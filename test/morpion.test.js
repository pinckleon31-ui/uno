'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const morpion = require('../morpion');

function makeRoom(playerTypes = ['human', 'human']) {
  const players = playerTypes.map((type, index) => ({
    id: `p${index + 1}`,
    nickname: type === 'bot' ? `Bot ${index + 1}` : `Joueur ${index + 1}`,
    isBot: type === 'bot',
  }));
  return {
    id: 'room-morpion-test',
    game: 'morpion',
    hostPlayerId: players[0].id,
    players,
    gameState: morpion.createGame(players),
  };
}

test('le morpion commence avec un plateau vide et refuse les coups illégaux', () => {
  const room = makeRoom();
  const [first, second] = room.players;
  assert.equal(room.gameState.board.length, 9);
  assert.throws(() => morpion.createGame(room.players.slice(0, 1)), { statusCode: 400 });
  assert.throws(() => morpion.playCell(room, second, 0), { statusCode: 403 });
  assert.throws(() => morpion.playCell(room, first, 9), { statusCode: 400 });
  morpion.playCell(room, first, 0);
  assert.throws(() => morpion.playCell(room, second, 0), { statusCode: 409 });
  morpion.playCell(room, second, 4);
  assert.throws(() => morpion.playCell(room, first, 4), { statusCode: 409 });
});

test('détecte une ligne gagnante et protège le plateau public', () => {
  const room = makeRoom();
  const [first, second] = room.players;
  for (const [player, cell] of [[first, 0], [second, 3], [first, 1], [second, 4], [first, 2]]) {
    morpion.playCell(room, player, cell);
  }
  assert.equal(room.gameState.phase, 'finished');
  assert.equal(room.gameState.result, 'win');
  assert.equal(room.gameState.winnerId, first.id);
  assert.deepEqual(room.gameState.winningCells, [0, 1, 2]);
  assert.equal(morpion.publicState(room, second).winnerName, 'Joueur 1');
});

test('déclare un match nul quand les neuf cases sont occupées', () => {
  const room = makeRoom();
  const [first, second] = room.players;
  for (const [player, cell] of [[first, 0], [second, 1], [first, 2], [second, 4], [first, 3], [second, 5], [first, 7], [second, 6], [first, 8]]) {
    morpion.playCell(room, player, cell);
  }
  assert.equal(room.gameState.phase, 'finished');
  assert.equal(room.gameState.result, 'draw');
  assert.equal(room.gameState.winnerId, null);
});

test('le bot joue automatiquement, gagne si possible et bloque une victoire adverse', () => {
  const room = makeRoom(['human', 'bot']);
  const human = room.players[0];
  const bot = room.players[1];
  morpion.playCell(room, human, 0);
  morpion.processBots(room);
  assert.equal(room.gameState.board[4], bot.id, 'le bot privilégie le centre');
  morpion.playCell(room, human, 1);
  morpion.processBots(room);
  assert.equal(room.gameState.board[2], bot.id, 'le bot bloque l’alignement imminent');
});
