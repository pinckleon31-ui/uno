'use strict';

const botDifficulty = require('./bot-difficulty');

const MAX_BOT_ACTIONS_PER_UPDATE = 2;
const WINNING_LINES = Object.freeze([
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]);
const BOT_PREFERENCE = [4, 0, 2, 6, 8, 1, 3, 5, 7];

function gameError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function findWinningLine(board, playerId) {
  return WINNING_LINES.find((line) => line.every((cell) => board[cell] === playerId)) || null;
}

function nextPlayerId(state, playerId) {
  const index = state.playerOrder.indexOf(playerId);
  if (index < 0 || state.playerOrder.length < 2) return null;
  return state.playerOrder[(index + 1) % state.playerOrder.length];
}

function createGame(players) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw gameError(400, 'Il faut exactement deux joueurs pour lancer une partie de morpion.');
  }
  const playerOrder = players.map((player) => player.id);
  return {
    phase: 'playing',
    result: null,
    board: Array(9).fill(null),
    playerOrder,
    symbols: { [playerOrder[0]]: 'X', [playerOrder[1]]: 'O' },
    currentPlayerId: playerOrder[0],
    winnerId: null,
    winnerIds: [],
    winningCells: [],
    startedAt: Date.now(),
    lastAction: {
      type: 'start',
      playerId: null,
      nickname: '',
      message: 'La partie commence : les X jouent en premier.',
      at: Date.now(),
    },
  };
}

function requireTurn(room, player) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') throw gameError(409, 'Cette partie de morpion est terminée.');
  if (!player || !state.playerOrder.includes(player.id)) throw gameError(403, 'Tu ne participes pas à cette partie.');
  if (state.currentPlayerId !== player.id) throw gameError(403, 'Ce n’est pas ton tour.');
  return state;
}

function playCell(room, player, selectedCell) {
  const state = requireTurn(room, player);
  const cell = typeof selectedCell === 'number'
    ? selectedCell
    : (typeof selectedCell === 'string' && /^\d+$/.test(selectedCell) ? Number(selectedCell) : Number.NaN);
  if (!Number.isInteger(cell) || cell < 0 || cell >= 9) throw gameError(400, 'Choisis une case du plateau.');
  if (state.board[cell] !== null) throw gameError(409, 'Cette case est déjà occupée. Choisis-en une autre.');

  state.board[cell] = player.id;
  const line = findWinningLine(state.board, player.id);
  if (line) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = player.id;
    state.winnerIds = [player.id];
    state.winningCells = line;
    state.lastAction = {
      type: 'win', playerId: player.id, nickname: player.nickname,
      message: `${player.nickname} aligne trois symboles et remporte la partie !`, at: Date.now(),
    };
    return;
  }
  if (state.board.every((occupied) => occupied !== null)) {
    state.phase = 'finished';
    state.result = 'draw';
    state.winnerId = null;
    state.winnerIds = [];
    state.lastAction = {
      type: 'draw', playerId: null, nickname: '',
      message: 'Le plateau est plein : match nul, bien joué à tous les deux !', at: Date.now(),
    };
    return;
  }

  state.currentPlayerId = nextPlayerId(state, player.id);
  const nextPlayer = room.players.find((candidate) => candidate.id === state.currentPlayerId);
  state.lastAction = {
    type: 'play', playerId: player.id, nickname: player.nickname,
    cell,
    message: `${player.nickname} a joué ${state.symbols[player.id]}. À ${nextPlayer?.nickname || 'l’autre joueur'} !`,
    at: Date.now(),
  };
}

function findImmediateMove(board, playerId) {
  for (const cell of BOT_PREFERENCE) {
    if (board[cell] !== null) continue;
    const candidate = board.slice();
    candidate[cell] = playerId;
    if (findWinningLine(candidate, playerId)) return cell;
  }
  return null;
}

function chooseBotCell(state, bot, difficulty = 'normal') {
  const emptyCells = BOT_PREFERENCE.filter((cell) => state.board[cell] === null);
  // Niveau facile : le bot joue au hasard une fois sur deux environ.
  if (botDifficulty.shouldBlunder(difficulty) && emptyCells.length) {
    return botDifficulty.pickRandom(emptyCells);
  }
  const immediateWin = findImmediateMove(state.board, bot.id);
  if (immediateWin !== null) return immediateWin;
  const opponentId = state.playerOrder.find((playerId) => playerId !== bot.id);
  // Niveau difficile : on bloque toujours, même quand on pourrait gagner plus tard.
  const block = findImmediateMove(state.board, opponentId);
  if (block !== null) return block;
  return emptyCells[0];
}

function processBots(room) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') return;
  let actions = 0;
  while (state.phase === 'playing' && actions < MAX_BOT_ACTIONS_PER_UPDATE) {
    const bot = room.players.find((player) => player.id === state.currentPlayerId && player.isBot);
    if (!bot) break;
    const cell = chooseBotCell(state, bot, room.botDifficulty);
    if (cell === undefined) break;
    playCell(room, bot, cell);
    actions += 1;
  }
}

function publicState(room, currentPlayer) {
  const state = room.gameState;
  if (!state) return null;
  const current = room.players.find((player) => player.id === state.currentPlayerId);
  const winner = state.winnerId ? room.players.find((player) => player.id === state.winnerId) : null;
  return {
    phase: state.phase,
    result: state.result,
    board: state.board.slice(),
    players: state.playerOrder.map((playerId, index) => {
      const player = room.players.find((candidate) => candidate.id === playerId);
      if (!player) return null;
      return {
        id: player.id,
        nickname: player.nickname,
        isBot: Boolean(player.isBot),
        isHost: player.id === room.hostPlayerId,
        isYou: Boolean(currentPlayer && player.id === currentPlayer.id),
        isCurrentTurn: state.phase === 'playing' && player.id === state.currentPlayerId,
        symbol: state.symbols[playerId] || (index === 0 ? 'X' : 'O'),
      };
    }).filter(Boolean),
    isMyTurn: Boolean(currentPlayer && state.phase === 'playing' && state.currentPlayerId === currentPlayer.id),
    currentPlayerName: current ? current.nickname : '',
    currentPlayerId: state.currentPlayerId,
    winnerId: state.winnerId,
    winnerName: winner ? winner.nickname : '',
    winnerIds: state.winnerIds.slice(),
    winningCells: state.winningCells.slice(),
    lastAction: state.lastAction,
  };
}

function syncPlayers(room) {
  const state = room.gameState;
  if (!state) return;
  const previousOrder = state.playerOrder.slice();
  const previousTurnIndex = Math.max(0, previousOrder.indexOf(state.currentPlayerId));
  const present = new Set(room.players.map((player) => player.id));
  state.playerOrder = previousOrder.filter((playerId) => present.has(playerId));
  if (state.phase === 'finished') return;
  if (state.playerOrder.length === 1) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = state.playerOrder[0];
    state.winnerIds = [state.winnerId];
    const winner = room.players.find((player) => player.id === state.winnerId);
    state.lastAction = {
      type: 'forfeit', playerId: state.winnerId, nickname: winner?.nickname || '',
      message: `${winner?.nickname || 'Le joueur restant'} remporte la partie par forfait.`, at: Date.now(),
    };
    return;
  }
  if (state.playerOrder.length === 0) {
    state.phase = 'finished';
    state.result = 'draw';
    state.winnerId = null;
    state.winnerIds = [];
    return;
  }
  if (!state.playerOrder.includes(state.currentPlayerId)) {
    state.currentPlayerId = state.playerOrder[previousTurnIndex % state.playerOrder.length];
  }
}

module.exports = { createGame, playCell, processBots, publicState, syncPlayers };
