/**
 * Transfer Partner Mappings
 * Maps credit card points programs to airline transfer partners
 * 
 * COMPLETE and CURRENT as of February 2026
 * Sources: NerdWallet, The Points Guy, official program pages
 * 
 * Created: 2026-02-16
 */

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
// SWEET SPOTS DATABASE
// ============================================================

const SWEET_SPOTS: Record<string, SweetSpot[]> = {
  'virgin-atlantic': [
    { route: 'US → Japan', cabin: 'First', points: 110000, typicalCashPrice: 25000, cpp: 22.7, notes: 'ANA First Class via Virgin Atlantic — the holy grail' },
    { route: 'US → Japan', cabin: 'Business', points: 90000, typicalCashPrice: 12000, cpp: 13.3, notes: 'ANA Business via Virgin Atlantic' },
    { route: 'US → UK', cabin: 'Business', points: 29000, typicalCashPrice: 4000, cpp: 13.8, notes: 'Virgin Atlantic Upper Class — dynamic low price' },
  ],
  'ana': [
    { route: 'US → Japan', cabin: 'First', points: 55000, typicalCashPrice: 25000, cpp: 45.5, notes: 'ANA First Class low season — best value in miles' },
    { route: 'US → Japan', cabin: 'Business', points: 43000, typicalCashPrice: 12000, cpp: 27.9, notes: 'ANA Business low season' },
    { route: 'Round the World', cabin: 'First', points: 180000, typicalCashPrice: 50000, cpp: 27.8, notes: 'ANA RTW in First Class' },
  ],
  'aeroplan': [
    { route: 'US → Europe', cabin: 'Business', points: 70000, typicalCashPrice: 5000, cpp: 7.1, notes: 'Star Alliance business to Europe' },
    { route: 'US → Asia', cabin: 'Business', points: 75000, typicalCashPrice: 8000, cpp: 10.7, notes: 'EVA/ANA business via Aeroplan' },
    { route: 'US → Middle East', cabin: 'Business', points: 70000, typicalCashPrice: 6000, cpp: 8.6, notes: 'Turkish business via Aeroplan' },
  ],
  'avianca-lifemiles': [
    { route: 'US → Europe', cabin: 'Business', points: 63000, typicalCashPrice: 5000, cpp: 7.9, notes: 'Star Alliance business, no fuel surcharges' },
    { route: 'US → Asia', cabin: 'Business', points: 70000, typicalCashPrice: 8000, cpp: 11.4, notes: 'ANA/EVA business via LifeMiles' },
  ],
  'united': [
    { route: 'US → Japan', cabin: 'Business', points: 80000, typicalCashPrice: 8000, cpp: 10.0, notes: 'United/ANA business saver' },
    { route: 'US → Europe', cabin: 'Business', points: 60000, typicalCashPrice: 4000, cpp: 6.7, notes: 'United Polaris or partner J' },
  ],
  'singapore': [
    { route: 'US → Singapore', cabin: 'Suites', points: 148000, typicalCashPrice: 18000, cpp: 12.2, notes: 'SQ Suites A380 — bucket list' },
    { route: 'US → Singapore', cabin: 'Business', points: 92000, typicalCashPrice: 8000, cpp: 8.7, notes: 'SQ Business direct' },
  ],
  'turkish': [
    { route: 'US → Europe', cabin: 'Business', points: 45000, typicalCashPrice: 4000, cpp: 8.9, notes: 'Star Alliance business to Europe — great value' },
    { route: 'US → Asia', cabin: 'Business', points: 52500, typicalCashPrice: 8000, cpp: 15.2, notes: 'Star Alliance business to Asia' },
  ],
  'ba-avios': [
    { route: 'US → Europe', cabin: 'Business', points: 57500, typicalCashPrice: 4000, cpp: 7.0, notes: 'oneworld business, watch for fuel surcharges on BA metal' },
    { route: 'US → Japan', cabin: 'Business', points: 60000, typicalCashPrice: 6000, cpp: 10.0, notes: 'JAL business via Avios — no surcharges on JAL' },
    { route: 'US → Middle East', cabin: 'Business', points: 42000, typicalCashPrice: 4000, cpp: 9.5, notes: 'Qatar QSuites short segment via Avios' },
  ],
  'american': [
    { route: 'US → Asia', cabin: 'Business', points: 60000, typicalCashPrice: 6000, cpp: 10.0, notes: 'JAL/Cathay business web special' },
    { route: 'US → Doha', cabin: 'Business', points: 70000, typicalCashPrice: 8000, cpp: 11.4, notes: 'Qatar QSuites via AA' },
    { route: 'US → Japan', cabin: 'First', points: 80000, typicalCashPrice: 20000, cpp: 25.0, notes: 'JAL First Class via AA — great deal' },
  ],
  'air-france-klm': [
    { route: 'US → Europe', cabin: 'Business', points: 53000, typicalCashPrice: 3500, cpp: 6.6, notes: 'AF/KLM business promo awards' },
  ],
  'emirates': [
    { route: 'US → Dubai', cabin: 'First', points: 136000, typicalCashPrice: 15000, cpp: 11.0, notes: 'Emirates First Class A380' },
    { route: 'US → Dubai', cabin: 'Business', points: 97000, typicalCashPrice: 7000, cpp: 7.2, notes: 'Emirates Business' },
  ],
  'delta': [
    { route: 'US → Europe', cabin: 'Business', points: 50000, typicalCashPrice: 3000, cpp: 6.0, notes: 'Delta One flash sales' },
  ],
  'alaska': [
    { route: 'US → Asia', cabin: 'Business', points: 50000, typicalCashPrice: 6000, cpp: 12.0, notes: 'Cathay Pacific business via Alaska' },
    { route: 'US → Japan', cabin: 'First', points: 70000, typicalCashPrice: 20000, cpp: 28.6, notes: 'JAL First Class via Alaska (pre-merger pricing)' },
  ],
  'cathay': [
    { route: 'US → HK', cabin: 'Business', points: 70000, typicalCashPrice: 6000, cpp: 8.6, notes: 'Cathay Pacific business direct' },
    { route: 'US → HK', cabin: 'First', points: 105000, typicalCashPrice: 15000, cpp: 14.3, notes: 'Cathay Pacific first direct' },
  ],
  'qatar': [
    { route: 'US → Doha', cabin: 'Business', points: 70000, typicalCashPrice: 8000, cpp: 11.4, notes: 'QSuites — frequently rated best business class' },
  ],
  'etihad': [
    { route: 'US → Abu Dhabi', cabin: 'Business', points: 60000, typicalCashPrice: 5000, cpp: 8.3, notes: 'Etihad Business Studios' },
  ],
};

// ============================================================
// POINTS PROGRAMS — COMPLETE AND CURRENT (Feb 2026)
// ============================================================

export const POINTS_PROGRAMS: PointsProgram[] = [
  {
    name: 'Amex Membership Rewards',
    slug: 'amex-mr',
    partners: [
      // Star Alliance
      { program: 'ANA Mileage Club', programCode: 'ana', alliance: 'star', ratio: 1.0, transferTime: '2-3 days', sweetSpots: SWEET_SPOTS['ana'] || [] },
      { program: 'Air Canada Aeroplan', programCode: 'aeroplan', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['aeroplan'] || [] },
      { program: 'Singapore KrisFlyer', programCode: 'singapore', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['singapore'] || [] },
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['avianca-lifemiles'] || [] },
      // oneworld
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['ba-avios'] || [] },
      { program: 'Cathay Pacific Asia Miles', programCode: 'cathay', alliance: 'oneworld', ratio: 0.8, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['cathay'] || [] },
      { program: 'Iberia Plus Avios', programCode: 'iberia', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Qantas Frequent Flyer', programCode: 'qantas', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'Qatar Airways Privilege Club', programCode: 'qatar', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['qatar'] || [] },
      { program: 'Aer Lingus AerClub', programCode: 'aer-lingus', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // SkyTeam
      { program: 'Delta SkyMiles', programCode: 'delta', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['delta'] || [] },
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['air-france-klm'] || [] },
      { program: 'Aeromexico Rewards', programCode: 'aeromexico', alliance: 'skyteam', ratio: 1.6, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['virgin-atlantic'] || [] },
      // Independent
      { program: 'Emirates Skywards', programCode: 'emirates', alliance: 'independent', ratio: 0.8, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['emirates'] || [] },
      { program: 'Etihad Guest', programCode: 'etihad', alliance: 'independent', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['etihad'] || [] },
      { program: 'JetBlue TrueBlue', programCode: 'jetblue', alliance: 'independent', ratio: 0.8, transferTime: 'Instant', sweetSpots: [] },
    ],
  },
  {
    name: 'Chase Ultimate Rewards',
    slug: 'chase-ur',
    partners: [
      // Star Alliance
      { program: 'United MileagePlus', programCode: 'united', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['united'] || [] },
      { program: 'Singapore KrisFlyer', programCode: 'singapore', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['singapore'] || [] },
      { program: 'Air Canada Aeroplan', programCode: 'aeroplan', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['aeroplan'] || [] },
      // oneworld
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['ba-avios'] || [] },
      { program: 'Aer Lingus AerClub', programCode: 'aer-lingus', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Iberia Plus Avios', programCode: 'iberia', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['air-france-klm'] || [] },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['virgin-atlantic'] || [] },
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
      { program: 'Air Canada Aeroplan', programCode: 'aeroplan', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['aeroplan'] || [] },
      { program: 'Singapore KrisFlyer', programCode: 'singapore', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['singapore'] || [] },
      { program: 'Turkish Miles&Smiles', programCode: 'turkish', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['turkish'] || [] },
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['avianca-lifemiles'] || [] },
      { program: 'TAP Miles&Go', programCode: 'tap', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Finnair Plus', programCode: 'finnair', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'EVA Air Infinity MileageLands', programCode: 'eva', alliance: 'star', ratio: 0.75, transferTime: '1-2 days', sweetSpots: [] },
      // oneworld
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['ba-avios'] || [] },
      { program: 'Cathay Pacific Asia Miles', programCode: 'cathay', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['cathay'] || [] },
      { program: 'Qantas Frequent Flyer', programCode: 'qantas', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'Qatar Airways Privilege Club', programCode: 'qatar', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['qatar'] || [] },
      { program: 'JAL Mileage Bank', programCode: 'jal', alliance: 'oneworld', ratio: 0.75, transferTime: '1-2 days', sweetSpots: [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['air-france-klm'] || [] },
      { program: 'Aeromexico Rewards', programCode: 'aeromexico', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // Independent
      { program: 'Emirates Skywards', programCode: 'emirates', alliance: 'independent', ratio: 0.75, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['emirates'] || [] },
      { program: 'Etihad Guest', programCode: 'etihad', alliance: 'independent', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['etihad'] || [] },
      { program: 'Virgin Red', programCode: 'virgin-atlantic', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['virgin-atlantic'] || [] },
      { program: 'JetBlue TrueBlue', programCode: 'jetblue', alliance: 'independent', ratio: 0.6, transferTime: 'Instant', sweetSpots: [] },
    ],
  },
  {
    name: 'Citi ThankYou Points',
    slug: 'citi-typ',
    partners: [
      // Star Alliance
      { program: 'Singapore KrisFlyer', programCode: 'singapore', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['singapore'] || [] },
      { program: 'Turkish Miles&Smiles', programCode: 'turkish', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['turkish'] || [] },
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['avianca-lifemiles'] || [] },
      { program: 'EVA Air Infinity MileageLands', programCode: 'eva', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'Thai Airways Royal Orchid Plus', programCode: 'thai', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      // oneworld
      { program: 'American Airlines AAdvantage', programCode: 'american', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['american'] || [] },
      { program: 'Cathay Pacific Asia Miles', programCode: 'cathay', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['cathay'] || [] },
      { program: 'Qantas Frequent Flyer', programCode: 'qantas', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: [] },
      { program: 'Qatar Airways Privilege Club', programCode: 'qatar', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['qatar'] || [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['air-france-klm'] || [] },
      { program: 'Aeromexico Rewards', programCode: 'aeromexico', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['virgin-atlantic'] || [] },
      // Independent
      { program: 'Emirates Skywards', programCode: 'emirates', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['emirates'] || [] },
      { program: 'Etihad Guest', programCode: 'etihad', alliance: 'independent', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['etihad'] || [] },
      { program: 'JetBlue TrueBlue', programCode: 'jetblue', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
    ],
  },
  {
    name: 'Bilt Rewards',
    slug: 'bilt',
    partners: [
      // Star Alliance
      { program: 'United MileagePlus', programCode: 'united', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['united'] || [] },
      { program: 'Air Canada Aeroplan', programCode: 'aeroplan', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['aeroplan'] || [] },
      { program: 'Turkish Miles&Smiles', programCode: 'turkish', alliance: 'star', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['turkish'] || [] },
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['avianca-lifemiles'] || [] },
      { program: 'TAP Miles&Go', programCode: 'tap', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // oneworld
      { program: 'American Airlines AAdvantage', programCode: 'american', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['american'] || [] },
      { program: 'Alaska/Hawaiian Atmos Rewards', programCode: 'alaska', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['alaska'] || [] },
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['ba-avios'] || [] },
      { program: 'Cathay Pacific Asia Miles', programCode: 'cathay', alliance: 'oneworld', ratio: 1.0, transferTime: '1-2 days', sweetSpots: SWEET_SPOTS['cathay'] || [] },
      { program: 'Aer Lingus AerClub', programCode: 'aer-lingus', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Iberia Plus Avios', programCode: 'iberia', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['air-france-klm'] || [] },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['virgin-atlantic'] || [] },
      // Independent
      { program: 'Emirates Skywards', programCode: 'emirates', alliance: 'independent', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['emirates'] || [] },
      { program: 'Southwest Rapid Rewards', programCode: 'southwest', alliance: 'independent', ratio: 1.0, transferTime: '1-3 days', sweetSpots: [] },
    ],
  },
  {
    name: 'Wells Fargo Rewards',
    slug: 'wells-fargo',
    partners: [
      // oneworld
      { program: 'British Airways Avios', programCode: 'ba-avios', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['ba-avios'] || [] },
      { program: 'Aer Lingus AerClub', programCode: 'aer-lingus', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      { program: 'Iberia Plus Avios', programCode: 'iberia', alliance: 'oneworld', ratio: 1.0, transferTime: 'Instant', sweetSpots: [] },
      // SkyTeam
      { program: 'Air France/KLM Flying Blue', programCode: 'air-france-klm', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['air-france-klm'] || [] },
      { program: 'Virgin Atlantic Flying Club', programCode: 'virgin-atlantic', alliance: 'skyteam', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['virgin-atlantic'] || [] },
      // Star Alliance
      { program: 'Avianca LifeMiles', programCode: 'avianca-lifemiles', alliance: 'star', ratio: 1.0, transferTime: 'Instant', sweetSpots: SWEET_SPOTS['avianca-lifemiles'] || [] },
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

// Map seats.aero source codes to our program codes
export const SEATS_AERO_SOURCE_MAP: Record<string, string> = {
  'united': 'united',
  'aeroplan': 'aeroplan',
  'virginatlantic': 'virgin-atlantic',
  'singapore': 'singapore',
  'ana': 'ana',
  'british_airways': 'ba-avios',
  'american': 'american',
  'delta': 'delta',
  'emirates': 'emirates',
  'turkish': 'turkish',
  'airfrance': 'air-france-klm',
  'lifemiles': 'avianca-lifemiles',
  'qantas': 'qantas',
  'alaska': 'alaska',
  'etihad': 'etihad',
};
