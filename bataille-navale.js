'use strict';

// Bataille navale à deux joueurs, grille 10 × 10.
// Les flottes sont placées automatiquement au lancement : le joueur n'a
// qu'à viser la grille adverse. Les tirs sont alternés, un navire coulé est
// annoncé, et la partie se termine quand une flotte entière est coulée.

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

// Place une flotte sans chevauchement. `random` est injectable pour les tests.
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

function createGame(players, options = {}) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw gameError(400, 'Il faut exactement deux joueurs pour lancer une bataille navale.');
  }
  const playerOrder = players.map((player) => player.id);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const grids = {};
  for (const playerId of playerOrder) {
    grids[playerId] = { ships: placeFleet(random), incoming: [] };
  }
  const now = Date.now();
  return {
    phase: 'playing',
    result: null,
    playerOrder,
    currentPlayerId: playerOrder[0],
    grids,
    winnerId: null,
    winnerIds: [],
    startedAt: now,
    lastAction: {
      type: 'start',
      playerId: null,
      nickname: '',
      message: 'Les flottes sont placées. À toi de viser une case adverse.',
      at: now,
    },
  };
}

function requireTurn(room, player) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') throw gameError(409, 'Cette bataille navale est terminée.');
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

// Le bot vise au hasard, mais préfère les cases voisines d'un navire touché
// non coulé : il devient ainsi plus redoutable sans être invincible.
function chooseBotTarget(state, botId) {
  const opponentId = state.playerOrder.find((playerId) => playerId !== botId);
  const grid = state.grids[opponentId];
  const tried = new Set(grid.incoming);
  const candidates = [];
  for (const ship of grid.ships) {
    if (ship.hits.length === 0 || ship.hits.length >= ship.size) continue;
    for (const hit of ship.hits) {
      const { row, column } = indexToCell(hit);
      for (const [rowDelta, columnDelta] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nextRow = row + rowDelta;
        const nextColumn = column + columnDelta;
        if (nextRow < 0 || nextRow >= GRID_SIZE || nextColumn < 0 || nextColumn >= GRID_SIZE) continue;
        const index = nextRow * GRID_SIZE + nextColumn;
        if (!tried.has(index)) candidates.push(index);
      }
    }
  }
  if (candidates.length) {
    const index = candidates[Math.floor(Math.random() * candidates.length)];
    return indexToCell(index);
  }
  const free = [];
  for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
    if (!tried.has(index)) free.push(index);
  }
  if (!free.length) return null;
  return indexToCell(free[Math.floor(Math.random() * free.length)]);
}

function processBots(room) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') return;
  let actions = 0;
  while (state.phase === 'playing' && actions < MAX_BOT_ACTIONS_PER_UPDATE) {
    const bot = room.players.find((player) => player.id === state.currentPlayerId && player.isBot);
    if (!bot) break;
    const target = chooseBotTarget(state, bot.id);
    if (!target) break;
    fire(room, bot, target.row, target.column);
    actions += 1;
  }
}

function publicState(room, currentPlayer) {
  const state = room.gameState;
  if (!state) return null;
  const finished = state.phase === 'finished';
  const current = room.players.find((player) => player.id === state.currentPlayerId);
  const winner = state.winnerId ? room.players.find((player) => player.id === state.winnerId) : null;
  const viewerId = currentPlayer ? currentPlayer.id : null;
  const viewerGrid = viewerId ? state.grids[viewerId] : null;
  const opponentId = viewerId ? state.playerOrder.find((playerId) => playerId !== viewerId) : null;
  const opponentGrid = opponentId ? state.grids[opponentId] : null;

  const ownGrid = viewerGrid ? {
    ships: viewerGrid.ships.map((ship) => ({
      size: ship.size,
      name: shipName(ship.size),
      cells: ship.cells.slice(),
      hits: ship.hits.slice(),
      sunk: ship.hits.length >= ship.size,
    })),
    received: viewerGrid.incoming.map((index) => ({
      index,
      hit: viewerGrid.ships.some((ship) => ship.cells.includes(index)),
    })),
  } : null;

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
        shipsRemaining: fleetRemaining(state.grids[playerId]),
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

function syncPlayers(room) {
  const state = room.gameState;
  if (!state) return;
  const present = new Set(room.players.map((player) => player.id));
  const previousOrder = state.playerOrder.slice();
  const previousTurnIndex = Math.max(0, previousOrder.indexOf(state.currentPlayerId));
  state.playerOrder = previousOrder.filter((playerId) => present.has(playerId));
  for (const playerId of previousOrder) {
    if (!present.has(playerId)) delete state.grids[playerId];
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
  if (!state.playerOrder.includes(state.currentPlayerId)) {
    state.currentPlayerId = state.playerOrder[previousTurnIndex % state.playerOrder.length];
  }
}

module.exports = {
  createGame,
  fire,
  processBots,
  publicState,
  syncPlayers,
  placeFleet,
  cellLabel,
  GRID_SIZE,
  FLEET,
};
