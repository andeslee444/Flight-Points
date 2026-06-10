/**
 * Better Auth React client (Phase 6, 06-01).
 * Import { signIn, signUp, signOut, useSession } from '@/lib/auth-client' in
 * client components. baseURL defaults to the current origin in the browser.
 */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
