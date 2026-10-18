'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const soloGames = require('../public/solo-games');

test('Snake mange une pomme, grandit, bloque le demi-tour et détecte le mur', () => {
  const game = soloGames.createSnake({ size: 10, random: () => 0 });
  game.food = { x: 6, y: 5 };
  assert.equal(soloGames.setSnakeDirection(game, { x: -1, y: 0 }), false, 'le serpent ne peut pas faire demi-tour sur lui-même');
  const beforeLength = game.snake.length;
  const result = soloGames.stepSnake(game, () => 0);
  assert.equal(result.ate, true);
  assert.equal(game.score, 1);
  assert.equal(game.snake.length, beforeLength + 1);

  game.snake = [{ x: 9, y: 5 }, { x: 8, y: 5 }, { x: 7, y: 5 }];
  game.direction = { x: 1, y: 0 };
  game.nextDirection = { x: 1, y: 0 };
  assert.equal(soloGames.stepSnake(game).collision, true);
  assert.equal(game.status, 'lost');
});

test('2048 fusionne une seule fois chaque tuile et calcule les points', () => {
  const game = soloGames.create2048({ random: () => 0 });
  game.board = [2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  game.score = 0;
  const move = soloGames.move2048(game, 'left', () => 0);
  assert.equal(move.changed, true);
  assert.equal(move.scoreGained, 8);
  assert.equal(game.score, 8);
  assert.deepEqual(game.board.slice(0, 2), [4, 4]);
  assert.equal(game.board.filter((value) => value === 4).length, 2);
  assert.equal(game.board.filter(Boolean).length, 3, 'une nouvelle tuile apparaît après un coup valide');
});

test('Démineur protège le premier clic, révèle les zones vides et finit après les cases sûres', () => {
  const game = soloGames.createMinesweeper({ rows: 5, columns: 5, mineCount: 1 });
  const first = soloGames.revealMinesweeper(game, 2, 2, () => 0);
  assert.equal(first.changed, true);
  assert.equal(game.grid[2 * game.columns + 2].mine, false);
  assert.ok(game.revealedSafe > 1, 'une zone vide se révèle automatiquement');
  for (let index = 0; index < game.grid.length; index += 1) {
    const cell = game.grid[index];
    if (!cell.mine && !cell.revealed) {
      soloGames.revealMinesweeper(game, Math.floor(index / game.columns), index % game.columns, () => 0);
    }
  }
  assert.equal(game.status, 'won');
});

test('Memory solo distingue les paires, masque les erreurs et termine la partie', () => {
  const game = soloGames.createMemory({ symbols: ['🍎', '⭐', '🐱'], random: () => 0 });
  const apple = game.cards.filter((card) => card.symbol === '🍎');
  const star = game.cards.filter((card) => card.symbol === '⭐');
  assert.equal(soloGames.revealMemory(game, apple[0].id).first, true);
  assert.equal(soloGames.revealMemory(game, star[0].id).mismatch, true);
  assert.equal(game.locked, true);
  assert.equal(soloGames.hideMemoryMismatch(game), true);
  assert.equal(apple[0].revealed, false);
  for (const pair of [apple, star, game.cards.filter((card) => card.symbol === '🐱')]) {
    soloGames.revealMemory(game, pair[0].id);
    const result = soloGames.revealMemory(game, pair[1].id);
    assert.equal(result.matched, true);
  }
  assert.equal(game.status, 'won');
  assert.equal(game.matches, 3);
});

test('2048 accepte des grilles plus grandes et garde son objectif', () => {
  const game = soloGames.create2048({ size: 6, target: 8192, random: () => 0 });
  assert.equal(game.size, 6);
  assert.equal(game.board.length, 36);
  game.board = Array(36).fill(0);
  game.board[0] = 2;
  game.board[1] = 2;
  const move = soloGames.move2048(game, 'left', () => 0);
  assert.equal(move.changed, true);
  assert.equal(game.board[0], 4);
  assert.equal(move.scoreGained, 4);
  assert.equal(game.status, 'playing', 'le 4 obtenu est loin de l’objectif 8192');
});

test('Démineur accepte un grand terrain très miné et garde un premier clic sûr', () => {
  const game = soloGames.createMinesweeper({ rows: 20, columns: 20, mineCount: 90 });
  assert.equal(game.rows, 20);
  assert.equal(game.columns, 20);
  assert.equal(game.mineCount, 90);
  assert.equal(game.flagsRemaining, 90);
  soloGames.revealMinesweeper(game, 10, 10, () => 0.5);
  assert.equal(game.grid.filter((cell) => cell.mine).length, 90);
  assert.equal(game.grid[10 * 20 + 10].mine, false);
  assert.equal(game.status, 'playing');
});

test('Memory solo propose plus de paires quand on agrandit la grille', () => {
  const game = soloGames.createMemory({ pairs: 18, random: () => 0.5 });
  assert.equal(game.pairCount, 18);
  assert.equal(game.cards.length, 36);
  assert.equal(new Set(game.cards.map((card) => card.symbol)).size, 18);
  const capped = soloGames.createMemory({ pairs: 999, random: () => 0.5 });
  assert.ok(capped.pairCount >= 18 && capped.cards.length === capped.pairCount * 2);
});
