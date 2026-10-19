'use strict';

// Vérifie le déploiement Vercel sans avoir besoin du cloud :
//  1. `api/index.js` sert l'application avec un corps déjà lu et une URL
//     réécrite en ?__route=…, exactement comme la plateforme Vercel.
//  2. le stockage « kv » partage les données entre deux instances et les
//     conserve après redémarrage (base Upstash simulée en local).

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const CREATOR_CODE = 'code-vercel-de-test';
const ROOT = path.join(__dirname, '..');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// --- 1. La fonction serverless, simulée comme chez Vercel -------------------

async function startVercelLikeFunction() {
  process.env.STORAGE = 'memory';
  process.env.CREATOR_CODE = CREATOR_CODE;
  process.env.VERCEL = '1';
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  const app = require('../api/index.js');

  const server = http.createServer((req, res) => {
    const method = req.method || 'GET';
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      // Vercel lit le corps JSON avant d'appeler la fonction…
      if (chunks.length > 0) {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          req.body = JSON.parse(raw);
        } catch {
          req.body = raw;
        }
      }
      // …et réécrit /api/… vers /api/index?__route=… (vercel.json).
      const [pathname, query = ''] = (req.url || '/').split('?');
      const apiPrefix = '/api/';
      if (pathname.startsWith(apiPrefix) && pathname !== '/api/index') {
        const route = pathname.slice(apiPrefix.length);
        req.url = `/api/index?__route=${encodeURIComponent(route)}${query ? `&${query}` : ''}`;
      }
      app(req, res);
    });
  });

  const port = await listen(server);
  return { server, port, app, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('api/index.js répond aux appels serverless de Vercel', async (t) => {
  const app = await startVercelLikeFunction();
  assert.equal(typeof app.app, 'function', 'le module exporte un gestionnaire HTTP');
  assert.equal(require('../server.js').server.listening, false, 'aucun port n’est ouvert à l’import');
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.deepEqual(Object.keys(healthData).sort(), ['ok', 'persistent', 'rooms', 'storage']);
  assert.equal(healthData.storage, 'memory', 'sur Vercel sans base KV, on reste en mémoire');
  assert.equal(healthData.persistent, false);

  const unlock = await fetch(`${base}/api/creator/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CREATOR_CODE }),
  });
  assert.equal(unlock.status, 200, 'le code organisateur est lu depuis l’environnement');
  const { ticket } = await unlock.json();

  const created = await fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Creator-Ticket': ticket },
    body: JSON.stringify({ title: 'Salon Vercel', game: 'morpion', maxPlayers: 2, nickname: 'Amiral' }),
  });
  const createdBody = await created.json();
  assert.equal(created.status, 201, 'le corps JSON pré-lu par Vercel est bien utilisé');
  assert.equal(createdBody.room.title, 'Salon Vercel');

  const rooms = await fetch(`${base}/api/rooms`);
  const roomsBody = await rooms.json();
  assert.equal(roomsBody.rooms.length, 1, 'le salon créé est visible');

  const join = await fetch(`${base}/api/rooms/${createdBody.room.id}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: 'Second' }),
  });
  assert.equal(join.status, 201);

  const missing = await fetch(`${base}/api/rooms`);
  assert.equal(missing.status, 200, 'une requête sans corps reste acceptée');
});

// --- 2. Le stockage KV, simulé avec un faux Upstash ------------------------

function startFakeKv() {
  const store = new Map();
  const log = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const send = (payload) => {
        const body = Buffer.from(JSON.stringify(payload));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      };
      if (!String(req.headers.authorization || '').startsWith('Bearer ')) {
        res.writeHead(401).end('{"error":"unauthorized"}');
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      let commands;
      try {
        commands = JSON.parse(raw);
      } catch {
        res.writeHead(400).end('{"error":"bad json"}');
        return;
      }
      if ((req.url || '').split('?')[0] !== '/pipeline' || !Array.isArray(commands)) {
        res.writeHead(404).end('{"error":"not found"}');
        return;
      }
      log.push(commands);
      const results = commands.map((command) => {
        const [name, key, value] = command;
        const action = String(name).toLowerCase();
        if (action === 'set') {
          store.set(String(key), String(value));
          return { result: 'OK' };
        }
        if (action === 'get') {
          return { result: store.has(String(key)) ? store.get(String(key)) : null };
        }
        return { error: `commande inconnue: ${name}` };
      });
      send(results);
    });
  });
  return { server, store, log };
}

async function launchApp(env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recre-jeux-vercel-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', CREATOR_CODE, DATA_DIR: dataDir, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = (chunk) => { output += chunk.toString(); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Le serveur ne démarre pas. Logs : ${output}`)), 10_000);
    timeout.unref();
    const inspect = () => {
      const match = output.match(/disponible sur http:\/\/0\.0\.0\.0:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on('data', inspect);
    inspect();
  });

  return {
    port,
    output: () => output,
    dataDir,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test('Le stockage KV partage et conserve les données entre instances', async (t) => {
  const kv = startFakeKv();
  const kvPort = await listen(kv.server);
  t.after(() => new Promise((resolve) => kv.server.close(resolve)));
  const env = {
    STORAGE: 'kv',
    KV_REST_API_URL: `http://127.0.0.1:${kvPort}`,
    KV_REST_API_TOKEN: 'jeton-de-test',
    VERCEL: '1',
  };

  const first = await launchApp(env);
  t.after(() => first.stop());

  const health = await (await fetch(`http://127.0.0.1:${first.port}/api/health`)).json();
  assert.equal(health.storage, 'kv');
  assert.equal(health.persistent, true);

  const unlock = await fetch(`http://127.0.0.1:${first.port}/api/creator/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CREATOR_CODE }),
  });
  const { ticket } = await unlock.json();
  const created = await fetch(`http://127.0.0.1:${first.port}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Creator-Ticket': ticket },
    body: JSON.stringify({ title: 'Salon partagé', game: 'morpion', maxPlayers: 2, nickname: 'Chef' }),
  });
  assert.equal(created.status, 201);
  const roomId = (await created.json()).room.id;
  assert.ok(kv.store.size >= 1, 'les salons sont écrits dans la base KV');
  assert.ok(fs.readdirSync(first.dataDir).length === 0, 'aucun fichier n’est écrit sur le disque');

  // Deuxième instance, mémoire vide : elle doit voir le même salon.
  const second = await launchApp(env);
  t.after(() => second.stop());
  const seen = await (await fetch(`http://127.0.0.1:${second.port}/api/rooms`)).json();
  assert.equal(seen.rooms.length, 1, 'la deuxième instance voit le salon de la première');
  assert.equal(seen.rooms[0].id, roomId);

  // Et un redémarrage complet conserve le salon.
  await first.stop();
  const third = await launchApp(env);
  t.after(() => third.stop());
  const afterRestart = await (await fetch(`http://127.0.0.1:${third.port}/api/rooms`)).json();
  assert.equal(afterRestart.rooms.length, 1, 'le salon survit au redémarrage');
  assert.equal(afterRestart.rooms[0].title, 'Salon partagé');

  const wroteWithSet = kv.log.some((batch) => batch.some((command) => String(command[0]).toLowerCase() === 'set'));
  assert.ok(wroteWithSet, 'les écritures utilisent SET');
  const readWithGet = kv.log.some((batch) => batch.some((command) => String(command[0]).toLowerCase() === 'get'));
  assert.ok(readWithGet, 'la relecture utilise GET');
});
