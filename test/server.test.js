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
  assert.match(script.text, /function soloBoardStyle/);
  assert.match(script.text, /grid-template-columns:repeat\(\$\{columns\}/, 'le nombre de colonnes est écrit en clair dans le style du plateau');
  assert.match(script.text, /function paintSnakeFrame/);
  assert.match(script.text, /data-snake-canvas/, 'le plateau du serpent est un canvas');
  assert.match(script.text, /function drawSnakeBoard/);
  assert.match(script.text, /function steerSnake/);
  assert.match(script.text, /function handleSnakeSwipe/, 'le serpent se dirige aussi au doigt');
  assert.match(script.text, /\/api\/presence/, 'le navigateur signale sa présence');
  assert.match(script.text, /function playBuzzSound/);
  assert.match(script.text, /function playMegaAlarm/, 'le son très fort existe');
  assert.match(script.text, /createDynamicsCompressor/, 'le son est compressé pour sonner le plus fort possible');
  assert.match(script.text, /function flashScreen/);
  assert.match(script.text, /function unlockAudio/, 'le son doit pouvoir être joué même sans interaction récente');
  assert.match(script.text, /data-admin-buzz-sound="\$\{sound\}"/);
  assert.match(script.text, /data-admin-buzz-all/, 'un bouton envoie la sirène à tout le monde');
  assert.match(script.text, /MÉGA à tout le monde/);
  assert.match(script.text, /data-admin-buzz/);
  assert.match(script.text, /function refreshAdminPresence/);
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
  assert.match(stylesheet.text, /\.snake-canvas/);
  assert.match(stylesheet.text, /\.admin-presence-card/);
  assert.match(stylesheet.text, /\.admin-buzz-button/);
  assert.match(stylesheet.text, /\.buzz-flash/);
  assert.match(stylesheet.text, /\.admin-buzz-all/);
  assert.match(stylesheet.text, /\.admin-buzz-actions \{[^}]*flex-wrap: wrap/, 'les boutons de son ne doivent jamais être coupés');
  assert.doesNotMatch(stylesheet.text, /repeat\(var\(/, 'une variable dans repeat() décale les rangées sur certains navigateurs');
  assert.doesNotMatch(stylesheet.text, /calc\([^)]*\/\s*var\(/, 'une division par une variable CSS casse les tailles sur certains navigateurs');
  assert.match(stylesheet.text, /\.memory-card-face \{[^}]*color: #332d55/, 'le symbole Memory doit rester lisible sur fond blanc');
  assert.match(stylesheet.text, /\.memory-card-face \{[^}]*Noto Color Emoji/);
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

test('la présence en ligne se déclare, se liste côté admin et reçoit un son', async (t) => {
  const { request } = await launchServer(t);

  const first = await request('/api/presence', {
    method: 'POST',
    body: { nickname: 'Lina', activity: 'Jeu solo : Snake' },
  });
  assert.equal(first.status, 200);
  assert.match(first.data.id, /^[a-f0-9]{8,48}$/i);
  assert.equal(first.data.buzz, null);

  // Le même navigateur garde son identifiant d'un battement à l'autre.
  const second = await request('/api/presence', {
    method: 'POST',
    body: { id: first.data.id, nickname: 'Lina', activity: 'Sur le site' },
  });
  assert.equal(second.data.id, first.data.id);

  const other = await request('/api/presence', { method: 'POST', body: { nickname: 'Tom' } });
  assert.notEqual(other.data.id, first.data.id);

  const unauthorized = await request('/api/admin/presence');
  assert.equal(unauthorized.status, 401, 'la liste des personnes connectées est réservée à l’admin');

  const login = await request('/api/admin/login', { method: 'POST', body: { code: TEST_CREATOR_CODE } });
  assert.equal(login.status, 200);
  const adminHeaders = { 'X-Admin-Token': login.data.token };

  const list = await request('/api/admin/presence', { headers: adminHeaders });
  assert.equal(list.status, 200);
  assert.equal(list.data.count, 2);
  const lina = list.data.people.find((person) => person.nickname === 'Lina');
  assert.ok(lina, 'la personne connectée apparaît dans la liste');
  assert.equal(lina.activity, 'Sur le site');
  assert.equal(lina.isAccount, false);
  assert.equal(lina.buzzPending, false);

  const buzzRefused = await request(`/api/admin/presence/${lina.id}/buzz`, {
    method: 'POST',
    body: { sound: 'cloche' },
  });
  assert.equal(buzzRefused.status, 401, 'impossible d’envoyer un son sans session admin');

  const buzz = await request(`/api/admin/presence/${lina.id}/buzz`, {
    method: 'POST',
    body: { sound: 'alarme', message: 'Reviens en classe !' },
    headers: adminHeaders,
  });
  assert.equal(buzz.status, 200);
  assert.equal(buzz.data.nickname, 'Lina');
  assert.equal(buzz.data.sound, 'alarme');

  const afterBuzz = await request('/api/admin/presence', { headers: adminHeaders });
  const linaWaiting = afterBuzz.data.people.find((person) => person.id === lina.id);
  assert.equal(linaWaiting.buzzPending, true);
  assert.equal(linaWaiting.buzzCount, 1);

  // Le son n'est remis qu'à la personne visée, une seule fois.
  const tomPing = await request('/api/presence', { method: 'POST', body: { id: other.data.id } });
  assert.equal(tomPing.data.buzz, null);

  const delivered = await request('/api/presence', { method: 'POST', body: { id: lina.id, nickname: 'Lina' } });
  assert.equal(delivered.data.buzz.sound, 'alarme');
  assert.equal(delivered.data.buzz.message, 'Reviens en classe !');

  const again = await request('/api/presence', { method: 'POST', body: { id: lina.id, nickname: 'Lina' } });
  assert.equal(again.data.buzz, null, 'le son ne sonne pas en boucle');

  // Son très fort : accepté comme les autres et transmis tel quel.
  const mega = await request(`/api/admin/presence/${lina.id}/buzz`, {
    method: 'POST',
    body: { sound: 'mega' },
    headers: adminHeaders,
  });
  assert.equal(mega.status, 200);
  assert.equal(mega.data.sound, 'mega');
  const megaDelivered = await request('/api/presence', { method: 'POST', body: { id: lina.id } });
  assert.equal(megaDelivered.data.buzz.sound, 'mega');

  const inconnu = await request(`/api/admin/presence/${lina.id}/buzz`, {
    method: 'POST',
    body: { sound: 'tremblement-de-terre' },
    headers: adminHeaders,
  });
  assert.equal(inconnu.data.sound, 'cloche', 'un son inconnu retombe sur la cloche');

  // Sirène envoyée à tout le monde d'un seul coup.
  const broadcast = await request('/api/admin/presence/tous/buzz', {
    method: 'POST',
    body: { sound: 'mega', message: 'Tout le monde écoute' },
    headers: adminHeaders,
  });
  assert.equal(broadcast.status, 200);
  assert.equal(broadcast.data.count, 2, 'les deux personnes connectées reçoivent la sirène');
  const linaBroadcast = await request('/api/presence', { method: 'POST', body: { id: lina.id } });
  assert.equal(linaBroadcast.data.buzz.sound, 'mega');
  const tomBroadcast = await request('/api/presence', { method: 'POST', body: { id: other.data.id } });
  assert.equal(tomBroadcast.data.buzz.message, 'Tout le monde écoute');

  const missing = await request('/api/admin/presence/inconnu/buzz', {
    method: 'POST',
    body: { sound: 'cloche' },
    headers: adminHeaders,
  });
  assert.equal(missing.status, 404);
});

test('Le journal d’activité note les vraies actions sans jamais capter les frappes', async (t) => {
  const { request, dataDir } = await launchServer(t);
  const unlocked = await request('/api/creator/unlock', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  const adminLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  const adminHeaders = { 'X-Admin-Token': adminLogin.data.token };

  // Sans session admin, le journal reste fermé.
  assert.equal((await request('/api/admin/activity')).status, 401);
  assert.equal((await request('/api/admin/activity', { method: 'DELETE' })).status, 401);

  const lina = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Lina', password: 'mot-de-passe-secret' },
  });
  assert.equal(lina.status, 201);

  // Présence : l'arrivée sur le site est notée une seule fois.
  const presence = await request('/api/presence', {
    method: 'POST',
    headers: { 'X-Account-Token': lina.data.token },
    body: { nickname: 'Lina', activity: 'Accueil' },
  });
  await request('/api/presence', {
    method: 'POST',
    headers: { 'X-Account-Token': lina.data.token },
    body: { id: presence.data.id, activity: 'Accueil' },
  });

  // Création de salon et lancement d'une partie.
  const created = await request('/api/rooms', {
    method: 'POST',
    headers: {
      'X-Creator-Ticket': unlocked.data.ticket,
      'X-Account-Token': lina.data.token,
    },
    body: { title: 'La partie du soir', game: 'morpion', maxPlayers: 2 },
  });
  assert.equal(created.status, 201);
  // Morpion se joue à deux : on complète avec un bot de test.
  const bots = await request(`/api/rooms/${created.data.room.id}/bots`, {
    method: 'POST',
    headers: { 'X-Player-Token': created.data.playerToken },
    body: { count: 1 },
  });
  assert.equal(bots.status, 200);
  const started = await request(`/api/rooms/${created.data.room.id}/start`, {
    method: 'POST',
    headers: { 'X-Player-Token': created.data.playerToken },
  });
  assert.equal(started.status, 200);

  const journal = await request('/api/admin/activity?limit=100', { headers: adminHeaders });
  assert.equal(journal.status, 200);
  const texts = journal.data.entries.map((entry) => `${entry.nickname} ${entry.text}`);
  assert.ok(texts.some((line) => line.includes('Lina a créé son compte')), 'création de compte');
  assert.ok(texts.some((line) => line.includes('Lina a rejoint le site')), 'arrivée sur le site');
  assert.ok(texts.some((line) => line.includes('a créé la partie « La partie du soir »')), 'création de salon');
  assert.ok(texts.some((line) => line.includes('a lancé la partie « La partie du soir »')), 'lancement de partie');
  assert.equal(
    texts.filter((line) => line.includes('a rejoint le site')).length,
    1,
    'une seule arrivée malgré les signaux de présence répétés',
  );

  // Les gestes admin sont tracés eux aussi.
  const buzz = await request(`/api/admin/presence/${presence.data.id}/buzz`, {
    method: 'POST',
    body: { sound: 'mega' },
    headers: adminHeaders,
  });
  assert.equal(buzz.status, 200);
  const afterBuzz = await request('/api/admin/activity', { headers: adminHeaders });
  assert.ok(
    afterBuzz.data.entries.some((entry) => entry.text.includes('a envoyé le son 📢 MÉGA à « Lina »')),
    'envoi de son journalisé',
  );
  assert.ok(afterBuzz.data.people.includes('Lina'), 'le filtre par joueur est alimenté');

  // Filtre par joueur.
  const filtered = await request('/api/admin/activity?person=Lina', { headers: adminHeaders });
  assert.ok(filtered.data.entries.length > 0);
  assert.ok(filtered.data.entries.every((entry) => entry.nickname === 'Lina'));
  assert.equal((await request('/api/admin/activity?person=Personne', { headers: adminHeaders })).data.entries.length, 0);

  // Garantie de confidentialité : aucun secret ne doit traîner dans le journal,
  // ni sur le disque, ni dans l'API.
  const rawFile = fs.readFileSync(path.join(dataDir, 'activity.json'), 'utf8');
  const serialized = JSON.stringify(afterBuzz.data);
  for (const secret of ['mot-de-passe-secret', TEST_CREATOR_CODE, 'password']) {
    assert.ok(!serialized.includes(secret), `le journal ne doit pas exposer « ${secret} »`);
  }
  assert.ok(!rawFile.includes('mot-de-passe-secret'), 'aucun mot de passe écrit sur le disque');
  assert.ok(!JSON.stringify(journal.data).includes('mot-de-passe-secret'));

  // Aucune entrée ne doit contenir de frappe clavier : uniquement des phrases
  // construites par le serveur.
  for (const entry of afterBuzz.data.entries) {
    assert.equal(typeof entry.text, 'string');
    assert.ok(entry.text.length > 0 && entry.text.length <= 160);
    assert.ok(!entry.text.includes('\n'), 'pas de contenu multiligne brut');
  }

  // Vidage du journal.
  const cleared = await request('/api/admin/activity', { method: 'DELETE', headers: adminHeaders });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.count, 1, 'seule la ligne de vidage reste');
  assert.match(cleared.data.entries[0].text, /a vidé le journal d’activité/);
  assert.equal((await request('/api/admin/activity', { headers: adminHeaders })).data.entries.length, 1);
});

test('Le client ne capture aucune frappe clavier et ne transmet que des actions', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

  assert.ok(!/addEventListener\(\s*['"]keypress['"]/.test(script), 'aucun écouteur keypress global');
  assert.ok(!/key(Code|down|press)[^\n]{0,80}api\(/i.test(script), 'aucune frappe envoyée au serveur');
  assert.ok(!/navigator\.sendBeacon|XMLHttpRequest/.test(script), 'aucune remontée discrète de frappes');
  assert.match(script, /data-admin-activity-list/, 'le panneau affiche le journal');
  assert.match(script, /data-admin-activity-clear/, 'le journal peut être vidé');
  assert.match(script, /Aucune touche de clavier n’est enregistrée/, 'la promesse est écrite dans l’interface');
  assert.match(stylesheet, /\.admin-activity-item/);
  assert.match(stylesheet, /\.admin-activity-list/);
});

test('Bloc-notes : les clics et les mots du tchat public sont notés, pas les champs de saisie', async (t) => {
  const { request } = await launchServer(t);
  const unlocked = await request('/api/creator/unlock', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  const adminLogin = await request('/api/admin/login', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  const adminHeaders = { 'X-Admin-Token': adminLogin.data.token };

  const account = await request('/api/accounts/register', {
    method: 'POST',
    body: { nickname: 'Nina', password: 'mon-mot-de-passe-prive' },
  });
  const accountHeaders = { 'X-Account-Token': account.data.token };

  const presence = await request('/api/presence', {
    method: 'POST',
    headers: accountHeaders,
    body: { nickname: 'Nina', activity: 'Accueil' },
  });
  const presenceId = presence.data.id;

  // Clics suivis : la clé est traduite par le serveur.
  const openedSolo = await request('/api/presence/action', {
    method: 'POST',
    body: { id: presenceId, action: 'jeux-solo' },
  });
  assert.equal(openedSolo.status, 200);
  const launchedSnake = await request('/api/presence/action', {
    method: 'POST',
    body: { id: presenceId, action: 'solo-snake' },
  });
  assert.equal(launchedSnake.status, 200);

  // Une clé inconnue est refusée : impossible d'écrire du texte libre.
  const forbidden = await request('/api/presence/action', {
    method: 'POST',
    body: { id: presenceId, action: 'a tapé son mot de passe secret' },
  });
  assert.equal(forbidden.status, 400);
  const wrongId = await request('/api/presence/action', {
    method: 'POST',
    body: { id: 'deadbeefdeadbeefdeadbeef', action: 'jeux-solo' },
  });
  assert.equal(wrongId.status, 404);

  // Tchat public : les mots écrits sont archivés pour la modération.
  const room = await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Creator-Ticket': unlocked.data.ticket, ...accountHeaders },
    body: { title: 'Le salon bavard', game: 'morpion', maxPlayers: 2 },
  });
  const roomId = room.data.room.id;
  const playerToken = room.data.playerToken;
  const chat = await request(`/api/rooms/${roomId}/chat`, {
    method: 'POST',
    headers: { 'X-Player-Token': playerToken },
    body: { message: 'Salut, on commence quand ?' },
  });
  assert.equal(chat.status, 201);

  // ... mais le tchat privé des loups reste hors du journal.
  const wolfRoute = await request(`/api/rooms/${roomId}/loup-garou/wolf-chat`, {
    method: 'POST',
    headers: { 'X-Player-Token': playerToken },
    body: { message: 'mot secret des loups' },
  });
  assert.notEqual(wolfRoute.status, 201);

  const journal = await request('/api/admin/activity?limit=100', { headers: adminHeaders });
  const texts = journal.data.entries.map((entry) => entry.text);
  assert.ok(texts.includes('a ouvert les jeux solo'), 'clic de navigation noté');
  assert.ok(texts.includes('a lancé une partie de Snake'), 'lancement de jeu solo noté');
  assert.ok(
    journal.data.entries.some((entry) => entry.kind === 'tchat' && entry.text.includes('Salut, on commence quand ?')),
    'message du tchat public archivé',
  );
  assert.ok(
    !journal.data.entries.some((entry) => entry.kind === 'tchat' && entry.text.includes('mot secret des loups')),
    'le tchat privé des loups n’est jamais archivé',
  );

  // Bloc-notes rattaché à la personne connectée.
  const presenceList = await request('/api/admin/presence', { headers: adminHeaders });
  const nina = presenceList.data.people.find((person) => person.nickname === 'Nina');
  assert.ok(nina, 'Nina est en ligne');
  assert.ok(Array.isArray(nina.notes) && nina.notes.length > 0, 'son bloc-notes est rempli');
  const noteTexts = nina.notes.map((note) => note.text);
  assert.ok(noteTexts.includes('a ouvert les jeux solo'));
  assert.ok(noteTexts.includes('a lancé une partie de Snake'));
  assert.ok(noteTexts.some((text) => text.includes('Salut, on commence quand ?')));
  assert.ok(nina.notes.length <= 14);

  // Aucun secret dans le journal ni dans la réponse.
  const serialized = JSON.stringify(journal.data) + JSON.stringify(presenceList.data);
  assert.ok(!serialized.includes('mon-mot-de-passe-prive'), 'aucun mot de passe');
  assert.ok(!serialized.includes(TEST_CREATOR_CODE), 'aucun code organisateur');
});

test('Le suivi des clics n’envoie que des clés et ne lit jamais les champs de saisie', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

  // La fonction de suivi n'envoie qu'un identifiant d'action.
  assert.match(script, /function trackAction\(key, cooldown/);
  assert.match(script, /body: \{ id: presenceId, action: key \}/);
  assert.ok(!/trackAction\([^)]*\.value/.test(script), 'jamais la valeur d’un champ dans le suivi');
  assert.ok(!/dataset\.value|\.value\s*\}\s*\)/.test(script.replace(/\n/g, ' ')), 'aucune valeur de champ transmise');

  // Aucune capture globale de frappe.
  assert.ok(!/['"]keypress['"]/.test(script));
  assert.ok(!/['"]keyup['"]/.test(script));
  assert.ok(!/beforeinput/.test(script));

  // Le bloc-notes s'affiche à côté du nom.
  assert.match(script, /admin-note-list/);
  assert.match(script, /data-admin-note=/);
  assert.match(script, /Bloc-notes/);
  assert.match(script, /ses clics et ses messages apparaîtront ici/);

  const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
  assert.match(stylesheet, /\.admin-note \{/);
  assert.match(stylesheet, /\.admin-note-item/);
  assert.match(stylesheet, /\.admin-note-list/);
});
