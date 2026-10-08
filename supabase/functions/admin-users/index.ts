// BlockCraft account management. Only the owner (ADMIN_EMAIL) can use it.
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function -> Via Editor,
// name it "admin-users", paste this whole file, deploy. Then set the secret
// ADMIN_EMAIL to your email (Edge Functions -> Secrets). See SETUP-LOGIN.md.

const PLAYER_EMAIL_DOMAIN = 'players.willbykat3.github.io'; // must match public/js/config.js
const USERNAME = /^[A-Za-z0-9_]{3,16}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

type Env = { get(name: string): string | undefined };
// deno-lint-ignore no-explicit-any
type MakeClient = (url: string, key: string) => any;

function serviceKey(env: Env): string | undefined {
  // New-style projects provide SUPABASE_SECRET_KEYS (JSON); older ones SUPABASE_SERVICE_ROLE_KEY.
  const keys = env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed)[0];
      if (typeof first === 'string') return first;
    } catch { /* fall through */ }
  }
  return env.get('SUPABASE_SERVICE_ROLE_KEY');
}

// deno-lint-ignore no-explicit-any
function publicUser(u: any, ownerEmail: string) {
  const isOwner = (u.email || '').toLowerCase() === ownerEmail;
  const synthetic = (u.email || '').endsWith('@' + PLAYER_EMAIL_DOMAIN);
  return {
    id: u.id,
    username: u.user_metadata?.username || (u.email || '').split('@')[0],
    email: synthetic ? null : u.email,
    isOwner,
    createdAt: u.created_at,
    lastSignIn: u.last_sign_in_at || null,
  };
}

export async function handleRequest(req: Request, env: Env, makeClient: MakeClient): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = env.get('SUPABASE_URL');
  const key = serviceKey(env);
  const ownerEmail = (env.get('ADMIN_EMAIL') || '').trim().toLowerCase();
  if (!url || !key) return json({ error: 'The function is missing its Supabase settings.' }, 500);
  if (!ownerEmail) return json({ error: 'Set the ADMIN_EMAIL secret for this function (see SETUP-LOGIN.md).' }, 500);

  const admin = makeClient(url, key);

  // Who is calling? The token is checked with Supabase Auth itself.
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoError } = await admin.auth.getUser(token);
  if (whoError || !who?.user) return json({ error: 'Please log in.' }, 401);
  if ((who.user.email || '').toLowerCase() !== ownerEmail) return json({ error: 'Only the owner can manage accounts.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }

  const fail = (e: { message?: string } | null) => json({ error: e?.message || 'Something went wrong.' }, 400);
  const findUser = async (id: unknown) => {
    if (typeof id !== 'string') return null;
    const { data } = await admin.auth.admin.getUserById(id);
    return data?.user ?? null;
  };

  switch (body.action) {
    case 'list': {
      const users = [];
      for (let page = 1; page < 50; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) return fail(error);
        users.push(...data.users);
        if (data.users.length < 1000) break;
      }
      const list = users.map((u) => publicUser(u, ownerEmail))
        .sort((a, b) => (b.isOwner ? 1 : 0) - (a.isOwner ? 1 : 0) || a.username.localeCompare(b.username));
      return json({ users: list });
    }

    case 'create': {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!USERNAME.test(username)) return json({ error: 'Usernames are 3–16 letters, numbers or _.' }, 400);
      if (password.length < 8) return json({ error: 'Passwords need at least 8 characters.' }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email: `${username.toLowerCase()}@${PLAYER_EMAIL_DOMAIN}`,
        password,
        email_confirm: true,
        user_metadata: { username },
      });
      if (error) {
        return json({ error: /already|exists|registered/i.test(error.message) ? 'That username is taken.' : error.message }, 400);
      }
      return json({ user: publicUser(data.user, ownerEmail) });
    }

    case 'update': {
      const user = await findUser(body.id);
      if (!user) return json({ error: 'No such account.' }, 404);
      const isOwner = (user.email || '').toLowerCase() === ownerEmail;
      const changes: Record<string, unknown> = {};
      if (body.password !== undefined) {
        const password = String(body.password);
        if (password.length < 8) return json({ error: 'Passwords need at least 8 characters.' }, 400);
        changes.password = password;
      }
      if (body.username !== undefined) {
        const username = String(body.username).trim();
        if (!USERNAME.test(username)) return json({ error: 'Usernames are 3–16 letters, numbers or _.' }, 400);
        changes.user_metadata = { ...(user.user_metadata || {}), username };
        // player accounts log in with their username, so their hidden email follows it;
        // the owner keeps logging in with their real email
        if (!isOwner) {
          changes.email = `${username.toLowerCase()}@${PLAYER_EMAIL_DOMAIN}`;
          changes.email_confirm = true;
        }
      }
      if (!Object.keys(changes).length) return json({ error: 'Nothing to change.' }, 400);
      const { data, error } = await admin.auth.admin.updateUserById(user.id, changes);
      if (error) {
        return json({ error: /already|exists|registered/i.test(error.message) ? 'That username is taken.' : error.message }, 400);
      }
      return json({ user: publicUser(data.user, ownerEmail) });
    }

    case 'delete': {
      const user = await findUser(body.id);
      if (!user) return json({ error: 'No such account.' }, 404);
      if ((user.email || '').toLowerCase() === ownerEmail) return json({ error: "You can't delete the owner account." }, 400);
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) return fail(error);
      return json({ ok: true });
    }

    default:
      return json({ error: 'Unknown action.' }, 400);
  }
}

// In Supabase (Deno): serve requests. Skipped when the file is imported by the tests.
// deno-lint-ignore no-explicit-any
const deno = (globalThis as any).Deno;
if (deno?.serve) {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  deno.serve((req: Request) => handleRequest(req, deno.env, (url: string, key: string) =>
    createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })));
}
