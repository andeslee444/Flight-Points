/**
 * Transfer Partner Mappings
 * Maps credit card points programs to airline transfer partners
 *
 * COMPLETE and CURRENT as of February 2026
 * Sources: NerdWallet, The Points Guy, official program pages
 *
 * Created: 2026-02-16
 */

import { SWEET_SPOTS as SWEET_SPOTS_DB } from './sweet-spots.js';
import { REGION_LABELS } from './airports.js';

export interface TransferPartner {
  program: string;          // Airline loyalty program name
  programCode: string;      // Internal code for matching
  alliance: 'star' | 'oneworld' | 'skyteam' | 'independent';
  ratio: number;            // Transfer ratio (points you GET per 1 point sent, e.g. 0.8 = 5:4)
  transferTime: string;     // Typical transfer time
  sweetSpots: SweetSpot[];  // Known sweet spot redemptions
}

export interface SweetSpot {
  route: string;            // e.g., "US → Japan"
  cabin: string;            // e.g., "First", "Business"
  points: number;           // Points required one-way
  typicalCashPrice: number; // Typical cash price for comparison
  cpp: number;              // Cents per point value
  notes: string;
}

export interface PointsProgram {
  name: string;
  slug: string;
  partners: TransferPartner[];
}

// ============================================================
// SWEET SPOTS — derived from canonical sweet-spots.ts database
// ============================================================

/**
 * Convert canonical SweetSpotEntry[] → per-partner SweetSpot[] lookup.
 * Bridges field name differences: pointsRequired → points, note → notes, etc.
 */
function getSweetSpotsForPartnerCode(partnerCode: string): SweetSpot[] {
  return SWEET_SPOTS_DB
    .filter(e => e.programCode === partnerCode)
    .map(e => ({
      route: e.originRegion && e.destinationRegion
        ? `${REGION_LABELS[e.originRegion] || e.originRegion} → ${REGION_LABELS[e.destinationRegion] || e.destinationRegion}`
        : e.route,
      cabin: e.cabin.charAt(0).toUpperCase() + e.cabin.slice(1),
      points: e.pointsRequired,
      typicalCashPrice: e.typicalCashPrice,
      cpp: e.centsPerPoint,
      notes: e.note,
    }));
}

// ============================================================
// POINTS PROGRAMS — COMPLETE AND CURRENT (Feb 2026)
// ============================================================

export const POINTS_PROGRAMS: PointsProgram[] = [
  {
    name: 'Amex Membership Rewards',
    slug: 'amex-mr',
    partners: [
      // Star Alliance
      { program: 'ANA Mileage Club', programCode: 'ana', alliance: 'star', ratio: 1.0, transferTime: '2-3 days', sweetSpots: getSweetSpotsForPartnerCode('ana') },
      { program: 'Air Canada Aeroplan', programCode: 'aeroplan', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('aeroplan') },
      { program: 'Singapore KrisFlyer', programCode: 'singapore', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('singapore') },
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('avianca-lifemiles') },
      // oneworld
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('ba-avios') },
      { program: 'Cathay Pacific Asia Miles', programCode: 'cathay', alliance: 'oneworld', ratio: 0.8, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('cathay') },
      { program: 'Iberia Plus Avios', programCode: 'iberia', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Qantas Frequent Flyer', programCode: 'qantas', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'Qatar Airways Privilege Club', programCode: 'qatar', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('qatar') },
      { program: 'Aer Lingus AerClub', programCode: 'aer-lingus', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // SkyTeam
      { program: 'Delta SkyMiles', programCode: 'delta', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('delta') },
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('air-france-klm') },
      { program: 'Aeromexico Rewards', programCode: 'aeromexico', alliance: 'skyteam', ratio: 1.6, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('virgin-atlantic') },
      // Independent
      { program: 'Emirates Skywards', programCode: 'emirates', alliance: 'independent', ratio: 0.8, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('emirates') },
      { program: 'Etihad Guest', programCode: 'etihad', alliance: 'independent', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('etihad') },
      { program: 'JetBlue TrueBlue', programCode: 'jetblue', alliance: 'independent', ratio: 0.8, transferTime: 'Instant', sweetSpots: [] },
    ],
  },
  {
    name: 'Chase Ultimate Rewards',
    slug: 'chase-ur',
    partners: [
      // Star Alliance
      { program: 'United MileagePlus', programCode: 'united', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('united') },
      { program: 'Singapore KrisFlyer', programCode: 'singapore', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('singapore') },
      { program: 'Air Canada Aeroplan', programCode: 'aeroplan', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('aeroplan') },
      // oneworld
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('ba-avios') },
      { program: 'Aer Lingus AerClub', programCode: 'aer-lingus', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Iberia Plus Avios', programCode: 'iberia', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('air-france-klm') },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('virgin-atlantic') },
      // Independent
      { program: 'Southwest Rapid Rewards', programCode: 'southwest', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'JetBlue TrueBlue', programCode: 'jetblue', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // Hotels (included for completeness)
      // IHG One Rewards, Marriott Bonvoy, World of Hyatt — not airline partners
    ],
  },
  {
    name: 'Capital One Miles',
    slug: 'capital-one',
    partners: [
      // Star Alliance
      { program: 'Air Canada Aeroplan', programCode: 'aeroplan', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('aeroplan') },
      { program: 'Singapore KrisFlyer', programCode: 'singapore', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('singapore') },
      { program: 'Turkish Miles&Smiles', programCode: 'turkish', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('turkish') },
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('avianca-lifemiles') },
      { program: 'TAP Miles&Go', programCode: 'tap', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Finnair Plus', programCode: 'finnair', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'EVA Air Infinity MileageLands', programCode: 'eva', alliance: 'star', ratio: 0.75, transferTime: '1-2 days', sweetSpots: [] },
      // oneworld
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('ba-avios') },
      { program: 'Cathay Pacific Asia Miles', programCode: 'cathay', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('cathay') },
      { program: 'Qantas Frequent Flyer', programCode: 'qantas', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'Qatar Airways Privilege Club', programCode: 'qatar', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('qatar') },
      { program: 'JAL Mileage Bank', programCode: 'jal', alliance: 'oneworld', ratio: 0.75, transferTime: '1-2 days', sweetSpots: [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('air-france-klm') },
      { program: 'Aeromexico Rewards', programCode: 'aeromexico', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // Independent
      { program: 'Emirates Skywards', programCode: 'emirates', alliance: 'independent', ratio: 0.75, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('emirates') },
      { program: 'Etihad Guest', programCode: 'etihad', alliance: 'independent', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('etihad') },
      { program: 'Virgin Red', programCode: 'virgin-atlantic', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('virgin-atlantic') },
      { program: 'JetBlue TrueBlue', programCode: 'jetblue', alliance: 'independent', ratio: 0.6, transferTime: 'Instant', sweetSpots: [] },
    ],
  },
  {
    name: 'Citi ThankYou Points',
    slug: 'citi-typ',
    partners: [
      // Star Alliance
      { program: 'Singapore KrisFlyer', programCode: 'singapore', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('singapore') },
      { program: 'Turkish Miles&Smiles', programCode: 'turkish', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('turkish') },
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('avianca-lifemiles') },
      { program: 'EVA Air Infinity MileageLands', programCode: 'eva', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'Thai Airways Royal Orchid Plus', programCode: 'thai', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      // oneworld
      { program: 'American Airlines AAdvantage', programCode: 'american', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('american') },
      { program: 'Cathay Pacific Asia Miles', programCode: 'cathay', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('cathay') },
      { program: 'Qantas Frequent Flyer', programCode: 'qantas', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'Qatar Airways Privilege Club', programCode: 'qatar', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('qatar') },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('air-france-klm') },
      { program: 'Aeromexico Rewards', programCode: 'aeromexico', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('virgin-atlantic') },
      // Independent
      { program: 'Emirates Skywards', programCode: 'emirates', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('emirates') },
      { program: 'Etihad Guest', programCode: 'etihad', alliance: 'independent', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('etihad') },
      { program: 'JetBlue TrueBlue', programCode: 'jetblue', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
    ],
  },
  {
    name: 'Bilt Rewards',
    slug: 'bilt',
    partners: [
      // Star Alliance
      { program: 'United MileagePlus', programCode: 'united', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('united') },
      { program: 'Air Canada Aeroplan', programCode: 'aeroplan', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('aeroplan') },
      { program: 'Turkish Miles&Smiles', programCode: 'turkish', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('turkish') },
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('avianca-lifemiles') },
      { program: 'TAP Miles&Go', programCode: 'tap', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // oneworld
      { program: 'American Airlines AAdvantage', programCode: 'american', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('american') },
      { program: 'Alaska/Hawaiian Atmos Rewards', programCode: 'alaska', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('alaska') },
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('ba-avios') },
      { program: 'Cathay Pacific Asia Miles', programCode: 'cathay', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: getSweetSpotsForPartnerCode('cathay') },
      { program: 'Aer Lingus AerClub', programCode: 'aer-lingus', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Iberia Plus Avios', programCode: 'iberia', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('air-france-klm') },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('virgin-atlantic') },
      // Independent
      { program: 'Emirates Skywards', programCode: 'emirates', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('emirates') },
      { program: 'Southwest Rapid Rewards', programCode: 'southwest', alliance: 'independent', ratio: 1.0, transferTime: '1-3 days', sweetSpots: [] },
    ],
  },
  {
    name: 'Wells Fargo Rewards',
    slug: 'wells-fargo',
    partners: [
      // oneworld
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('ba-avios') },
      { program: 'Aer Lingus AerClub', programCode: 'aer-lingus', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Iberia Plus Avios', programCode: 'iberia', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('air-france-klm') },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('virgin-atlantic') },
      // Star Alliance
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: getSweetSpotsForPartnerCode('avianca-lifemiles') },
    ],
  },
];

// ============================================================
// HELPERS
// ============================================================

export function getProgramBySlug(slug: string): PointsProgram | undefined {
  return POINTS_PROGRAMS.find(p => p.slug === slug);
}

export function getTransferPartnersForProgram(slug: string): TransferPartner[] {
  return getProgramBySlug(slug)?.partners || [];
}

export function getAllProgramCodes(slug: string): string[] {
  return getTransferPartnersForProgram(slug).map(p => p.programCode);
}

/**
 * Find which credit card programs can transfer to a given airline program
 */
export function findProgramsForAirline(airlineProgramCode: string): Array<{ program: PointsProgram; partner: TransferPartner }> {
  const results: Array<{ program: PointsProgram; partner: TransferPartner }> = [];
  for (const program of POINTS_PROGRAMS) {
    const partner = program.partners.find(p => p.programCode === airlineProgramCode);
    if (partner) {
      results.push({ program, partner });
    }
  }
  return results;
}

/**
 * Calculate effective points cost including transfer ratio
 */
export function effectivePointsCost(pointsRequired: number, transferRatio: number): number {
  return Math.ceil(pointsRequired / transferRatio);
}

export function findBestSweetSpot(programSlug: string, origin: string, destination: string, cabin: string): SweetSpot | null {
  const partners = getTransferPartnersForProgram(programSlug);
  let best: { spot: SweetSpot; partner: TransferPartner } | null = null;

  for (const partner of partners) {
    for (const spot of partner.sweetSpots) {
      const matchesCabin = cabin === 'any' || spot.cabin.toLowerCase().includes(cabin.toLowerCase());
      if (matchesCabin) {
        if (!best || spot.cpp > best.spot.cpp) {
          best = { spot, partner };
        }
      }
    }
  }

  return best?.spot || null;
}
