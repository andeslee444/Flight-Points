/**
 * Drizzle migration runner
 *
 * Uses the same SSL handling as db.ts (rejectUnauthorized: false) to
 * apply migrations to AWS RDS. Run with:
 *   npx tsx drizzle/migrate.ts
 *
 * Prerequisite: DATABASE_URL must be set in .env
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

async function main() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  // Strip sslmode from connection string — we handle SSL via the ssl option
  const connectionString = rawUrl.replace(/[?&]sslmode=[^&]*/g, '').replace(/\?$/, '');

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });

  const db = drizzle(pool);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.join(__dirname, 'migrations');

  console.log('[migrate] Applying migrations from', migrationsFolder);

  try {
    await migrate(db, { migrationsFolder });
    console.log('[migrate] Migrations applied successfully');
  } catch (err) {
    console.error('[migrate] Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
