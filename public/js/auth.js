// Accounts and logins, using Supabase Auth.
// Nobody can sign up on their own: only the owner creates accounts (admin.html),
// and the host checks every joining player's login with Supabase.

import { createClient } from '../vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PLAYER_EMAIL_DOMAIN } from './config.js';

export const configured = !!(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

let client = null;
function supabase() {
  if (!configured) throw new Error('Logins are not set up yet (see SETUP-LOGIN.md).');
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

// "Steve" -> "steve@players...", emails are used as typed.
export function loginEmail(nameOrEmail) {
  const t = String(nameOrEmail).trim();
  return t.includes('@') ? t.toLowerCase() : `${t.toLowerCase()}@${PLAYER_EMAIL_DOMAIN}`;
}

// The name shown in the game for an account.
export function displayName(user) {
  const meta = user?.user_metadata?.username;
  if (meta) return String(meta).slice(0, 16);
  const email = user?.email || '';
  return email.split('@')[0].replace(/[^A-Za-z0-9_\- ]/g, '').slice(0, 16) || 'Player';
}

export async function currentUser() {
  if (!configured) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.user ?? null;
}

export async function accessToken() {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signIn(nameOrEmail, password) {
  const { data, error } = await supabase().auth.signInWithPassword({ email: loginEmail(nameOrEmail), password });
  if (error) {
    throw new Error(/invalid login|invalid credentials/i.test(error.message)
      ? 'Wrong username or password.'
      : error.message);
  }
  return data.user;
}

export async function signOut() {
  if (configured) await supabase().auth.signOut();
}

// Host side: is this token a real, current login? Returns the account's display name.
export async function verifyToken(token) {
  if (!token || typeof token !== 'string') throw new Error('You need to log in to join.');
  const { data, error } = await supabase().auth.getUser(token);
  if (error || !data?.user) throw new Error('Your login could not be verified. Try logging out and in again.');
  return { id: data.user.id, name: displayName(data.user) };
}

// Owner-only account management (checked by the admin-users Edge Function).
export async function adminCall(action, payload = {}) {
  const { data, error } = await supabase().functions.invoke('admin-users', { body: { action, ...payload } });
  if (error) {
    let message = error.message;
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return data;
}
