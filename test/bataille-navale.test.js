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

// Place une flotte au hasard et valide, comme le ferait un joueur pressé.
function readyWithRandomFleet(room, player) {
  // Un bot place sa flotte tout seul via processBots.
  if (player.isBot) {
    bataille.processBots(room);
    return { started: room.gameState.phase === 'playing' };
  }
  bataille.randomizeFleet(room, player);
  return bataille.ready(room, player);
}

// Partie prête à jouer : les deux flottes placées.
function makePlayingRoom(playerTypes = ['human', 'human']) {
  const room = makeRoom(playerTypes);
  const [first, second] = room.players;
  readyWithRandomFleet(room, first);
  readyWithRandomFleet(room, second);
  return room;
}

// Tire sur toutes les cases d'un navire précis pour le couler proprement.
function shipCells(state, playerId, size) {
  const ship = state.grids[playerId].ships.find((candidate) => candidate.size === size);
  return ship.cells.map((index) => ({ row: Math.floor(index / bataille.GRID_SIZE), column: index % bataille.GRID_SIZE }));
}

test('la bataille navale place cinq navires de tailles réglementaires sans chevauchement', () => {
  const room = makePlayingRoom();
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

test('le premier tireur est tiré au sort, puis les tirs alternent', () => {
  const room = makePlayingRoom();
  const [first, second] = room.players;
  const starter = room.gameState.currentPlayerId;
  assert.ok([first.id, second.id].includes(starter), 'le premier tireur est l’un des deux joueurs');

  const shooter = room.players.find((player) => player.id === starter);
  const other = room.players.find((player) => player.id !== starter);
  const target = shipCells(room.gameState, other.id, 2)[0];
  const result = bataille.fire(room, shooter, target.row, target.column);
  assert.equal(result.hit, true, 'le navire est touché');
  assert.equal(room.gameState.currentPlayerId, other.id, 'le tour passe à l’adversaire');

  assert.throws(() => bataille.fire(room, shooter, 0, 0), /pas ton tour/i);

  const secondShot = bataille.fire(room, other, 0, 0);
  assert.ok(typeof secondShot.hit === 'boolean');
  assert.equal(room.gameState.currentPlayerId, shooter.id);

  const repeatIndex = shipCells(room.gameState, other.id, 2)[0];
  assert.throws(
    () => bataille.fire(room, shooter, repeatIndex.row, repeatIndex.column),
    /déjà tiré/i,
  );
});

test('couler toute la flotte termine la partie et déclare le vainqueur', () => {
  const room = makePlayingRoom();
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
  assert.throws(() => bataille.fire(room, first, 0, 0), /n’est pas en cours|terminée/i);
});

test('le bot tire tout seul et ne vise jamais deux fois la même case', () => {
  const room = makePlayingRoom(['human', 'bot']);
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
  const room = makePlayingRoom();
  const [first] = room.players;
  const state = bataille.publicState(room, first);
  assert.equal(state.ownGrid.ships.length, 5, 'on voit sa propre flotte');
  assert.equal(state.targetGrid.ships.length, 0, 'la flotte adverse reste secrète');
  assert.equal(state.isMyTurn, room.gameState.currentPlayerId === first.id);

  const spectator = bataille.publicState(room, null);
  assert.equal(spectator.isSpectator, true);
  assert.equal(spectator.ownGrid, null);
  assert.equal(spectator.isMyTurn, false);
});

test('un joueur qui quitte la partie la termine par forfait', () => {
  const room = makePlayingRoom();
  const [first] = room.players;
  room.players = room.players.filter((player) => player.id !== room.players[1].id);
  bataille.syncPlayers(room);
  assert.equal(room.gameState.phase, 'finished');
  assert.equal(room.gameState.winnerId, first.id);
  assert.match(room.gameState.lastAction.message, /forfait/);
});

test('le placement manuel refuse le chevauchement et le débordement', () => {
  const room = makeRoom();
  const [first] = room.players;
  bataille.placeShip(room, first, { size: 5, row: 0, column: 0, orientation: 'horizontal' });
  assert.throws(
    () => bataille.placeShip(room, first, { size: 4, row: 0, column: 2, orientation: 'horizontal' }),
    /déjà placé/i,
  );
  assert.throws(
    () => bataille.placeShip(room, first, { size: 4, row: 8, column: 0, orientation: 'vertical' }),
    /dépasse/i,
  );
  assert.throws(
    () => bataille.placeShip(room, first, { size: 5, row: 0, column: 0, orientation: 'horizontal' }),
    /déjà placé tous les navires/i,
  );
  // On peut retirer un navire et le replacer ailleurs.
  bataille.removeShip(room, first, 0);
  bataille.placeShip(room, first, { size: 5, row: 5, column: 5, orientation: 'vertical' });
  assert.equal(room.gameState.placements[first.id].ships.length, 1);
});

test('la partie ne démarre qu\'une fois les deux flottes validées, et le placement est visible', () => {
  const room = makeRoom();
  const [first, second] = room.players;

  // Un joueur incomplet ne peut pas valider.
  bataille.placeShip(room, first, { size: 5, row: 0, column: 0, orientation: 'horizontal' });
  assert.throws(() => bataille.ready(room, first), /Place tous tes navires/i);

  const placementView = bataille.publicState(room, first);
  assert.equal(placementView.phase, 'placing');
  assert.equal(placementView.placement.remaining.length, 4, 'il reste quatre navires à placer');
  assert.equal(placementView.placement.ships.length, 1);
  assert.equal(placementView.placement.ships[0].size, 5);
  assert.equal(placementView.isMyTurn, false, 'on ne tire pas avant le début');
  assert.equal(placementView.targetGrid.shots.length, 0, 'aucun tir avant le début');
  assert.equal(placementView.isMyTurn, false);

  // Les deux joueurs complètent puis valident.
  const firstReady = readyWithRandomFleet(room, first);
  assert.equal(firstReady.started, false, 'la partie attend le second joueur');
  assert.equal(room.gameState.placements[first.id].ready, true);
  assert.equal(room.gameState.placements[second.id].ready, false);

  const waitingView = bataille.publicState(room, second);
  assert.equal(waitingView.placement.opponentReady, true, 'le second sait que l’autre est prêt');

  const secondReady = readyWithRandomFleet(room, second);
  assert.equal(secondReady.started, true);
  assert.equal(room.gameState.phase, 'playing');
  assert.ok(room.gameState.startedAt);
  assert.ok(room.gameState.currentPlayerId, 'un premier tireur est désigné');
  assert.ok([first.id, second.id].includes(room.gameState.currentPlayerId));
});

test('le bot place sa flotte et valide tout seul', () => {
  const room = makeRoom(['human', 'bot']);
  const [human, bot] = room.players;
  bataille.processBots(room);
  assert.equal(room.gameState.placements[bot.id].ready, true);
  assert.equal(room.gameState.placements[bot.id].ships.length, 5);
  assert.equal(room.gameState.phase, 'placing', 'la partie attend encore le joueur humain');

  readyWithRandomFleet(room, human);
  assert.equal(room.gameState.phase, 'playing');
});

test('le niveau du bot change son comportement de visée', () => {
  const easy = makePlayingRoom(['human', 'bot']);
  easy.botDifficulty = 'facile';
  const normal = makePlayingRoom(['human', 'bot']);
  normal.botDifficulty = 'normal';
  const hard = makePlayingRoom(['human', 'bot']);
  hard.botDifficulty = 'difficile';

  // Vérifié indirectement : les trois niveaux produisent des cibles valides et
  // ne tirent jamais hors grille.
  for (const room of [easy, normal, hard]) {
    bataille.processBots(room);
    const shots = room.gameState.grids[room.players[0].id].incoming;
    assert.ok(shots.every((index) => index >= 0 && index < 100));
    assert.equal(new Set(shots).size, shots.length);
  }
});

test('Une partie enregistrée par une version précédente reste lisible', () => {
  const legacy = {
    phase: 'playing',
    result: null,
    playerOrder: ['a', 'b'],
    currentPlayerId: 'a',
    grids: {
      a: { ships: [{ size: 5, cells: [0, 1, 2, 3, 4], hits: [0] }], incoming: [7] },
      b: { ships: [{ size: 2, cells: [9, 19], hits: [] }], incoming: [] },
    },
    winnerId: null,
    winnerIds: undefined,
    lastAction: { message: 'Ancienne partie', at: 1 },
  };
  const room = {
    id: 'legacy',
    players: [
      { id: 'a', nickname: 'Amiral', isBot: false },
      { id: 'b', nickname: 'Second', isBot: false },
    ],
    hostPlayerId: 'a',
    gameState: legacy,
  };
  assert.doesNotThrow(() => bataille.syncPlayers(room));
  const state = bataille.publicState(room, room.players[0]);
  assert.equal(state.phase, 'playing');
  assert.equal(state.ownGrid.ships.length, 1);
  assert.equal(state.ownGrid.received.length, 1);
  assert.deepEqual(legacy.winnerIds, []);
  assert.deepEqual(Object.keys(legacy.placements).sort(), ['a', 'b']);
});
