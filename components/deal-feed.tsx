import { DealCard } from './deal-card';
import type { EnrichedDeal } from '@/lib/deals';

export function DealFeed({ deals }: { deals: EnrichedDeal[] }) {
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {deals.map((deal) => (
        <DealCard key={deal.id} deal={deal} />
      ))}
    </div>
  );
}
