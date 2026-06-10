import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { relativeTime } from '@/lib/time';
import type { EnrichedDeal } from '@/lib/deals';

const TIER_COLORS: Record<string, string> = {
  S: 'bg-amber-500 text-black font-bold',
  A: 'bg-emerald-600 text-white',
  B: 'bg-blue-600 text-white',
};

const TIER_LABELS: Record<string, string> = {
  S: 'S-Tier: Holy Grail',
  A: 'A-Tier: Excellent',
  B: 'B-Tier: Great',
};

const RATING_LABEL: Record<string, string> = {
  hot: 'Hot deal',
  good: 'Good deal',
  fair: 'Fair',
  unknown: '',
};

export function DealCard({ deal }: { deal: EnrichedDeal }) {
  return (
    <Card className="bg-card border-border hover:border-muted-foreground/50 transition-colors cursor-pointer">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground truncate">{deal.airline}</span>
          {deal.sweetSpot && (
            <Badge className={TIER_COLORS[deal.sweetSpot.tier]}>
              {TIER_LABELS[deal.sweetSpot.tier]}
            </Badge>
          )}
        </div>
        <div className="text-xl font-bold">
          {deal.origin} → {deal.destination}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between items-end">
          <div>
            <div className="text-2xl font-bold text-primary">
              {deal.pointsRequired.toLocaleString()} pts
            </div>
            <div className="text-sm text-muted-foreground">{deal.cabinDisplay}</div>
          </div>
          {deal.cpp != null && (
            <div className="text-right">
              <div className="text-lg font-semibold text-emerald-400">{deal.cpp}¢/pt</div>
              <div className="text-xs text-muted-foreground">CPP</div>
            </div>
          )}
        </div>
        <div className="mt-3 flex justify-between text-xs text-muted-foreground">
          <span>{deal.departureDate}</span>
          <span>
            {deal.direct ? 'Direct' : `${deal.stops} stop${deal.stops > 1 ? 's' : ''}`}
          </span>
        </div>
        {deal.dealRating && deal.dealRating !== 'unknown' && (
          <div className="mt-1 text-xs text-muted-foreground">{RATING_LABEL[deal.dealRating]}</div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          Scraped {relativeTime(deal.scrapedAt)}
        </div>
      </CardContent>
    </Card>
  );
}
