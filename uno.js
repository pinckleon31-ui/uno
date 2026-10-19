'use strict';

const crypto = require('node:crypto');

const COLORS = ['red', 'yellow', 'green', 'blue'];
const MAX_BOT_ACTIONS_PER_UPDATE = 80;

function gameError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function makeCard(color, type, value = null) {
  return { id: crypto.randomUUID(), color, type, value };
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function createDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push(makeCard(color, 'number', 0));
    for (let value = 1; value <= 9; value += 1) {
      deck.push(makeCard(color, 'number', value));
      deck.push(makeCard(color, 'number', value));
    }
    for (const type of ['skip', 'reverse', 'draw2']) {
      deck.push(makeCard(color, type));
      deck.push(makeCard(color, type));
    }
  }
  for (let i = 0; i < 4; i += 1) {
    deck.push(makeCard('wild', 'wild'));
    deck.push(makeCard('wild', 'wild4'));
  }
  return shuffle(deck);
}

function createGame(players) {
  if (!Array.isArray(players) || players.length < 2) {
    throw gameError(400, 'Il faut au moins deux joueurs pour lancer UNO.');
  }

  const deck = createDeck();
  const playerOrder = players.map((player) => player.id);
  const hands = Object.create(null);
  for (const playerId of playerOrder) {
    hands[playerId] = [];
    for (let card = 0; card < 7; card += 1) hands[playerId].push(deck.pop());
  }

  const returnedCards = [];
  let firstCard = null;
  while (deck.length && !firstCard) {
    const card = deck.pop();
    if (card.type === 'number') firstCard = card;
    else returnedCards.push(card);
  }
  deck.push(...returnedCards);
  shuffle(deck);

  if (!firstCard) throw gameError(500, 'Impossible de préparer le paquet UNO.');
  return {
    phase: 'playing',
    result: null,
    deck,
    discardPile: [firstCard],
    playerOrder,
    hands,
    currentPlayerId: playerOrder[0],
    direction: 1,
    currentColor: firstCard.color,
    drawnCardId: null,
    winnerId: null,
    startedAt: Date.now(),
    lastAction: {
      type: 'start',
      playerId: null,
      nickname: '',
      message: 'La partie commence : à toi de jouer !',
      at: Date.now(),
    },
  };
}

function nextPlayerId(state, playerId, steps = 1) {
  const order = state.playerOrder;
  if (!order.length) return null;
  const startIndex = order.indexOf(playerId);
  let index = startIndex < 0 ? 0 : startIndex;
  for (let step = 0; step < steps; step += 1) {
    index = (index + state.direction + order.length) % order.length;
  }
  return order[index];
}

function canPlayCard(card, hand, state) {
  if (card.type === 'wild') return true;
  if (card.type === 'wild4') {
    return !hand.some((other) => other.id !== card.id && other.color === state.currentColor);
  }
  if (card.color === state.currentColor) return true;
  const topCard = state.discardPile[state.discardPile.length - 1];
  if (!topCard) return false;
  if (card.type !== topCard.type) return false;
  return card.type !== 'number' || card.value === topCard.value;
}

function recycleDrawPile(state) {
  if (state.deck.length > 0 || state.discardPile.length <= 1) return;
  const topCard = state.discardPile.pop();
  const recycled = state.discardPile.splice(0);
  state.discardPile.push(topCard);
  shuffle(recycled);
  state.deck.push(...recycled);
}

function drawFromDeck(state) {
  recycleDrawPile(state);
  return state.deck.pop() || null;
}

function requirePlayingTurn(room, player) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') {
    throw gameError(409, 'Cette manche UNO n’est pas en cours.');
  }
  if (!player || state.currentPlayerId !== player.id) {
    throw gameError(403, 'Ce n’est pas ton tour.');
  }
  return state;
}

function actionRecord(type, player, message, card = null) {
  return {
    type,
    playerId: player ? player.id : null,
    nickname: player ? player.nickname : '',
    message,
    card: card ? { color: card.color, type: card.type, value: card.value } : null,
    at: Date.now(),
  };
}

function playCard(room, player, cardId, selectedColor = '') {
  const state = requirePlayingTurn(room, player);
  const hand = state.hands[player.id] || [];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) throw gameError(404, 'Cette carte n’est plus dans ta main.');
  const card = hand[cardIndex];

  if (state.drawnCardId && state.drawnCardId !== card.id) {
    throw gameError(400, 'Après avoir pioché, tu peux jouer uniquement la carte que tu viens de piocher.');
  }
  if (!canPlayCard(card, hand, state)) {
    throw gameError(400, 'Cette carte ne peut pas être jouée sur la carte actuelle.');
  }
  if ((card.type === 'wild' || card.type === 'wild4') && !COLORS.includes(selectedColor)) {
    throw gameError(400, 'Choisis une couleur pour jouer cette carte.');
  }

  hand.splice(cardIndex, 1);
  state.discardPile.push(card);
  state.currentColor = card.type === 'wild' || card.type === 'wild4' ? selectedColor : card.color;
  state.drawnCardId = null;

  if (hand.length === 0) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = player.id;
    state.currentPlayerId = null;
    state.lastAction = actionRecord('win', player, `${player.nickname} a gagné la manche !`, card);
    return;
  }

  let steps = 1;
  let message = `${player.nickname} joue ${card.type === 'number' ? card.value : card.type === 'draw2' ? '+2' : card.type === 'wild4' ? '+4' : card.type}.`;
  if (hand.length === 1) message = `${player.nickname} joue une carte et dit UNO !`;

  if (card.type === 'skip') {
    steps = 2;
    message = `${player.nickname} passe le tour suivant.`;
  } else if (card.type === 'reverse') {
    state.direction *= -1;
    steps = state.playerOrder.length === 2 ? 2 : 1;
    message = `${player.nickname} inverse le sens du jeu.`;
  } else if (card.type === 'draw2' || card.type === 'wild4') {
    const penalty = card.type === 'draw2' ? 2 : 4;
    const nextId = nextPlayerId(state, player.id, 1);
    const nextHand = state.hands[nextId] || [];
    for (let i = 0; i < penalty; i += 1) {
      const drawn = drawFromDeck(state);
      if (drawn) nextHand.push(drawn);
    }
    state.hands[nextId] = nextHand;
    steps = 2;
    message = `${player.nickname} joue ${card.type === 'draw2' ? '+2' : '+4'} : ${room.players.find((candidate) => candidate.id === nextId)?.nickname || 'Le joueur suivant'} pioche ${penalty} cartes.`;
  } else if (card.type === 'wild') {
    message = `${player.nickname} change la couleur pour ${selectedColor}.`;
  }

  state.currentPlayerId = nextPlayerId(state, player.id, steps);
  state.lastAction = actionRecord('play', player, message, card);
}

function drawForPlayer(room, player) {
  const state = requirePlayingTurn(room, player);
  if (state.drawnCardId) {
    throw gameError(400, 'Tu as déjà pioché. Joue la carte piochée ou passe ton tour.');
  }

  const card = drawFromDeck(state);
  if (!card) {
    state.currentPlayerId = nextPlayerId(state, player.id);
    state.lastAction = actionRecord('draw', player, `${player.nickname} passe : il n’y a plus de cartes à piocher.`);
    return;
  }

  const hand = state.hands[player.id] || [];
  hand.push(card);
  state.hands[player.id] = hand;
  if (canPlayCard(card, hand, state)) {
    state.drawnCardId = card.id;
    state.lastAction = actionRecord('draw', player, `${player.nickname} pioche une carte jouable.`, card);
  } else {
    state.currentPlayerId = nextPlayerId(state, player.id);
    state.lastAction = actionRecord('draw', player, `${player.nickname} pioche et passe son tour.`, card);
  }
}

function passTurn(room, player) {
  const state = requirePlayingTurn(room, player);
  if (!state.drawnCardId) throw gameError(400, 'Pioche une carte avant de passer ton tour.');
  state.drawnCardId = null;
  state.currentPlayerId = nextPlayerId(state, player.id);
  state.lastAction = actionRecord('pass', player, `${player.nickname} passe son tour.`);
}

function botColor(hand) {
  const counts = Object.fromEntries(COLORS.map((color) => [color, 0]));
  for (const card of hand) {
    if (COLORS.includes(card.color)) counts[card.color] += 1;
  }
  return COLORS.reduce((best, color) => counts[color] > counts[best] ? color : best, COLORS[0]);
}

function botCard(hand, state) {
  const playable = hand.filter((card) => canPlayCard(card, hand, state));
  if (!playable.length) return null;
  const rank = { draw2: 5, skip: 4, reverse: 3, number: 2, wild: 1, wild4: 0 };
  playable.sort((a, b) => rank[b.type] - rank[a.type]);
  return playable[0];
}

function processBots(room) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') return;

  let actions = 0;
  while (state.phase === 'playing' && actions < MAX_BOT_ACTIONS_PER_UPDATE) {
    const player = room.players.find((candidate) => candidate.id === state.currentPlayerId);
    if (!player || !player.isBot) break;

    const hand = state.hands[player.id] || [];
    const playable = botCard(hand, state);
    if (playable) {
      const color = playable.type === 'wild' || playable.type === 'wild4' ? botColor(hand) : '';
      playCard(room, player, playable.id, color);
    } else {
      drawForPlayer(room, player);
      if (state.phase === 'playing' && state.currentPlayerId === player.id && state.drawnCardId) {
        const drawnId = state.drawnCardId;
        const drawnCard = (state.hands[player.id] || []).find((card) => card.id === drawnId);
        const color = drawnCard && (drawnCard.type === 'wild' || drawnCard.type === 'wild4')
          ? botColor(state.hands[player.id])
          : '';
        if (drawnCard) playCard(room, player, drawnId, color);
      }
    }
    actions += 1;
  }
}

function publicState(room, currentPlayer) {
  const state = room.gameState;
  if (!state) return null;
  const currentPlayerId = state.currentPlayerId;
  const isMyTurn = Boolean(currentPlayer && currentPlayer.id === currentPlayerId && state.phase === 'playing');
  const myHand = currentPlayer ? (state.hands[currentPlayer.id] || []) : [];
  const drawnCardId = isMyTurn ? state.drawnCardId : null;
  const winner = state.winnerId ? room.players.find((player) => player.id === state.winnerId) : null;

  return {
    phase: state.phase,
    result: state.result || (state.winnerId ? 'win' : (state.phase === 'finished' ? 'draw' : null)),
    startedAt: state.startedAt,
    currentPlayerId,
    currentPlayerName: room.players.find((player) => player.id === currentPlayerId)?.nickname || null,
    currentColor: state.currentColor,
    topCard: state.discardPile[state.discardPile.length - 1] || null,
    deckCount: state.deck.length,
    direction: state.direction,
    drawnCardId,
    isMyTurn,
    winnerId: state.winnerId,
    winnerName: winner ? winner.nickname : null,
    lastAction: state.lastAction,
    players: state.playerOrder
      .map((playerId) => room.players.find((player) => player.id === playerId))
      .filter(Boolean)
      .map((player) => ({
        id: player.id,
        nickname: player.nickname,
        isBot: Boolean(player.isBot),
        isHost: player.id === room.hostPlayerId,
        isYou: Boolean(currentPlayer && currentPlayer.id === player.id),
        isCurrentTurn: player.id === currentPlayerId,
        cardCount: (state.hands[player.id] || []).length,
      })),
    myHand: myHand.map((card) => ({
      ...card,
      playable: isMyTurn && (!drawnCardId || drawnCardId === card.id) && canPlayCard(card, myHand, state),
    })),
  };
}

function cheatCard(card) {
  const colorNames = { red: 'Rouge', yellow: 'Jaune', green: 'Vert', blue: 'Bleu' };
  const actionNames = { skip: 'Passe-tour', reverse: 'Inversion', draw2: '+2' };
  let label;
  if (card.type === 'number') label = `${colorNames[card.color] || 'Couleur'} ${card.value}`;
  else if (card.type === 'wild') label = 'Joker multicolore';
  else if (card.type === 'wild4') label = 'Joker +4';
  else label = `${colorNames[card.color] || 'Couleur'} ${actionNames[card.type] || card.type}`;
  return { id: card.id, color: card.color, type: card.type, value: card.value, label };
}

function cheatState(room) {
  const state = room.gameState;
  if (!state) return null;
  const deck = state.deck.map(cheatCard).sort((a, b) => a.label.localeCompare(b.label, 'fr-FR'));
  return {
    game: 'uno',
    phase: state.phase,
    deckCount: state.deck.length,
    nextDraw: state.deck.length ? cheatCard(state.deck[state.deck.length - 1]) : null,
    discardTop: state.discardPile.length ? cheatCard(state.discardPile[state.discardPile.length - 1]) : null,
    currentPlayerId: state.currentPlayerId,
    currentPlayerName: room.players.find((player) => player.id === state.currentPlayerId)?.nickname || null,
    players: state.playerOrder
      .map((playerId) => {
        const player = room.players.find((candidate) => candidate.id === playerId);
        return player ? {
          id: player.id,
          nickname: player.nickname,
          isBot: Boolean(player.isBot),
          hand: (state.hands[playerId] || []).map(cheatCard),
        } : null;
      })
      .filter(Boolean),
    deck,
  };
}

function cheatForceNextDraw(room, cardId) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') throw gameError(409, 'La pioche ne peut être modifiée que pendant une manche UNO en cours.');
  const index = state.deck.findIndex((card) => card.id === cardId);
  if (index < 0) throw gameError(404, 'Cette carte n’est plus dans la pioche. Actualise les outils secrets.');
  const [card] = state.deck.splice(index, 1);
  state.deck.push(card);
  return cheatCard(card);
}

function cheatGiveCard(room, cardId, targetPlayerId) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') throw gameError(409, 'Les cartes ne peuvent être données que pendant une manche UNO en cours.');
  const player = room.players.find((candidate) => candidate.id === targetPlayerId && state.playerOrder.includes(candidate.id));
  if (!player) throw gameError(404, 'Ce joueur n’est plus dans la partie.');
  const index = state.deck.findIndex((card) => card.id === cardId);
  if (index < 0) throw gameError(404, 'Cette carte n’est plus dans la pioche. Actualise les outils secrets.');
  const [card] = state.deck.splice(index, 1);
  const hand = state.hands[player.id] || [];
  hand.push(card);
  state.hands[player.id] = hand;
  return { playerId: player.id, nickname: player.nickname, card: cheatCard(card) };
}

function syncPlayers(room) {
  const state = room.gameState;
  if (!state) return;
  const oldOrder = state.playerOrder.slice();
  const oldCurrent = state.currentPlayerId;
  const present = new Set(room.players.map((player) => player.id));
  state.playerOrder = oldOrder.filter((playerId) => present.has(playerId));
  for (const playerId of oldOrder) {
    if (!present.has(playerId)) delete state.hands[playerId];
  }

  if (state.phase !== 'playing') return;
  if (state.playerOrder.length === 0) {
    state.phase = 'finished';
    state.result = 'draw';
    state.currentPlayerId = null;
    state.drawnCardId = null;
    state.lastAction = { type: 'leave', playerId: null, nickname: '', message: 'La partie est terminée.', at: Date.now() };
    return;
  }
  if (state.playerOrder.length === 1) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerId = state.playerOrder[0];
    state.currentPlayerId = null;
    state.drawnCardId = null;
    const winner = room.players.find((player) => player.id === state.winnerId);
    state.lastAction = actionRecord('win', winner, `${winner ? winner.nickname : 'Un joueur'} remporte la partie : il n’y a plus d’adversaires.`);
    return;
  }
  if (!state.playerOrder.includes(oldCurrent)) {
    const oldIndex = Math.max(0, oldOrder.indexOf(oldCurrent));
    let next = state.playerOrder[0];
    for (let step = 1; step <= oldOrder.length; step += 1) {
      const index = ((oldIndex + state.direction * step) % oldOrder.length + oldOrder.length) % oldOrder.length;
      if (present.has(oldOrder[index])) {
        next = oldOrder[index];
        break;
      }
    }
    state.currentPlayerId = next;
    state.drawnCardId = null;
    state.lastAction = { type: 'leave', playerId: null, nickname: '', message: 'Un joueur a quitté la partie : le tour continue.', at: Date.now() };
  }
}

module.exports = {
  COLORS,
  createGame,
  cheatForceNextDraw,
  cheatGiveCard,
  cheatState,
  drawForPlayer,
  passTurn,
  playCard,
  processBots,
  publicState,
  syncPlayers,
};
