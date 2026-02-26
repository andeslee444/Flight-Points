/**
 * Drizzle ORM schema definitions
 *
 * Tables:
 *   - price_history     — per-flight rows from every daemon scrape cycle
 *   - alert_subscriptions — user route watch list (wired to Better Auth users in Phase 6)
 *   - Better Auth tables  — user, session, account, verification (standard pg adapter schema)
 *
 * The daemon write path continues to use the raw pg pool in db.ts.
 * This schema is used by drizzle-kit for migration generation and by
 * db-drizzle.ts (Vercel/Next.js read path) for typed queries.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

// ── price_history ──────────────────────────────────────────────────────────────
// One row per individual flight result per scrape cycle.
// Stores only confirmed availability (calendar/estimated excluded at daemon level).

export const priceHistory = pgTable(
  'price_history',
  {
    id: serial('id').primaryKey(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    cabin: text('cabin').notNull(), // 'economy' | 'business' | 'first' | 'premium_economy'
    program: text('program').notNull(), // scraper key, e.g. 'aa-cdp'
    flightNumber: text('flight_number'),
    departureDate: text('departure_date').notNull(), // 'YYYY-MM-DD'
    departureTime: text('departure_time'),
    miles: integer('miles').notNull(),
    cashPriceUsd: numeric('cash_price_usd', { precision: 10, scale: 2 }),
    taxesUsd: numeric('taxes_usd', { precision: 10, scale: 2 }),
    availabilityType: text('availability_type').notNull().default('confirmed'),
    scrapeCycleId: text('scrape_cycle_id'), // ISO timestamp of the cycle
    scrapedAt: timestamp('scraped_at').notNull().defaultNow(),
  },
  (table) => [
    index('ph_route_cabin_idx').on(
      table.origin,
      table.destination,
      table.cabin,
      table.program,
      table.departureDate,
    ),
    index('ph_scraped_at_idx').on(table.scrapedAt),
  ],
);

// ── alert_subscriptions ────────────────────────────────────────────────────────
// User route watch entries. user_id references Better Auth's user table
// (foreign key constraint not enforced yet — Phase 6 wires auth).

export const alertSubscriptions = pgTable('alert_subscriptions', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(), // Better Auth user ID
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  cabin: text('cabin').notNull(),
  program: text('program'), // null = any program
  maxMiles: integer('max_miles'), // null = any price
  channel: text('channel').notNull(), // 'email' | 'whatsapp'
  contact: text('contact').notNull(), // email address or WhatsApp number
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ── Better Auth tables ─────────────────────────────────────────────────────────
// Standard Better Auth PostgreSQL adapter schema.
// These tables will be used in Phase 6 when auth is fully wired.

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});
