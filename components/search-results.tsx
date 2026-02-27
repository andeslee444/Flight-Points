'use client';

import { FlightResultCard } from './flight-result-card';
import type { EnrichedDeal } from '@/lib/enrichment';

interface SearchResultsProps {
  results: EnrichedDeal[];
  from: string;
  to: string;
}

export function SearchResults({ results, from, to }: SearchResultsProps) {
  // Metro dedup toggle will be added in Plan 03-04
  const displayResults = results;

  if (displayResults.length === 0) {
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
      {displayResults.map((deal) => (
        <FlightResultCard key={deal.id} deal={deal} />
      ))}
    </div>
  );
}
