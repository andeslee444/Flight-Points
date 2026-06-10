// lib/coverage.ts — static constants derived from SCRAPER_REGISTRY
// These are intentionally static strings (not dynamic registry reads)
// to avoid importing scrapers/index.ts which has daemon-only transitive deps.
// Copy last reviewed against the registry: 2026-06-10.

export const ALLIANCE_LABELS: Record<string, string> = {
  oneworld: 'oneworld — via American AAdvantage (BA, JAL, Cathay, Qatar, Qantas partner awards)',
  skyteam: 'SkyTeam — via Flying Blue and Delta/Virgin Atlantic',
  independent: 'Also searched: JetBlue, Alaska, Cathay (calendar availability only)',
};

export const SCRAPER_HEALTH_NOTICES: Array<{
  alliance: string;
  message: string;
  severity: 'warning' | 'info';
}> = [
  {
    alliance: 'star',
    message:
      'Star Alliance: Not currently covered — United, Aeroplan, ANA, and Singapore logins are blocked; Turkish is pending API credentials',
    severity: 'warning',
  },
  {
    alliance: 'skyteam',
    message:
      'SkyTeam coverage requires active Flying Blue / Virgin Atlantic logins — results may pause when sessions expire',
    severity: 'info',
  },
  {
    alliance: 'oneworld',
    message:
      'oneworld results come via American and are pending re-verification — some partner availability may be missing',
    severity: 'info',
  },
];
