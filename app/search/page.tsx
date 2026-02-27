import { getSearchResults } from '@/lib/search';
import { SearchForm } from '@/components/search-form';
import { SearchResults } from '@/components/search-results';

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
          <SearchResults results={results} from={from!} to={to!} />
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
