// lib/coverage.ts — static constants derived from SCRAPER_REGISTRY
// These are intentionally static strings (not dynamic registry reads)
// to avoid importing scrapers/index.ts which has daemon-only transitive deps.

export const ALLIANCE_LABELS: Record<string, string> = {
  oneworld: 'oneworld — covers American, British Airways, JAL, Cathay, Qatar, Qantas',
  star: 'Star Alliance — covers United, ANA, Singapore, Lufthansa, Turkish, Air Canada',
  skyteam: 'SkyTeam — covers Air France/KLM, Delta, Korean Air',
};

export const SCRAPER_HEALTH_NOTICES: Array<{
  alliance: string;
  message: string;
  severity: 'warning' | 'info';
}> = [
  {
    alliance: 'star',
    message: 'Star Alliance: Limited coverage — United/Aeroplan login blocked',
    severity: 'warning',
  },
  {
    alliance: 'oneworld',
    message: 'British Airways: Temporarily unavailable — CAPTCHA blocks login',
    severity: 'info',
  },
];
