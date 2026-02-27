import { Badge } from '@/components/ui/badge';
import { ALLIANCE_LABELS, SCRAPER_HEALTH_NOTICES } from '@/lib/coverage';

export function CoverageNotices() {
  return (
    <div className="space-y-3 mt-6 mb-2">
      {/* Alliance coverage labels */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(ALLIANCE_LABELS).map(([key, label]) => (
          <Badge
            key={key}
            variant="outline"
            className="text-xs text-muted-foreground border-border font-normal py-1"
          >
            {label}
          </Badge>
        ))}
      </div>

      {/* Scraper health notices */}
      {SCRAPER_HEALTH_NOTICES.length > 0 && (
        <div className="space-y-1">
          {SCRAPER_HEALTH_NOTICES.map((notice, i) => (
            <div
              key={i}
              className={`text-xs px-3 py-1.5 rounded ${
                notice.severity === 'warning'
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
              }`}
            >
              {notice.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
