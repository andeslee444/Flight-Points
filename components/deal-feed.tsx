'use client';

import { useDealFilterStore } from '@/stores/filter-store';
import { DealCard } from './deal-card';
import type { EnrichedDeal } from '@/lib/deals';

export function DealFeed({ deals }: { deals: EnrichedDeal[] }) {
  const { cabin, region, program } = useDealFilterStore();

  if (deals.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">No deals available right now</p>
        <p className="text-sm mt-2">
          The daemon scrapes flights every 30 minutes — check back soon
        </p>
      </div>
    );
  }

  const filtered = deals.filter((deal) => {
    // Cabin filter
    if (cabin !== 'all' && deal.cabin !== cabin) return false;

    // Region filter — match destination region
    if (region !== 'all' && deal.region !== region) return false;

    // Program filter — check if any transfer partner matches
    if (program !== 'all' && !deal.transferFrom.includes(program)) return false;

    return true;
  });

  if (filtered.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">No deals match your filters</p>
        <p className="text-sm mt-2">
          Try broadening your search — select &quot;All&quot; in the filters
          above
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {filtered.map((deal) => (
        <DealCard key={deal.id} deal={deal} />
      ))}
    </div>
  );
}
