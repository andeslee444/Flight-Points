/**
 * History Writer
 *
 * Appends confirmed flight results to the price_history table after each
 * daemon scrape cycle. Only 'confirmed' availability type results are written.
 * Calendar/estimated data is explicitly excluded.
 *
 * Note: Uses r.pointsRequired and r.taxesAndFees (FlightResult fields).
 * The plan referenced r.milesRequired/r.taxesUSD which do not exist on FlightResult.
 */
import { getPool } from './db.js';
import type { FlightResult, AvailabilityType } from './types.js';

export async function writeHistoryBatch(
  results: FlightResult[],
  scraperKey: string,
  availabilityType: AvailabilityType,
  cycleId: string,
): Promise<number> {
  // Gate: only confirmed availability enters price_history.
  // Calendar/estimated data would corrupt time-series queries.
  if (availabilityType !== 'confirmed') return 0;

  const validResults = results.filter(
    r => r.pointsRequired && r.origin && r.destination && r.departureDate
  );
  if (validResults.length === 0) return 0;

  const pool = getPool();
  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query('BEGIN');
    for (const r of validResults) {
      await client.query(
        `INSERT INTO price_history
           (origin, destination, cabin, program, flight_number, departure_date,
            departure_time, miles, taxes_usd, availability_type, scrape_cycle_id, scraped_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,NOW())`,
        [
          r.origin,
          r.destination,
          r.cabin ?? 'unknown',
          scraperKey,
          r.flightNumber ?? null,
          r.departureDate,
          r.departureTime ?? null,
          r.pointsRequired,
          r.taxesAndFees ?? null,
          cycleId,
        ],
      );
      inserted++;
    }
    await client.query('COMMIT');
    console.log(`[history-writer] Inserted ${inserted} rows for ${scraperKey} (cycle: ${cycleId})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[history-writer] Failed to write history for ${scraperKey}:`, err);
    throw err;
  } finally {
    client.release();
  }
  return inserted;
}
