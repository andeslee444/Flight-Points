import { getSearchResults } from '@/lib/search';
import { SearchForm } from '@/components/search-form';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    class?: string;
    program?: string;
    date?: string;
  }>;
}) {
  const params = await searchParams;
  const { from, to, class: cabin = 'business', program = 'amex-mr', date } = params;

  const hasSearch = Boolean(from && to);
  const results = hasSearch
    ? await getSearchResults({ from: from!, to: to!, cabin, program, date })
    : [];

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Search Award Flights</h1>
      <p className="text-muted-foreground mb-6">
        Find the best points redemptions across all programs
      </p>

      <SearchForm initialValues={params} />

      {hasSearch && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              {results.length} result{results.length !== 1 ? 's' : ''} for {from} &rarr; {to}
            </h2>
          </div>
          {results.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-lg">No award flights found</p>
              <p className="text-sm mt-2">
                The daemon scrapes this route periodically — try again later or adjust your search
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {results.map((deal) => (
                <div key={deal.id} className="p-4 border border-border rounded-lg">
                  <div className="flex justify-between">
                    <span className="font-medium">
                      {deal.airline} {deal.flightNumber}
                    </span>
                    <span className="text-primary font-bold">
                      {deal.pointsRequired.toLocaleString()} pts
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {deal.origin} &rarr; {deal.destination} &middot; {deal.cabinDisplay} &middot;{' '}
                    {deal.departureDate}
                    {deal.cpp != null && ` · ${deal.cpp}¢/pt`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!hasSearch && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg">Enter an origin and destination to search</p>
        </div>
      )}
    </main>
  );
}
