import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/time';
import type { EnrichedDeal } from '@/lib/enrichment';

// Tier badge colors (same as DealCard for consistency)
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

// Deal rating badge — mapped from internal names to user-facing labels
const RATING_STYLES: Record<string, { label: string; className: string }> = {
  hot: { label: 'Incredible', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  good: { label: 'Great', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  fair: { label: 'Fair', className: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' },
};

// Program slug → display name (for transfer partner pills)
const PROGRAM_DISPLAY: Record<string, string> = {
  'amex-mr': 'Amex MR',
  'chase-ur': 'Chase UR',
  'citi-typ': 'Citi TYP',
  'capital-one': 'Capital One',
  bilt: 'Bilt',
};

// Cash savings computation
function cashSavings(deal: EnrichedDeal): number | null {
  if (!deal.cpp || !deal.pointsRequired) return null;
  // cashPrice ≈ (pointsRequired * cpp / 100) + taxes (approximately)
  // savings = estimated cash value - taxes paid
  const estimatedCashValue = (deal.pointsRequired * deal.cpp) / 100;
  const savings = Math.round(estimatedCashValue - deal.taxes);
  return savings > 0 ? savings : null;
}

export function FlightResultCard({ deal }: { deal: EnrichedDeal }) {
  const ratingStyle = deal.dealRating !== 'unknown' ? RATING_STYLES[deal.dealRating] : null;
  const savings = cashSavings(deal);
  const stopsLabel = deal.direct
    ? 'Direct'
    : `${deal.stops} stop${deal.stops > 1 ? 's' : ''}`;

  return (
    <Card className="bg-card border-border hover:border-muted-foreground/50 transition-colors">
      <CardContent className="p-4 sm:p-6">
        {/* Badges row */}
        {(deal.sweetSpot || ratingStyle) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {deal.sweetSpot && (
              <Badge className={TIER_COLORS[deal.sweetSpot.tier]}>
                {TIER_LABELS[deal.sweetSpot.tier]}
              </Badge>
            )}
            {ratingStyle && (
              <Badge
                variant="outline"
                className={ratingStyle.className}
              >
                {ratingStyle.label}
              </Badge>
            )}
          </div>
        )}

        {/* Main content: flight info + value + book */}
        <div className="flex flex-col md:flex-row md:gap-6">
          {/* Left: Flight info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-base">
                {deal.airline}
                {deal.flightNumber ? ` ${deal.flightNumber}` : ''}
              </span>
              <span className="text-sm text-muted-foreground">{deal.cabinDisplay}</span>
            </div>
            <div className="mt-1 text-lg font-medium">
              {deal.origin} &rarr; {deal.destination}
            </div>
            {(deal.departureTime || deal.arrivalTime) && (
              <div className="text-sm text-muted-foreground mt-0.5">
                {deal.departureTime && deal.arrivalTime
                  ? `${deal.departureTime} \u2192 ${deal.arrivalTime}`
                  : deal.departureTime || deal.arrivalTime}
                {deal.duration && ` \u00b7 ${deal.duration}`}
              </div>
            )}
            <div className="text-sm text-muted-foreground mt-0.5">
              {stopsLabel}
              {deal.departureDate && ` \u00b7 ${deal.departureDate}`}
            </div>
          </div>

          {/* Center: Points & value */}
          <div className="mt-3 md:mt-0 md:text-right flex-shrink-0">
            <div className="text-xl font-bold text-primary">
              {deal.pointsRequired.toLocaleString()} pts
            </div>
            {deal.cpp != null && (
              <div className="text-base font-semibold text-emerald-400">
                {deal.cpp}&cent;/pt
              </div>
            )}
            {savings != null && (
              <div className="text-sm text-muted-foreground">
                Saves you ${savings.toLocaleString()} vs cash
              </div>
            )}
          </div>
        </div>

        {/* Transfer partner pills */}
        {(deal.transferFrom.length > 0 || deal.transferPath) && (
          <div className="mt-3">
            {deal.transferFrom.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1">
                {deal.transferFrom.map((slug) => (
                  <Badge key={slug} variant="outline" className="text-xs">
                    {PROGRAM_DISPLAY[slug] || slug}
                  </Badge>
                ))}
              </div>
            )}
            {deal.transferPath && (
              <p className="text-xs text-muted-foreground">{deal.transferPath}</p>
            )}
          </div>
        )}

        {/* Footer: freshness + book button */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Scraped {relativeTime(deal.scrapedAt)}
          </span>
          <Button variant="outline" size="sm" asChild>
            <a
              href={deal.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Book on {deal.airline} &rarr;
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
