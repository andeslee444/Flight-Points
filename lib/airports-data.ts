// lib/airports-data.ts — static airport list for autocomplete
export interface AirportOption {
  code: string;
  city: string;
  region: string;
}

export const AIRPORT_LIST: AirportOption[] = [
  // US
  { code: 'JFK', city: 'New York JFK', region: 'US' },
  { code: 'EWR', city: 'Newark', region: 'US' },
  { code: 'LGA', city: 'New York LaGuardia', region: 'US' },
  { code: 'LAX', city: 'Los Angeles', region: 'US' },
  { code: 'SFO', city: 'San Francisco', region: 'US' },
  { code: 'ORD', city: "Chicago O'Hare", region: 'US' },
  { code: 'IAD', city: 'Washington Dulles', region: 'US' },
  { code: 'DFW', city: 'Dallas Fort Worth', region: 'US' },
  { code: 'ATL', city: 'Atlanta', region: 'US' },
  { code: 'BOS', city: 'Boston', region: 'US' },
  { code: 'SEA', city: 'Seattle', region: 'US' },
  { code: 'MIA', city: 'Miami', region: 'US' },
  { code: 'IAH', city: 'Houston', region: 'US' },
  { code: 'DEN', city: 'Denver', region: 'US' },
  { code: 'PHX', city: 'Phoenix', region: 'US' },
  // Europe
  { code: 'LHR', city: 'London Heathrow', region: 'Europe' },
  { code: 'CDG', city: 'Paris CDG', region: 'Europe' },
  { code: 'FRA', city: 'Frankfurt', region: 'Europe' },
  { code: 'AMS', city: 'Amsterdam', region: 'Europe' },
  { code: 'FCO', city: 'Rome', region: 'Europe' },
  { code: 'MAD', city: 'Madrid', region: 'Europe' },
  { code: 'BCN', city: 'Barcelona', region: 'Europe' },
  { code: 'MUC', city: 'Munich', region: 'Europe' },
  { code: 'ZRH', city: 'Zurich', region: 'Europe' },
  { code: 'VIE', city: 'Vienna', region: 'Europe' },
  { code: 'CPH', city: 'Copenhagen', region: 'Europe' },
  { code: 'ARN', city: 'Stockholm', region: 'Europe' },
  { code: 'OSL', city: 'Oslo', region: 'Europe' },
  { code: 'HEL', city: 'Helsinki', region: 'Europe' },
  { code: 'DUB', city: 'Dublin', region: 'Europe' },
  { code: 'LIS', city: 'Lisbon', region: 'Europe' },
  { code: 'ATH', city: 'Athens', region: 'Europe' },
  { code: 'IST', city: 'Istanbul', region: 'Europe' },
  { code: 'WAW', city: 'Warsaw', region: 'Europe' },
  { code: 'PRG', city: 'Prague', region: 'Europe' },
  { code: 'BRU', city: 'Brussels', region: 'Europe' },
  { code: 'GVA', city: 'Geneva', region: 'Europe' },
  // Japan
  { code: 'NRT', city: 'Tokyo Narita', region: 'Japan' },
  { code: 'HND', city: 'Tokyo Haneda', region: 'Japan' },
  { code: 'KIX', city: 'Osaka Kansai', region: 'Japan' },
  { code: 'NGO', city: 'Nagoya', region: 'Japan' },
  { code: 'FUK', city: 'Fukuoka', region: 'Japan' },
  { code: 'CTS', city: 'Sapporo', region: 'Japan' },
  { code: 'OKA', city: 'Okinawa', region: 'Japan' },
  // Korea
  { code: 'ICN', city: 'Seoul Incheon', region: 'Korea' },
  { code: 'GMP', city: 'Seoul Gimpo', region: 'Korea' },
  // China/HK/TW
  { code: 'PEK', city: 'Beijing', region: 'China/HK/TW' },
  { code: 'PVG', city: 'Shanghai Pudong', region: 'China/HK/TW' },
  { code: 'HKG', city: 'Hong Kong', region: 'China/HK/TW' },
  { code: 'TPE', city: 'Taipei', region: 'China/HK/TW' },
  // Southeast Asia
  { code: 'SIN', city: 'Singapore', region: 'SEA' },
  { code: 'BKK', city: 'Bangkok', region: 'SEA' },
  { code: 'MNL', city: 'Manila', region: 'SEA' },
  { code: 'SGN', city: 'Ho Chi Minh City', region: 'SEA' },
  { code: 'HAN', city: 'Hanoi', region: 'SEA' },
  { code: 'KUL', city: 'Kuala Lumpur', region: 'SEA' },
  // India
  { code: 'DEL', city: 'Delhi', region: 'India' },
  { code: 'BOM', city: 'Mumbai', region: 'India' },
  { code: 'BLR', city: 'Bangalore', region: 'India' },
  // Middle East
  { code: 'DOH', city: 'Doha', region: 'Middle East' },
  { code: 'DXB', city: 'Dubai', region: 'Middle East' },
  { code: 'AUH', city: 'Abu Dhabi', region: 'Middle East' },
  { code: 'JED', city: 'Jeddah', region: 'Middle East' },
  { code: 'RUH', city: 'Riyadh', region: 'Middle East' },
  // Australia/NZ
  { code: 'SYD', city: 'Sydney', region: 'Australia/NZ' },
  { code: 'MEL', city: 'Melbourne', region: 'Australia/NZ' },
  { code: 'BNE', city: 'Brisbane', region: 'Australia/NZ' },
  { code: 'PER', city: 'Perth', region: 'Australia/NZ' },
  { code: 'AKL', city: 'Auckland', region: 'Australia/NZ' },
];
