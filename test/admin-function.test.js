import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../supabase/functions/admin-users/index.ts';

const OWNER = 'owner@example.org';

// In-memory stand-in for the Supabase admin client.
function fakeSupabase() {
  const users = new Map();
  const tokens = new Map();
  let n = 0;
  const add = (email, password, meta = {}) => {
    const u = { id: 'u' + ++n, email, user_metadata: meta, created_at: '2026-01-01', password };
    users.set(u.id, u);
    return u;
  };
  const owner = add(OWNER, 'ownerpass1');
  const friend = add('bob@players.willbykat3.github.io', 'friendpass', { username: 'Bob' });
  tokens.set('owner-token', owner.id);
  tokens.set('friend-token', friend.id);
  const client = {
    auth: {
      getUser: async (t) => (tokens.has(t) ? { data: { user: users.get(tokens.get(t)) }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }),
      admin: {
        listUsers: async () => ({ data: { users: [...users.values()] }, error: null }),
        getUserById: async (id) => ({ data: { user: users.get(id) ?? null }, error: null }),
        createUser: async ({ email, password, user_metadata }) => {
          if ([...users.values()].some((u) => u.email === email)) return { data: null, error: { message: 'A user with this email address has already been registered' } };
          return { data: { user: add(email, password, user_metadata) }, error: null };
        },
        updateUserById: async (id, changes) => {
          const u = users.get(id);
          if (changes.email && [...users.values()].some((o) => o.email === changes.email && o.id !== id)) return { data: null, error: { message: 'email already exists' } };
          Object.assign(u, { email: changes.email ?? u.email, password: changes.password ?? u.password, user_metadata: changes.user_metadata ?? u.user_metadata });
          return { data: { user: u }, error: null };
        },
        deleteUser: async (id) => { users.delete(id); return { error: null }; },
      },
    },
  };
  return { client, users, owner, friend };
}

function setup() {
  const fake = fakeSupabase();
  const env = new Map([['SUPABASE_URL', 'https://x.supabase.co'], ['SUPABASE_SECRET_KEYS', '{"default":"sb_secret_123"}'], ['ADMIN_EMAIL', OWNER]]);
  let usedKey = null;
  const call = async (token, body, method = 'POST') => {
    const req = new Request('https://x.supabase.co/functions/v1/admin-users', {
      method, headers: token ? { Authorization: 'Bearer ' + token } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined,
    });
    const res = await handleRequest(req, { get: (k) => env.get(k) }, (url, key) => { usedKey = key; return fake.client; });
    return { status: res.status, body: res.status === 200 && method === 'OPTIONS' ? null : await res.json().catch(() => null) };
  };
  return { ...fake, env, call, usedKey: () => usedKey };
}

test('only the owner can use the admin function', async () => {
  const s = setup();
  assert.equal((await s.call(null, { action: 'list' })).status, 401);
  assert.equal((await s.call('nonsense', { action: 'list' })).status, 401);
  const friend = await s.call('friend-token', { action: 'list' });
  assert.equal(friend.status, 403);
  assert.match(friend.body.error, /owner/);
  const owner = await s.call('owner-token', { action: 'list' });
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body.users.map((u) => [u.username, u.isOwner, u.email]), [['owner', true, OWNER], ['Bob', false, null]]);
  assert.equal(s.usedKey(), 'sb_secret_123', 'uses the secret key from SUPABASE_SECRET_KEYS');
  // CORS preflight works without a login
  assert.equal((await s.call(null, null, 'OPTIONS')).status, 200);
});

test('without ADMIN_EMAIL nobody gets in', async () => {
  const s = setup();
  s.env.delete('ADMIN_EMAIL');
  const r = await s.call('owner-token', { action: 'list' });
  assert.equal(r.status, 500);
  assert.match(r.body.error, /ADMIN_EMAIL/);
});

test('the owner can create, edit and delete accounts', async () => {
  const s = setup();
  const created = await s.call('owner-token', { action: 'create', username: 'Alex_99', password: 'longenough' });
  assert.equal(created.status, 200);
  const alex = [...s.users.values()].find((u) => u.user_metadata.username === 'Alex_99');
  assert.equal(alex.email, 'alex_99@players.willbykat3.github.io');
  assert.equal(alex.password, 'longenough');

  assert.match((await s.call('owner-token', { action: 'create', username: 'alex_99', password: 'longenough' })).body.error, /taken/);
  assert.match((await s.call('owner-token', { action: 'create', username: 'a b', password: 'longenough' })).body.error, /letters/);
  assert.match((await s.call('owner-token', { action: 'create', username: 'Sam', password: 'short' })).body.error, /8 characters/);

  const renamed = await s.call('owner-token', { action: 'update', id: alex.id, username: 'Alexandra', password: 'newpassword' });
  assert.equal(renamed.status, 200);
  assert.equal(alex.email, 'alexandra@players.willbykat3.github.io');
  assert.equal(alex.password, 'newpassword');

  // the owner's own login email never changes when renaming
  await s.call('owner-token', { action: 'update', id: s.owner.id, username: 'Will' });
  assert.equal(s.owner.email, OWNER);
  assert.equal(s.owner.user_metadata.username, 'Will');

  assert.match((await s.call('owner-token', { action: 'delete', id: s.owner.id })).body.error, /owner/);
  assert.equal((await s.call('owner-token', { action: 'delete', id: alex.id })).status, 200);
  assert.ok(!s.users.has(alex.id));
  assert.equal((await s.call('owner-token', { action: 'delete', id: 'nope' })).status, 404);
});

test('a normal player cannot create accounts', async () => {
  const s = setup();
  const r = await s.call('friend-token', { action: 'create', username: 'Sneaky', password: 'longenough' });
  assert.equal(r.status, 403);
  assert.equal(s.users.size, 2);
});
