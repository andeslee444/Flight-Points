/**
 * United Award Search via Aeroplan + Camoufox (Python subprocess wrapper)
 *
 * Uses Aeroplan (Air Canada) to find Star Alliance award space including United metal.
 * Requires AEROPLAN_USERNAME and AEROPLAN_PASSWORD env vars (login required since March 2025).
 *
 * Created: 2026-02-16
 */

import { FlightResult, SearchParams } from '../types.js';
import { runCamoufoxSearch, runCamoufoxBatch, type CamoufoxRunnerOptions } from './camoufox-runner.js';

const OPTS: CamoufoxRunnerOptions = {
  label: 'UA-Aeroplan-TS',
  script: 'united-aeroplan-camoufox.py',
  cachePrefix: 'united-aeroplan',
  timeoutMs: 150_000,
  batchDelayMs: 45000,
};

function log(msg: string) {
  console.log(`[UA-Aeroplan-TS ${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

export function searchUnitedViaAeroplan(params: SearchParams): Promise<FlightResult[]> {
  if (!process.env.AEROPLAN_USERNAME || !process.env.AEROPLAN_PASSWORD) {
    log('Skipping: AEROPLAN_USERNAME and AEROPLAN_PASSWORD env vars required');
    return Promise.resolve([]);
  }
  return runCamoufoxSearch(params, OPTS);
}

export async function searchUnitedMetalViaAeroplan(params: SearchParams): Promise<FlightResult[]> {
  const all = await searchUnitedViaAeroplan(params);
  return all.filter(f =>
    f.flightNumber?.includes('UA') ||
    f.airline === 'United Airlines'
  );
}

export async function searchUnitedViaAeroplanBatch(
  paramsList: SearchParams[],
  delayBetweenMs: number = 45000,
): Promise<Map<string, FlightResult[]>> {
  return runCamoufoxBatch(paramsList, { ...OPTS, batchDelayMs: delayBetweenMs }, searchUnitedViaAeroplan);
}
