'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const TEST_CREATOR_CODE = 'private-cheat-test-code';

async function launchServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recre-jeux-cheat-'));
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
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
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
    try { data = JSON.parse(text); } catch { /* garde le texte pour faciliter le diagnostic */ }
    return { status: response.status, data, text };
  }
  return { request };
}

test('le rôle Tricheur reste caché dans les parties et réserve les outils de secrets à son titulaire', async (t) => {
  const { request } = await launchServer(t);
  const unlock = await request('/api/creator/unlock', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  assert.equal(unlock.status, 200);
  const adminLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  assert.equal(adminLogin.status, 200);
  const adminHeaders = { 'X-Admin-Token': adminLogin.data.token };

  const cheater = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Mila Secret', password: '1234', isCheater: true },
  });
  const normalPlayer = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Noé Joueur', password: 'abcd' },
  });
  assert.equal(cheater.status, 201);
  assert.equal(normalPlayer.status, 201);
  assert.equal(cheater.data.account.isCheater, false, 'l’inscription ne peut pas s’attribuer le rôle');

  const adminAccounts = await request('/api/admin/accounts', { headers: adminHeaders });
  const cheaterId = adminAccounts.data.accounts.find((account) => account.nickname === 'Mila Secret').id;
  assert.equal(adminAccounts.data.accounts.find((account) => account.id === cheaterId).isCheater, false);
  const granted = await request(`/api/admin/accounts/${cheaterId}`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: { isCheater: true },
  });
  assert.equal(granted.status, 200);
  assert.equal(granted.data.account.isCheater, true);
  assert.equal((await request('/api/accounts/me', {
    headers: { 'X-Account-Token': cheater.data.token },
  })).data.account.isCheater, true);

  const unoRoom = await request('/api/rooms', {
    method: 'POST',
    headers: {
      'X-Creator-Ticket': unlock.data.ticket,
      'X-Account-Token': cheater.data.token,
    },
    body: { title: 'Pioche secrète', game: 'uno', maxPlayers: 2 },
  });
  assert.equal(unoRoom.status, 201);
  const unoId = unoRoom.data.room.id;
  const cheaterPlayerToken = unoRoom.data.playerToken;
  const waitingCheat = await request(`/api/rooms/${unoId}/cheat`, {
    headers: { 'X-Account-Token': cheater.data.token, 'X-Player-Token': cheaterPlayerToken },
  });
  assert.equal(waitingCheat.status, 409, 'les outils ne révèlent rien avant le démarrage');

  const joinedUno = await request(`/api/rooms/${unoId}/join`, {
    method: 'POST',
    headers: { 'X-Account-Token': normalPlayer.data.token },
    body: { nickname: 'Pseudo libre' },
  });
  assert.equal(joinedUno.status, 201);
  const normalPlayerToken = joinedUno.data.playerToken;
  const startedUno = await request(`/api/rooms/${unoId}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': cheaterPlayerToken },
    body: {},
  });
  assert.equal(startedUno.status, 200);
  assert.equal(startedUno.data.room.isCheater, true, 'seul le titulaire voit son autorisation dans sa réponse');
  assert.ok(startedUno.data.room.players.every((player) => !Object.hasOwn(player, 'isCheater')),
    'aucun indicateur Tricheur n’est attaché aux noms des joueurs');

  const normalRoom = await request(`/api/rooms/${unoId}`, {
    headers: { 'X-Player-Token': normalPlayerToken },
  });
  assert.equal(normalRoom.data.room.isCheater, false);
  assert.ok(normalRoom.data.room.players.every((player) => !Object.hasOwn(player, 'isCheater')));
  assert.equal((await request(`/api/rooms/${unoId}/cheat`, {
    headers: { 'X-Account-Token': normalPlayer.data.token, 'X-Player-Token': normalPlayerToken },
  })).status, 403, 'un compte sans rôle ne peut pas lire les outils secrets');
  assert.equal((await request(`/api/rooms/${unoId}/cheat`, {
    headers: { 'X-Account-Token': cheater.data.token, 'X-Player-Token': normalPlayerToken },
  })).status, 403, 'le compte Tricheur doit correspondre au joueur du salon');

  const secretHeaders = {
    'X-Account-Token': cheater.data.token,
    'X-Player-Token': cheaterPlayerToken,
  };
  const secretState = await request(`/api/rooms/${unoId}/cheat`, { headers: secretHeaders });
  assert.equal(secretState.status, 200);
  assert.equal(secretState.data.cheat.game, 'uno');
  assert.equal(secretState.data.cheat.players.length, 2);
  assert.ok(secretState.data.cheat.players.every((player) => player.hand.length === 7));
  assert.equal(secretState.data.cheat.deck.length, secretState.data.cheat.deckCount);

  const chosenDraw = secretState.data.cheat.deck[0];
  const forced = await request(`/api/rooms/${unoId}/cheat`, {
    method: 'POST',
    headers: secretHeaders,
    body: { action: 'force-next-draw', cardId: chosenDraw.id },
  });
  assert.equal(forced.status, 200);
  assert.equal(forced.data.forcedCard.id, chosenDraw.id);
  assert.equal(forced.data.cheat.nextDraw.id, chosenDraw.id);
  const drew = await request(`/api/rooms/${unoId}/uno/draw`, {
    method: 'POST',
    headers: { 'X-Player-Token': cheaterPlayerToken },
    body: {},
  });
  assert.equal(drew.status, 200);
  assert.ok(drew.data.room.uno.myHand.some((card) => card.id === chosenDraw.id),
    'le prochain joueur reçoit effectivement la carte choisie lorsqu’il pioche');

  const afterDraw = await request(`/api/rooms/${unoId}/cheat`, { headers: secretHeaders });
  const giftedCard = afterDraw.data.cheat.deck[0];
  const gifted = await request(`/api/rooms/${unoId}/cheat`, {
    method: 'POST',
    headers: secretHeaders,
    body: { action: 'give-card', cardId: giftedCard.id, targetPlayerId: unoRoom.data.room.players[0].id },
  });
  assert.equal(gifted.status, 200);
  assert.equal(gifted.data.given.card.id, giftedCard.id);
  assert.equal(gifted.data.cheat.players.find((player) => player.nickname === 'Mila Secret').hand.length, 9);

  const loupRoom = await request('/api/rooms', {
    method: 'POST',
    headers: {
      'X-Creator-Ticket': unlock.data.ticket,
      'X-Account-Token': cheater.data.token,
    },
    body: { title: 'Village discret', game: 'loup-garou', maxPlayers: 4 },
  });
  assert.equal(loupRoom.status, 201);
  const loupId = loupRoom.data.room.id;
  const loupHostToken = loupRoom.data.playerToken;
  const loupPlayers = [loupHostToken];
  for (let index = 0; index < 3; index += 1) {
    const joinHeaders = index === 0 ? { 'X-Account-Token': normalPlayer.data.token } : {};
    const joined = await request(`/api/rooms/${loupId}/join`, {
      method: 'POST',
      headers: joinHeaders,
      body: { nickname: `Villageois ${index + 2}` },
    });
    assert.equal(joined.status, 201);
    loupPlayers.push(joined.data.playerToken);
  }
  const startedLoup = await request(`/api/rooms/${loupId}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': loupHostToken },
    body: {},
  });
  assert.equal(startedLoup.status, 200);
  assert.equal(startedLoup.data.room.loupGarou.players.every((player) => player.role === null), true);
  const loupSecrets = await request(`/api/rooms/${loupId}/cheat`, {
    headers: { 'X-Account-Token': cheater.data.token, 'X-Player-Token': loupHostToken },
  });
  assert.equal(loupSecrets.status, 200);
  assert.equal(loupSecrets.data.cheat.roles.length, 4);
  assert.equal(loupSecrets.data.cheat.roles.filter((player) => player.role === 'wolf').length, 1);
  assert.ok(loupSecrets.data.cheat.roles.every((player) => typeof player.roleName === 'string'));
  assert.equal((await request(`/api/rooms/${loupId}/cheat`, {
    headers: { 'X-Account-Token': normalPlayer.data.token, 'X-Player-Token': loupPlayers[1] },
  })).status, 403, 'les rôles secrets restent protégés pour les autres joueurs');
});
