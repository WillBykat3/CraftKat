// Connections between players and the GameHost.
//
// Every client sees the same simple interface:
//   conn.send(msg), conn.onMessage = fn(msg), conn.onClose = fn(reason), conn.close()
//
// - The host's own player talks to the GameHost directly (loopback).
// - Friends connect with WebRTC through Trystero. Public Nostr relays are only
//   used to find each other; game data then flows directly between browsers.

import { joinNostr, joinWsRelay, selfId } from '../vendor/trystero.js';

export const APP_ID = 'craftkat-p2p-v1';

function trysteroRoom(roomId, password, relay, onJoinError) {
  const config = { appId: APP_ID };
  if (password) config.password = password;
  // ?relay=ws://... uses a self-hosted relay (used for testing) instead of Nostr
  if (relay) {
    config.relayConfig = { urls: [relay] };
    return joinWsRelay(config, roomId, { onJoinError });
  }
  return joinNostr(config, roomId, { onJoinError });
}

// The host side: routes GameHost messages to the local player or to WebRTC peers.
export class HostNetwork {
  constructor(host) {
    this.host = host;
    this.local = null;
    this.room = null;
    this.action = null;
    this.peers = new Set();
    this.verified = new Set();
    // async (token) => {id, name}; when set, friends must prove who they are before playing
    this.verify = null;
  }

  // GameHost's send callback
  deliver(peerId, msg) {
    if (peerId === 'local') {
      const conn = this.local;
      if (conn) queueMicrotask(() => conn.onMessage?.(structuredClone(msg)));
    } else if (this.action && this.peers.has(peerId)) {
      this.action.send(msg, { target: peerId }).catch(() => {});
    }
  }

  // Connection for the host's own player.
  connectLocal() {
    const conn = {
      onMessage: null,
      onClose: null,
      send: (msg) => queueMicrotask(() => this.host.message('local', structuredClone(msg))),
      close: () => this.host.disconnect('local'),
    };
    this.local = conn;
    this.host.connect('local');
    return conn;
  }

  // Opens the world to friends. Returns the room id used in the invite link.
  open({ roomId, password, relay, onPeerCount }) {
    if (this.room) return this.roomId;
    this.roomId = roomId;
    this.room = trysteroRoom(roomId, password, relay, () => {});
    this.action = this.room.makeAction('game');
    this.room.onPeerJoin = (peerId) => {
      this.peers.add(peerId);
      this.host.connect(peerId);
      this.action.send({ t: 'hostHello' }, { target: peerId }).catch(() => {});
      onPeerCount?.(this.peers.size);
    };
    this.room.onPeerLeave = (peerId) => {
      this.peers.delete(peerId);
      this.verified.delete(peerId);
      this.host.disconnect(peerId);
      onPeerCount?.(this.peers.size);
    };
    this.action.onMessage = (data, { peerId }) => this.receive(peerId, data);
    return roomId;
  }

  // Messages from friends. Until a friend's hello has been checked, nothing else gets through.
  async receive(peerId, data) {
    if (!this.peers.has(peerId) || !data || typeof data !== 'object') return;
    if (this.verified.has(peerId)) {
      if (data.t !== 'hello') this.host.message(peerId, data);
      return;
    }
    if (data.t !== 'hello' || this.checking?.has(peerId)) return;
    // never trust identity fields a friend sends about themselves
    const hello = { t: 'hello', name: data.name, password: data.password };
    if (this.verify) {
      (this.checking ??= new Set()).add(peerId);
      try {
        const who = await this.verify(data.token);
        hello.name = who.name;
        hello.accountId = who.id;
      } catch (err) {
        this.deliver(peerId, { t: 'error', msg: err.message || 'Your login could not be verified.' });
        return;
      } finally {
        this.checking.delete(peerId);
      }
      if (!this.peers.has(peerId)) return; // left while we were checking
    }
    this.verified.add(peerId);
    this.host.message(peerId, hello);
  }

  isOpen() {
    return !!this.room;
  }

  close() {
    if (this.room) this.room.leave();
    this.room = null;
    this.action = null;
    for (const peerId of this.peers) this.host.disconnect(peerId);
    this.peers.clear();
    this.verified.clear();
  }
}

// The joining side. Resolves with a connection once the host answers,
// or rejects with a readable error.
export function joinFriend({ roomId, password, relay, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    let hostPeer = null;
    let settled = false;
    let timer = null;
    const conn = {
      onMessage: null,
      onClose: null,
      send: (msg) => {
        if (hostPeer) action.send(msg, { target: hostPeer }).catch(() => {});
      },
      close: () => room.leave(),
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      room.leave();
      reject(new Error(message));
    };
    const room = trysteroRoom(roomId, password, relay, (details) => {
      const text = String(details?.error || '');
      if (/password/i.test(text)) fail('Wrong password for this world.');
      else if (!hostPeer) fail('Found the world but could not connect to it. Your network may block direct connections (see the README).');
    });
    const action = room.makeAction('game');
    action.onMessage = (data, { peerId }) => {
      if (!hostPeer) {
        if (data && data.t === 'hostHello') {
          hostPeer = peerId;
          settled = true;
          clearTimeout(timer);
          resolve(conn);
        }
        return;
      }
      if (peerId === hostPeer) conn.onMessage?.(data);
    };
    room.onPeerLeave = (peerId) => {
      if (peerId === hostPeer) conn.onClose?.('The host left the game.');
    };
    // a wrong password stops the two sides from even finding each other, so it looks the same as a missing world
    timer = setTimeout(() => fail(password
      ? 'Could not join. Check the link and the password, and make sure the host has the game open with "Open to friends".'
      : 'Could not find this world. Check the link, and make sure the host has the game open with "Open to friends".'), timeoutMs);
  });
}

export function randomRoomId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

export { selfId };
