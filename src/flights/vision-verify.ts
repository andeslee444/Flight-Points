/**
 * Vision-based anomaly classifier.
 *
 * The silent-zero detector (scraper-health.recordZero → `suspect`) knows a
 * scraper returned 0 but not WHY. A screenshot of the page at the moment of
 * failure, classified by a Claude vision call, resolves the ambiguity:
 *   - genuinely_no_availability — page loaded, just no award space (benign)
 *   - blocked_or_captcha        — Akamai/Cloudflare/captcha wall
 *   - login_wall                — session expired, sign-in required
 *   - layout_changed            — page loaded with results but our parser missed them (DOM drift)
 *   - unknown                   — couldn't tell
 *
 * Cost is trivial because it's gated to anomalies only (canary EMPTY/FAIL, or
 * the daemon's first suspect-flip): a ~1300px PNG on Haiku is ~$0.0017/call.
 *
 * Dormant until ANTHROPIC_API_KEY is set — classifyAnomaly() returns null (and
 * logs) when the key or the screenshot is missing, so it never breaks a caller.
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';

// claude-haiku-4-5: cheapest vision-capable model; supports structured outputs.
// (Verified against the current model catalog — do not append a date suffix.)
const VISION_MODEL = 'claude-haiku-4-5';

export type AnomalyLabel =
  | 'genuinely_no_availability'
  | 'blocked_or_captcha'
  | 'login_wall'
  | 'layout_changed'
  | 'unknown';

export interface AnomalyDiagnosis {
  label: AnomalyLabel;
  confidence: number; // 0..1
  evidence: string; // short human-readable justification
}

const VALID_LABELS: AnomalyLabel[] = [
  'genuinely_no_availability',
  'blocked_or_captcha',
  'login_wall',
  'layout_changed',
  'unknown',
];

function log(msg: string): void {
  console.error(`[vision-verify ${new Date().toISOString()}] ${msg}`);
}

/** Most recent diagnostic screenshot for a scraper, or null if none exist. */
export function findLatestDiagnostic(scraperKey: string, dir: string): string | null {
  try {
    if (!fs.existsSync(dir)) return null;
    const prefix = `${scraperKey}-`;
    const matches = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.png'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    return matches.length ? path.join(dir, matches[0].f) : null;
  } catch {
    return null;
  }
}

function extractJson(text: string): any | null {
  // Tolerate prose around the JSON (Haiku usually returns clean JSON, but be safe).
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Classify why a scraper returned no results, from a screenshot of the page.
 * Returns null (never throws) when the API key or image is missing, or on any
 * API/parse error — callers treat null as "couldn't diagnose".
 *
 * @param imagePath  PNG screenshot captured by the scraper at failure time.
 * @param context    Human description of the search, e.g. "United JFK→NRT business 2026-07-25; scraper returned 0 results".
 */
export async function classifyAnomaly(
  imagePath: string,
  context: string,
): Promise<AnomalyDiagnosis | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    log('ANTHROPIC_API_KEY not set — skipping vision classification.');
    return null;
  }
  let b64: string;
  try {
    b64 = fs.readFileSync(imagePath).toString('base64');
  } catch (e: any) {
    log(`Could not read screenshot ${imagePath}: ${e.message}`);
    return null;
  }

  const prompt =
    `This is a screenshot of an airline award-flight search page. Context: ${context}. ` +
    `Our scraper returned 0 results — classify WHY into exactly one label:\n` +
    `- "genuinely_no_availability": the page loaded normally and simply shows no award seats for these dates\n` +
    `- "blocked_or_captcha": a bot-detection / captcha / "access denied" / Akamai / Cloudflare challenge page\n` +
    `- "login_wall": a sign-in / session-expired page blocking the search\n` +
    `- "layout_changed": the page DOES show flight results, meaning our parser missed them (site redesign)\n` +
    `- "unknown": none of the above is clear\n` +
    `Respond with ONLY a JSON object: {"label": <one label>, "confidence": <0..1>, "evidence": "<short reason>"}`;

  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    const textBlock = resp.content.find((b) => b.type === 'text');
    const raw = textBlock && 'text' in textBlock ? textBlock.text : '';
    const parsed = extractJson(raw);
    if (!parsed || !VALID_LABELS.includes(parsed.label)) {
      log(`Unparseable vision response: ${raw.slice(0, 120)}`);
      return null;
    }
    return {
      label: parsed.label,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      evidence: typeof parsed.evidence === 'string' ? parsed.evidence.slice(0, 300) : '',
    };
  } catch (e: any) {
    log(`Vision API call failed: ${e.message}`);
    return null;
  }
}
