/**
 * Better Auth server instance (Phase 6, 06-01).
 *
 * Wires Better Auth to the existing Drizzle instance + auth schema
 * (user/session/account/verification in src/flights/db-schema.ts, already
 * migrated to Neon). Email/password only for v1 — social providers can be
 * added later via the providers config.
 *
 * Requires BETTER_AUTH_SECRET (32+ random chars) in the environment.
 * BETTER_AUTH_URL should be the canonical site origin in production.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDrizzle } from '@/src/flights/db-drizzle';
import * as schema from '@/src/flights/db-schema';

export const auth = betterAuth({
  database: drizzleAdapter(getDrizzle(), {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // No email-verification gate for v1 — turn on once an email sender is wired.
    requireEmailVerification: false,
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
});
