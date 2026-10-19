'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bataille = require('../bataille-navale');

function seededRandom(seed = 123456789) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function makeRoom(playerTypes = ['human', 'human']) {
  const players = playerTypes.map((type, index) => ({
    id: `p${index + 1}`,
    nickname: type === 'bot' ? `Bot ${index + 1}` : `Joueur ${index + 1}`,
    isBot: type === 'bot',
  }));
  return {
    id: 'room-bataille-test',
    game: 'bataille-navale',
    hostPlayerId: players[0].id,
    players,
    gameState: bataille.createGame(players, { random: seededRandom() }),
  };
}

// Tire sur toutes les cases d'un navire précis pour le couler proprement.
function shipCells(state, playerId, size) {
  const ship = state.grids[playerId].ships.find((candidate) => candidate.size === size);
  return ship.cells.map((index) => ({ row: Math.floor(index / bataille.GRID_SIZE), column: index % bataille.GRID_SIZE }));
}

test('la bataille navale place cinq navires de tailles réglementaires sans chevauchement', () => {
  const room = makeRoom();
  const state = room.gameState;
  for (const playerId of state.playerOrder) {
    const ships = state.grids[playerId].ships;
    assert.equal(ships.length, 5);
    assert.deepEqual(ships.map((ship) => ship.size).sort((a, b) => a - b), [2, 3, 3, 4, 5]);
    const occupied = ships.flatMap((ship) => ship.cells);
    assert.equal(new Set(occupied).size, occupied.length, 'aucune case occupée deux fois');
    assert.ok(occupied.every((index) => index >= 0 && index < 100));
  }
});

test('les tirs alternent et une case ne peut pas être visée deux fois', () => {
  const room = makeRoom();
  const [first, second] = room.players;
  assert.equal(room.gameState.currentPlayerId, first.id);

  const firstShip = shipCells(room.gameState, second.id, 2)[0];
  const result = bataille.fire(room, first, firstShip.row, firstShip.column);
  assert.equal(result.hit, true, 'le navire est touché');
  assert.equal(room.gameState.currentPlayerId, second.id, 'le tour passe à l’adversaire');

  assert.throws(() => bataille.fire(room, first, 0, 0), /pas ton tour/i);

  const secondShot = bataille.fire(room, second, 0, 0);
  assert.ok(typeof secondShot.hit === 'boolean');
  assert.equal(room.gameState.currentPlayerId, first.id);

  const repeatIndex = shipCells(room.gameState, second.id, 2)[0];
  assert.throws(
    () => bataille.fire(room, first, repeatIndex.row, repeatIndex.column),
    /déjà tiré/i,
  );
});

test('couler toute la flotte termine la partie et déclare le vainqueur', () => {
  const room = makeRoom();
  const [first, second] = room.players;
  const targets = room.gameState.grids[second.id].ships
    .flatMap((ship) => ship.cells)
    .map((index) => ({ row: Math.floor(index / 10), column: index % 10 }));

  let safety = 0;
  while (room.gameState.phase === 'playing' && safety < 400) {
    safety += 1;
    const shooter = room.players.find((player) => player.id === room.gameState.currentPlayerId);
    if (shooter.id === first.id) {
      const next = targets.find((cell) => (
        !room.gameState.grids[second.id].incoming.includes(cell.row * 10 + cell.column)
      ));
      bataille.fire(room, first, next.row, next.column);
    } else {
      const free = Array.from({ length: 100 }, (_, index) => index)
        .find((index) => !room.gameState.grids[first.id].incoming.includes(index));
      bataille.fire(room, second, Math.floor(free / 10), free % 10);
    }
  }

  assert.equal(room.gameState.phase, 'finished');
  assert.equal(room.gameState.result, 'win');
  assert.equal(room.gameState.winnerId, first.id);
  assert.deepEqual(room.gameState.winnerIds, [first.id]);
  assert.match(room.gameState.lastAction.message, /gagne la bataille/);
  assert.throws(() => bataille.fire(room, first, 0, 0), /terminée/i);
});

test('le bot tire tout seul et ne vise jamais deux fois la même case', () => {
  const room = makeRoom(['human', 'bot']);
  const [, bot] = room.players;
  // On laisse le bot jouer plusieurs tours en faisant tirer l'humain entre deux.
  let safety = 0;
  while (room.gameState.phase === 'playing' && safety < 120) {
    safety += 1;
    const human = room.players[0];
    if (room.gameState.currentPlayerId === human.id) {
      const free = Array.from({ length: 100 }, (_, i) => i)
        .find((i) => !room.gameState.grids[room.players[1].id].incoming.includes(i));
      if (free === undefined) break;
      bataille.fire(room, human, Math.floor(free / 10), free % 10);
    } else {
      const before = room.gameState.grids[human.id].incoming.length;
      bataille.processBots(room);
      const after = room.gameState.grids[human.id].incoming.length;
      if (after === before) break;
    }
  }
  const shots = room.gameState.grids[room.players[0].id].incoming;
  assert.equal(new Set(shots).size, shots.length, 'le bot ne rejoue pas une case');
  assert.ok(shots.length > 0, 'le bot a bien tiré');
});

test('la vue publique cache la flotte adverse tant que la partie dure', () => {
  const room = makeRoom();
  const [first] = room.players;
  const state = bataille.publicState(room, first);
  assert.equal(state.ownGrid.ships.length, 5, 'on voit sa propre flotte');
  assert.equal(state.targetGrid.ships.length, 0, 'la flotte adverse reste secrète');
  assert.equal(state.isMyTurn, true);

  const spectator = bataille.publicState(room, null);
  assert.equal(spectator.isSpectator, true);
  assert.equal(spectator.ownGrid, null);
  assert.equal(spectator.isMyTurn, false);
});

test('un joueur qui quitte la partie la termine par forfait', () => {
  const room = makeRoom();
  const [first] = room.players;
  room.players = room.players.filter((player) => player.id !== room.players[1].id);
  bataille.syncPlayers(room);
  assert.equal(room.gameState.phase, 'finished');
  assert.equal(room.gameState.winnerId, first.id);
  assert.match(room.gameState.lastAction.message, /forfait/);
});
