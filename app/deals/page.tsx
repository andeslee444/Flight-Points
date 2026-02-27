import { getTopDeals } from '@/lib/deals';
import { DealFeed } from '@/components/deal-feed';

export const dynamic = 'force-dynamic'; // Always fetch fresh data from flight_cache

export default async function DealsPage() {
  const deals = await getTopDeals({ limit: 50 });

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Award Deal Feed</h1>
      <p className="text-muted-foreground mb-6">
        Best current award flight deals across all programs
      </p>
      <DealFeed deals={deals} />
    </main>
  );
}
