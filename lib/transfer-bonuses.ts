/**
 * Transfer Bonus Configuration
 *
 * Manually updated when credit card programs announce transfer bonuses.
 * Bonuses are promotional offers (e.g., "40% Chase UR -> Virgin Atlantic")
 * that reduce the effective cost of points redemptions.
 *
 * There is no public API for this data — static config is the v1 approach.
 *
 * Update process:
 * 1. Check https://thepointsguy.com/loyalty-programs/current-transfer-bonuses/
 * 2. Check https://www.nerdwallet.com/travel/learn/credit-card-transfer-bonuses
 * 3. Update ACTIVE_TRANSFER_BONUSES array below
 * 4. Expired bonuses are automatically hidden at runtime (no cleanup needed)
 */

export interface TransferBonus {
  fromProgram: string;    // CC program slug, e.g. 'chase-ur'
  toProgram: string;      // Airline programCode, e.g. 'virgin-atlantic'
  bonusPct: number;       // e.g. 40 for 40% bonus
  description: string;    // e.g. '40% Chase UR -> Virgin Atlantic'
  expiresAt: string;      // 'YYYY-MM-DD' — filtered at runtime
}

// ================================================================
// ACTIVE TRANSFER BONUSES — Update when new bonuses are announced
// Expired entries are automatically hidden (no need to remove them)
// ================================================================

export const ACTIVE_TRANSFER_BONUSES: TransferBonus[] = [
  // Add active bonuses here when announced. Example format:
  // {
  //   fromProgram: 'chase-ur',
  //   toProgram: 'virgin-atlantic',
  //   bonusPct: 40,
  //   description: '40% Chase UR -> Virgin Atlantic',
  //   expiresAt: '2026-02-28',
  // },
];

/**
 * Returns only non-expired bonuses.
 */
export function getActiveBonuses(): TransferBonus[] {
  const today = new Date().toISOString().slice(0, 10);
  return ACTIVE_TRANSFER_BONUSES.filter((b) => b.expiresAt >= today);
}

/**
 * Find all active bonuses that transfer TO a specific airline program.
 * Returns bonuses from any CC program that has an active bonus to this airline.
 */
export function getBonusesForProgram(airlineProgramCode: string): TransferBonus[] {
  return getActiveBonuses().filter((b) => b.toProgram === airlineProgramCode);
}

/**
 * Compute effective points cost with bonus applied.
 *
 * A 40% bonus means 1 CC point -> 1.4 airline miles.
 * So you need FEWER CC points: effectiveCost = airlineMiles / (ratio * (1 + bonus/100))
 *
 * @param milesRequired - Airline miles needed for the award
 * @param transferRatio - Base CC -> airline ratio (e.g. 1.0 for 1:1)
 * @param bonusPct - Bonus percentage (e.g. 40 for 40%)
 * @returns Effective CC points needed (rounded up)
 */
export function effectiveBonusCost(
  milesRequired: number,
  transferRatio: number,
  bonusPct: number,
): number {
  const effectiveRatio = transferRatio * (1 + bonusPct / 100);
  return Math.ceil(milesRequired / effectiveRatio);
}
