'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const puissance4 = require('../puissance4');

function makeRoom({ playerTypes = ['human', 'human'] } = {}) {
  const players = playerTypes.map((type, index) => ({
    id: `p${index + 1}`,
    nickname: type === 'bot' ? `Bot ${index + 1}` : `Joueur ${index + 1}`,
    isBot: type === 'bot',
  }));
  return {
    id: 'room-p4-test',
    game: 'puissance-4',
    hostPlayerId: players[0].id,
    players,
    gameState: puissance4.createGame(players),
  };
}

test('prépare une grille de 6 × 7 et ne dévoile que des informations publiques', () => {
  const room = makeRoom();
  const state = puissance4.publicState(room, room.players[0]);
  assert.equal(state.board.length, 6);
  assert.ok(state.board.every((row) => row.length === 7 && row.every((cell) => cell === null)));
  assert.equal(state.isMyTurn, true);
  assert.equal(state.players[0].color, 'red');
  assert.equal(state.players[1].color, 'yellow');
  assert.throws(() => puissance4.createGame([room.players[0]]), { statusCode: 400 });
});

test('refuse les colonnes invalides, les tours incorrects et les colonnes pleines', () => {
  const room = makeRoom();
  assert.throws(() => puissance4.playColumn(room, room.players[1], 0), { statusCode: 403 });
  assert.throws(() => puissance4.playColumn(room, room.players[0], 7), { statusCode: 400 });
  assert.throws(() => puissance4.playColumn(room, room.players[0], 2.5), { statusCode: 400 });
  assert.throws(() => puissance4.playColumn(room, room.players[0], ''), { statusCode: 400 });

  room.gameState.board = Array.from({ length: 6 }, () => Array(7).fill(null));
  for (let row = 0; row < 6; row += 1) room.gameState.board[row][0] = row % 2 ? 'p2' : 'p1';
  assert.throws(() => puissance4.playColumn(room, room.players[0], 0), { statusCode: 400 });
});

test('termine la partie après un alignement vertical de quatre jetons', () => {
  const room = makeRoom();
  for (let turn = 0; turn < 7; turn += 1) {
    const player = room.players.find((candidate) => candidate.id === room.gameState.currentPlayerId);
    puissance4.playColumn(room, player, turn % 2 === 0 ? 0 : 1);
  }
  assert.equal(room.gameState.phase, 'finished');
  assert.equal(room.gameState.result, 'win');
  assert.equal(room.gameState.winnerId, 'p1');
  assert.equal(room.gameState.winningCells.length, 4);
});

test('détecte également un alignement horizontal et bloque un coup gagnant adverse', () => {
  const room = makeRoom();
  const columns = [0, 6, 1, 6, 2, 5, 3];
  for (const column of columns) {
    const player = room.players.find((candidate) => candidate.id === room.gameState.currentPlayerId);
    puissance4.playColumn(room, player, column);
  }
  assert.equal(room.gameState.winnerId, 'p1');
  assert.equal(room.gameState.winningCells.length, 4);

  const botRoom = makeRoom({ playerTypes: ['human', 'bot'] });
  botRoom.gameState.currentPlayerId = 'p2';
  botRoom.gameState.board[5][0] = 'p1';
  botRoom.gameState.board[5][1] = 'p1';
  botRoom.gameState.board[5][2] = 'p1';
  puissance4.processBots(botRoom);
  assert.equal(botRoom.gameState.board[5][3], 'p2', 'le bot bloque la victoire immédiate');
  assert.equal(botRoom.gameState.currentPlayerId, 'p1');
});

test('repère un alignement diagonal qui traverse la dernière colonne jouée', () => {
  const room = makeRoom();
  room.gameState.board[5][0] = 'p1';
  room.gameState.board[5][1] = 'p2';
  room.gameState.board[4][1] = 'p1';
  room.gameState.board[5][2] = 'p2';
  room.gameState.board[4][2] = 'p2';
  room.gameState.board[3][2] = 'p1';
  room.gameState.board[5][3] = 'p2';
  room.gameState.board[4][3] = 'p2';
  room.gameState.board[3][3] = 'p2';
  room.gameState.currentPlayerId = 'p1';

  puissance4.playColumn(room, room.players[0], 3);
  assert.equal(room.gameState.phase, 'finished');
  assert.equal(room.gameState.winnerId, 'p1');
  assert.equal(room.gameState.winningCells.length, 4);
});
