import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/flights/db-schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
    ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false },
  },
});
