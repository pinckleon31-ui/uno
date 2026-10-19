'use strict';

// Bataille navale à deux joueurs, grille 10 × 10.
// Chaque joueur place ses cinq navires (ou demande un placement au hasard),
// puis la partie commence : le premier tireur est tiré au sort. Les tirs sont
// ensuite alternés, un navire coulé est annoncé, et la victoire revient à qui
// coule toute la flotte adverse.

const botDifficulty = require('./bot-difficulty');

const GRID_SIZE = 10;
const FLEET = Object.freeze([5, 4, 3, 3, 2]);
const MAX_BOT_ACTIONS_PER_UPDATE = 2;

const SHIP_NAMES = Object.freeze({
  5: 'Porte-avions',
  4: 'Croiseur',
  3: 'Torpilleur',
  2: 'Patrouilleur',
});

function gameError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function shipName(size) {
  return SHIP_NAMES[size] || `Navire de ${size}`;
}

function indexToCell(index) {
  return { row: Math.floor(index / GRID_SIZE), column: index % GRID_SIZE };
}

function cellLabel(index) {
  const { row, column } = indexToCell(index);
  return `${String.fromCharCode(65 + column)}${row + 1}`;
}

function randomBetween(max, random) {
  return Math.floor(random() * max);
}

// Place une flotte complète sans chevauchement. `random` est injectable pour
// les tests : le placement doit être reproductible.
function placeFleet(random = Math.random) {
  const occupied = new Set();
  const ships = [];
  for (const size of FLEET) {
    let placed = null;
    for (let attempt = 0; attempt < 600 && !placed; attempt += 1) {
      const horizontal = random() < 0.5;
      const maxRow = horizontal ? GRID_SIZE : GRID_SIZE - size;
      const maxColumn = horizontal ? GRID_SIZE - size : GRID_SIZE;
      const row = randomBetween(maxRow, random);
      const column = randomBetween(maxColumn, random);
      const cells = [];
      for (let step = 0; step < size; step += 1) {
        const index = horizontal
          ? row * GRID_SIZE + (column + step)
          : (row + step) * GRID_SIZE + column;
        cells.push(index);
      }
      if (cells.some((index) => occupied.has(index))) continue;
      cells.forEach((index) => occupied.add(index));
      placed = { size, cells, hits: [] };
    }
    if (!placed) {
      // Repli déterministe : lignes horizontales empilées, jamais en échec.
      let index = 0;
      while (index < GRID_SIZE * GRID_SIZE && placed === null) {
        const cells = Array.from({ length: size }, (_, step) => index + step);
        if (cells.every((cell) => cell < GRID_SIZE * GRID_SIZE && !occupied.has(cell))) {
          cells.forEach((cell) => occupied.add(cell));
          placed = { size, cells, hits: [] };
        }
        index += size;
      }
    }
    ships.push(placed);
  }
  return ships;
}

function emptyPlacement() {
  return { ships: [], ready: false };
}

function createGame(players, options = {}) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw gameError(400, 'Il faut exactement deux joueurs pour lancer une bataille navale.');
  }
  const playerOrder = players.map((player) => player.id);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const grids = {};
  const placements = {};
  for (const playerId of playerOrder) {
    grids[playerId] = { ships: [], incoming: [] };
    placements[playerId] = emptyPlacement();
  }
  const now = Date.now();
  return {
    phase: 'placing',
    result: null,
    playerOrder,
    currentPlayerId: null,
    grids,
    placements,
    winnerId: null,
    winnerIds: [],
    startedPlacementAt: now,
    startedAt: null,
    lastAction: {
      type: 'placing',
      playerId: null,
      nickname: '',
      message: 'Place tes cinq navires, puis appuie sur Prêt.',
      at: now,
    },
  };
}

function shipsToPlace(placement) {
  const remaining = FLEET.slice();
  for (const ship of placement.ships) {
    const index = remaining.indexOf(ship.size);
    if (index >= 0) remaining.splice(index, 1);
  }
  return remaining;
}

function cellsForPlacement(size, row, column, orientation) {
  const cells = [];
  for (let step = 0; step < size; step += 1) {
    const nextRow = orientation === 'vertical' ? row + step : row;
    const nextColumn = orientation === 'horizontal' ? column + step : column;
    if (nextRow < 0 || nextRow >= GRID_SIZE || nextColumn < 0 || nextColumn >= GRID_SIZE) return null;
    cells.push(nextRow * GRID_SIZE + nextColumn);
  }
  return cells;
}

function occupiedCells(placement) {
  return new Set(placement.ships.flatMap((ship) => ship.cells));
}

function requirePlacing(room, player) {
  const state = room.gameState;
  if (!state) throw gameError(409, 'Cette bataille navale n’a pas commencé.');
  if (state.phase !== 'placing') throw gameError(409, 'Les flottes sont déjà prêtes : la partie a commencé.');
  if (!player || !state.playerOrder.includes(player.id)) throw gameError(403, 'Tu ne participes pas à cette partie.');
  if (player.isBot) throw gameError(403, 'Les bots placent leurs navires tout seuls.');
  if (state.placements[player.id].ready) throw gameError(409, 'Tu as déjà validé ta flotte.');
  return state;
}

function placeShip(room, player, spec = {}) {
  const state = requirePlacing(room, player);
  const placement = state.placements[player.id];
  const size = Number.parseInt(spec.size, 10);
  const row = Number.parseInt(spec.row, 10);
  const column = Number.parseInt(spec.column, 10);
  const orientation = spec.orientation === 'vertical' ? 'vertical' : 'horizontal';

  if (!FLEET.includes(size)) throw gameError(400, 'Ce navire n’existe pas.');
  if (!shipsToPlace(placement).includes(size)) {
    throw gameError(409, 'Tu as déjà placé tous les navires de cette taille.');
  }
  if (!Number.isInteger(row) || !Number.isInteger(column)) {
    throw gameError(400, 'Choisis une case de la grille (A à J, 1 à 10).');
  }
  const cells = cellsForPlacement(size, row, column, orientation);
  if (!cells) throw gameError(400, 'Le navire dépasse de la grille.');
  const occupied = occupiedCells(placement);
  if (cells.some((index) => occupied.has(index))) {
    throw gameError(409, 'Un navire est déjà placé sur ces cases.');
  }
  const ship = { size, cells, orientation };
  placement.ships.push(ship);
  state.lastAction = {
    type: 'placement',
    playerId: player.id,
    nickname: player.nickname,
    message: `${player.nickname} place son ${shipName(size)}.`,
    at: Date.now(),
  };
  return ship;
}

function removeShip(room, player, index) {
  const state = requirePlacing(room, player);
  const placement = state.placements[player.id];
  const position = Number.parseInt(index, 10);
  if (!Number.isInteger(position) || position < 0 || position >= placement.ships.length) {
    throw gameError(400, 'Ce navire n’est pas placé.');
  }
  placement.ships.splice(position, 1);
  return true;
}

function clearFleet(room, player) {
  const state = requirePlacing(room, player);
  state.placements[player.id].ships = [];
  return true;
}

function randomizeFleet(room, player, random = Math.random) {
  const state = requirePlacing(room, player);
  state.placements[player.id].ships = placeFleet(random).map((ship) => ({
    size: ship.size,
    cells: ship.cells,
    orientation: ship.cells.length > 1 && ship.cells[1] === ship.cells[0] + 1 ? 'horizontal' : 'vertical',
  }));
  return state.placements[player.id].ships;
}

function allReady(state) {
  return state.playerOrder.every((playerId) => state.placements[playerId].ready);
}

function startBattle(room, random = Math.random) {
  const state = room.gameState;
  for (const playerId of state.playerOrder) {
    state.grids[playerId] = {
      ships: state.placements[playerId].ships.map((ship) => ({
        size: ship.size,
        cells: ship.cells.slice(),
        hits: [],
      })),
      incoming: [],
    };
  }
  state.phase = 'playing';
  state.startedAt = Date.now();
  // Premier tireur tiré au sort : aucune place n'est avantagée.
  state.currentPlayerId = state.playerOrder[randomBetween(state.playerOrder.length, random)];
  const first = room.players.find((player) => player.id === state.currentPlayerId);
  state.lastAction = {
    type: 'start',
    playerId: null,
    nickname: '',
    message: `Les deux flottes sont prêtes. ${first?.nickname || 'Un joueur'} commence !`,
    at: state.startedAt,
  };
  return state;
}

function ready(room, player) {
  const state = requirePlacing(room, player);
  const placement = state.placements[player.id];
  if (shipsToPlace(placement).length) {
    throw gameError(400, 'Place tous tes navires avant de valider.');
  }
  placement.ready = true;
  if (allReady(state)) {
    startBattle(room);
    return { started: true };
  }
  return { started: false };
}

function requireTurn(room, player) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') throw gameError(409, 'Cette bataille navale n’est pas en cours.');
  if (!player || !state.playerOrder.includes(player.id)) throw gameError(403, 'Tu ne participes pas à cette partie.');
  if (state.currentPlayerId !== player.id) throw gameError(403, 'Ce n’est pas ton tour.');
  return state;
}

function fleetRemaining(grid) {
  return grid.ships.filter((ship) => ship.hits.length < ship.size).length;
}

function fire(room, player, row, column) {
  const state = requireTurn(room, player);
  const safeRow = Number.parseInt(row, 10);
  const safeColumn = Number.parseInt(column, 10);
  if (!Number.isInteger(safeRow) || !Number.isInteger(safeColumn)
    || safeRow < 0 || safeRow >= GRID_SIZE || safeColumn < 0 || safeColumn >= GRID_SIZE) {
    throw gameError(400, 'Choisis une case de la grille (A à J, 1 à 10).');
  }

  const opponentId = state.playerOrder.find((playerId) => playerId !== player.id);
  const opponentGrid = state.grids[opponentId];
  const index = safeRow * GRID_SIZE + safeColumn;
  if (opponentGrid.incoming.includes(index)) {
    throw gameError(409, 'Tu as déjà tiré sur cette case. Choisis-en une autre.');
  }

  opponentGrid.incoming.push(index);
  const ship = opponentGrid.ships.find((candidate) => candidate.cells.includes(index)) || null;
  const sunk = Boolean(ship) && ship.hits.length + 1 === ship.size;
  if (ship) ship.hits.push(index);

  const opponent = room.players.find((candidate) => candidate.id === opponentId);
  const opponentName = opponent?.nickname || 'L’adversaire';
  let message;
  if (!ship) {
    message = `${player.nickname} tire en ${cellLabel(index)} : dans l’eau.`;
  } else if (sunk) {
    message = `${player.nickname} coule le ${shipName(ship.size)} adverse en ${cellLabel(index)} !`;
  } else {
    message = `${player.nickname} touche un navire en ${cellLabel(index)}.`;
  }

  const remaining = fleetRemaining(opponentGrid);
  if (remaining === 0) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = player.id;
    state.winnerIds = [player.id];
    state.currentPlayerId = null;
    state.lastAction = {
      type: 'victory',
      playerId: player.id,
      nickname: player.nickname,
      message: `${player.nickname} coule toute la flotte de ${opponentName} et gagne la bataille !`,
      at: Date.now(),
    };
    return { hit: Boolean(ship), sunk, victory: true, cell: index };
  }

  state.currentPlayerId = opponentId;
  state.lastAction = {
    type: ship ? (sunk ? 'sunk' : 'hit') : 'miss',
    playerId: player.id,
    nickname: player.nickname,
    message,
    at: Date.now(),
  };
  return { hit: Boolean(ship), sunk, victory: false, cell: index };
}

// Le bot vise les cases voisines d'un navire touché non coulé. En facile, il
// tire complètement au hasard ; en difficile, il prolonge la ligne déjà tracée
// pour achever le navire plus vite.
function chooseBotTarget(state, botId, room) {
  const opponentId = state.playerOrder.find((playerId) => playerId !== botId);
  const grid = state.grids[opponentId];
  const tried = new Set(grid.incoming);
  const difficulty = botDifficulty.normalize(room.botDifficulty);

  const freeCell = (index) => !tried.has(index);
  const inGrid = (row, column) => row >= 0 && row < GRID_SIZE && column >= 0 && column < GRID_SIZE;

  if (difficulty === 'difficile') {
    // Prolonge une ligne de deux touches alignées.
    for (const ship of grid.ships) {
      if (ship.hits.length < 2 || ship.hits.length >= ship.size) continue;
      const cells = ship.hits.map(indexToCell);
      const sameRow = cells.every((cell) => cell.row === cells[0].row);
      const sorted = cells.slice().sort((a, b) => (sameRow ? a.column - b.column : a.row - b.row));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const candidates = sameRow
        ? [{ row: first.row, column: first.column - 1 }, { row: last.row, column: last.column + 1 }]
        : [{ row: first.row - 1, column: first.column }, { row: last.row + 1, column: last.column }];
      const options = candidates.filter((cell) => (
        inGrid(cell.row, cell.column) && freeCell(cell.row * GRID_SIZE + cell.column)
      ));
      if (options.length) {
        const choice = options[Math.floor(Math.random() * options.length)];
        return { row: choice.row, column: choice.column };
      }
    }
  }

  if (difficulty !== 'facile') {
    const candidates = [];
    for (const ship of grid.ships) {
      if (ship.hits.length === 0 || ship.hits.length >= ship.size) continue;
      for (const hit of ship.hits) {
        const { row, column } = indexToCell(hit);
        for (const [rowDelta, columnDelta] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nextRow = row + rowDelta;
          const nextColumn = column + columnDelta;
          if (!inGrid(nextRow, nextColumn)) continue;
          const index = nextRow * GRID_SIZE + nextColumn;
          if (freeCell(index)) candidates.push(index);
        }
      }
    }
    if (candidates.length) {
      const index = candidates[Math.floor(Math.random() * candidates.length)];
      return indexToCell(index);
    }
  }

  const free = [];
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    if (freeCell(index)) free.push(index);
  }
  if (!free.length) return null;
  return indexToCell(free[Math.floor(Math.random() * free.length)]);
}

function processBots(room) {
  const state = room.gameState;
  if (!state) return;

  // Phase de placement : les bots posent leur flotte et valident tout seuls.
  if (state.phase === 'placing') {
    for (const playerId of state.playerOrder) {
      const player = room.players.find((candidate) => candidate.id === playerId);
      if (!player || !player.isBot) continue;
      const placement = state.placements[playerId];
      if (!placement.ready) {
        placement.ships = placeFleet().map((ship) => ({
          size: ship.size,
          cells: ship.cells,
          orientation: ship.cells.length > 1 && ship.cells[1] === ship.cells[0] + 1 ? 'horizontal' : 'vertical',
        }));
        placement.ready = true;
      }
    }
    if (state.phase === 'placing' && allReady(state)) startBattle(room);
    return;
  }

  if (state.phase !== 'playing') return;
  let actions = 0;
  while (state.phase === 'playing' && actions < MAX_BOT_ACTIONS_PER_UPDATE) {
    const bot = room.players.find((player) => player.id === state.currentPlayerId && player.isBot);
    if (!bot) break;
    const target = chooseBotTarget(state, bot.id, room);
    if (!target) break;
    fire(room, bot, target.row, target.column);
    actions += 1;
  }
}

function publicState(room, currentPlayer) {
  const state = normalizeState(room.gameState);
  if (!state) return null;
  const finished = state.phase === 'finished';
  const placing = state.phase === 'placing';
  const current = room.players.find((player) => player.id === state.currentPlayerId);
  const winner = state.winnerId ? room.players.find((player) => player.id === state.winnerId) : null;
  const viewerId = currentPlayer ? currentPlayer.id : null;
  const viewerGrid = viewerId ? state.grids[viewerId] : null;
  const viewerPlacement = viewerId ? state.placements[viewerId] : null;
  const opponentId = viewerId ? state.playerOrder.find((playerId) => playerId !== viewerId) : null;
  const opponentGrid = opponentId ? state.grids[opponentId] : null;
  const opponentPlacement = opponentId ? state.placements[opponentId] : null;

  const ownShipsSource = placing
    ? (viewerPlacement ? viewerPlacement.ships.map((ship) => ({
      size: ship.size,
      name: shipName(ship.size),
      cells: ship.cells.slice(),
      hits: [],
      sunk: false,
      orientation: ship.orientation,
    })) : [])
    : (viewerGrid ? viewerGrid.ships.map((ship) => ({
      size: ship.size,
      name: shipName(ship.size),
      cells: ship.cells.slice(),
      hits: ship.hits.slice(),
      sunk: ship.hits.length >= ship.size,
    })) : []);

  const ownGrid = viewerGrid ? {
    ships: ownShipsSource,
    received: viewerGrid.incoming.map((index) => ({
      index,
      hit: viewerGrid.ships.some((ship) => ship.cells.includes(index)),
    })),
  } : (placing && viewerPlacement ? { ships: ownShipsSource, received: [] } : null);

  const targetGrid = opponentGrid ? {
    shots: opponentGrid.incoming.map((index) => {
      const ship = opponentGrid.ships.find((candidate) => candidate.cells.includes(index)) || null;
      return {
        index,
        result: ship ? (ship.hits.length >= ship.size ? 'sunk' : 'hit') : 'miss',
      };
    }),
    // Les navires adverses ne sont révélés qu'une fois la partie terminée.
    ships: finished
      ? opponentGrid.ships.map((ship) => ({
        size: ship.size,
        name: shipName(ship.size),
        cells: ship.cells.slice(),
        sunk: ship.hits.length >= ship.size,
      }))
      : [],
  } : null;

  return {
    phase: state.phase,
    result: state.result,
    gridSize: GRID_SIZE,
    columnLabels: Array.from({ length: GRID_SIZE }, (_, index) => String.fromCharCode(65 + index)),
    fleet: FLEET.slice(),
    placement: placing && viewerPlacement ? {
      ships: viewerPlacement.ships.map((ship) => ({
        size: ship.size,
        cells: ship.cells.slice(),
        orientation: ship.orientation,
      })),
      remaining: shipsToPlace(viewerPlacement),
      ready: viewerPlacement.ready,
      opponentReady: Boolean(opponentPlacement && opponentPlacement.ready),
      canPlace: !viewerPlacement.ready,
    } : null,
    players: state.playerOrder.map((playerId) => {
      const player = room.players.find((candidate) => candidate.id === playerId);
      if (!player) return null;
      return {
        id: player.id,
        nickname: player.nickname,
        isBot: Boolean(player.isBot),
        isHost: player.id === room.hostPlayerId,
        isYou: Boolean(viewerId && player.id === viewerId),
        isCurrentTurn: state.phase === 'playing' && player.id === state.currentPlayerId,
        shipsRemaining: placing
          ? FLEET.length
          : fleetRemaining(state.grids[playerId]),
        isReady: placing ? state.placements[playerId].ready : true,
      };
    }).filter(Boolean),
    isMyTurn: Boolean(viewerId && state.phase === 'playing' && state.currentPlayerId === viewerId),
    isSpectator: !viewerId,
    currentPlayerName: current ? current.nickname : '',
    currentPlayerId: state.currentPlayerId,
    winnerId: state.winnerId,
    winnerName: winner ? winner.nickname : '',
    winnerIds: state.winnerIds.slice(),
    ownGrid,
    targetGrid,
    lastAction: state.lastAction,
  };
}

// Les parties enregistrées par une version précédente n'ont pas de
// `placements` : on complète l'état pour ne jamais casser un salon existant.
function normalizeState(state) {
  if (!state || typeof state !== 'object') return null;
  if (!Array.isArray(state.playerOrder)) state.playerOrder = [];
  if (!state.grids || typeof state.grids !== 'object') state.grids = {};
  for (const playerId of state.playerOrder) {
    const grid = state.grids[playerId] || (state.grids[playerId] = { ships: [], incoming: [] });
    if (!Array.isArray(grid.ships)) grid.ships = [];
    if (!Array.isArray(grid.incoming)) grid.incoming = [];
  }
  if (!state.placements || typeof state.placements !== 'object') state.placements = {};
  for (const playerId of state.playerOrder) {
    if (!state.placements[playerId]) state.placements[playerId] = emptyPlacement();
    const placement = state.placements[playerId];
    if (!Array.isArray(placement.ships)) placement.ships = [];
    placement.ready = Boolean(placement.ready);
  }
  if (!Array.isArray(state.winnerIds)) state.winnerIds = [];
  if (typeof state.phase !== 'string') state.phase = 'finished';
  return state;
}

function syncPlayers(room) {
  const state = normalizeState(room.gameState);
  if (!state) return;
  const present = new Set(room.players.map((player) => player.id));
  const previousOrder = state.playerOrder.slice();
  const previousTurnIndex = Math.max(0, previousOrder.indexOf(state.currentPlayerId));
  state.playerOrder = previousOrder.filter((playerId) => present.has(playerId));
  for (const playerId of previousOrder) {
    if (!present.has(playerId)) {
      delete state.grids[playerId];
      delete state.placements[playerId];
    }
  }
  if (state.phase === 'finished') return;
  if (state.playerOrder.length === 1) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = state.playerOrder[0];
    state.winnerIds = [state.winnerId];
    state.currentPlayerId = null;
    const winner = room.players.find((player) => player.id === state.winnerId);
    state.lastAction = {
      type: 'forfeit',
      playerId: state.winnerId,
      nickname: winner?.nickname || '',
      message: `${winner?.nickname || 'Le joueur restant'} remporte la bataille par forfait.`,
      at: Date.now(),
    };
    return;
  }
  if (state.playerOrder.length === 0) {
    state.phase = 'finished';
    state.result = 'draw';
    state.winnerId = null;
    state.winnerIds = [];
    state.currentPlayerId = null;
    return;
  }
  if (state.phase === 'playing' && !state.playerOrder.includes(state.currentPlayerId)) {
    state.currentPlayerId = state.playerOrder[previousTurnIndex % state.playerOrder.length];
  }
}

module.exports = {
  createGame,
  placeShip,
  removeShip,
  clearFleet,
  randomizeFleet,
  ready,
  fire,
  processBots,
  publicState,
  syncPlayers,
  placeFleet,
  cellLabel,
  GRID_SIZE,
  FLEET,
};
