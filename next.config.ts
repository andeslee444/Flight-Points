import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    // Resolve .js extensions to .ts files.
    // The daemon source files (transfer-partners.ts, sweet-spots.ts, airports.ts, db-drizzle.ts)
    // use NodeNext-style .js extensions in their imports (e.g., import ... from './airports.js').
    // Next.js / Turbopack needs this alias to find the .ts source files.
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  async rewrites() {
    const harborUrl = process.env.HARBOR_URL || 'http://HARBOR_URL_NOT_SET';
    return [
      {
        source: '/api/flights/live-search',
        destination: `${harborUrl}/api/flights/live-search`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/api/flights/live-search',
        headers: [
          { key: 'X-Accel-Buffering', value: 'no' },
        ],
      },
    ];
  },
};

export default config;
