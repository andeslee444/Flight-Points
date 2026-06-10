/**
 * Better Auth catch-all route handler (Phase 6, 06-01).
 * Handles all /api/auth/* endpoints (sign-up, sign-in, session, sign-out, ...).
 */
import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth);
