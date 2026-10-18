'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const TEST_CREATOR_CODE = 'test-code-only';

async function launchServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recre-jeux-api-'));
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
      headers,
      ...(body === undefined ? {} : {
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      // Une réponse texte reste disponible via la propriété text.
    }
    return { status: response.status, data, response, text };
  }

  return { request, dataDir };
}

test('API de bout en bout : code organisateur, lobby, confidentialité, bots et actions UNO', async (t) => {
  const { request, dataDir } = await launchServer(t);

  const home = await request('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /<html lang="fr">/);
  assert.match(home.text, /data-action="account"/);
  assert.match(home.text, /data-action="admin"/);
  assert.match(home.text, /id="solo"/);
  assert.match(home.text, /data-solo-game="snake"/);
  assert.match(home.text, /data-solo-game="2048"/);
  assert.match(home.text, /data-solo-game="demineur"/);
  assert.match(home.text, /data-solo-game="memory"/);
  assert.doesNotMatch(home.text, /data-solo-game="(?:uno|loup-garou|quiz|puissance-4|blind-test|morpion|memoire)"/);
  assert.match(home.text, /Panneau administrateur/);
  assert.match(home.text, /id="leaderboard-list"/);
  const soloEngine = await request('/solo-games.js');
  assert.equal(soloEngine.status, 200);
  assert.match(soloEngine.text, /createSnake/);
  assert.match(soloEngine.text, /create2048/);
  assert.match(soloEngine.text, /createMinesweeper/);
  assert.match(soloEngine.text, /createMemory/);
  const script = await request('/app.js');
  assert.equal(script.status, 200);
  assert.match(script.text, /Créer mon compte/);
  assert.match(script.text, /function accountDialog\(mode = 'login'\)/);
  assert.match(script.text, /LAST_ACCOUNT_NICKNAME_KEY/);
  assert.match(script.text, /function puissance4GameDialog/);
  assert.match(script.text, /function loupGarouGameDialog/);
  assert.match(script.text, /function startSoloGame/);
  assert.match(script.text, /data-solo-game/);
  assert.match(script.text, /function snakeMarkup/);
  assert.match(script.text, /function board2048Markup/);
  assert.match(script.text, /function minesweeperMarkup/);
  assert.match(script.text, /function memorySoloMarkup/);
  assert.match(script.text, /data-solo-2048-move/);
  assert.match(script.text, /data-mines-row/);
  assert.match(script.text, /data-memory-card/);
  assert.doesNotMatch(script.text, /\/api\/solo/, 'les jeux solo tournent côté navigateur, sans salon serveur');
  assert.match(script.text, /data-solo-variant/);
  assert.match(script.text, /function soloOptionRow/);
  assert.match(script.text, /function snakeInterval/);
  assert.match(script.text, /Mettre le jeu en grand/);
  assert.match(script.text, /roomCloseButton/);
  assert.match(script.text, /myDayVoteId/);
  assert.match(script.text, /werewolf-timer-track/);
  assert.match(script.text, /formSnapshots/);
  assert.match(script.text, /data-p4-column/);
  assert.match(script.text, /api\('\/api\/leaderboard'\)/);
  assert.match(script.text, /function adminPanelDialog/);
  assert.match(script.text, /\/api\/admin\/login/);
  assert.match(script.text, /X-Admin-Token/);
  assert.match(script.text, /data-fullscreen-toggle/);
  assert.match(script.text, /data-cheat-open/);
  assert.match(script.text, /function renderCheatDialog/);
  assert.match(script.text, /data-cheat-mode/);
  assert.match(script.text, /data-cheat-deck-card/);
  assert.match(script.text, /Toutes les mains/);
  assert.match(script.text, /Touche une carte/);
  assert.match(script.text, /X-Room-Tokens/);
  assert.match(script.text, /data-room-close/);
  assert.doesNotMatch(script.text, /1864/);
  const stylesheet = await request('/styles.css');
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.text, /\.uno-game-view/);
  assert.match(stylesheet.text, /\.account-profile/);
  assert.match(stylesheet.text, /\.leaderboard-card/);
  assert.match(stylesheet.text, /\.admin-account-card/);
  assert.match(stylesheet.text, /\.app-dialog:fullscreen/);
  assert.match(stylesheet.text, /\.chat-fullscreen-button/);
  assert.match(stylesheet.text, /\.cheat-deck-grid/);
  assert.match(stylesheet.text, /\.room-close-button/);
  assert.match(stylesheet.text, /\.werewolf-timer-track/);
  assert.match(stylesheet.text, /\.werewolf-target\.is-selected/);
  assert.match(stylesheet.text, /\.solo-game-card/);
  assert.match(stylesheet.text, /\.solo-arcade-view/);
  assert.match(stylesheet.text, /\.solo-2048-board/);
  assert.match(stylesheet.text, /\.minesweeper-board/);
  assert.match(stylesheet.text, /\.solo-memory-board/);
  assert.match(stylesheet.text, /\.solo-option-chip/);
  assert.match(stylesheet.text, /\.app-dialog:fullscreen\[data-view="solo-game"\]/);

  const initialList = await request('/api/rooms');
  assert.equal(initialList.status, 200);
  assert.deepEqual(initialList.data.rooms, []);

  const lockedCreation = await request('/api/rooms', {
    method: 'POST',
    body: { title: 'Sans code', nickname: 'Visiteur', game: 'uno', maxPlayers: 4 },
  });
  assert.equal(lockedCreation.status, 401, 'la création exige le ticket organisateur');
  assert.equal((await request('/api/creator/unlock', { method: 'POST', body: null })).status, 400);

  const wrongCode = await request('/api/creator/unlock', { method: 'POST', body: { code: '0000' } });
  assert.equal(wrongCode.status, 401);
  const unlocked = await request('/api/creator/unlock', { method: 'POST', body: { code: TEST_CREATOR_CODE } });
  assert.equal(unlocked.status, 200);
  assert.equal(typeof unlocked.data.ticket, 'string');

  const registered = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Joueuse Test', password: '1234' },
  });
  assert.equal(registered.status, 201, 'les comptes se créent sans code organisateur');
  assert.equal(registered.data.account.nickname, 'Joueuse Test');
  assert.equal(registered.data.account.wins, 0);
  assert.equal(JSON.stringify(registered.data).includes('passwordHash'), false);
  assert.equal(JSON.stringify(registered.data).includes('passwordSalt'), false);
  const persistedAccounts = fs.readFileSync(path.join(dataDir, 'accounts.json'), 'utf8');
  assert.match(persistedAccounts, /"passwordHash"/);
  assert.doesNotMatch(persistedAccounts, /"password"\s*:\s*"1234"/);
  const registeredToken = registered.data.token;
  assert.equal((await request('/api/accounts/me', {
    headers: { 'X-Account-Token': registeredToken },
  })).data.account.nickname, 'Joueuse Test');
  assert.equal((await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'joueuse TEST', password: '5678' },
  })).status, 409, 'les pseudos de compte sont uniques sans tenir compte des majuscules');
  assert.equal((await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'AB', password: '123' },
  })).status, 400, 'le mot de passe court garde une longueur minimale');
  assert.equal((await request('/api/accounts/login', {
    method: 'POST',
    body: { nickname: 'Joueuse Test', password: '0000' },
  })).status, 401);
  const loggedIn = await request('/api/accounts/login', {
    method: 'POST',
    body: { nickname: 'joueuse test', password: '1234' },
  });
  assert.equal(loggedIn.status, 200, 'un pseudo peut se reconnecter sans tenir compte de la casse');
  const accountToken = loggedIn.data.token;
  const secondAccount = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Élève Test', password: 'abcd' },
  });
  assert.equal(secondAccount.status, 201);

  assert.equal((await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Creator-Ticket': unlocked.data.ticket },
    body: { title: 'Jeu inconnu', nickname: 'Organisatrice', game: 'constructor', maxPlayers: 2 },
  })).status, 400, 'un identifiant de jeu inconnu ne doit pas être accepté');

  const botRoomResult = await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Creator-Ticket': unlocked.data.ticket },
    body: { title: 'Test bots', nickname: 'Organisatrice', game: 'uno', maxPlayers: 3 },
  });
  assert.equal(botRoomResult.status, 201);
  const botRoomId = botRoomResult.data.room.id;
  const botHostToken = botRoomResult.data.playerToken;
  assert.equal((await request(`/api/rooms/${botRoomId}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': botHostToken },
    body: {},
  })).status, 400, 'UNO ne démarre pas avant le minimum de deux joueurs');
  const addedBots = await request(`/api/rooms/${botRoomId}/bots`, {
    method: 'POST',
    headers: { 'X-Player-Token': botHostToken },
    body: { count: 1 },
  });
  assert.equal(addedBots.status, 200);
  assert.equal(addedBots.data.addedCount, 1);
  assert.equal(addedBots.data.room.playerCount, 2);
  const botPlayer = addedBots.data.room.players.find((player) => player.isBot);
  assert.ok(botPlayer);
  const botStart = await request(`/api/rooms/${botRoomId}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': botHostToken },
    body: {},
  });
  assert.equal(botStart.status, 200);
  assert.equal(botStart.data.room.uno.isMyTurn, true);
  const firstPlayable = botStart.data.room.uno.myHand.find((card) => (
    card.playable && (card.type === 'number' || card.type === 'wild')
  ));
  let botTrigger;
  if (firstPlayable) {
    botTrigger = await request(`/api/rooms/${botRoomId}/uno/play`, {
      method: 'POST',
      headers: { 'X-Player-Token': botHostToken },
      body: {
        cardId: firstPlayable.id,
        ...(firstPlayable.type === 'wild' || firstPlayable.type === 'wild4' ? { color: 'red' } : {}),
      },
    });
  } else {
    botTrigger = await request(`/api/rooms/${botRoomId}/uno/draw`, {
      method: 'POST',
      headers: { 'X-Player-Token': botHostToken },
      body: {},
    });
    if (botTrigger.status === 200 && botTrigger.data.room.uno.drawnCardId) {
      const passed = await request(`/api/rooms/${botRoomId}/uno/pass`, {
        method: 'POST',
        headers: { 'X-Player-Token': botHostToken },
        body: {},
      });
      assert.equal(passed.status, 200);
      botTrigger = passed;
    }
  }
  assert.equal(botTrigger.status, 200);
  const afterBotTurn = await request(`/api/rooms/${botRoomId}`, {
    headers: { 'X-Player-Token': botHostToken },
  });
  assert.equal(afterBotTurn.status, 200);
  assert.ok(
    afterBotTurn.data.room.uno.phase === 'finished' || afterBotTurn.data.room.uno.lastAction.playerId === botPlayer.id,
    'le bot prend son tour automatiquement après l’action du joueur',
  );
  assert.equal((await request(`/api/rooms/${botRoomId}/bots`, {
    method: 'DELETE',
    headers: { 'X-Player-Token': botHostToken },
  })).status, 409, 'les bots sont figés une fois la partie lancée');

  const roomResult = await request('/api/rooms', {
    method: 'POST',
    headers: {
      'X-Creator-Ticket': unlocked.data.ticket,
      'X-Account-Token': accountToken,
    },
    body: { title: 'UNO à 2 sur 4', nickname: 'Pseudo différent', game: 'uno', maxPlayers: 4 },
  });
  assert.equal(roomResult.status, 201);
  assert.equal(roomResult.data.room.players[0].nickname, 'Joueuse Test', 'le compte garde le pseudo choisi');
  assert.equal(JSON.stringify(roomResult.data.room).includes('accountId'), false);
  const roomId = roomResult.data.room.id;
  const hostToken = roomResult.data.playerToken;

  const unauthorizedCreate = await request('/api/rooms', {
    method: 'POST',
    body: { title: 'Salon interdit', nickname: 'Élève', game: 'uno', maxPlayers: 4 },
  });
  assert.equal(unauthorizedCreate.status, 401);

  const joined = await request(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'X-Account-Token': secondAccount.data.token },
    body: { nickname: 'Pseudo temporaire' },
  });
  assert.equal(joined.status, 201, 'un joueur rejoint sans code organisateur');
  assert.equal(joined.data.room.players.find((player) => player.isCurrentPlayer).nickname, 'Élève Test');
  const guestToken = joined.data.playerToken;
  assert.equal(joined.data.room.playerCount, 2);
  assert.equal(joined.data.room.maxPlayers, 4);

  const started = await request(`/api/rooms/${roomId}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': hostToken },
    body: {},
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.room.status, 'started');
  assert.equal(started.data.room.playerCount, 2, 'le salon démarre sans être complet');
  assert.equal(started.data.room.maxPlayers, 4);
  assert.equal(started.data.room.uno.phase, 'playing');
  assert.equal(started.data.room.uno.myHand.length, 7);
  assert.equal(started.data.room.uno.isMyTurn, true);

  const anonymousRoom = await request(`/api/rooms/${roomId}`);
  assert.equal(anonymousRoom.status, 200);
  assert.deepEqual(anonymousRoom.data.room.uno.myHand, [], 'les mains adverses sont privées');
  assert.equal(JSON.stringify(anonymousRoom.data).includes('tokenHash'), false);
  assert.equal((await request(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    body: { nickname: 'En retard' },
  })).status, 409, 'un nouveau joueur ne peut entrer après le départ');
  assert.equal((await request(`/api/rooms/${roomId}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': guestToken },
    body: {},
  })).status, 403, 'seul l’organisateur peut lancer');

  assert.equal((await request(`/api/rooms/${roomId}/uno/draw`, {
    method: 'POST',
    headers: { 'X-Player-Token': guestToken },
    body: {},
  })).status, 403, 'le moteur refuse une action hors tour');
  assert.equal((await request(`/api/rooms/${roomId}/uno/pass`, {
    method: 'POST',
    headers: { 'X-Player-Token': hostToken },
    body: {},
  })).status, 400, 'on ne peut pas passer avant d’avoir pioché');
  assert.equal((await request(`/api/rooms/${roomId}/uno/play`, {
    method: 'POST',
    headers: { 'X-Player-Token': hostToken },
    body: { cardId: 'carte-inexistante' },
  })).status, 404);
  assert.equal((await request(`/api/rooms/${roomId}/uno/restart`, {
    method: 'POST',
    headers: { 'X-Player-Token': hostToken },
    body: {},
  })).status, 409, 'on ne peut relancer qu’une manche terminée');

  const firstTurn = await request(`/api/rooms/${roomId}/uno/draw`, {
    method: 'POST',
    headers: { 'X-Player-Token': hostToken },
    body: {},
  });
  assert.equal(firstTurn.status, 200);
  if (firstTurn.data.room.uno.drawnCardId) {
    const passed = await request(`/api/rooms/${roomId}/uno/pass`, {
      method: 'POST',
      headers: { 'X-Player-Token': hostToken },
      body: {},
    });
    assert.equal(passed.status, 200);
  }

  let successfulPlay = false;
  for (let attempt = 0; attempt < 40 && !successfulPlay; attempt += 1) {
    const [hostView, guestView] = await Promise.all([
      request(`/api/rooms/${roomId}`, { headers: { 'X-Player-Token': hostToken } }),
      request(`/api/rooms/${roomId}`, { headers: { 'X-Player-Token': guestToken } }),
    ]);
    const currentView = hostView.data.room.uno.isMyTurn ? hostView : guestView;
    const currentToken = hostView.data.room.uno.isMyTurn ? hostToken : guestToken;
    const playable = currentView.data.room.uno.myHand.find((card) => card.playable);
    if (playable) {
      const played = await request(`/api/rooms/${roomId}/uno/play`, {
        method: 'POST',
        headers: { 'X-Player-Token': currentToken },
        body: {
          cardId: playable.id,
          ...(playable.type === 'wild' || playable.type === 'wild4' ? { color: 'green' } : {}),
        },
      });
      assert.equal(played.status, 200);
      successfulPlay = true;
      break;
    }
    const drawn = await request(`/api/rooms/${roomId}/uno/draw`, {
      method: 'POST',
      headers: { 'X-Player-Token': currentToken },
      body: {},
    });
    assert.equal(drawn.status, 200);
    if (drawn.data.room.uno.drawnCardId) {
      const card = drawn.data.room.uno.myHand.find((item) => item.id === drawn.data.room.uno.drawnCardId);
      const action = card.playable ? 'play' : 'pass';
      const moved = await request(`/api/rooms/${roomId}/uno/${action}`, {
        method: 'POST',
        headers: { 'X-Player-Token': currentToken },
        body: action === 'play'
          ? { cardId: card.id, ...(card.type === 'wild' || card.type === 'wild4' ? { color: 'green' } : {}) }
          : {},
      });
      assert.equal(moved.status, 200);
      if (action === 'play') successfulPlay = true;
    }
  }
  assert.equal(successfulPlay, true, 'un joueur doit pouvoir jouer une carte via l’API');

  assert.equal((await request('/api/accounts/logout', {
    method: 'POST',
    headers: { 'X-Account-Token': accountToken },
  })).status, 200);
  assert.equal((await request('/api/accounts/me', {
    headers: { 'X-Account-Token': accountToken },
  })).status, 401, 'la déconnexion révoque le jeton utilisé');
  assert.equal((await request('/api/accounts/me', {
    headers: { 'X-Account-Token': registeredToken },
  })).status, 200, 'les autres sessions du même compte restent actives');
  const reconnected = await request('/api/accounts/login', {
    method: 'POST',
    body: { nickname: 'Joueuse Test', password: '1234' },
  });
  assert.equal(reconnected.status, 200, 'un compte déconnecté peut se reconnecter avec son pseudo et son mot de passe');
  assert.equal(reconnected.data.account.nickname, 'Joueuse Test');
});

test('Puissance 4 en ligne : le duel est jouable et les victoires sont mémorisées au classement', async (t) => {
  const { request, dataDir } = await launchServer(t);
  const unlocked = await request('/api/creator/unlock', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  assert.equal(unlocked.status, 200);

  const alice = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Alice Championne', password: '1234' },
  });
  const bob = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Bob Joueur', password: '5678' },
  });
  assert.equal(alice.status, 201);
  assert.equal(bob.status, 201);

  const created = await request('/api/rooms', {
    method: 'POST',
    headers: {
      'X-Creator-Ticket': unlocked.data.ticket,
      'X-Account-Token': alice.data.token,
    },
    body: { title: 'Le grand duel', game: 'puissance-4', maxPlayers: 2 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.room.game, 'puissance-4');
  const roomId = created.data.room.id;
  const alicePlayerToken = created.data.playerToken;
  assert.equal((await request(`/api/rooms/${roomId}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': alicePlayerToken },
    body: {},
  })).status, 400, 'Puissance 4 attend ses deux joueurs');

  const joined = await request(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'X-Account-Token': bob.data.token },
    body: { nickname: 'Pseudo temporaire' },
  });
  assert.equal(joined.status, 201, 'le deuxième joueur rejoint sans code organisateur');
  assert.equal(joined.data.room.players.find((player) => player.isCurrentPlayer).nickname, 'Bob Joueur');
  const bobPlayerToken = joined.data.playerToken;

  const started = await request(`/api/rooms/${roomId}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': alicePlayerToken },
    body: {},
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.room.puissance4.phase, 'playing');
  assert.equal(started.data.room.puissance4.board.length, 6);
  assert.equal(started.data.room.puissance4.board[0].length, 7);
  assert.equal(started.data.room.puissance4.isMyTurn, true);
  assert.equal((await request(`/api/rooms/${roomId}/puissance-4/play`, {
    method: 'POST',
    headers: { 'X-Player-Token': bobPlayerToken },
    body: { column: 0 },
  })).status, 403, 'le serveur interdit de jouer hors tour');
  assert.equal((await request(`/api/rooms/${roomId}/puissance-4/play`, {
    method: 'POST',
    headers: { 'X-Player-Token': alicePlayerToken },
    body: { column: 7 },
  })).status, 400, 'le serveur refuse les colonnes hors grille');

  const columns = [0, 6, 1, 6, 2, 5, 3];
  let lastMove;
  for (const [turn, column] of columns.entries()) {
    lastMove = await request(`/api/rooms/${roomId}/puissance-4/play`, {
      method: 'POST',
      headers: { 'X-Player-Token': turn % 2 === 0 ? alicePlayerToken : bobPlayerToken },
      body: { column },
    });
    assert.equal(lastMove.status, 200);
  }
  assert.equal(lastMove.data.room.puissance4.phase, 'finished');
  assert.equal(lastMove.data.room.puissance4.result, 'win');
  assert.equal(lastMove.data.room.puissance4.winnerName, 'Alice Championne');
  assert.equal(lastMove.data.room.puissance4.winningCells.length, 4);
  assert.equal(JSON.stringify(lastMove.data.room).includes('accountId'), false);
  assert.equal(JSON.stringify(lastMove.data.room).includes('tokenHash'), false);

  const leaderboard = await request('/api/leaderboard');
  assert.equal(leaderboard.status, 200);
  assert.deepEqual(leaderboard.data.players, [
    { nickname: 'Alice Championne', wins: 1 },
    { nickname: 'Bob Joueur', wins: 0 },
  ]);
  const storedAccounts = JSON.parse(fs.readFileSync(path.join(dataDir, 'accounts.json'), 'utf8'));
  assert.equal(storedAccounts.accounts.find((account) => account.nickname === 'Alice Championne').wins, 1);

  const replayed = await request(`/api/rooms/${roomId}/puissance-4/restart`, {
    method: 'POST',
    headers: { 'X-Player-Token': alicePlayerToken },
    body: {},
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.data.room.puissance4.phase, 'playing');
  assert.ok(replayed.data.room.puissance4.board.flat().every((cell) => cell === null));
  const leaderboardAfterReplay = await request('/api/leaderboard');
  assert.equal(leaderboardAfterReplay.data.players[0].wins, 1, 'une victoire n’est comptée qu’une fois');
});

test('seul l’organisateur peut fermer un salon ou arrêter une partie en cours', async (t) => {
  const { request } = await launchServer(t);
  const unlocked = await request('/api/creator/unlock', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  assert.equal(unlocked.status, 200);

  const created = await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Creator-Ticket': unlocked.data.ticket },
    body: { title: 'Salon à fermer', nickname: 'Organisatrice', game: 'uno', maxPlayers: 4 },
  });
  assert.equal(created.status, 201);
  const roomId = created.data.room.id;
  const hostToken = created.data.playerToken;
  const joined = await request(`/api/rooms/${roomId}/join`, {
    method: 'POST',
    body: { nickname: 'Invité' },
  });
  assert.equal(joined.status, 201);
  const guestToken = joined.data.playerToken;

  const publicList = await request('/api/rooms');
  assert.equal(publicList.data.rooms[0].isHost, false, 'le statut organisateur ne fuit pas dans la liste publique');
  const hostList = await request('/api/rooms', {
    headers: { 'X-Room-Tokens': JSON.stringify({ [roomId]: hostToken }) },
  });
  assert.equal(hostList.data.rooms[0].isHost, true, 'le jeton organisateur permet d’afficher son action sur l’accueil');
  const guestList = await request('/api/rooms', {
    headers: { 'X-Room-Tokens': JSON.stringify({ [roomId]: guestToken }) },
  });
  assert.equal(guestList.data.rooms[0].isHost, false, 'un participant ne reçoit pas le droit de fermeture');

  const refusedClose = await request(`/api/rooms/${roomId}`, {
    method: 'DELETE',
    headers: { 'X-Player-Token': guestToken },
  });
  assert.equal(refusedClose.status, 403, 'le serveur refuse la fermeture par un participant');
  const closed = await request(`/api/rooms/${roomId}`, {
    method: 'DELETE',
    headers: { 'X-Player-Token': hostToken },
  });
  assert.equal(closed.status, 200, 'l’organisateur ferme le salon sans avoir à l’ouvrir');
  assert.deepEqual((await request('/api/rooms')).data.rooms, []);

  const activeRoom = await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Creator-Ticket': unlocked.data.ticket },
    body: { title: 'Partie en cours', nickname: 'Organisatrice', game: 'uno', maxPlayers: 2 },
  });
  assert.equal(activeRoom.status, 201);
  const activeGuest = await request(`/api/rooms/${activeRoom.data.room.id}/join`, {
    method: 'POST', body: { nickname: 'Invité actif' },
  });
  assert.equal(activeGuest.status, 201);
  const started = await request(`/api/rooms/${activeRoom.data.room.id}/start`, {
    method: 'POST', headers: { 'X-Player-Token': activeRoom.data.playerToken }, body: {},
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.room.status, 'started');
  const guestCannotStop = await request(`/api/rooms/${activeRoom.data.room.id}`, {
    method: 'DELETE', headers: { 'X-Player-Token': activeGuest.data.playerToken },
  });
  assert.equal(guestCannotStop.status, 403, 'un participant ne peut pas arrêter une partie en cours');
  const stopped = await request(`/api/rooms/${activeRoom.data.room.id}`, {
    method: 'DELETE', headers: { 'X-Player-Token': activeRoom.data.playerToken },
  });
  assert.equal(stopped.status, 200, 'l’organisateur peut arrêter la partie en cours pour tout le monde');
  assert.deepEqual((await request('/api/rooms')).data.rooms, []);
});
