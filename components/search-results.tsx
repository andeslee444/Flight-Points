'use client';

import { FlightResultCard } from './flight-result-card';
import { MetroToggle } from './metro-toggle';
import { useSearchStore } from '@/stores/search-store';
import type { EnrichedDeal } from '@/lib/enrichment';

interface SearchResultsProps {
  results: EnrichedDeal[];
  from: string;
  to: string;
}

const METRO_GROUPS: Record<string, string> = {
  // NYC
  JFK: 'JFK', LGA: 'JFK', EWR: 'JFK',
  // Tokyo
  NRT: 'NRT', HND: 'NRT',
  // Los Angeles
  LAX: 'LAX', SNA: 'LAX', BUR: 'LAX', LGB: 'LAX',
  // Chicago
  ORD: 'ORD', MDW: 'ORD',
  // San Francisco Bay
  SFO: 'SFO', OAK: 'SFO', SJC: 'SFO',
  // Washington DC
  IAD: 'IAD', DCA: 'IAD',
  // Dallas
  DFW: 'DFW', DAL: 'DFW',
  // Houston
  IAH: 'IAH', HOU: 'IAH',
  // Miami
  MIA: 'MIA',
  // London
  LHR: 'LHR', LGW: 'LHR', LCY: 'LHR',
  // Paris
  CDG: 'CDG', ORY: 'CDG',
  // Seoul
  ICN: 'ICN', GMP: 'ICN',
  // Shanghai
  PVG: 'PVG', SHA: 'PVG',
  // Beijing
  PEK: 'PEK', PKX: 'PEK',
  // Osaka
  KIX: 'KIX', ITM: 'KIX',
};

export function SearchResults({ results, from, to }: SearchResultsProps) {
  const { showAllAirports } = useSearchStore();

  // Metro dedup: when collapsed, keep only the first (best CPP) result per metro group
  const displayResults = showAllAirports ? results : (() => {
    const seen = new Set<string>();
    return results.filter((deal) => {
      const originRep = METRO_GROUPS[deal.origin] || deal.origin;
      const destRep = METRO_GROUPS[deal.destination] || deal.destination;
      const key = `${originRep}-${destRep}-${deal.cabin}-${deal.airline}-${deal.departureDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  if (displayResults.length === 0 && results.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">
          No award flights found for {from} &rarr; {to}
        </p>
        <p className="text-sm mt-2">
          The daemon scrapes this route periodically — try again later or adjust your search
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">
          {displayResults.length} result{displayResults.length !== 1 ? 's' : ''}
          {!showAllAirports && displayResults.length < results.length &&
            ` (${results.length - displayResults.length} nearby grouped)`
          }
        </span>
        <MetroToggle />
      </div>
      {displayResults.map((deal) => (
        <FlightResultCard key={deal.id} deal={deal} />
      ))}
    </div>
  );
}
