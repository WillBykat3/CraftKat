import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostNetwork } from '../public/js/net.js';

// A fake GameHost that records what reaches it.
function fakeHost() {
  const got = [];
  return { got, connect() {}, disconnect() {}, message: (peer, msg) => got.push([peer, msg]) };
}

function network(verify) {
  const host = fakeHost();
  const net = new HostNetwork(host);
  const sent = [];
  net.deliver = (peer, msg) => sent.push([peer, msg]);
  net.verify = verify;
  net.peers.add('friend');
  return { host, net, sent };
}

const goodLogin = async (token) => {
  if (token === 'valid-token') return { id: 'acct-1', name: 'RealName' };
  throw new Error('Your login could not be verified.');
};

test('friends must have a verified login, and their name comes from the account', async () => {
  const { host, net, sent } = network(goodLogin);
  // nothing gets through before hello
  await net.receive('friend', { t: 'set', x: 1, y: 2, z: 3, id: 1 });
  assert.equal(host.got.length, 0);
  // a forged name and account id are replaced by the verified ones
  await net.receive('friend', { t: 'hello', name: 'TheOwner', accountId: 'acct-owner', isHost: true, token: 'valid-token' });
  assert.deepEqual(host.got, [['friend', { t: 'hello', name: 'RealName', accountId: 'acct-1', password: undefined }]]);
  // after that, game messages pass, but a second hello doesn't
  await net.receive('friend', { t: 'chat', msg: 'hi' });
  await net.receive('friend', { t: 'hello', name: 'Other', token: 'valid-token' });
  assert.equal(host.got.length, 2);
  assert.equal(host.got[1][1].t, 'chat');
  assert.equal(sent.length, 0);
});

test('a bad or missing login is turned away', async () => {
  for (const token of [undefined, 'stolen', '']) {
    const { host, net, sent } = network(goodLogin);
    await net.receive('friend', { t: 'hello', name: 'Hacker', token });
    assert.equal(host.got.length, 0);
    assert.equal(sent[0][1].t, 'error');
    await net.receive('friend', { t: 'dig', x: 0, y: 0, z: 0 });
    assert.equal(host.got.length, 0, 'still locked out');
  }
});

test('without logins configured (local testing), names are used as given but never account ids', async () => {
  const { host, net } = network(null);
  await net.receive('friend', { t: 'hello', name: 'Dev', accountId: 'acct-owner' });
  assert.deepEqual(host.got[0][1], { t: 'hello', name: 'Dev', password: undefined });
});

test('messages from peers that are not in the room are ignored', async () => {
  const { host, net } = network(goodLogin);
  await net.receive('stranger', { t: 'hello', token: 'valid-token' });
  assert.equal(host.got.length, 0);
});
