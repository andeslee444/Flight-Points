/**
 * Sweet Spots Database
 * Known incredible award redemptions that should be flagged to users
 * 
 * These are the "holy grail" bookings that points enthusiasts seek out.
 * When we detect availability matching these routes/programs, we flag them.
 * 
 * Sources: The Points Guy, One Mile at a Time, Thrifty Traveler, AwardWallet
 * Current as of February 2026
 * 
 * Created: 2026-02-16
 */

export interface SweetSpotEntry {
  id: string;
  route: string;              // Origin-Destination or wildcard (e.g., '*-NRT', 'JFK-DOH')
  originRegion?: string;      // 'US', 'Europe', etc.
  destinationRegion?: string;
  cabin: 'economy' | 'business' | 'first' | 'suites';
  bookingProgram: string;     // Program to book through
  programCode: string;        // Internal code
  pointsRequired: number;     // One-way
  operatingAirline: string;   // Actual airline flying
  product: string;            // Specific product name
  typicalCashPrice: number;   // Approximate cash price
  centsPerPoint: number;
  transferFrom: string[];     // Credit card programs that transfer to this
  note: string;
  tier: 'S' | 'A' | 'B';     // S = must-book, A = excellent, B = great
  tags: string[];
}

// ============================================================
// THE DATABASE
// ============================================================

export const SWEET_SPOTS: SweetSpotEntry[] = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // S-TIER: The absolute best deals in points travel
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'ana-f-virgin',
    route: '*-NRT',
    originRegion: 'US',
    destinationRegion: 'Japan',
    cabin: 'first',
    bookingProgram: 'Virgin Atlantic Flying Club',
    programCode: 'virgin-atlantic',
    pointsRequired: 110000,
    operatingAirline: 'ANA',
    product: 'ANA First Class (THE Suite/THE Room)',
    typicalCashPrice: 25000,
    centsPerPoint: 22.7,
    transferFrom: ['Amex MR', 'Chase UR', 'Citi TYP', 'Capital One', 'Bilt'],
    note: 'ANA First Class via Virgin Atlantic — THE holy grail of award travel. Transferable from every major program.',
    tier: 'S',
    tags: ['first-class', 'japan', 'ana', 'aspirational'],
  },
  {
    id: 'ana-f-ana-low',
    route: '*-NRT',
    originRegion: 'US',
    destinationRegion: 'Japan',
    cabin: 'first',
    bookingProgram: 'ANA Mileage Club',
    programCode: 'ana',
    pointsRequired: 55000,
    operatingAirline: 'ANA',
    product: 'ANA First Class (low season)',
    typicalCashPrice: 25000,
    centsPerPoint: 45.5,
    transferFrom: ['Amex MR'],
    note: 'ANA First Class booked direct with ANA miles in low season — insane value at 55K miles. Amex MR only transfer partner.',
    tier: 'S',
    tags: ['first-class', 'japan', 'ana', 'low-season'],
  },
  {
    id: 'qatar-qsuites-aa',
    route: 'JFK-DOH',
    originRegion: 'US',
    destinationRegion: 'Middle East',
    cabin: 'business',
    bookingProgram: 'American AAdvantage',
    programCode: 'american',
    pointsRequired: 70000,
    operatingAirline: 'Qatar Airways',
    product: 'Qatar QSuites',
    typicalCashPrice: 8000,
    centsPerPoint: 11.4,
    transferFrom: ['Citi TYP', 'Bilt'],
    note: 'Qatar QSuites — frequently rated the world\'s best business class. Book via AA miles. Also: IAD-DOH, ORD-DOH, MIA-DOH, DFW-DOH.',
    tier: 'S',
    tags: ['business-class', 'qsuites', 'qatar', 'middle-east'],
  },
  {
    id: 'sq-suites',
    route: '*-SIN',
    originRegion: 'US',
    destinationRegion: 'Singapore',
    cabin: 'suites',
    bookingProgram: 'Singapore KrisFlyer',
    programCode: 'singapore',
    pointsRequired: 148000,
    operatingAirline: 'Singapore Airlines',
    product: 'Singapore Suites (A380)',
    typicalCashPrice: 18000,
    centsPerPoint: 12.2,
    transferFrom: ['Amex MR', 'Chase UR', 'Citi TYP', 'Capital One', 'Bilt'],
    note: 'Singapore Suites — the most luxurious first class in the sky. Must book via KrisFlyer (no partner bookings).',
    tier: 'S',
    tags: ['suites', 'singapore', 'aspirational', 'a380'],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // A-TIER: Excellent deals
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'turkish-j-europe',
    route: '*-IST',
    originRegion: 'US',
    destinationRegion: 'Europe',
    cabin: 'business',
    bookingProgram: 'Turkish Miles&Smiles',
    programCode: 'turkish',
    pointsRequired: 45000,
    operatingAirline: 'Star Alliance',
    product: 'Star Alliance Business to Europe',
    typicalCashPrice: 4000,
    centsPerPoint: 8.9,
    transferFrom: ['Citi TYP', 'Capital One', 'Bilt'],
    note: 'Turkish Miles&Smiles: 45K for Star Alliance business to Europe. One of the cheapest business class redemptions available.',
    tier: 'A',
    tags: ['business-class', 'europe', 'star-alliance', 'value'],
  },
  {
    id: 'jal-f-aa',
    route: '*-NRT',
    originRegion: 'US',
    destinationRegion: 'Japan',
    cabin: 'first',
    bookingProgram: 'American AAdvantage',
    programCode: 'american',
    pointsRequired: 80000,
    operatingAirline: 'Japan Airlines',
    product: 'JAL First Class',
    typicalCashPrice: 20000,
    centsPerPoint: 25.0,
    transferFrom: ['Citi TYP', 'Bilt'],
    note: 'JAL First Class via AA — excellent product, 80K miles one-way. Also bookable via Alaska for 70K.',
    tier: 'A',
    tags: ['first-class', 'japan', 'jal', 'oneworld'],
  },
  {
    id: 'ana-j-virgin',
    route: '*-NRT',
    originRegion: 'US',
    destinationRegion: 'Japan',
    cabin: 'business',
    bookingProgram: 'Virgin Atlantic Flying Club',
    programCode: 'virgin-atlantic',
    pointsRequired: 90000,
    operatingAirline: 'ANA',
    product: 'ANA Business Class (THE Room)',
    typicalCashPrice: 12000,
    centsPerPoint: 13.3,
    transferFrom: ['Amex MR', 'Chase UR', 'Citi TYP', 'Capital One', 'Bilt'],
    note: 'ANA Business Class via Virgin — THE Room is one of the best business class products.',
    tier: 'A',
    tags: ['business-class', 'japan', 'ana'],
  },
  {
    id: 'emirates-f-a380',
    route: '*-DXB',
    originRegion: 'US',
    destinationRegion: 'Middle East',
    cabin: 'first',
    bookingProgram: 'Emirates Skywards',
    programCode: 'emirates',
    pointsRequired: 136000,
    operatingAirline: 'Emirates',
    product: 'Emirates First Class A380 (shower suite)',
    typicalCashPrice: 15000,
    centsPerPoint: 11.0,
    transferFrom: ['Amex MR', 'Citi TYP', 'Capital One', 'Bilt'],
    note: 'Emirates A380 First Class with shower suite and bar. Iconic experience.',
    tier: 'A',
    tags: ['first-class', 'emirates', 'a380', 'aspirational'],
  },
  {
    id: 'virgin-upper-class',
    route: '*-LHR',
    originRegion: 'US',
    destinationRegion: 'Europe',
    cabin: 'business',
    bookingProgram: 'Virgin Atlantic Flying Club',
    programCode: 'virgin-atlantic',
    pointsRequired: 29000,
    operatingAirline: 'Virgin Atlantic',
    product: 'Virgin Atlantic Upper Class',
    typicalCashPrice: 4000,
    centsPerPoint: 13.8,
    transferFrom: ['Amex MR', 'Chase UR', 'Citi TYP', 'Capital One', 'Bilt'],
    note: 'Virgin Upper Class from 29K points with dynamic pricing. Great value trans-Atlantic.',
    tier: 'A',
    tags: ['business-class', 'europe', 'virgin', 'dynamic-pricing'],
  },
  {
    id: 'cathay-j-alaska',
    route: '*-HKG',
    originRegion: 'US',
    destinationRegion: 'Asia',
    cabin: 'business',
    bookingProgram: 'Alaska Mileage Plan (Atmos Rewards)',
    programCode: 'alaska',
    pointsRequired: 50000,
    operatingAirline: 'Cathay Pacific',
    product: 'Cathay Pacific Business Class',
    typicalCashPrice: 6000,
    centsPerPoint: 12.0,
    transferFrom: ['Bilt'],
    note: 'Cathay Pacific business via Alaska/Atmos — 50K miles. Bilt is the only transferable currency to Alaska.',
    tier: 'A',
    tags: ['business-class', 'asia', 'cathay', 'oneworld'],
  },
  {
    id: 'flying-blue-promo',
    route: '*-CDG',
    originRegion: 'US',
    destinationRegion: 'Europe',
    cabin: 'business',
    bookingProgram: 'Air France/KLM Flying Blue',
    programCode: 'air-france-klm',
    pointsRequired: 53000,
    operatingAirline: 'Air France/KLM',
    product: 'Air France/KLM Business (Promo Awards)',
    typicalCashPrice: 3500,
    centsPerPoint: 6.6,
    transferFrom: ['Amex MR', 'Chase UR', 'Citi TYP', 'Capital One', 'Bilt', 'Wells Fargo'],
    note: 'Flying Blue monthly promo awards — can go as low as 53K in business. Check monthly promo page.',
    tier: 'A',
    tags: ['business-class', 'europe', 'promo', 'skyteam'],
  },
  {
    id: 'lifemiles-j-europe',
    route: '*-EUR',
    originRegion: 'US',
    destinationRegion: 'Europe',
    cabin: 'business',
    bookingProgram: 'Avianca LifeMiles',
    programCode: 'avianca-lifemiles',
    pointsRequired: 63000,
    operatingAirline: 'Star Alliance',
    product: 'Star Alliance Business to Europe',
    typicalCashPrice: 5000,
    centsPerPoint: 7.9,
    transferFrom: ['Amex MR', 'Citi TYP', 'Capital One', 'Bilt', 'Wells Fargo'],
    note: 'LifeMiles: 63K for Star Alliance business to Europe. No fuel surcharges on any bookings.',
    tier: 'A',
    tags: ['business-class', 'europe', 'star-alliance', 'no-surcharges'],
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // B-TIER: Great deals
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'aeroplan-j-europe',
    route: '*-EUR',
    originRegion: 'US',
    destinationRegion: 'Europe',
    cabin: 'business',
    bookingProgram: 'Air Canada Aeroplan',
    programCode: 'aeroplan',
    pointsRequired: 70000,
    operatingAirline: 'Star Alliance',
    product: 'Star Alliance Business to Europe',
    typicalCashPrice: 5000,
    centsPerPoint: 7.1,
    transferFrom: ['Amex MR', 'Chase UR', 'Capital One', 'Bilt'],
    note: 'Aeroplan: flexible routing rules allow stopovers. 70K for business to Europe.',
    tier: 'B',
    tags: ['business-class', 'europe', 'star-alliance', 'stopover'],
  },
  {
    id: 'avios-short-haul',
    route: 'short-haul',
    originRegion: 'US',
    destinationRegion: 'US',
    cabin: 'economy',
    bookingProgram: 'British Airways Avios',
    programCode: 'ba-avios',
    pointsRequired: 7500,
    operatingAirline: 'American Airlines',
    product: 'AA Short-Haul via Avios',
    typicalCashPrice: 300,
    centsPerPoint: 4.0,
    transferFrom: ['Amex MR', 'Chase UR', 'Capital One', 'Bilt', 'Wells Fargo'],
    note: 'Avios for AA short-haul flights under 1,151 miles: 7,500 Avios + ~$5.60 in taxes.',
    tier: 'B',
    tags: ['economy', 'domestic', 'short-haul', 'aa'],
  },
  {
    id: 'jal-j-avios',
    route: '*-NRT',
    originRegion: 'US',
    destinationRegion: 'Japan',
    cabin: 'business',
    bookingProgram: 'British Airways Avios',
    programCode: 'ba-avios',
    pointsRequired: 60000,
    operatingAirline: 'Japan Airlines',
    product: 'JAL Business Class via Avios',
    typicalCashPrice: 6000,
    centsPerPoint: 10.0,
    transferFrom: ['Amex MR', 'Chase UR', 'Capital One', 'Bilt', 'Wells Fargo'],
    note: 'JAL business via Avios — no fuel surcharges on JAL metal. Low taxes.',
    tier: 'B',
    tags: ['business-class', 'japan', 'jal', 'low-taxes'],
  },
  {
    id: 'delta-one-flash',
    route: '*-EUR',
    originRegion: 'US',
    destinationRegion: 'Europe',
    cabin: 'business',
    bookingProgram: 'Delta SkyMiles',
    programCode: 'delta',
    pointsRequired: 50000,
    operatingAirline: 'Delta',
    product: 'Delta One Flash Sales',
    typicalCashPrice: 3000,
    centsPerPoint: 6.0,
    transferFrom: ['Amex MR'],
    note: 'Delta One to Europe for 50K during flash sales. Dynamic pricing — watch for drops.',
    tier: 'B',
    tags: ['business-class', 'europe', 'delta', 'flash-sale'],
  },
  {
    id: 'etihad-j',
    route: '*-AUH',
    originRegion: 'US',
    destinationRegion: 'Middle East',
    cabin: 'business',
    bookingProgram: 'Etihad Guest',
    programCode: 'etihad',
    pointsRequired: 60000,
    operatingAirline: 'Etihad',
    product: 'Etihad Business Studios',
    typicalCashPrice: 5000,
    centsPerPoint: 8.3,
    transferFrom: ['Amex MR', 'Citi TYP', 'Capital One'],
    note: 'Etihad Business Studios — excellent product. Also bookable via AA for partner awards.',
    tier: 'B',
    tags: ['business-class', 'middle-east', 'etihad'],
  },
  {
    id: 'ana-rtw',
    route: 'RTW',
    originRegion: 'US',
    destinationRegion: 'RTW',
    cabin: 'first',
    bookingProgram: 'ANA Mileage Club',
    programCode: 'ana',
    pointsRequired: 180000,
    operatingAirline: 'Star Alliance',
    product: 'ANA Round-the-World in First Class',
    typicalCashPrice: 50000,
    centsPerPoint: 27.8,
    transferFrom: ['Amex MR'],
    note: 'ANA RTW award: 180K miles for first class around the world on Star Alliance. Must include Japan.',
    tier: 'B',
    tags: ['first-class', 'rtw', 'ana', 'star-alliance'],
  },
];

// ============================================================
// HELPERS
// ============================================================

/**
 * Check if a flight result matches any sweet spots
 */
export function matchSweetSpots(
  origin: string,
  destination: string,
  cabin: string,
  programCode?: string,
): SweetSpotEntry[] {
  return SWEET_SPOTS.filter(spot => {
    // Match cabin
    const cabinMatch = spot.cabin === cabin || spot.cabin === 'suites' && cabin === 'first';
    if (!cabinMatch) return false;

    // Match program if specified
    if (programCode && spot.programCode !== programCode) return false;

    // Match route
    if (spot.route === 'RTW' || spot.route === 'short-haul') return false; // Special cases
    const [spotOrigin, spotDest] = spot.route.split('-');
    const originMatch = spotOrigin === '*' || spotOrigin === origin;
    const destMatch = spotDest === destination || spotDest === '*'
      || (spotDest === 'EUR' && isEuropean(destination))
      || (spotDest === 'NRT' && isJapanese(destination));

    return originMatch && destMatch;
  });
}

/**
 * Get all sweet spots sorted by tier then cents per point
 */
export function getSweetSpotsByTier(tier?: 'S' | 'A' | 'B'): SweetSpotEntry[] {
  const filtered = tier ? SWEET_SPOTS.filter(s => s.tier === tier) : SWEET_SPOTS;
  return filtered.sort((a, b) => {
    if (a.tier !== b.tier) {
      const tierOrder = { S: 0, A: 1, B: 2 };
      return tierOrder[a.tier] - tierOrder[b.tier];
    }
    return b.centsPerPoint - a.centsPerPoint;
  });
}

/**
 * Get sweet spots reachable from a specific credit card program
 */
export function getSweetSpotsForProgram(creditCardProgram: string): SweetSpotEntry[] {
  return SWEET_SPOTS.filter(spot =>
    spot.transferFrom.some(p => p.toLowerCase().includes(creditCardProgram.toLowerCase()))
  );
}

// Helpers
function isEuropean(code: string): boolean {
  const euAirports = ['LHR', 'CDG', 'FRA', 'MUC', 'FCO', 'BCN', 'MAD', 'AMS', 'ZRH', 'VIE', 'IST', 'ATH', 'LIS', 'CPH', 'ARN', 'HEL', 'OSL', 'DUB', 'BRU', 'GVA'];
  return euAirports.includes(code);
}

function isJapanese(code: string): boolean {
  const jpAirports = ['NRT', 'HND', 'KIX', 'NGO', 'FUK', 'CTS', 'OKA'];
  return jpAirports.includes(code);
}

export default { SWEET_SPOTS, matchSweetSpots, getSweetSpotsByTier, getSweetSpotsForProgram };
