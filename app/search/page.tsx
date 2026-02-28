import { getSearchResults } from '@/lib/search';
import { getPriceHistory } from '@/lib/price-history';
import { SearchForm } from '@/components/search-form';
import { SearchResults } from '@/components/search-results';
import { CoverageNotices } from '@/components/coverage-notices';
import { PriceHistoryChart } from '@/components/price-history-chart';

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

  const primaryFrom = from ? from.split(',')[0]?.trim().toUpperCase() : '';
  const primaryTo = to ? to.split(',')[0]?.trim().toUpperCase() : '';
  const historyData = hasSearch
    ? await getPriceHistory(primaryFrom, primaryTo, cabin)
    : [];

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Search Award Flights</h1>
      <p className="text-muted-foreground mb-6">
        Find the best points redemptions across all programs
      </p>

      <SearchForm initialValues={params} />
      <CoverageNotices />

      {hasSearch && (
        <div className="mt-8">
          <SearchResults results={results} from={from!} to={to!} />
        </div>
      )}

      {hasSearch && (
        <PriceHistoryChart
          data={historyData}
          from={primaryFrom}
          to={primaryTo}
          cabin={cabin}
        />
      )}

      {!hasSearch && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg">Enter an origin and destination to search</p>
        </div>
      )}
    </main>
  );
}
