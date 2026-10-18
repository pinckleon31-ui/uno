'use strict';

const crypto = require('node:crypto');

const QUESTION_COUNT = 8;
const BOT_ACTIONS_PER_UPDATE = 20;

const QUIZ_QUESTIONS = [
  { prompt: 'Quelle planète est surnommée la planète rouge ?', choices: ['Mars', 'Vénus', 'Jupiter', 'Mercure'], correct: 0, explanation: 'La poussière riche en fer donne à Mars sa couleur rouge.' },
  { prompt: 'Combien font 8 × 7 ?', choices: ['54', '56', '64', '48'], correct: 1, explanation: '8 multiplié par 7 font 56.' },
  { prompt: 'Quelle est la capitale de la France ?', choices: ['Lyon', 'Marseille', 'Paris', 'Lille'], correct: 2, explanation: 'Paris est la capitale de la France.' },
  { prompt: 'Quel est le symbole chimique de l’eau ?', choices: ['CO₂', 'O₂', 'H₂O', 'NaCl'], correct: 2, explanation: 'Une molécule d’eau contient deux atomes d’hydrogène et un atome d’oxygène.' },
  { prompt: 'Quel est le plus grand animal vivant ?', choices: ['L’éléphant d’Afrique', 'Le requin blanc', 'La girafe', 'La baleine bleue'], correct: 3, explanation: 'La baleine bleue est le plus grand animal connu.' },
  { prompt: 'Combien de côtés possède un hexagone ?', choices: ['5', '6', '7', '8'], correct: 1, explanation: 'Le préfixe « hexa- » signifie six.' },
  { prompt: 'Quel organe fait circuler le sang dans le corps ?', choices: ['Le cœur', 'Le foie', 'Le poumon', 'L’estomac'], correct: 0, explanation: 'Le cœur agit comme une pompe pour faire circuler le sang.' },
  { prompt: 'Combien de secondes y a-t-il dans une minute ?', choices: ['30', '50', '60', '100'], correct: 2, explanation: 'Une minute contient 60 secondes.' },
  { prompt: 'Sur quel continent se trouve le désert du Sahara ?', choices: ['Asie', 'Afrique', 'Amérique du Sud', 'Europe'], correct: 1, explanation: 'Le Sahara se trouve en Afrique du Nord.' },
  { prompt: 'Quel gaz les plantes absorbent-elles principalement pour la photosynthèse ?', choices: ['Dioxyde de carbone', 'Hélium', 'Oxygène', 'Azote'], correct: 0, explanation: 'Les plantes utilisent le dioxyde de carbone, l’eau et la lumière.' },
];

const BLIND_TEST_TRACKS = [
  { title: 'La fusée en papier', notes: [60, 64, 67, 72, 67, 64, 62, 67] },
  { title: 'Le robot qui danse', notes: [64, 64, 67, 64, 69, 67, 62, 64] },
  { title: 'La balade du phare', notes: [55, 60, 64, 62, 60, 57, 59, 55] },
  { title: 'Le chat de minuit', notes: [72, 69, 67, 64, 67, 69, 72, 76] },
  { title: 'Course dans les étoiles', notes: [60, 67, 72, 74, 72, 67, 64, 60] },
  { title: 'Le train des vacances', notes: [57, 57, 60, 62, 64, 64, 62, 60] },
  { title: 'La danse des lucioles', notes: [67, 71, 74, 79, 76, 74, 71, 67] },
  { title: 'Le petit cirque', notes: [60, 63, 67, 69, 67, 63, 60, 55] },
  { title: 'Le réveil du dragon', notes: [48, 55, 60, 63, 60, 58, 55, 51] },
  { title: 'La promenade du dimanche', notes: [62, 65, 69, 67, 65, 62, 60, 62] },
];

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

function questionsFor(kind) {
  if (kind === 'quiz') {
    return QUIZ_QUESTIONS.map((question) => ({ ...question }));
  }
  if (kind === 'blind-test') {
    return BLIND_TEST_TRACKS.map((track) => ({
      prompt: 'Écoute ce thème original puis retrouve son titre.',
      notes: track.notes.slice(),
      choices: BLIND_TEST_TRACKS.map((candidate) => candidate.title),
      correct: BLIND_TEST_TRACKS.findIndex((candidate) => candidate.title === track.title),
      explanation: `Le thème entendu s’appelle « ${track.title} »; il a été créé spécialement pour ce jeu.`,
    }));
  }
  throw gameError(400, 'Ce jeu de questions n’existe pas.');
}

function prepareQuestion(question) {
  const options = question.choices.map((text, index) => ({
    text,
    isCorrect: index === question.correct,
  }));
  const shuffled = shuffle(options);
  return {
    prompt: question.prompt,
    notes: question.notes || null,
    choices: shuffled.map((option) => option.text),
    correctIndex: shuffled.findIndex((option) => option.isCorrect),
    explanation: question.explanation,
  };
}

function createGame(players, kind) {
  if (!Array.isArray(players) || players.length < 2) {
    throw gameError(400, 'Il faut au moins deux joueurs pour lancer ce jeu.');
  }
  const source = shuffle(questionsFor(kind)).slice(0, QUESTION_COUNT);
  const playerOrder = players.map((player) => player.id);
  const questions = shuffle(source).map(prepareQuestion);
  return {
    phase: 'playing',
    result: null,
    kind,
    questions,
    questionIndex: 0,
    playerOrder,
    scores: Object.fromEntries(playerOrder.map((playerId) => [playerId, 0])),
    answers: {},
    roundResult: null,
    winnerId: null,
    winnerIds: [],
    startedAt: Date.now(),
    lastAction: {
      type: 'start',
      playerId: null,
      nickname: '',
      message: kind === 'blind-test'
        ? 'Le blind test commence : écoutez le premier thème !'
        : 'Le quiz commence : bonne chance !',
      at: Date.now(),
    },
  };
}

function currentQuestion(state) {
  return state.questions[state.questionIndex] || null;
}

function resolveRound(room) {
  const state = room.gameState;
  const question = currentQuestion(state);
  if (!question || state.phase !== 'playing') return;
  const resultRows = state.playerOrder.map((playerId) => {
    const answer = state.answers[playerId];
    const player = room.players.find((candidate) => candidate.id === playerId);
    const correct = Boolean(answer && answer.choiceIndex === question.correctIndex);
    const points = correct ? 1 : 0;
    state.scores[playerId] = (Number(state.scores[playerId]) || 0) + points;
    return {
      playerId,
      nickname: player ? player.nickname : 'Joueur',
      choiceIndex: answer ? answer.choiceIndex : null,
      correct,
      points,
    };
  });
  state.roundResult = {
    questionIndex: state.questionIndex,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    results: resultRows,
  };
  const isFinalQuestion = state.questionIndex >= state.questions.length - 1;
  if (isFinalQuestion) {
    const highestScore = Math.max(0, ...state.playerOrder.map((playerId) => state.scores[playerId] || 0));
    state.winnerIds = state.playerOrder.filter((playerId) => state.scores[playerId] === highestScore);
    state.winnerId = state.winnerIds.length === 1 ? state.winnerIds[0] : null;
    state.phase = 'finished';
    state.result = state.winnerIds.length === 1 ? 'win' : 'draw';
    state.lastAction = {
      type: 'finished',
      playerId: null,
      nickname: '',
      message: state.result === 'win' ? 'Le quiz est terminé : un champion se détache !' : 'Le quiz est terminé : égalité au sommet !',
      at: Date.now(),
    };
  } else {
    state.phase = 'reveal';
    state.lastAction = {
      type: 'reveal',
      playerId: null,
      nickname: '',
      message: 'Réponse révélée ! Comparez les scores avant la prochaine question.',
      at: Date.now(),
    };
  }
}

function answerQuestion(room, player, choiceIndex) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') {
    throw gameError(409, 'La question n’est pas ouverte aux réponses.');
  }
  if (!player || !state.playerOrder.includes(player.id)) {
    throw gameError(403, 'Tu ne participes pas à cette partie.');
  }
  if (Object.hasOwn(state.answers, player.id)) {
    throw gameError(409, 'Ta réponse est déjà enregistrée.');
  }
  const question = currentQuestion(state);
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= question.choices.length) {
    throw gameError(400, 'Choisis une des réponses proposées.');
  }
  state.answers[player.id] = { choiceIndex, answeredAt: Date.now() };
  state.lastAction = {
    type: 'answer',
    playerId: player.id,
    nickname: player.nickname,
    message: `${player.nickname} a répondu.`,
    at: Date.now(),
  };
  if (state.playerOrder.every((playerId) => Object.hasOwn(state.answers, playerId))) {
    resolveRound(room);
  }
}

function advanceQuestion(room, player) {
  const state = room.gameState;
  if (!state || state.phase !== 'reveal') {
    throw gameError(409, 'Attends que les réponses soient révélées avant de continuer.');
  }
  if (!player || player.id !== room.hostPlayerId) {
    throw gameError(403, 'Seul l’organisateur peut lancer la question suivante.');
  }
  state.questionIndex += 1;
  state.answers = {};
  state.roundResult = null;
  state.phase = 'playing';
  state.lastAction = {
    type: 'question',
    playerId: player.id,
    nickname: player.nickname,
    message: `${player.nickname} lance la question ${state.questionIndex + 1}.`,
    at: Date.now(),
  };
}

function processBots(room) {
  const state = room.gameState;
  if (!state || state.phase !== 'playing') return;
  let actions = 0;
  while (state.phase === 'playing' && actions < BOT_ACTIONS_PER_UPDATE) {
    const bot = state.playerOrder
      .map((playerId) => room.players.find((player) => player.id === playerId))
      .find((player) => player && player.isBot && !Object.hasOwn(state.answers, player.id));
    if (!bot) break;
    const question = currentQuestion(state);
    let choiceIndex;
    const botKnowsAnswer = crypto.randomInt(100) < (state.kind === 'blind-test' ? 42 : 62);
    if (botKnowsAnswer) {
      choiceIndex = question.correctIndex;
    } else {
      const wrongChoices = question.choices.map((_, index) => index).filter((index) => index !== question.correctIndex);
      choiceIndex = wrongChoices[crypto.randomInt(wrongChoices.length)];
    }
    answerQuestion(room, bot, choiceIndex);
    actions += 1;
  }
}

function publicState(room, currentPlayer) {
  const state = room.gameState;
  if (!state) return null;
  const question = currentQuestion(state);
  const ownAnswer = currentPlayer && state.answers[currentPlayer.id];
  const roundIsRevealed = state.phase === 'reveal' || state.phase === 'finished';
  const scores = state.playerOrder
    .map((playerId) => {
      const player = room.players.find((candidate) => candidate.id === playerId);
      if (!player) return null;
      return {
        id: player.id,
        nickname: player.nickname,
        score: Number(state.scores[playerId]) || 0,
        isBot: Boolean(player.isBot),
        isYou: Boolean(currentPlayer && currentPlayer.id === player.id),
        isHost: player.id === room.hostPlayerId,
        answered: Object.hasOwn(state.answers, playerId),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'fr-FR'));
  const winnerNames = (state.winnerIds || [])
    .map((playerId) => room.players.find((player) => player.id === playerId)?.nickname)
    .filter(Boolean);
  return {
    phase: state.phase,
    kind: state.kind,
    startedAt: state.startedAt,
    questionNumber: state.questionIndex + 1,
    totalQuestions: state.questions.length,
    question: question ? {
      prompt: question.prompt,
      choices: question.choices.slice(),
      notes: state.kind === 'blind-test' ? question.notes.slice() : null,
      correctIndex: roundIsRevealed ? question.correctIndex : null,
      explanation: roundIsRevealed ? question.explanation : '',
    } : null,
    isMyTurn: Boolean(currentPlayer && state.phase === 'playing' && !ownAnswer),
    hasAnswered: Boolean(ownAnswer),
    myChoiceIndex: ownAnswer ? ownAnswer.choiceIndex : null,
    answeredCount: Object.keys(state.answers).length,
    totalPlayers: state.playerOrder.length,
    scores,
    roundResult: state.roundResult,
    result: state.result,
    winnerId: state.winnerId,
    winnerIds: state.winnerIds.slice(),
    winnerNames,
    isHost: Boolean(currentPlayer && currentPlayer.id === room.hostPlayerId),
    lastAction: state.lastAction,
  };
}

function syncPlayers(room) {
  const state = room.gameState;
  if (!state) return;
  const previousOrder = state.playerOrder.slice();
  const present = new Set(room.players.map((player) => player.id));
  state.playerOrder = previousOrder.filter((playerId) => present.has(playerId));
  for (const playerId of previousOrder) {
    if (!present.has(playerId)) {
      delete state.scores[playerId];
      delete state.answers[playerId];
    }
  }
  if (!state.playerOrder.length) {
    state.phase = 'finished';
    state.result = 'draw';
    state.winnerIds = [];
    state.winnerId = null;
    return;
  }
  if (state.playerOrder.length === 1) {
    state.phase = 'finished';
    state.result = 'win';
    state.winnerIds = state.playerOrder.slice();
    state.winnerId = state.playerOrder[0];
    state.lastAction = {
      type: 'finished',
      playerId: state.winnerId,
      nickname: room.players.find((player) => player.id === state.winnerId)?.nickname || '',
      message: 'La partie se termine par forfait.',
      at: Date.now(),
    };
    return;
  }
  if (state.phase === 'playing' && state.playerOrder.every((playerId) => Object.hasOwn(state.answers, playerId))) {
    resolveRound(room);
  }
}

function createFor(kind) {
  return {
    createGame: (players) => createGame(players, kind),
    answerQuestion,
    advanceQuestion,
    processBots,
    publicState,
    syncPlayers,
  };
}

module.exports = { createFor };
