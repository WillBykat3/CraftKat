// Builds chunk meshes off the main thread. Keeps its own copy of the world
// (same seed + edits), so only small messages cross the thread boundary.

import { World } from './world.js';
import { buildChunkMesh } from './mesher.js';
import { uvOf } from './atlas-layout.js';

let world = null;
const queue = [];
let scheduled = false;

function work() {
  scheduled = false;
  const job = queue.shift();
  if (!job || !world) return;
  const { solid, water } = buildChunkMesh(world, job.cx, job.cz, uvOf);
  const transfer = [];
  for (const m of [solid, water]) {
    if (m) transfer.push(m.positions.buffer, m.uvs.buffer, m.shade.buffer, m.light.buffer, m.indices.buffer);
  }
  postMessage({ t: 'mesh', cx: job.cx, cz: job.cz, version: job.version, solid, water }, transfer);
  if (queue.length) schedule();
}

function schedule() {
  if (!scheduled) {
    scheduled = true;
    setTimeout(work, 0); // lets newer messages (edits, cancels) arrive between chunks
  }
}

onmessage = (event) => {
  const msg = event.data;
  switch (msg.t) {
    case 'init':
      world = new World(msg.seed, msg.gen);
      world.importEdits(msg.edits);
      queue.length = 0;
      break;
    case 'set':
      world?.setBlock(msg.x, msg.y, msg.z, msg.id);
      break;
    case 'mesh': {
      // replace an older queued request for the same chunk; urgent ones jump the queue
      const i = queue.findIndex((j) => j.cx === msg.cx && j.cz === msg.cz);
      if (i >= 0) queue.splice(i, 1);
      if (msg.urgent) queue.unshift(msg); else queue.push(msg);
      schedule();
      break;
    }
    case 'cancel': {
      // drop queued chunks that are no longer wanted
      const keep = new Set(msg.keep);
      for (let i = queue.length - 1; i >= 0; i--) if (!keep.has(queue[i].cx + ',' + queue[i].cz)) queue.splice(i, 1);
      break;
    }
    case 'unload':
      world?.unloadFar(msg.cx, msg.cz, msg.radius);
      break;
  }
};
