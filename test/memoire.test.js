'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const memoire = require('../memoire');

function makeRoom(playerTypes = ['human', 'human']) {
  const players = playerTypes.map((type, index) => ({
    id: `p${index + 1}`,
    nickname: type === 'bot' ? `Bot ${index + 1}` : `Joueur ${index + 1}`,
    isBot: type === 'bot',
  }));
  return {
    id: 'room-memory-test',
    game: 'memoire',
    hostPlayerId: players[0].id,
    players,
    gameState: memoire.createGame(players),
  };
}

test('le memory mélange seize cartes sans révéler les symboles cachés', () => {
  const room = makeRoom();
  assert.equal(room.gameState.cards.length, 16);
  assert.equal(new Set(room.gameState.cards.map((card) => card.pairId)).size, 8);
  const view = memoire.publicState(room, room.players[0]);
  assert.ok(view.board.every((card) => card.symbol === null && card.isRevealed === false));
  assert.equal(view.totalPairs, 8);
  assert.equal(view.canFlip, true);
  assert.throws(() => memoire.createGame(Array.from({ length: 5 }, (_, i) => ({ id: `p${i}` }))), { statusCode: 400 });
});

test('les paires donnent un point et le joueur peut rejouer', () => {
  const room = makeRoom();
  const player = room.players[0];
  const pair = room.gameState.cards.filter((card) => card.pairId === 0);
  memoire.flipCard(room, player, pair[0].id);
  assert.equal(room.gameState.revealedCardIds.length, 1);
  assert.equal(memoire.publicState(room, player).board.find((card) => card.id === pair[0].id).symbol, pair[0].symbol);
  memoire.flipCard(room, player, pair[1].id);
  assert.equal(room.gameState.phase, 'playing');
  assert.equal(room.gameState.currentPlayerId, player.id);
  assert.equal(room.gameState.scores[player.id], 1);
  assert.ok(room.gameState.matchedCardIds.includes(pair[0].id));
  assert.equal(memoire.publicState(room, room.players[1]).board.find((card) => card.id === pair[1].id).symbol, pair[1].symbol);
});

test('une erreur reste visible jusqu’à ce que le joueur actif passe son tour', () => {
  const room = makeRoom();
  const [first, second] = room.players;
  const firstCard = room.gameState.cards[0];
  const otherCard = room.gameState.cards.find((card) => card.pairId !== firstCard.pairId);
  memoire.flipCard(room, first, firstCard.id);
  assert.throws(() => memoire.flipCard(room, first, firstCard.id), { statusCode: 400 });
  memoire.flipCard(room, first, otherCard.id);
  assert.equal(room.gameState.phase, 'mismatch');
  assert.equal(memoire.publicState(room, second).board.filter((card) => card.isRevealed).length, 2);
  assert.throws(() => memoire.continueAfterMismatch(room, second), { statusCode: 403 });
  memoire.continueAfterMismatch(room, first);
  assert.equal(room.gameState.phase, 'playing');
  assert.equal(room.gameState.currentPlayerId, second.id);
  assert.equal(room.gameState.revealedCardIds.length, 0);
  assert.ok(memoire.publicState(room, second).board.every((card) => card.isMatched || card.symbol === null));
});

test('termine après les huit paires et partage la victoire en cas d’égalité', () => {
  const room = makeRoom();
  const [first, second] = room.players;
  const pair = (pairId) => room.gameState.cards.filter((card) => card.pairId === pairId);
  const flipPair = (player, pairId) => {
    memoire.flipCard(room, player, pair(pairId)[0].id);
    memoire.flipCard(room, player, pair(pairId)[1].id);
  };
  for (let pairId = 0; pairId < 4; pairId += 1) flipPair(first, pairId);
  memoire.flipCard(room, first, pair(4)[0].id);
  memoire.flipCard(room, first, pair(5)[0].id);
  memoire.continueAfterMismatch(room, first);
  for (let pairId = 4; pairId < 8; pairId += 1) flipPair(second, pairId);
  assert.equal(room.gameState.phase, 'finished');
  assert.equal(room.gameState.result, 'draw');
  assert.deepEqual(room.gameState.winnerIds, [first.id, second.id]);
  assert.equal(room.gameState.scores[first.id], 4);
  assert.equal(room.gameState.scores[second.id], 4);
  assert.equal(memoire.publicState(room, first).matchedPairs, 8);
});

test('les bots jouent automatiquement jusqu’au prochain joueur humain', () => {
  const room = makeRoom(['human', 'bot']);
  const human = room.players[0];
  const bot = room.players[1];
  const a = room.gameState.cards[0];
  const b = room.gameState.cards.find((card) => card.pairId !== a.pairId);
  memoire.flipCard(room, human, a.id);
  memoire.flipCard(room, human, b.id);
  memoire.continueAfterMismatch(room, human);
  memoire.processBots(room);
  assert.ok(['playing', 'finished'].includes(room.gameState.phase));
  if (room.gameState.phase === 'playing') assert.equal(room.gameState.currentPlayerId, human.id);
  assert.ok(room.gameState.scores[bot.id] >= 0);
});
