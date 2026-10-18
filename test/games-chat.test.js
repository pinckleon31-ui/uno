'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const TEST_CREATOR_CODE = 'games-chat-test-code';

async function launchServer(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recre-jeux-extra-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '0', CREATOR_CODE: TEST_CREATOR_CODE, DATA_DIR: dataDir },
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
    const timeout = setTimeout(() => reject(new Error(`Le serveur ne démarre pas. ${output}`)), 10_000);
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
      reject(new Error(`Le serveur s’est arrêté (${code ?? signal}). ${output}`));
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
    try { data = JSON.parse(text); } catch { /* conserve la réponse texte */ }
    return { status: response.status, data, text };
  }
  return { request };
}

async function openRoom(request, ticket, { game, title, hostName, maxPlayers }) {
  const created = await request('/api/rooms', {
    method: 'POST',
    headers: { 'X-Creator-Ticket': ticket },
    body: { game, title, nickname: hostName, maxPlayers },
  });
  assert.equal(created.status, 201, `${game} se crée`);
  const players = [{ nickname: hostName, token: created.data.playerToken }];
  for (let index = 2; index <= maxPlayers; index += 1) {
    const joined = await request(`/api/rooms/${created.data.room.id}/join`, {
      method: 'POST',
      body: { nickname: `${game} Joueur ${index}` },
    });
    assert.equal(joined.status, 201, `${game} accueille son joueur ${index}`);
    players.push({ nickname: `${game} Joueur ${index}`, token: joined.data.playerToken });
  }
  return { roomId: created.data.room.id, players };
}

async function getRoom(request, roomId, token) {
  const response = await request(`/api/rooms/${roomId}`, { headers: { 'X-Player-Token': token } });
  assert.equal(response.status, 200);
  return response.data.room;
}

async function verifyRoomChat(request, room, gameLabel) {
  const response = await request(`/api/rooms/${room.roomId}/chat`, {
    method: 'POST',
    headers: { 'X-Player-Token': room.players[0].token },
    body: { message: `Salut depuis ${gameLabel}` },
  });
  assert.equal(response.status, 201, `${gameLabel} possède son tchat`);
  assert.equal(response.data.room.chat[0].nickname, room.players[0].nickname);
  assert.ok(response.data.room.chat[0].emoji);
  assert.ok(response.data.room.chat[0].color);
}

async function playAllTriviaRounds(request, roomId, players, gameId) {
  for (let round = 0; round < 8; round += 1) {
    let room = await getRoom(request, roomId, players[0].token);
    const state = room[gameId === 'quiz' ? 'quiz' : 'blindTest'];
    assert.equal(state.phase, 'playing');
    if (gameId === 'blind-test') assert.ok(state.question.notes.length >= 6);
    for (const player of players) {
      const answer = await request(`/api/rooms/${roomId}/${gameId}/answer`, {
        method: 'POST',
        headers: { 'X-Player-Token': player.token },
        body: { choiceIndex: 0 },
      });
      assert.equal(answer.status, 200);
    }
    room = await getRoom(request, roomId, players[0].token);
    const roundState = room[gameId === 'quiz' ? 'quiz' : 'blindTest'];
    assert.ok(['reveal', 'finished'].includes(roundState.phase));
    assert.notEqual(roundState.question.correctIndex, null);
    if (roundState.phase === 'reveal') {
      const advanced = await request(`/api/rooms/${roomId}/${gameId}/next`, {
        method: 'POST',
        headers: { 'X-Player-Token': players[0].token },
        body: {},
      });
      assert.equal(advanced.status, 200, 'l’organisateur passe à la question suivante');
    }
  }
  const finalRoom = await getRoom(request, roomId, players[0].token);
  const finalState = finalRoom[gameId === 'quiz' ? 'quiz' : 'blindTest'];
  assert.equal(finalState.phase, 'finished');
  assert.equal(finalState.questionNumber, 8);
  assert.ok(finalState.winnerIds.length >= 1);
}

test('les trois jeux restants se lancent et se terminent par leurs propres règles', async (t) => {
  const { request } = await launchServer(t);
  const unlock = await request('/api/creator/unlock', {
    method: 'POST',
    body: { code: TEST_CREATOR_CODE },
  });
  assert.equal(unlock.status, 200);

  const quizRoom = await openRoom(request, unlock.data.ticket, {
    game: 'quiz', title: 'Quiz de test', hostName: 'Camille Quiz', maxPlayers: 2,
  });
  await verifyRoomChat(request, quizRoom, 'Quiz express');
  const startedQuiz = await request(`/api/rooms/${quizRoom.roomId}/start`, {
    method: 'POST', headers: { 'X-Player-Token': quizRoom.players[0].token }, body: {},
  });
  assert.equal(startedQuiz.status, 200);
  assert.equal(startedQuiz.data.room.quiz.totalQuestions, 8);
  await playAllTriviaRounds(request, quizRoom.roomId, quizRoom.players, 'quiz');
  const replay = await request(`/api/rooms/${quizRoom.roomId}/quiz/restart`, {
    method: 'POST', headers: { 'X-Player-Token': quizRoom.players[0].token }, body: {},
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.room.quiz.questionNumber, 1);

  const blindRoom = await openRoom(request, unlock.data.ticket, {
    game: 'blind-test', title: 'Blind test original', hostName: 'Camille Son', maxPlayers: 2,
  });
  await verifyRoomChat(request, blindRoom, 'Blind test');
  const startedBlind = await request(`/api/rooms/${blindRoom.roomId}/start`, {
    method: 'POST', headers: { 'X-Player-Token': blindRoom.players[0].token }, body: {},
  });
  assert.equal(startedBlind.status, 200);
  assert.ok(Array.isArray(startedBlind.data.room.blindTest.question.notes));
  await playAllTriviaRounds(request, blindRoom.roomId, blindRoom.players, 'blind-test');

  const loupRoom = await openRoom(request, unlock.data.ticket, {
    game: 'loup-garou', title: 'Village de test', hostName: 'Camille Village', maxPlayers: 4,
  });
  await verifyRoomChat(request, loupRoom, 'Loup-garou');
  const startedLoup = await request(`/api/rooms/${loupRoom.roomId}/start`, {
    method: 'POST', headers: { 'X-Player-Token': loupRoom.players[0].token }, body: {},
  });
  assert.equal(startedLoup.status, 200);
  assert.equal(startedLoup.data.room.loupGarou.phase, 'night');
  assert.ok(startedLoup.data.room.loupGarou.myRole);
  assert.ok(startedLoup.data.room.loupGarou.players.every((player) => player.role === null));
  assert.deepEqual(startedLoup.data.room.chat, [], 'le tchat public est masqué pendant la nuit');
  const nightChat = await request(`/api/rooms/${loupRoom.roomId}/chat`, {
    method: 'POST',
    headers: { 'X-Player-Token': loupRoom.players[0].token },
    body: { message: 'Le village dort' },
  });
  assert.equal(nightChat.status, 409, 'le serveur bloque les messages publics pendant la nuit');
  const anonymousLoup = await request(`/api/rooms/${loupRoom.roomId}`);
  assert.equal(anonymousLoup.status, 200);
  assert.equal(anonymousLoup.data.room.loupGarou.myRole, null);
  assert.ok(anonymousLoup.data.room.loupGarou.players.every((player) => player.role === null));

  for (let turn = 0; turn < 20; turn += 1) {
    const views = await Promise.all(loupRoom.players.map((player) => getRoom(request, loupRoom.roomId, player.token)));
    const state = views[0].loupGarou;
    if (state.phase === 'finished') break;
    if (state.phase === 'night') {
      const actors = views.filter((room) => room.loupGarou.canAct);
      assert.ok(actors.length > 0, 'une personne dispose d’une action nocturne');
      for (const view of actors) {
        const game = view.loupGarou;
        const actorIndex = views.indexOf(view);
        const action = await request(`/api/rooms/${loupRoom.roomId}/loup-garou/act`, {
          method: 'POST',
          headers: { 'X-Player-Token': loupRoom.players[actorIndex].token },
          body: { targetId: game.eligibleTargets[0].id },
        });
        assert.equal(action.status, 200);
      }
    } else if (state.phase === 'day') {
      const wolf = views.find((room) => room.loupGarou.myRole === 'wolf');
      assert.ok(wolf, 'le rôle du loup est privé mais visible par son propre joueur');
      const wolfId = wolf.loupGarou.players.find((player) => player.isYou).id;
      for (const [actorIndex, view] of views.entries()) {
        if (!view.loupGarou.canAct) continue;
        const current = view.loupGarou.players.find((player) => player.isYou);
        const target = current.id === wolfId
          ? view.loupGarou.eligibleTargets[0]
          : view.loupGarou.eligibleTargets.find((candidate) => candidate.id === wolfId);
        const action = await request(`/api/rooms/${loupRoom.roomId}/loup-garou/act`, {
          method: 'POST', headers: { 'X-Player-Token': loupRoom.players[actorIndex].token }, body: { targetId: target.id },
        });
        assert.equal(action.status, 200);
      }
    }
  }
  const finalLoup = await getRoom(request, loupRoom.roomId, loupRoom.players[0].token);
  assert.equal(finalLoup.loupGarou.phase, 'finished');
  assert.ok(finalLoup.loupGarou.winnerIds.length > 0);
});

test('Loup-garou en ligne : les nuits, rôles spéciaux, votes et victoires fonctionnent par API', async (t) => {
  const { request } = await launchServer(t);
  const unlock = await request('/api/creator/unlock', {
    method: 'POST', body: { code: TEST_CREATOR_CODE },
  });
  const loupRoom = await openRoom(request, unlock.data.ticket, {
    game: 'loup-garou', title: 'La forêt des rôles', hostName: 'Camille Nuit', maxPlayers: 8,
  });
  const started = await request(`/api/rooms/${loupRoom.roomId}/start`, {
    method: 'POST', headers: { 'X-Player-Token': loupRoom.players[0].token }, body: {},
  });
  assert.equal(started.status, 200);
  assert.equal(started.data.room.loupGarou.phase, 'night');

  const openingViews = await Promise.all(loupRoom.players.map((player) => getRoom(request, loupRoom.roomId, player.token)));
  const wolfIndex = openingViews.findIndex((room) => room.loupGarou.myRole === 'wolf');
  const villagerIndex = openingViews.findIndex((room) => room.loupGarou.myRole !== 'wolf');
  assert.notEqual(wolfIndex, -1);
  assert.notEqual(villagerIndex, -1);
  const secretMessage = await request(`/api/rooms/${loupRoom.roomId}/loup-garou/wolf-chat`, {
    method: 'POST',
    headers: { 'X-Player-Token': loupRoom.players[wolfIndex].token },
    body: { message: 'Visons le joueur du nord.' },
  });
  assert.equal(secretMessage.status, 201);
  assert.equal(secretMessage.data.room.loupGarou.wolfChat.length, 1);
  assert.deepEqual(secretMessage.data.room.chat, [], 'le message privé n’entre jamais dans le tchat public');
  const wolfOnlyView = await getRoom(request, loupRoom.roomId, loupRoom.players[villagerIndex].token);
  assert.deepEqual(wolfOnlyView.loupGarou.wolfChat, [], 'les autres rôles ne reçoivent pas le tchat des loups');
  const deniedWolfMessage = await request(`/api/rooms/${loupRoom.roomId}/loup-garou/wolf-chat`, {
    method: 'POST',
    headers: { 'X-Player-Token': loupRoom.players[villagerIndex].token },
    body: { message: 'Je ne suis pas un loup.' },
  });
  assert.equal(deniedWolfMessage.status, 403);

  let finished = false;
  for (let turn = 0; turn < 160; turn += 1) {
    const views = await Promise.all(loupRoom.players.map((player) => getRoom(request, loupRoom.roomId, player.token)));
    if (views[0].loupGarou.phase === 'finished') {
      finished = true;
      break;
    }
    const actors = views
      .map((room, index) => ({ room, index }))
      .filter(({ room }) => room.loupGarou.canAct);
    assert.ok(actors.length > 0, `un joueur peut agir pendant ${views[0].loupGarou.phase}`);
    for (const { room, index } of actors) {
      const game = room.loupGarou;
      let body;
      if (game.actionKind === 'cupid') {
        body = {
          action: 'cupid',
          firstTargetId: game.eligibleTargets[0].id,
          secondTargetId: game.eligibleTargets[1].id,
        };
      } else if (game.actionKind === 'witch') {
        body = { action: 'witch', save: false, poisonTargetId: '' };
      } else {
        body = { targetId: game.eligibleTargets[0].id };
      }
      const action = await request(`/api/rooms/${loupRoom.roomId}/loup-garou/act`, {
        method: 'POST',
        headers: { 'X-Player-Token': loupRoom.players[index].token },
        body,
      });
      assert.equal(action.status, 200, action.data.error || 'le rôle actif agit en ligne');
    }
  }
  const finalRoom = await getRoom(request, loupRoom.roomId, loupRoom.players[0].token);
  assert.ok(finished || finalRoom.loupGarou.phase === 'finished');
});

test('Morpion et Memory se lancent, appliquent leurs tours et autorisent la revanche', async (t) => {
  const { request } = await launchServer(t);
  const unlock = await request('/api/creator/unlock', {
    method: 'POST', body: { code: TEST_CREATOR_CODE },
  });

  const morpionRoom = await openRoom(request, unlock.data.ticket, {
    game: 'morpion', title: 'Morpion de test', hostName: 'Ari Morpion', maxPlayers: 2,
  });
  await verifyRoomChat(request, morpionRoom, 'Morpion');
  const startedMorpion = await request(`/api/rooms/${morpionRoom.roomId}/start`, {
    method: 'POST', headers: { 'X-Player-Token': morpionRoom.players[0].token }, body: {},
  });
  assert.equal(startedMorpion.status, 200);
  const hostId = startedMorpion.data.room.players.find((player) => player.isHost).id;
  const guestId = startedMorpion.data.room.players.find((player) => !player.isHost).id;
  for (const [player, cell] of [
    [morpionRoom.players[0], 0], [morpionRoom.players[1], 3],
    [morpionRoom.players[0], 1], [morpionRoom.players[1], 4],
    [morpionRoom.players[0], 2],
  ]) {
    const move = await request(`/api/rooms/${morpionRoom.roomId}/morpion/play`, {
      method: 'POST', headers: { 'X-Player-Token': player.token }, body: { cell },
    });
    assert.equal(move.status, 200);
  }
  const finishedMorpion = await getRoom(request, morpionRoom.roomId, morpionRoom.players[0].token);
  assert.equal(finishedMorpion.morpion.phase, 'finished');
  assert.equal(finishedMorpion.morpion.winnerId, hostId);
  assert.notEqual(hostId, guestId);
  const restartedMorpion = await request(`/api/rooms/${morpionRoom.roomId}/morpion/restart`, {
    method: 'POST', headers: { 'X-Player-Token': morpionRoom.players[0].token }, body: {},
  });
  assert.equal(restartedMorpion.status, 200);
  assert.equal(restartedMorpion.data.room.morpion.phase, 'playing');

  const memoryRoom = await openRoom(request, unlock.data.ticket, {
    game: 'memoire', title: 'Memory de test', hostName: 'Ari Memory', maxPlayers: 2,
  });
  await verifyRoomChat(request, memoryRoom, 'Memory');
  const startedMemory = await request(`/api/rooms/${memoryRoom.roomId}/start`, {
    method: 'POST', headers: { 'X-Player-Token': memoryRoom.players[0].token }, body: {},
  });
  assert.equal(startedMemory.status, 200);
  const memoryHostId = startedMemory.data.room.players.find((player) => player.isHost).id;
  const memoryGuestId = startedMemory.data.room.players.find((player) => !player.isHost).id;
  const initialBoard = startedMemory.data.room.memoire.board;
  assert.equal(initialBoard.length, 16);
  assert.ok(initialBoard.every((card) => card.symbol === null));
  const firstCardId = initialBoard[0].id;
  const firstFlip = await request(`/api/rooms/${memoryRoom.roomId}/memoire/flip`, {
    method: 'POST', headers: { 'X-Player-Token': memoryRoom.players[0].token }, body: { cardId: firstCardId },
  });
  assert.equal(firstFlip.status, 200);
  const secondView = await getRoom(request, memoryRoom.roomId, memoryRoom.players[1].token);
  assert.ok(secondView.memoire.board.find((card) => card.id === firstCardId).symbol);
  assert.equal(secondView.memoire.board.filter((card) => card.symbol !== null).length, 1);
  const wrongTurn = await request(`/api/rooms/${memoryRoom.roomId}/memoire/flip`, {
    method: 'POST', headers: { 'X-Player-Token': memoryRoom.players[1].token }, body: { cardId: initialBoard[1].id },
  });
  assert.equal(wrongTurn.status, 403);
  const secondFlip = await request(`/api/rooms/${memoryRoom.roomId}/memoire/flip`, {
    method: 'POST', headers: { 'X-Player-Token': memoryRoom.players[0].token }, body: { cardId: initialBoard[1].id },
  });
  assert.equal(secondFlip.status, 200);
  if (secondFlip.data.room.memoire.phase === 'mismatch') {
    const continued = await request(`/api/rooms/${memoryRoom.roomId}/memoire/continue`, {
      method: 'POST', headers: { 'X-Player-Token': memoryRoom.players[0].token }, body: {},
    });
    assert.equal(continued.status, 200);
    assert.equal(continued.data.room.memoire.currentPlayerId, memoryGuestId);
  } else {
    assert.equal(secondFlip.data.room.memoire.matchedPairs, 1);
    assert.equal(secondFlip.data.room.memoire.currentPlayerId, memoryHostId, 'une paire trouvée permet de rejouer');
  }
});

test('le tchat affiche pseudo, emoji et couleur, et les réactions éclair sont limitées', async (t) => {
  const { request } = await launchServer(t);
  const unlock = await request('/api/creator/unlock', {
    method: 'POST', body: { code: TEST_CREATOR_CODE },
  });
  const unoRoom = await openRoom(request, unlock.data.ticket, {
    game: 'uno', title: 'Chat UNO', hostName: 'Alex UNO', maxPlayers: 2,
  });
  await verifyRoomChat(request, unoRoom, 'UNO');
  const room = await openRoom(request, unlock.data.ticket, {
    game: 'puissance-4', title: 'Chat de test', hostName: 'Alex Tchat', maxPlayers: 2,
  });
  const headers = { 'X-Player-Token': room.players[0].token };
  const sent = await request(`/api/rooms/${room.roomId}/chat`, {
    method: 'POST', headers, body: { message: '<b>Salut la bande !</b>' },
  });
  assert.equal(sent.status, 201);
  const firstMessage = sent.data.room.chat[0];
  assert.equal(firstMessage.nickname, 'Alex Tchat');
  assert.match(firstMessage.emoji, /\p{Extended_Pictographic}/u);
  assert.match(firstMessage.color, /^#[0-9a-f]{6}$/i);
  assert.equal(firstMessage.text, '<b>Salut la bande !</b>');
  const oversized = await request(`/api/rooms/${room.roomId}/chat`, {
    method: 'POST', headers, body: { message: 'x'.repeat(221) },
  });
  assert.equal(oversized.status, 400, 'les messages dépassant 220 caractères sont refusés');

  const limited = await request(`/api/rooms/${room.roomId}/chat`, {
    method: 'POST', headers, body: { reaction: '🎉' },
  });
  assert.equal(limited.status, 429, 'une courte pause évite le spam');
  await new Promise((resolve) => setTimeout(resolve, 700));
  const reaction = await request(`/api/rooms/${room.roomId}/chat`, {
    method: 'POST', headers, body: { reaction: '🎉' },
  });
  assert.equal(reaction.status, 201);
  assert.equal(reaction.data.room.chat[1].kind, 'reaction');
  assert.equal(reaction.data.room.chat[1].text, '🎉');

  const publicRooms = await request('/api/rooms');
  assert.deepEqual(publicRooms.data.rooms.find((candidate) => candidate.id === room.roomId).chat, [], 'le tchat reste privé du salon');
  const unauthorized = await request(`/api/rooms/${room.roomId}/chat`, {
    method: 'POST', body: { message: 'Anonyme' },
  });
  assert.equal(unauthorized.status, 401);
});

test('l’ancienne route de salons solo contre bots est désactivée', async (t) => {
  const { request } = await launchServer(t);
  const response = await request('/api/solo', {
    method: 'POST',
    body: { game: 'uno', nickname: 'Joueur' },
  });
  assert.equal(response.status, 404);
  const publicRooms = await request('/api/rooms');
  assert.deepEqual(publicRooms.data.rooms, [], 'aucun salon solo contre bots n’est créé');
});
