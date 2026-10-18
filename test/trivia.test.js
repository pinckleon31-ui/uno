'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const quiz = require('../quiz');
const blindTest = require('../blind_melody');

function makeRoom(engine, game, playerTypes = ['human', 'human']) {
  const players = playerTypes.map((type, index) => ({
    id: `p${index + 1}`,
    nickname: type === 'bot' ? `Bot ${index + 1}` : `Joueur ${index + 1}`,
    isBot: type === 'bot',
  }));
  return {
    id: `room-${game}-test`,
    game,
    hostPlayerId: players[0].id,
    players,
    gameState: engine.createGame(players),
  };
}

test('Quiz : réponses privées, révélation, scores et victoire après huit questions', () => {
  const room = makeRoom(quiz, 'quiz');
  const host = room.players[0];
  const guest = room.players[1];
  let publicState = quiz.publicState(room, host);
  assert.equal(publicState.phase, 'playing');
  assert.equal(publicState.question.correctIndex, null, 'la bonne réponse reste secrète avant la révélation');
  assert.equal(publicState.totalQuestions, 8);

  let answeredQuestions = 0;
  while (room.gameState.phase !== 'finished') {
    if (room.gameState.phase === 'reveal') quiz.advanceQuestion(room, host);
    const correct = room.gameState.questions[room.gameState.questionIndex].correctIndex;
    quiz.answerQuestion(room, host, correct);
    assert.throws(() => quiz.answerQuestion(room, host, correct), { statusCode: 409 });
    const incorrect = (correct + 1) % room.gameState.questions[room.gameState.questionIndex].choices.length;
    quiz.answerQuestion(room, guest, incorrect);
    answeredQuestions += 1;
    if (room.gameState.phase === 'reveal') {
      publicState = quiz.publicState(room, guest);
      assert.equal(publicState.question.correctIndex, correct);
      assert.equal(publicState.roundResult.results.length, 2);
    }
  }

  assert.equal(answeredQuestions, 8);
  assert.equal(room.gameState.scores.p1, 8);
  assert.equal(room.gameState.scores.p2, 0);
  assert.equal(room.gameState.winnerId, 'p1');
  assert.deepEqual(room.gameState.winnerIds, ['p1']);
});

test('Blind test : les morceaux originaux ont des notes audio et les bots répondent', () => {
  const room = makeRoom(blindTest, 'blind-test', ['human', 'bot']);
  const question = room.gameState.questions[0];
  assert.ok(question.notes.length >= 6);
  assert.ok(question.notes.every((note) => Number.isInteger(note) && note >= 36 && note <= 84));
  assert.equal(blindTest.publicState(room, room.players[0]).question.correctIndex, null);

  blindTest.processBots(room);
  assert.equal(Object.hasOwn(room.gameState.answers, 'p2'), true);
  assert.equal(blindTest.publicState(room, room.players[0]).hasAnswered, false);
  blindTest.answerQuestion(room, room.players[0], question.correctIndex);
  assert.ok(['reveal', 'finished'].includes(room.gameState.phase));
  assert.equal(blindTest.publicState(room, room.players[0]).question.correctIndex, question.correctIndex);
});

test('le quiz refuse les réponses hors plage et la suite d’une question sans organiser', () => {
  const room = makeRoom(quiz, 'quiz');
  assert.throws(() => quiz.answerQuestion(room, room.players[0], 20), { statusCode: 400 });
  assert.throws(() => quiz.advanceQuestion(room, room.players[1]), { statusCode: 409 });
  const correct = room.gameState.questions[0].correctIndex;
  quiz.answerQuestion(room, room.players[0], correct);
  quiz.answerQuestion(room, room.players[1], correct);
  assert.throws(() => quiz.advanceQuestion(room, room.players[1]), { statusCode: 403 });
  quiz.advanceQuestion(room, room.players[0]);
  assert.equal(room.gameState.questionIndex, 1);
});
