// Login settings. These two values are public by design (Supabase calls this
// the "publishable" key), so it's safe for them to be in this file. Fill them in
// from your Supabase project: Project Settings -> API Keys / Data API.
// See SETUP-LOGIN.md for the full step-by-step guide.
export const SUPABASE_URL = 'https://vyqgdlqgnynlqliwverz.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xywC2Y8P-1F3V8g3vhttGw_bkj2oUBn';

// Accounts created with just a username get this made-up email domain behind
// the scenes (Supabase logins need an email). No email is ever sent to it.
// Must match PLAYER_EMAIL_DOMAIN in supabase/functions/admin-users/index.ts.
export const PLAYER_EMAIL_DOMAIN = 'players.willbykat3.github.io';
