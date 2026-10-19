'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const TEST_CREATOR_CODE = 'admin-test-code-private';

async function launchServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recre-jeux-admin-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: '0',
      CREATOR_CODE: TEST_CREATOR_CODE,
      DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const capture = (chunk) => { output += chunk.toString(); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Le serveur ne démarre pas. Logs : ${output}`)), 10_000);
    timeout.unref();
    const inspect = () => {
      const match = output.match(/disponible sur http:\/\/0\.0\.0\.0:(\d+)/);
      if (!match) return;
      clearTimeout(timeout);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Le serveur s’est arrêté (${code ?? signal}). Logs : ${output}`));
    });
    inspect();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  async function request(url, { method = 'GET', headers = {}, body } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      // Le texte reste disponible si une route renvoie une page HTML par erreur.
    }
    return { status: response.status, data, text };
  }

  return { request, dataDir };
}

test('administration protégée : comptes, pseudonymes, rôle admin, création sans code et suppression', async (t) => {
  const { request, dataDir } = await launchServer(t);

  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /data-action="admin"/);
  const app = await request('/app.js');
  assert.equal(app.status, 200);
  assert.match(app.text, /function adminPanelDialog/);
  assert.match(app.text, /function submitAdminRename/);
  assert.match(app.text, /data-cheater-role/);
  assert.doesNotMatch(app.text, /1864/, 'le code organisateur ne doit jamais être inscrit dans le JavaScript client');

  assert.equal((await request('/api/admin/accounts')).status, 401, 'la liste est protégée');
  assert.equal((await request('/api/admin/login', {
    method: 'POST',
    body: { code: 'code-incorrect' },
  })).status, 401, 'un mauvais code ne crée pas de session administrateur');

  const unlocked = await request('/api/admin/login', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  assert.equal(unlocked.status, 200);
  assert.equal(typeof unlocked.data.token, 'string');
  assert.ok(unlocked.data.expiresIn > 0);
  const adminHeaders = { 'X-Admin-Token': unlocked.data.token };
  const emptyAccounts = await request('/api/admin/accounts', { headers: adminHeaders });
  assert.equal(emptyAccounts.status, 200);
  assert.equal(emptyAccounts.data.count, 0);
  assert.deepEqual(emptyAccounts.data.accounts, []);

  const first = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Alice Joueuse', password: '1234', isAdmin: true, isCheater: true },
  });
  const second = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Bob Joueur', password: 'abcd' },
  });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.data.account.isAdmin, false, 'le rôle admin ne peut pas être attribué à l’inscription');
  assert.equal(first.data.account.isCheater, false, 'le rôle Tricheur ne peut pas être attribué à l’inscription');

  const listed = await request('/api/admin/accounts', { headers: adminHeaders });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.count, 2);
  assert.deepEqual(listed.data.accounts.map((account) => account.nickname).sort(), ['Alice Joueuse', 'Bob Joueur']);
  assert.equal(JSON.stringify(listed.data).includes('passwordHash'), false);
  assert.equal(JSON.stringify(listed.data).includes('passwordSalt'), false);
  assert.equal(JSON.stringify(listed.data).includes('sessions'), false);
  const firstId = listed.data.accounts.find((account) => account.nickname === 'Alice Joueuse').id;
  const secondId = listed.data.accounts.find((account) => account.nickname === 'Bob Joueur').id;
  assert.equal((await request(`/api/admin/accounts/${firstId}`, {
    method: 'PATCH',
    headers: { 'X-Account-Token': first.data.token },
    body: { isAdmin: true },
  })).status, 401, 'un compte joueur ne peut pas utiliser les routes admin');

  const renamedAndPromoted = await request(`/api/admin/accounts/${firstId}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: { nickname: 'Zoé Admin', isAdmin: true },
  });
  assert.equal(renamedAndPromoted.status, 200);
  assert.equal(renamedAndPromoted.data.account.nickname, 'Zoé Admin');
  assert.equal(renamedAndPromoted.data.account.isAdmin, true);
  assert.equal((await request('/api/accounts/me', {
    headers: { 'X-Account-Token': first.data.token },
  })).data.account.nickname, 'Zoé Admin', 'le nouveau pseudo est reflété par la session du compte');
  assert.equal((await request('/api/accounts/me', {
    headers: { 'X-Account-Token': first.data.token },
  })).data.account.isAdmin, true, 'le rôle accordé est visible dans la session');

  assert.equal((await request(`/api/admin/accounts/${secondId}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: { nickname: 'zoé admin' },
  })).status, 409, 'les pseudos administrés restent uniques sans tenir compte de la casse');
  assert.equal((await request(`/api/admin/accounts/${secondId}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: { isAdmin: 'true' },
  })).status, 400, 'le rôle doit être un booléen explicite');

  const createdWithoutCode = await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Account-Token': first.data.token },
    body: { title: 'Salon admin', game: 'morpion', maxPlayers: 2 },
  });
  assert.equal(createdWithoutCode.status, 201, 'un compte promu crée une partie sans ticket ni code');
  assert.equal(createdWithoutCode.data.room.players[0].nickname, 'Zoé Admin');
  assert.equal((await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Account-Token': second.data.token },
    body: { title: 'Salon joueur', game: 'uno', maxPlayers: 4 },
  })).status, 401, 'un compte ordinaire ne peut toujours pas créer sans code');

  const joined = await request(`/api/rooms/${createdWithoutCode.data.room.id}/join`, {
    method: 'POST',
    headers: { 'X-Account-Token': second.data.token },
    body: { nickname: 'Pseudo temporaire' },
  });
  assert.equal(joined.status, 201);
  const removed = await request(`/api/admin/accounts/${secondId}`, {
    method: 'DELETE',
    headers: adminHeaders,
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.data.deleted.nickname, 'Bob Joueur');
  assert.equal(removed.data.count, 1);
  assert.equal((await request('/api/accounts/me', {
    headers: { 'X-Account-Token': second.data.token },
  })).status, 401, 'la suppression révoque toutes les sessions du compte');
  const storedRooms = JSON.parse(fs.readFileSync(path.join(dataDir, 'rooms.json'), 'utf8'));
  assert.equal(storedRooms.rooms[0].players.some((player) => player.accountId === secondId), false,
    'la suppression détache le compte des salons encore en cours');

  const demoted = await request(`/api/admin/accounts/${firstId}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: { isAdmin: false },
  });
  assert.equal(demoted.status, 200);
  assert.equal(demoted.data.account.isAdmin, false);
  assert.equal((await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Account-Token': first.data.token },
    body: { title: 'Salon sans droit', game: 'uno', maxPlayers: 2 },
  })).status, 401, 'retirer le rôle coupe immédiatement le droit de création');

  const finalList = await request('/api/admin/accounts', { headers: adminHeaders });
  assert.equal(finalList.data.count, 1);
  assert.equal(finalList.data.accounts[0].nickname, 'Zoé Admin');
  assert.equal((await request('/api/admin/logout', { method: 'POST', headers: adminHeaders })).status, 200);
  assert.equal((await request('/api/admin/accounts', { headers: adminHeaders })).status, 401, 'la déconnexion révoque la session admin');
});
