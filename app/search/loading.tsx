export default function SearchLoading() {
  return (
    <main className="container mx-auto px-4 py-8">
      <div className="h-8 w-64 bg-muted animate-pulse rounded mb-2" />
      <div className="h-5 w-96 bg-muted animate-pulse rounded mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted animate-pulse rounded" />
        ))}
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    </main>
  );
}
