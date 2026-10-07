# BlockCraft

A Minecraft-style multiplayer building game that runs in the web browser.
One person runs the server; friends join by opening a link. Nobody has to install anything except the host.

**Features**
- Endless generated world: hills, mountains with snow, beaches and trees
- Break and place 12 kinds of blocks; everyone sees changes instantly
- See your friends walking around, with name tags
- Chat, flying, a block menu, and the world **saves automatically**
- Optional server password so only your friends can join

> BlockCraft is an independent fan project. It is not Minecraft and is not affiliated with Mojang or Microsoft. All textures are drawn by code.

---

## 1. Start the server (host only)

You need **Node.js 18 or newer**. Get it from <https://nodejs.org> (pick "LTS").

```bash
git clone https://github.com/WillBykat3/minecraft.git
cd minecraft
npm install
npm start
```

You'll see something like:

```
BlockCraft server running! (world seed 123456789)

  On this computer:      http://localhost:3000
  Same Wi-Fi / network:  http://192.168.1.42:3000
```

Open `http://localhost:3000` in Chrome, Edge or Firefox, type a name and press **Play**.

> **Windows:** the first time, Windows Firewall asks whether Node.js may use the network.
> Tick **Private networks** and click **Allow**, otherwise friends can't connect.

To stop the server press `Ctrl + C`. The world is saved to `world-data.json` (also every 10 seconds while running).

### Add a password (recommended when sharing over the internet)

```bash
# macOS / Linux
SERVER_PASSWORD=pickSomething npm start

# Windows PowerShell
$env:SERVER_PASSWORD="pickSomething"; npm start
```

Friends type the password on the join screen.

### Other settings

| Variable          | Default            | What it does                                   |
|-------------------|--------------------|------------------------------------------------|
| `PORT`            | `3000`             | Port the server listens on                     |
| `SERVER_PASSWORD` | *(none)*           | Password needed to join                        |
| `MAX_PLAYERS`     | `20`               | Maximum players online at once                 |
| `WORLD_SEED`      | random             | Seed for a **new** world (ignored once saved)  |
| `WORLD_FILE`      | `world-data.json`  | Where the world is saved                       |

Want a fresh world? Stop the server and delete `world-data.json`.

---

## 2. Get your friends in

### Friends in the same house / on the same Wi-Fi
Send them the **"Same Wi-Fi / network"** address the server printed, e.g. `http://192.168.1.42:3000`.

### Friends somewhere else (over the internet)
Pick **one** of these:

**A. Cloudflare quick tunnel (easiest, free, no account, no router setup)**
1. Install `cloudflared`: <https://github.com/cloudflare/cloudflared/releases>
   (Windows: `winget install --id Cloudflare.cloudflared`, macOS: `brew install cloudflared`)
2. With the game server running, open a second terminal and run:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
3. It prints a link like `https://something-random.trycloudflare.com`. Send that to your friends.

The link only works while both windows are open, and you get a **new link every time**.
Since anyone with the link can join, set a `SERVER_PASSWORD`.

**B. Port forwarding (permanent address, needs router access)**
1. In your router's settings, forward **TCP port 3000** to the "Same Wi-Fi" IP address the server printed.
2. Find your public IP (search "what is my IP").
3. Friends open `http://YOUR-PUBLIC-IP:3000`.

Doesn't work? Some internet providers (and most mobile hotspots) share one public IP between customers ("CGNAT"), which blocks port forwarding; use option A instead.

**C. Host it in the cloud (runs even when your PC is off)**
The included `Dockerfile` runs on any Docker host (Railway, Fly.io, a VPS, etc.).
Keep `/data` on a persistent volume, or the world resets whenever the server restarts.
Free tiers often have catches: Render's free web services, for example, go to sleep after 15 minutes
without traffic (about a minute to wake up) and **lose saved files** on restart.

```bash
docker build -t blockcraft .
docker run -p 3000:3000 -v blockcraft-data:/data -e SERVER_PASSWORD=pickSomething blockcraft
```

---

## Controls

| Key | Action |
|-----|--------|
| W A S D | Move |
| Mouse | Look around (click the game to capture the mouse) |
| Space | Jump · double-tap to fly |
| Shift | Sprint · fly down |
| F | Toggle flying |
| Left click | Break block (hold to keep breaking) |
| Right click | Place block |
| Middle click | Pick the block you're looking at |
| 1–9 / mouse wheel | Choose block |
| E | Block menu |
| T or Enter | Chat (`/list` shows who's online, `/spawn` takes you home) |
| R | Back to spawn |
| Esc | Release the mouse |

The game needs a keyboard and mouse (desktop or laptop); phones and tablets aren't supported.
If it's slow, pick a shorter **View distance** on the join screen.

---

## For developers

```
server.js            HTTP + WebSocket server, validation, saving
public/index.html    page and UI
public/js/
  blocks.js          block types (shared with the server)
  noise.js           seeded simplex noise
  world.js           terrain generation + edits (shared with the server)
  mesher.js          chunk -> triangles, face culling, ambient occlusion
  textures.js        pixel-art textures drawn on a canvas
  players.js         other players' avatars
  main.js            rendering, controls, physics, networking
test/                node:test tests (world generation, meshing, server)
```

- The world is generated from a seed, so only changed blocks are stored and sent over the network.
- The server checks every block change (reach, no bedrock, rate limits) and corrects cheating or out-of-sync clients.
- Run the tests with `npm test`. Add `?debug` to the URL to get `window.blockcraft` in the browser console.
- Rendering uses [three.js](https://threejs.org), served locally from `node_modules`, so no CDN is needed.
