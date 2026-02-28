'use client';

import { useLiveSearchStore } from '@/stores/live-search-store';
import type { ScraperStatus } from '@/stores/live-search-store';

function StatusDot({ status }: { status: ScraperStatus }) {
  const colors: Record<ScraperStatus, string> = {
    pending: 'bg-muted-foreground/40',
    running: 'bg-yellow-500',
    done: 'bg-green-500',
    error: 'bg-red-500',
    skipped: 'bg-muted-foreground/40',
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${colors[status]}`}
    />
  );
}

export function LiveSearchProgress() {
  const { isLive, scrapers, elapsedSeconds } = useLiveSearchStore();

  const scraperList = Object.values(scrapers);

  // Don't render anything if no live search has been started
  if (!isLive && scraperList.length === 0) return null;

  // Check for search-level error (concurrency limit, etc.)
  const searchError = scrapers['__search-error'];

  return (
    <div className="border border-border rounded-lg p-4 mb-5 bg-card">
      <div className="flex items-center gap-2 mb-3">
        {isLive && (
          <span className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" />
        )}
        <span className="font-semibold text-sm text-foreground">
          {isLive ? 'Live search in progress' : 'Live search complete'}
        </span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {elapsedSeconds}s
        </span>
      </div>

      {searchError && searchError.status === 'error' && (
        <p className="text-sm text-muted-foreground mb-3">
          {searchError.message}
        </p>
      )}

      <div className="space-y-0.5">
        {scraperList
          .filter((s) => s.key !== '__search-error')
          .map((s) => (
            <div
              key={s.key}
              className="flex items-center gap-2 text-xs py-1 border-t border-border/30 first:border-0"
            >
              <StatusDot status={s.status} />
              <span className="font-medium w-36 shrink-0 truncate">
                {s.name || s.key}
              </span>
              <span className="text-muted-foreground truncate">
                {s.status === 'done' && s.resultCount > 0
                  ? `${s.resultCount} result${s.resultCount !== 1 ? 's' : ''}`
                  : s.message}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
