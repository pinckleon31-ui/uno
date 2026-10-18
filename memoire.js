'use strict';

const crypto = require('node:crypto');

const PAIR_COUNT = 8;
const MAX_BOT_ACTIONS_PER_UPDATE = 100;
const MEMORY_SYMBOLS = Object.freeze(['🍎', '🚀', '🐙', '🎲', '🌈', '🦕', '🎈', '⭐', '🧩', '🍉', '🐝', '🪐']);

function gameError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function shuffle(values) {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = crypto.randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function nextPlayerId(state, playerId) {
  const index = state.playerOrder.indexOf(playerId);
  if (index < 0 || state.playerOrder.length < 2) return null;
  return state.playerOrder[(index + 1) % state.playerOrder.length];
}

function actionRecord(type, player, message, cardIds = []) {
  return {
    type,
    playerId: player ? player.id : null,
    nickname: player ? player.nickname : '',
    cardIds: cardIds.slice(),
    message,
    at: Date.now(),
  };
}

function createGame(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
    throw gameError(400, 'Il faut entre deux et quatre joueurs pour lancer une partie de mémoire.');
  }
  const symbols = shuffle(MEMORY_SYMBOLS).slice(0, PAIR_COUNT);
  const cards = shuffle(symbols.flatMap((symbol, pairId) => [
    { id: crypto.randomUUID(), pairId, symbol },
    { id: crypto.randomUUID(), pairId, symbol },
  ]));
  const playerOrder = players.map((player) => player.id);
  return {
    phase: 'playing',
    result: null,
    cards,
    playerOrder,
    currentPlayerId: playerOrder[0],
    matchedCardIds: [],
    revealedCardIds: [],
    scores: Object.fromEntries(playerOrder.map((playerId) => [playerId, 0])),
    botMemory: Object.fromEntries(players.filter((player) => player.isBot).map((player) => [player.id, {}])),
    winnerId: null,
    winnerIds: [],
    startedAt: Date.now(),
    lastAction: actionRecord('start', null, 'Le jeu commence : retourne deux cartes et retrouve les paires !'),
  };
}

function isCardAvailable(state, card) {
  return !state.matchedCardIds.includes(card.id) && !state.revealedCardIds.includes(card.id);
}

function rememberVisibleCards(state) {
  const exposedIds = new Set([...state.matchedCardIds, ...state.revealedCardIds]);
  for (const memory of Object.values(state.botMemory || {})) {
    for (const cardId of exposedIds) {
      const card = state.cards.find((candidate) => candidate.id === cardId);
      if (card) memory[card.id] = card.pairId;
    }
  }
}

function finishGame(state, result, winnerIds, message) {
  state.phase = 'finished';
  state.result = result;
  state.winnerIds = winnerIds.slice();
  state.winnerId = winnerIds.length === 1 ? winnerIds[0] : null;
  state.lastAction = actionRecord('finished', null, message);
}

function flipCard(room, player, cardId) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') throw gameError(409, 'Attends la fin de ce tour avant de retourner une carte.');
  if (!player || !state.playerOrder.includes(player.id)) throw gameError(403, 'Tu ne participes pas à cette partie.');
  if (state.currentPlayerId !== player.id) throw gameError(403, 'Ce n’est pas ton tour.');
  if (state.revealedCardIds.length >= 2) throw gameError(409, 'Retourne les cartes différentes pour passer ton tour.');
  const card = state.cards.find((candidate) => candidate.id === cardId);
  if (!card || !isCardAvailable(state, card)) throw gameError(400, 'Cette carte est déjà retournée. Choisis-en une autre.');

  state.revealedCardIds.push(card.id);
  rememberVisibleCards(state);
  if (state.revealedCardIds.length === 1) {
    state.lastAction = actionRecord('flip', player, `${player.nickname} retourne une carte…`, state.revealedCardIds);
    return;
  }

  const first = state.cards.find((candidate) => candidate.id === state.revealedCardIds[0]);
  if (first.pairId === card.pairId) {
    const foundIds = state.revealedCardIds.slice();
    state.matchedCardIds.push(...foundIds);
    state.revealedCardIds = [];
    state.scores[player.id] = (Number(state.scores[player.id]) || 0) + 1;
    rememberVisibleCards(state);
    const pairsFound = state.matchedCardIds.length / 2;
    if (pairsFound === state.cards.length / 2) {
      const highestScore = Math.max(0, ...state.playerOrder.map((playerId) => state.scores[playerId] || 0));
      const winnerIds = state.playerOrder.filter((playerId) => state.scores[playerId] === highestScore);
      finishGame(
        state,
        winnerIds.length === 1 ? 'win' : 'draw',
        winnerIds,
        winnerIds.length === 1
          ? `${player.nickname} remporte la partie avec ${highestScore} paires !`
          : `La partie se termine à égalité avec ${highestScore} paires par personne.`,
      );
      return;
    }
    state.lastAction = actionRecord('match', player, `Bien joué ${player.nickname} ! Une paire trouvée : tu rejoues.`, foundIds);
    return;
  }

  state.phase = 'mismatch';
  state.lastAction = actionRecord('miss', player, 'Ce ne sont pas les mêmes cartes. Observe-les puis passe ton tour.', state.revealedCardIds);
}

function continueAfterMismatch(room, player) {
  const state = room.gameState;
  if (!state || state.phase !== 'mismatch') throw gameError(409, 'Il n’y a pas de paire à retourner pour le moment.');
  if (!player || !state.playerOrder.includes(player.id)) throw gameError(403, 'Tu ne participes pas à cette partie.');
  if (state.currentPlayerId !== player.id) throw gameError(403, 'Seul le joueur actif peut passer son tour.');
  const previousPlayer = player.nickname;
  state.revealedCardIds = [];
  state.currentPlayerId = nextPlayerId(state, player.id);
  state.phase = 'playing';
  const nextPlayer = room.players.find((candidate) => candidate.id === state.currentPlayerId);
  state.lastAction = actionRecord('turn', player, `${previousPlayer} passe son tour. À ${nextPlayer?.nickname || 'au joueur suivant'} !`);
}

function chooseBotCard(state, bot) {
  const available = state.cards.filter((card) => isCardAvailable(state, card));
  if (!available.length) return null;
  const known = state.botMemory?.[bot.id] || {};
  const visiblePair = state.revealedCardIds.length === 1
    ? state.cards.find((card) => card.id === state.revealedCardIds[0])?.pairId
    : null;

  if (visiblePair !== null && visiblePair !== undefined) {
    const match = available.find((card) => card.pairId === visiblePair && known[card.id] === visiblePair);
    if (match) return match;
  }

  const knownPairs = new Map();
  for (const [cardId, pairId] of Object.entries(known)) {
    const card = available.find((candidate) => candidate.id === cardId);
    if (!card) continue;
    if (!knownPairs.has(pairId)) knownPairs.set(pairId, []);
    knownPairs.get(pairId).push(card);
  }
  const completedPair = Array.from(knownPairs.values()).find((pair) => pair.length >= 2);
  if (completedPair) return completedPair[crypto.randomInt(completedPair.length)];
  const knownCard = available.find((card) => Object.hasOwn(known, card.id));
  if (knownCard) return knownCard;
  return available[crypto.randomInt(available.length)];
}

function processBots(room) {
  const state = room.gameState;
  if (!state || state.phase === 'finished') return;
  let actions = 0;
  while (state.phase !== 'finished' && actions < MAX_BOT_ACTIONS_PER_UPDATE) {
    const bot = room.players.find((player) => player.id === state.currentPlayerId && player.isBot);
    if (!bot) break;
    if (state.phase === 'mismatch') {
      continueAfterMismatch(room, bot);
      actions += 1;
      continue;
    }
    const card = chooseBotCard(state, bot);
    if (!card) break;
    flipCard(room, bot, card.id);
    actions += 1;
  }
}

function publicState(room, currentPlayer) {
  const state = room.gameState;
  if (!state) return null;
  const currentPlayerInfo = room.players.find((player) => player.id === state.currentPlayerId);
  const matchedIds = new Set(state.matchedCardIds);
  const revealedIds = new Set(state.revealedCardIds);
  const board = state.cards.map((card) => {
    const isMatched = matchedIds.has(card.id);
    const isRevealed = isMatched || revealedIds.has(card.id);
    return {
      id: card.id,
      symbol: isRevealed ? card.symbol : null,
      isMatched,
      isRevealed,
    };
  });
  const scores = state.playerOrder.map((playerId) => {
    const player = room.players.find((candidate) => candidate.id === playerId);
    if (!player) return null;
    return {
      id: player.id,
      nickname: player.nickname,
      score: Number(state.scores[player.id]) || 0,
      isBot: Boolean(player.isBot),
      isHost: player.id === room.hostPlayerId,
      isYou: Boolean(currentPlayer && player.id === currentPlayer.id),
      isCurrentTurn: state.phase !== 'finished' && player.id === state.currentPlayerId,
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'fr-FR'));
  const winnerNames = state.winnerIds.map((playerId) => room.players.find((player) => player.id === playerId)?.nickname).filter(Boolean);
  return {
    phase: state.phase,
    result: state.result,
    board,
    players: state.playerOrder.map((playerId) => {
      const player = room.players.find((candidate) => candidate.id === playerId);
      if (!player) return null;
      return {
        id: player.id,
        nickname: player.nickname,
        isBot: Boolean(player.isBot),
        isHost: player.id === room.hostPlayerId,
        isYou: Boolean(currentPlayer && player.id === currentPlayer.id),
        isCurrentTurn: state.phase !== 'finished' && player.id === state.currentPlayerId,
        score: Number(state.scores[player.id]) || 0,
      };
    }).filter(Boolean),
    scores,
    currentPlayerId: state.currentPlayerId,
    currentPlayerName: currentPlayerInfo ? currentPlayerInfo.nickname : '',
    isMyTurn: Boolean(currentPlayer && state.phase !== 'finished' && state.currentPlayerId === currentPlayer.id),
    canFlip: Boolean(currentPlayer && state.phase === 'playing' && state.currentPlayerId === currentPlayer.id && state.revealedCardIds.length < 2),
    canContinue: Boolean(currentPlayer && state.phase === 'mismatch' && state.currentPlayerId === currentPlayer.id),
    revealedCount: state.revealedCardIds.length,
    matchedPairs: state.matchedCardIds.length / 2,
    totalPairs: state.cards.length / 2,
    winnerId: state.winnerId,
    winnerIds: state.winnerIds.slice(),
    winnerNames,
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
  for (const playerId of previousOrder) {
    if (!present.has(playerId)) {
      delete state.scores[playerId];
      delete state.botMemory[playerId];
    }
  }
  if (state.phase === 'finished') return;
  if (state.playerOrder.length === 1) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = state.playerOrder[0];
    state.winnerIds = [state.winnerId];
    const winner = room.players.find((player) => player.id === state.winnerId);
    state.lastAction = actionRecord('forfeit', winner, `${winner?.nickname || 'Le joueur restant'} remporte la partie par forfait.`);
    return;
  }
  if (state.playerOrder.length === 0) {
    finishGame(state, 'draw', [], 'La partie se termine sans vainqueur.');
    return;
  }
  if (!state.playerOrder.includes(state.currentPlayerId)) {
    state.currentPlayerId = state.playerOrder[previousTurnIndex % state.playerOrder.length];
    state.revealedCardIds = [];
    state.phase = 'playing';
    state.lastAction = actionRecord('turn', null, 'Un joueur a quitté la partie. Le jeu continue.');
  }
}

module.exports = { createGame, flipCard, continueAfterMismatch, processBots, publicState, syncPlayers };
