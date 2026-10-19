'use strict';

const botDifficulty = require('./bot-difficulty');

const ROWS = 6;
const COLUMNS = 7;
const CONNECT = 4;
const MAX_BOT_ACTIONS_PER_UPDATE = 4;
const CENTER_PREFERENCE = [3, 2, 4, 1, 5, 0, 6];

function gameError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createGame(players) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw gameError(400, 'Il faut exactement deux joueurs pour lancer Puissance 4.');
  }
  const playerOrder = players.map((player) => player.id);
  return {
    phase: 'playing',
    result: null,
    board: Array.from({ length: ROWS }, () => Array(COLUMNS).fill(null)),
    playerOrder,
    currentPlayerId: playerOrder[0],
    winnerId: null,
    winningCells: [],
    startedAt: Date.now(),
    lastAction: {
      type: 'start',
      playerId: null,
      nickname: '',
      message: 'La partie commence : choisissez une colonne.',
      at: Date.now(),
    },
  };
}

function nextPlayerId(state, playerId) {
  const index = state.playerOrder.indexOf(playerId);
  if (index < 0 || state.playerOrder.length < 2) return null;
  return state.playerOrder[(index + 1) % state.playerOrder.length];
}

function lowestOpenRow(board, column) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (!board[row][column]) return row;
  }
  return -1;
}

function winningLine(board, row, column, playerId) {
  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [rowStep, columnStep] of directions) {
    const line = [{ row, column }];
    for (const sign of [-1, 1]) {
      for (let distance = 1; distance < CONNECT; distance += 1) {
        const nextRow = row + rowStep * distance * sign;
        const nextColumn = column + columnStep * distance * sign;
        if (
          nextRow < 0 || nextRow >= ROWS
          || nextColumn < 0 || nextColumn >= COLUMNS
          || board[nextRow][nextColumn] !== playerId
        ) break;
        line.push({ row: nextRow, column: nextColumn });
      }
    }
    if (line.length >= CONNECT) return line;
  }
  return [];
}

function requireTurn(room, player) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') {
    throw gameError(409, 'Cette partie de Puissance 4 est terminée.');
  }
  if (!player || state.currentPlayerId !== player.id) {
    throw gameError(403, 'Ce n’est pas ton tour.');
  }
  return state;
}

function actionRecord(type, player, message, column = null) {
  return {
    type,
    playerId: player ? player.id : null,
    nickname: player ? player.nickname : '',
    column,
    message,
    at: Date.now(),
  };
}

function playColumn(room, player, column) {
  const state = requireTurn(room, player);
  const selectedColumn = typeof column === 'number'
    ? column
    : (typeof column === 'string' && /^\d+$/.test(column) ? Number(column) : Number.NaN);
  if (!Number.isInteger(selectedColumn) || selectedColumn < 0 || selectedColumn >= COLUMNS) {
    throw gameError(400, 'Choisis une colonne de 1 à 7.');
  }
  const row = lowestOpenRow(state.board, selectedColumn);
  if (row < 0) throw gameError(400, 'Cette colonne est pleine. Choisis-en une autre.');

  state.board[row][selectedColumn] = player.id;
  const line = winningLine(state.board, row, selectedColumn, player.id);
  if (line.length >= CONNECT) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = player.id;
    state.currentPlayerId = null;
    state.winningCells = line;
    state.lastAction = actionRecord(
      'win',
      player,
      `${player.nickname} aligne quatre jetons et remporte Puissance 4 !`,
      selectedColumn,
    );
    return;
  }

  const isBoardFull = state.board.every((boardRow) => boardRow.every(Boolean));
  if (isBoardFull) {
    state.phase = 'finished';
    state.result = 'draw';
    state.winnerId = null;
    state.currentPlayerId = null;
    state.winningCells = [];
    state.lastAction = actionRecord('draw', player, 'La grille est pleine : match nul !', selectedColumn);
    return;
  }

  state.currentPlayerId = nextPlayerId(state, player.id);
  state.lastAction = actionRecord(
    'play',
    player,
    `${player.nickname} joue dans la colonne ${selectedColumn + 1}.`,
    selectedColumn,
  );
}

function simulateDrop(board, column, playerId) {
  const row = lowestOpenRow(board, column);
  if (row < 0) return null;
  const nextBoard = board.map((boardRow) => boardRow.slice());
  nextBoard[row][column] = playerId;
  return { board: nextBoard, row };
}

function chooseBotColumn(state, botId, difficulty = 'normal') {
  const openColumns = CENTER_PREFERENCE.filter((column) => lowestOpenRow(state.board, column) >= 0);
  if (!openColumns.length) return -1;

  // Niveau facile : le bot ignore ses heuristiques une fois sur deux environ.
  if (botDifficulty.shouldBlunder(difficulty)) {
    const careless = botDifficulty.pickRandom(openColumns);
    return careless === null ? openColumns[0] : careless;
  }

  for (const column of openColumns) {
    const move = simulateDrop(state.board, column, botId);
    if (winningLine(move.board, move.row, column, botId).length >= CONNECT) return column;
  }

  const opponentId = state.playerOrder.find((playerId) => playerId !== botId);
  if (opponentId) {
    for (const column of openColumns) {
      const move = simulateDrop(state.board, column, opponentId);
      if (winningLine(move.board, move.row, column, opponentId).length >= CONNECT) return column;
    }
  }
  return openColumns[0];
}

function processBots(room) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') return;

  let actions = 0;
  while (state.phase === 'playing' && actions < MAX_BOT_ACTIONS_PER_UPDATE) {
    const player = room.players.find((candidate) => candidate.id === state.currentPlayerId);
    if (!player || !player.isBot) break;
    const column = chooseBotColumn(state, player.id, room.botDifficulty);
    if (column < 0) {
      state.phase = 'finished';
      state.result = 'draw';
      state.currentPlayerId = null;
      state.lastAction = actionRecord('draw', player, 'La grille est pleine : match nul !');
      break;
    }
    playColumn(room, player, column);
    actions += 1;
  }
}

function publicState(room, currentPlayer) {
  const state = room.gameState;
  if (!state) return null;
  const currentPlayerId = state.currentPlayerId;
  const isMyTurn = Boolean(currentPlayer && currentPlayer.id === currentPlayerId && state.phase === 'playing');
  const winner = state.winnerId ? room.players.find((player) => player.id === state.winnerId) : null;

  return {
    phase: state.phase,
    result: state.result,
    startedAt: state.startedAt,
    currentPlayerId,
    currentPlayerName: room.players.find((player) => player.id === currentPlayerId)?.nickname || null,
    isMyTurn,
    winnerId: state.winnerId,
    winnerName: winner ? winner.nickname : null,
    winningCells: state.winningCells || [],
    lastAction: state.lastAction,
    board: state.board.map((row) => row.slice()),
    players: state.playerOrder
      .map((playerId, index) => room.players.find((player) => player.id === playerId))
      .filter(Boolean)
      .map((player, index) => ({
        id: player.id,
        nickname: player.nickname,
        isBot: Boolean(player.isBot),
        isHost: player.id === room.hostPlayerId,
        isYou: Boolean(currentPlayer && currentPlayer.id === player.id),
        isCurrentTurn: player.id === currentPlayerId,
        color: index === 0 ? 'red' : 'yellow',
      })),
  };
}

function syncPlayers(room) {
  const state = room.gameState;
  if (!state) return;
  const oldOrder = state.playerOrder.slice();
  const oldCurrent = state.currentPlayerId;
  const present = new Set(room.players.map((player) => player.id));
  state.playerOrder = oldOrder.filter((playerId) => present.has(playerId));

  if (state.phase !== 'playing') return;
  if (state.playerOrder.length === 0) {
    state.phase = 'finished';
    state.result = 'draw';
    state.currentPlayerId = null;
    state.lastAction = { type: 'draw', playerId: null, nickname: '', message: 'La partie est terminée.', at: Date.now() };
    return;
  }
  if (state.playerOrder.length === 1) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = state.playerOrder[0];
    state.currentPlayerId = null;
    const winner = room.players.find((player) => player.id === state.winnerId);
    state.lastAction = actionRecord('win', winner, `${winner ? winner.nickname : 'Un joueur'} gagne la partie par forfait.`);
    return;
  }
  if (!state.playerOrder.includes(oldCurrent)) {
    state.currentPlayerId = state.playerOrder.find((playerId) => playerId !== oldCurrent) || state.playerOrder[0];
    state.lastAction = { type: 'leave', playerId: null, nickname: '', message: 'Un joueur a quitté la partie : le tour continue.', at: Date.now() };
  }
}

module.exports = {
  createGame,
  playColumn,
  processBots,
  publicState,
  syncPlayers,
};
