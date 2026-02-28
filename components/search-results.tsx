'use client';

import { useMemo } from 'react';
import { FlightResultCard } from './flight-result-card';
import { LiveSearchProgress } from './live-search-progress';
import { MetroToggle } from './metro-toggle';
import { useSearchStore } from '@/stores/search-store';
import { useLiveSearchStore } from '@/stores/live-search-store';
import { useLiveSearch } from '@/hooks/use-live-search';
import type { EnrichedDeal } from '@/lib/enrichment';
import type { LiveFlightResult } from '@/stores/live-search-store';

interface SearchResultsProps {
  results: EnrichedDeal[];
  from: string;
  to: string;
  cabin: string;
  program: string;
  date?: string;
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

/**
 * Map a Harbor-enriched LiveFlightResult to an EnrichedDeal.
 * Fills in defaults for fields that Harbor's enrichFlightResult() doesn't provide.
 */
function liveResultToEnrichedDeal(flight: LiveFlightResult): EnrichedDeal {
  return {
    // Fields present in both
    airline: flight.airline,
    flightNumber: flight.flightNumber,
    origin: flight.origin,
    destination: flight.destination,
    departureDate: flight.departureDate,
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
    duration: flight.duration,
    stops: flight.stops,
    cabin: flight.cabin,
    pointsRequired: flight.pointsRequired,
    pointsProgram: flight.pointsProgram,
    points: flight.points,
    taxes: flight.taxes,
    cpp: flight.cpp,
    dealRating: flight.dealRating,
    cabinDisplay: flight.cabinDisplay,
    route: flight.route,
    direct: flight.direct,
    program: flight.program,
    programDisplay: flight.programDisplay,
    transferPath: flight.transferPath,
    bookingUrl: flight.bookingUrl,
    source: flight.source,
    // Defaults for fields not in Harbor's enrichment
    transferFrom: [],
    sweetSpot: null,
    region: '',
    transferBonuses: [],
    scrapedAt: new Date().toISOString(),
    id: `live-${flight.airline}-${flight.flightNumber}-${flight.departureDate}-${flight.cabin}`,
  };
}

export function SearchResults({ results, from, to, cabin, program, date }: SearchResultsProps) {
  const { showAllAirports } = useSearchStore();
  const { liveResults } = useLiveSearchStore();

  // Always trigger live search when search params are present
  useLiveSearch(from, to, cabin, program, date);

  // Merge SSR results with live results, deduplicating
  const mergedResults = useMemo(() => {
    const seen = new Set<string>();
    const merged: EnrichedDeal[] = [];

    // SSR results first (they have full enrichment including sweetSpot, transferFrom, etc.)
    for (const deal of results) {
      const key = `${deal.airline}-${deal.flightNumber}-${deal.departureDate}-${deal.cabin}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(deal);
      }
    }

    // Live results second (mapped to EnrichedDeal with defaults for missing fields)
    for (const flight of liveResults) {
      const key = `${flight.airline}-${flight.flightNumber}-${flight.departureDate}-${flight.cabin}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(liveResultToEnrichedDeal(flight));
      }
    }

    return merged;
  }, [results, liveResults]);

  // Metro dedup: when collapsed, keep only the first (best CPP) result per metro group
  const displayResults = showAllAirports ? mergedResults : (() => {
    const seen = new Set<string>();
    return mergedResults.filter((deal) => {
      const originRep = METRO_GROUPS[deal.origin] || deal.origin;
      const destRep = METRO_GROUPS[deal.destination] || deal.destination;
      const key = `${originRep}-${destRep}-${deal.cabin}-${deal.airline}-${deal.departureDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();

  if (displayResults.length === 0 && results.length === 0 && liveResults.length === 0) {
    return (
      <div>
        <LiveSearchProgress />
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg">
            No award flights found for {from} &rarr; {to}
          </p>
          <p className="text-sm mt-2">
            The daemon scrapes this route periodically — try again later or adjust your search
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <LiveSearchProgress />
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">
          {displayResults.length} result{displayResults.length !== 1 ? 's' : ''}
          {!showAllAirports && displayResults.length < mergedResults.length &&
            ` (${mergedResults.length - displayResults.length} nearby grouped)`
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
