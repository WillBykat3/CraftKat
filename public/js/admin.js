// Owner-only account manager. Every action goes through the admin-users Edge
// Function, which checks on the server that the caller is the owner.

import { configured, currentUser, signIn, signOut, adminCall } from './auth.js';

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
let accounts = [];
let editing = null;

function when(iso) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

async function start() {
  for (const id of ['setup-missing', 'login', 'denied', 'panel', 'who']) show(id, false);
  if (!configured) { show('setup-missing'); return; }
  const user = await currentUser();
  if (!user) { show('login'); return; }
  $('who-name').textContent = `Signed in as ${user.email}`;
  show('who');
  await refresh();
}

async function refresh() {
  $('list-error').textContent = '';
  $('btn-refresh').disabled = true;
  try {
    const { users } = await adminCall('list');
    accounts = users;
    show('panel');
    show('denied', false);
    render();
  } catch (err) {
    if (/owner|log in/i.test(err.message)) {
      show('panel', false);
      $('denied-text').textContent = err.message;
      show('denied');
    } else {
      show('panel');
      $('list-error').textContent = 'Could not load accounts: ' + err.message;
    }
  } finally {
    $('btn-refresh').disabled = false;
  }
}

function render() {
  const body = $('accounts');
  body.innerHTML = '';
  $('count').textContent = `(${accounts.length})`;
  for (const a of accounts) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = a.username;
    if (a.isOwner) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'owner';
      name.appendChild(b);
    }
    const created = document.createElement('td');
    created.textContent = when(a.createdAt);
    const last = document.createElement('td');
    last.textContent = when(a.lastSignIn);
    const actions = document.createElement('td');
    actions.className = 'actions';
    const edit = document.createElement('button');
    edit.className = 'secondary';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => openEdit(a));
    actions.appendChild(edit);
    if (!a.isOwner) {
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = 'Delete';
      del.addEventListener('click', () => remove(a, del));
      actions.appendChild(del);
    }
    tr.append(name, created, last, actions);
    body.appendChild(tr);
  }
}

function randomPassword() {
  const words = ['creeper', 'diamond', 'pickaxe', 'torch', 'redstone', 'emerald', 'obsidian', 'cherry', 'copper', 'lantern', 'beacon', 'nether'];
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${words[r[0] % words.length]}-${words[r[1] % words.length]}-${100 + (r[2] % 900)}`;
}

async function remove(a, button) {
  if (!confirm(`Delete the account "${a.username}"? They won't be able to log in any more.`)) return;
  button.disabled = true;
  try {
    await adminCall('delete', { id: a.id });
    accounts = accounts.filter((x) => x.id !== a.id);
    render();
  } catch (err) {
    alert('Could not delete: ' + err.message);
    button.disabled = false;
  }
}

function openEdit(a) {
  editing = a;
  $('edit-title').textContent = a.username;
  $('edit-username').value = a.username;
  $('edit-password').value = '';
  $('edit-error').textContent = '';
  $('edit-dialog').showModal();
}

$('edit-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const changes = {};
  const username = $('edit-username').value.trim();
  if (username && username !== editing.username) changes.username = username;
  if ($('edit-password').value) changes.password = $('edit-password').value;
  if (!Object.keys(changes).length) { $('edit-dialog').close(); return; }
  $('btn-save').disabled = true;
  try {
    const { user } = await adminCall('update', { id: editing.id, ...changes });
    accounts = accounts.map((x) => (x.id === user.id ? user : x));
    render();
    $('edit-dialog').close();
  } catch (err) {
    $('edit-error').textContent = err.message;
  } finally {
    $('btn-save').disabled = false;
  }
});

$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('new-username').value.trim();
  const password = $('new-password').value;
  $('create-result').textContent = 'Creating…';
  try {
    const { user } = await adminCall('create', { username, password });
    accounts.push(user);
    render();
    $('create-result').textContent = `Created "${username}". Send them their username and password.`;
    $('new-username').value = '';
    $('new-password').value = '';
  } catch (err) {
    $('create-result').textContent = 'Could not create: ' + err.message;
  }
});

$('btn-generate').addEventListener('click', () => { $('new-password').value = randomPassword(); });
$('btn-refresh').addEventListener('click', refresh);

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('btn-login').disabled = true;
  $('login-error').textContent = '';
  try {
    await signIn($('login-email').value, $('login-password').value);
    $('login-password').value = '';
    await start();
  } catch (err) {
    $('login-error').textContent = err.message;
  } finally {
    $('btn-login').disabled = false;
  }
});

$('btn-logout').addEventListener('click', async () => {
  await signOut();
  start();
});

start();
