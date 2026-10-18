'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const uno = require('../uno');

function card(id, color, type = 'number', value = null) {
  return { id, color, type, value };
}

function makeRoom({ playerTypes = ['human', 'human', 'human'], current = 'p1', currentColor = 'red', topCard, hands = {}, deck = [], direction = 1 } = {}) {
  const players = playerTypes.map((type, index) => ({
    id: `p${index + 1}`,
    nickname: type === 'bot' ? `Bot ${index + 1}` : `Joueur ${index + 1}`,
    isBot: type === 'bot',
  }));
  const playerOrder = players.map((player) => player.id);
  const allHands = Object.fromEntries(playerOrder.map((id) => [id, hands[id] || []]));
  return {
    id: 'room-test',
    game: 'uno',
    hostPlayerId: playerOrder[0],
    players,
    gameState: {
      phase: 'playing',
      deck: deck.slice(),
      discardPile: [topCard || card('top', 'red', 'number', 5)],
      playerOrder,
      hands: allHands,
      currentPlayerId: current,
      direction,
      currentColor,
      drawnCardId: null,
      winnerId: null,
      startedAt: Date.now(),
      lastAction: { type: 'start', playerId: null, nickname: '', message: 'Début du test.', at: Date.now() },
    },
  };
}

test('crée un paquet UNO standard de 108 cartes et ne publie que la main du joueur', () => {
  const players = Array.from({ length: 4 }, (_, index) => ({ id: `p${index + 1}`, nickname: `Joueur ${index + 1}`, isBot: false }));
  const game = uno.createGame(players);
  const room = { players, hostPlayerId: 'p1', gameState: game };
  const allCards = [
    ...game.deck,
    ...game.discardPile,
    ...Object.values(game.hands).flat(),
  ];

  assert.equal(allCards.length, 108);
  assert.equal(new Set(allCards.map((item) => item.id)).size, 108);
  assert.ok(game.deck.length > 0);
  assert.equal(game.discardPile.length, 1);
  assert.equal(game.discardPile[0].type, 'number');
  assert.deepEqual(players.map((player) => game.hands[player.id].length), [7, 7, 7, 7]);
  assert.equal(game.currentPlayerId, 'p1');
  assert.equal(game.phase, 'playing');

  const anonymousView = uno.publicState(room, null);
  assert.deepEqual(anonymousView.myHand, []);
  assert.equal(Object.hasOwn(anonymousView, 'hands'), false);
  assert.ok(anonymousView.players.every((player) => Number.isInteger(player.cardCount)));
  const playerView = uno.publicState(room, players[0]);
  assert.equal(playerView.myHand.length, 7);
  assert.ok(playerView.myHand.every((item) => typeof item.id === 'string'));
});

test('applique les règles de correspondance et la restriction du joker +4', () => {
  const room = makeRoom({
    hands: {
      p1: [
        card('red-seven', 'red', 'number', 7),
        card('blue-five', 'blue', 'number', 5),
        card('blue-seven', 'blue', 'number', 7),
        card('red-skip', 'red', 'skip'),
        card('wild', 'wild', 'wild'),
        card('wild-four', 'wild', 'wild4'),
      ],
    },
  });
  const hand = uno.publicState(room, room.players[0]).myHand;
  const byId = Object.fromEntries(hand.map((item) => [item.id, item.playable]));

  assert.equal(byId['red-seven'], true, 'même couleur');
  assert.equal(byId['blue-five'], true, 'même chiffre');
  assert.equal(byId['blue-seven'], false, 'ni même couleur ni même chiffre');
  assert.equal(byId['red-skip'], true, 'une carte action peut correspondre par couleur');
  assert.equal(byId.wild, true, 'un joker est toujours jouable');
  assert.equal(byId['wild-four'], false, 'un +4 est interdit si la main contient la couleur active');
});

test('fait avancer le tour correctement pour les cartes passe-tour et inversion', () => {
  const skipRoom = makeRoom({
    current: 'p1',
    hands: { p1: [card('skip', 'red', 'skip'), card('spare', 'blue', 'number', 2)] },
  });
  uno.playCard(skipRoom, skipRoom.players[0], 'skip');
  assert.equal(skipRoom.gameState.currentPlayerId, 'p3');

  const reverseRoom = makeRoom({
    current: 'p1',
    hands: { p1: [card('reverse', 'red', 'reverse'), card('spare', 'blue', 'number', 2)] },
  });
  uno.playCard(reverseRoom, reverseRoom.players[0], 'reverse');
  assert.equal(reverseRoom.gameState.direction, -1);
  assert.equal(reverseRoom.gameState.currentPlayerId, 'p3');

  const twoPlayerRoom = makeRoom({
    playerTypes: ['human', 'human'],
    current: 'p1',
    hands: { p1: [card('reverse-two', 'red', 'reverse'), card('spare-two', 'blue', 'number', 2)] },
  });
  uno.playCard(twoPlayerRoom, twoPlayerRoom.players[0], 'reverse-two');
  assert.equal(twoPlayerRoom.gameState.currentPlayerId, 'p1', 'à deux, l’inversion fait sauter le tour adverse');
});

test('fait piocher les cartes de pénalité et choisit une couleur pour le joker', () => {
  const drawTwoRoom = makeRoom({
    current: 'p1',
    hands: { p1: [card('draw-two', 'red', 'draw2'), card('spare', 'blue', 'number', 2)] },
    deck: [card('d1', 'green', 'number', 1), card('d2', 'yellow', 'number', 2), card('d3', 'blue', 'number', 3)],
  });
  uno.playCard(drawTwoRoom, drawTwoRoom.players[0], 'draw-two');
  assert.equal(drawTwoRoom.gameState.hands.p2.length, 2);
  assert.equal(drawTwoRoom.gameState.currentPlayerId, 'p3');
  assert.equal(drawTwoRoom.gameState.deck.length, 1);

  const wildRoom = makeRoom({
    current: 'p1',
    hands: { p1: [card('wild-card', 'wild', 'wild'), card('spare', 'blue', 'number', 2)] },
  });
  assert.throws(() => uno.playCard(wildRoom, wildRoom.players[0], 'wild-card'), { statusCode: 400 });
  uno.playCard(wildRoom, wildRoom.players[0], 'wild-card', 'green');
  assert.equal(wildRoom.gameState.currentColor, 'green');
  assert.equal(wildRoom.gameState.currentPlayerId, 'p2');

  const illegalFourRoom = makeRoom({
    current: 'p1',
    hands: { p1: [card('wild-four', 'wild', 'wild4'), card('red-two', 'red', 'number', 2)] },
  });
  assert.throws(() => uno.playCard(illegalFourRoom, illegalFourRoom.players[0], 'wild-four', 'blue'), { statusCode: 400 });

  const legalFourRoom = makeRoom({
    current: 'p1',
    hands: { p1: [card('wild-four-legal', 'wild', 'wild4'), card('blue-two', 'blue', 'number', 2)] },
    deck: [
      card('penalty-1', 'green', 'number', 1),
      card('penalty-2', 'yellow', 'number', 2),
      card('penalty-3', 'blue', 'number', 3),
      card('penalty-4', 'red', 'number', 4),
    ],
  });
  uno.playCard(legalFourRoom, legalFourRoom.players[0], 'wild-four-legal', 'yellow');
  assert.equal(legalFourRoom.gameState.currentColor, 'yellow');
  assert.equal(legalFourRoom.gameState.hands.p2.length, 4);
  assert.equal(legalFourRoom.gameState.currentPlayerId, 'p3');
});

test('pioche, joue uniquement la carte piochée ou passe après une pioche jouable', () => {
  const playableDraw = makeRoom({
    current: 'p1',
    hands: { p1: [card('existing', 'blue', 'number', 8)] },
    deck: [card('drawn', 'red', 'number', 3)],
  });
  uno.drawForPlayer(playableDraw, playableDraw.players[0]);
  assert.equal(playableDraw.gameState.currentPlayerId, 'p1');
  assert.equal(playableDraw.gameState.drawnCardId, 'drawn');
  assert.throws(() => uno.drawForPlayer(playableDraw, playableDraw.players[0]), { statusCode: 400 });
  assert.throws(() => uno.playCard(playableDraw, playableDraw.players[0], 'existing'), { statusCode: 400 });
  uno.passTurn(playableDraw, playableDraw.players[0]);
  assert.equal(playableDraw.gameState.currentPlayerId, 'p2');
  assert.equal(playableDraw.gameState.drawnCardId, null);
  assert.equal(playableDraw.gameState.hands.p1.length, 2);

  const unplayableDraw = makeRoom({
    current: 'p1',
    hands: { p1: [card('existing-blue', 'blue', 'number', 8)] },
    deck: [card('drawn-yellow', 'yellow', 'number', 3)],
  });
  uno.drawForPlayer(unplayableDraw, unplayableDraw.players[0]);
  assert.equal(unplayableDraw.gameState.currentPlayerId, 'p2');
  assert.equal(unplayableDraw.gameState.drawnCardId, null);
  assert.equal(unplayableDraw.gameState.hands.p1.length, 2);

  const playDrawn = makeRoom({
    current: 'p1',
    hands: { p1: [card('existing-blue-2', 'blue', 'number', 8)] },
    deck: [card('drawn-red', 'red', 'number', 3)],
  });
  uno.drawForPlayer(playDrawn, playDrawn.players[0]);
  uno.playCard(playDrawn, playDrawn.players[0], 'drawn-red');
  assert.equal(playDrawn.gameState.currentPlayerId, 'p2');
  assert.equal(playDrawn.gameState.hands.p1.length, 1);
});

test('déclare le vainqueur puis synchronise les joueurs qui quittent', () => {
  const winningRoom = makeRoom({
    current: 'p1',
    hands: { p1: [card('last-card', 'red', 'number', 8)] },
  });
  uno.playCard(winningRoom, winningRoom.players[0], 'last-card');
  assert.equal(winningRoom.gameState.phase, 'finished');
  assert.equal(winningRoom.gameState.result, 'win');
  assert.equal(winningRoom.gameState.winnerId, 'p1');
  assert.equal(winningRoom.gameState.currentPlayerId, null);

  const leavingRoom = makeRoom({ current: 'p2' });
  leavingRoom.players = leavingRoom.players.filter((player) => player.id !== 'p2');
  uno.syncPlayers(leavingRoom);
  assert.equal(leavingRoom.gameState.currentPlayerId, 'p3');
  assert.deepEqual(leavingRoom.gameState.playerOrder, ['p1', 'p3']);
});

test('les bots jouent automatiquement quand leur tour arrive', () => {
  const room = makeRoom({
    playerTypes: ['human', 'bot'],
    current: 'p2',
    hands: {
      p1: [card('human-card', 'blue', 'number', 2)],
      p2: [card('bot-card', 'red', 'number', 3), card('bot-spare', 'blue', 'number', 4)],
    },
  });
  uno.processBots(room);
  assert.equal(room.gameState.currentPlayerId, 'p1');
  assert.equal(room.gameState.hands.p2.length, 1);
  assert.match(room.gameState.lastAction.message, /Bot 2 joue/);
});
