/**
 * Self-healing parser AUTO-REPAIR — closes the detect→recover loop.
 *
 * The vision classifier (`vision-verify.ts`) tells us WHY a CDP scraper that
 * loaded a page parsed 0 results: when it flags `layout_changed`, the page
 * actually HAS flight results but our DOM selector drifted (site redesign).
 * This module acts on that signal: it asks an LLM to propose a fresh selector,
 * then — critically — VALIDATES the proposal against the golden route's expected
 * result before swapping it in. A proposal only ships if it actually reproduces
 * the known-good extraction (>= expected count, miles in range). A bad proposal
 * is REJECTED and the last-known selector is kept untouched, so a hallucinated
 * or broken repair can never reach production.
 *
 * Everything that touches the network is INJECTABLE (the `llm` and `validate`
 * functions, plus the `store`), so this is fully unit-testable with no real
 * LLM, no browser, and no network. A real default `LlmRepairFn` is provided but
 * stays DORMANT — it returns null without ANTHROPIC_API_KEY — so importing this
 * module never makes a surprise API call.
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

// claude-haiku-4-5: cheapest vision-capable model; the screenshot + DOM snippet
// fit comfortably and selector generation is a cheap, well-bounded task.
// (Matches vision-verify.ts — do not append a date suffix.)
const REPAIR_MODEL = 'claude-haiku-4-5';

/** A candidate CSS selector returned by the LLM, with optional self-reported confidence. */
export interface SelectorProposal {
  selector: string;
  confidence?: number; // 0..1, advisory only — we trust validation, not self-report
}

/**
 * Injectable LLM call. Given the drifted page's DOM (and optionally a
 * screenshot) plus the selector that used to work and what we expect to find,
 * returns a fresh selector proposal — or null if it can't / won't propose one
 * (e.g. dormant without an API key).
 */
export type LlmRepairFn = (input: {
  screenshotPath?: string;
  domHtml: string;
  lastKnownSelector: string;
  expected: { cabin?: string; minCount: number };
}) => Promise<SelectorProposal | null>;

/**
 * Injectable validator. Runs a candidate selector against the GOLDEN page and
 * reports exactly what it would extract: how many rows and a sample of the
 * miles values. This is the ground truth the repair is judged against.
 */
export type ValidateFn = (
  selector: string,
) => Promise<{ count: number; sampleMiles: number[] }>;

/** Persistence for the current selector per scraper. */
export interface SelectorStore {
  get(scraperKey: string): Promise<string | null>;
  set(scraperKey: string, selector: string): Promise<void>;
}

/** Trivial in-process store — handy for tests and single-process daemons. */
export class InMemorySelectorStore implements SelectorStore {
  private readonly map = new Map<string, string>();

  async get(scraperKey: string): Promise<string | null> {
    return this.map.has(scraperKey) ? (this.map.get(scraperKey) as string) : null;
  }

  async set(scraperKey: string, selector: string): Promise<void> {
    this.map.set(scraperKey, selector);
  }
}

/**
 * Disk-backed store: a single JSON map persisted to `filePath`, so a validated
 * selector swap survives daemon/canary restarts. Reads tolerate a missing or
 * corrupt file (treated as empty). Writes are best-effort and atomic-ish.
 */
export class DiskSelectorStore implements SelectorStore {
  constructor(private readonly filePath: string) {}

  private read(): Record<string, string> {
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async get(scraperKey: string): Promise<string | null> {
    return this.read()[scraperKey] ?? null;
  }

  async set(scraperKey: string, selector: string): Promise<void> {
    const map = this.read();
    map[scraperKey] = selector;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}

export interface AutoRepairContext {
  domHtml: string;
  screenshotPath?: string;
  expected: {
    cabin?: string;
    minCount: number;
    /** If given, every sampled miles value must fall within [min, max] inclusive. */
    milesRange?: [number, number];
  };
}

export interface AutoRepairResult {
  repaired: boolean;
  /** The selector now in the store. On success, the new one; on failure, the kept old one (if any). */
  newSelector?: string;
  reason: string;
}

function log(msg: string): void {
  console.error(`[parser-autorepair ${new Date().toISOString()}] ${msg}`);
}

function inRange(value: number, [min, max]: [number, number]): boolean {
  return value >= min && value <= max;
}

export class ParserAutoRepair {
  private readonly llm: LlmRepairFn;
  private readonly validate: ValidateFn;
  private readonly store: SelectorStore;

  constructor(opts: { llm: LlmRepairFn; validate: ValidateFn; store: SelectorStore }) {
    this.llm = opts.llm;
    this.validate = opts.validate;
    this.store = opts.store;
  }

  /**
   * Attempt to repair a drifted selector for `scraperKey`.
   *
   * Flow: ask the LLM for a proposal → validate it against the golden
   * expectation → hot-swap (persist) ONLY if it reproduces >= minCount results
   * AND (if a milesRange is given) every sampled miles value is in range.
   * Otherwise reject and leave the last-known selector untouched.
   *
   * Never throws on LLM/validate failure — returns a `repaired:false` result
   * with a reason so the caller can keep using the old selector.
   */
  async attemptRepair(
    scraperKey: string,
    ctx: AutoRepairContext,
  ): Promise<AutoRepairResult> {
    const lastKnown = (await this.store.get(scraperKey)) ?? '';

    // 1) Ask the LLM for a candidate selector.
    let proposal: SelectorProposal | null;
    try {
      proposal = await this.llm({
        screenshotPath: ctx.screenshotPath,
        domHtml: ctx.domHtml,
        lastKnownSelector: lastKnown,
        expected: { cabin: ctx.expected.cabin, minCount: ctx.expected.minCount },
      });
    } catch (e: any) {
      log(`LLM call threw for ${scraperKey}: ${e?.message ?? e}`);
      return {
        repaired: false,
        newSelector: lastKnown || undefined,
        reason: `llm error: ${e?.message ?? e} — kept last-known selector`,
      };
    }

    if (!proposal || !proposal.selector || !proposal.selector.trim()) {
      // No proposal — e.g. dormant LLM without an API key, or it declined.
      return {
        repaired: false,
        newSelector: lastKnown || undefined,
        reason: 'no proposal from llm (none returned / dormant without key) — kept last-known selector',
      };
    }

    const candidate = proposal.selector;

    // 2) Validate the candidate against the golden page. NEVER hot-swap unvalidated.
    let result: { count: number; sampleMiles: number[] };
    try {
      result = await this.validate(candidate);
    } catch (e: any) {
      log(`Validation threw for ${scraperKey} (${candidate}): ${e?.message ?? e}`);
      return {
        repaired: false,
        newSelector: lastKnown || undefined,
        reason: `validation error: ${e?.message ?? e} — rejected proposal, kept last-known selector`,
      };
    }

    // 3a) Count guard: must reproduce at least the expected number of results.
    if (result.count < ctx.expected.minCount) {
      return {
        repaired: false,
        newSelector: lastKnown || undefined,
        reason:
          `rejected: proposal "${candidate}" extracted ${result.count} < expected minCount ${ctx.expected.minCount} ` +
          `— kept last-known selector`,
      };
    }

    // 3b) Miles-range guard: every sampled value must be plausible award pricing.
    if (ctx.expected.milesRange) {
      const range = ctx.expected.milesRange;
      const offenders = result.sampleMiles.filter((m) => !inRange(m, range));
      // An in-range count with no actual miles samples is suspect — a real
      // results table yields miles, so require at least one sample to verify.
      if (result.sampleMiles.length === 0) {
        return {
          repaired: false,
          newSelector: lastKnown || undefined,
          reason:
            `rejected: proposal "${candidate}" matched ${result.count} nodes but extracted no miles values ` +
            `(cannot verify miles range) — kept last-known selector`,
        };
      }
      if (offenders.length > 0) {
        return {
          repaired: false,
          newSelector: lastKnown || undefined,
          reason:
            `rejected: proposal "${candidate}" miles out of range [${range[0]}, ${range[1]}] ` +
            `(offenders: ${offenders.join(', ')}) — kept last-known selector`,
        };
      }
    }

    // 4) Validated — hot-swap by persisting the new selector.
    await this.store.set(scraperKey, candidate);
    return {
      repaired: true,
      newSelector: candidate,
      reason:
        `validated: "${candidate}" reproduced ${result.count} results ` +
        `(>= ${ctx.expected.minCount})` +
        (ctx.expected.milesRange
          ? `, miles in [${ctx.expected.milesRange[0]}, ${ctx.expected.milesRange[1]}]`
          : '') +
        ' — hot-swapped + persisted',
    };
  }
}

/**
 * Real, production LlmRepairFn backed by Claude. DORMANT by default: returns
 * null (and logs) without ANTHROPIC_API_KEY, so importing/wiring this never
 * triggers a surprise API call. Tests inject a fake llm instead.
 */
export const defaultLlmRepairFn: LlmRepairFn = async (input) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    log('ANTHROPIC_API_KEY not set — repair LLM dormant, returning null.');
    return null;
  }

  // Truncate DOM so we stay well within token budget; the relevant results
  // block is what matters, not the whole document.
  const domSnippet = input.domHtml.slice(0, 12000);

  const content: Anthropic.MessageParam['content'] = [];
  if (input.screenshotPath) {
    try {
      const b64 = fs.readFileSync(input.screenshotPath).toString('base64');
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: b64 },
      });
    } catch (e: any) {
      log(`Could not read screenshot ${input.screenshotPath}: ${e?.message ?? e}`);
    }
  }
  content.push({
    type: 'text',
    text:
      `An airline award-search page redesigned and our CSS selector stopped matching ` +
      `flight-result rows. Old selector: "${input.lastKnownSelector}". ` +
      (input.expected.cabin ? `Cabin of interest: ${input.expected.cabin}. ` : '') +
      `We expect at least ${input.expected.minCount} result rows. ` +
      `Given the DOM below, propose ONE new CSS selector that matches the flight-result rows.\n\n` +
      `Respond with ONLY JSON: {"selector": "<css>", "confidence": <0..1>}\n\n` +
      `DOM:\n${domSnippet}`,
  });

  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: REPAIR_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content }],
    });
    const textBlock = resp.content.find((b) => b.type === 'text');
    const raw = textBlock && 'text' in textBlock ? textBlock.text : '';
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) {
      log(`Unparseable repair response: ${raw.slice(0, 120)}`);
      return null;
    }
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (typeof parsed.selector !== 'string' || !parsed.selector.trim()) return null;
    return {
      selector: parsed.selector,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    };
  } catch (e: any) {
    log(`Repair LLM call failed: ${e?.message ?? e}`);
    return null;
  }
};
