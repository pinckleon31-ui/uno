'use strict';

(function attachSoloGames(root, factory) {
  const games = factory();
  if (typeof module === 'object' && module.exports) module.exports = games;
  if (root) root.SoloGames = games;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const MEMORY_SYMBOLS = [
    '🍓', '⭐', '🐱', '🎲', '🚀', '🌈', '🎵', '🍕',
    '🐢', '🍉', '⚽️', '🎨', '🦊', '🍩', '🧃', '🐝',
    '🏀', '🪁', '🍭', '🐳', '🎸', '🧁',
  ];

  function randomIndex(length, random) {
    return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
  }

  function shuffle(values, random) {
    const shuffled = values.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = randomIndex(index + 1, random);
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    return shuffled;
  }

  function randomFreeCell(snake, size, random) {
    const occupied = new Set(snake.map((part) => `${part.x}:${part.y}`));
    const free = [];
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (!occupied.has(`${x}:${y}`)) free.push({ x, y });
      }
    }
    return free.length ? free[randomIndex(free.length, random)] : null;
  }

  function createSnake({ size = 20, random = Math.random } = {}) {
    const safeSize = Number.isInteger(size) && size >= 6 ? size : 20;
    const center = Math.floor(safeSize / 2);
    const snake = [
      { x: center, y: center },
      { x: center - 1, y: center },
      { x: center - 2, y: center },
    ];
    return {
      size: safeSize,
      snake,
      direction: { x: 1, y: 0 },
      nextDirection: { x: 1, y: 0 },
      food: randomFreeCell(snake, safeSize, random),
      score: 0,
      status: 'playing',
      paused: false,
    };
  }

  function setSnakeDirection(state, direction) {
    if (!state || state.status !== 'playing' || state.paused || !direction) return false;
    const valid = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .some(([x, y]) => x === direction.x && y === direction.y);
    if (!valid || (direction.x + state.direction.x === 0 && direction.y + state.direction.y === 0)) return false;
    state.nextDirection = { x: direction.x, y: direction.y };
    return true;
  }

  function stepSnake(state, random = Math.random) {
    if (!state || state.status !== 'playing' || state.paused) return { moved: false, ate: false };
    state.direction = { ...state.nextDirection };
    const head = state.snake[0];
    const nextHead = { x: head.x + state.direction.x, y: head.y + state.direction.y };
    const eating = Boolean(state.food && nextHead.x === state.food.x && nextHead.y === state.food.y);
    const bodyToCheck = eating ? state.snake : state.snake.slice(0, -1);
    const collision = nextHead.x < 0 || nextHead.y < 0
      || nextHead.x >= state.size || nextHead.y >= state.size
      || bodyToCheck.some((part) => part.x === nextHead.x && part.y === nextHead.y);
    if (collision) {
      state.status = 'lost';
      return { moved: true, ate: false, collision: true };
    }

    state.snake.unshift(nextHead);
    if (eating) {
      state.score += 1;
      state.food = randomFreeCell(state.snake, state.size, random);
      if (!state.food) state.status = 'won';
    } else {
      state.snake.pop();
    }
    return { moved: true, ate: eating, collision: false, status: state.status };
  }

  function add2048Tile(state, random = Math.random) {
    const empty = [];
    state.board.forEach((value, index) => { if (value === 0) empty.push(index); });
    if (!empty.length) return null;
    const index = empty[randomIndex(empty.length, random)];
    const value = random() < 0.9 ? 2 : 4;
    state.board[index] = value;
    return { index, value };
  }

  function create2048({ size = 4, target = 2048, random = Math.random } = {}) {
    const safeSize = Number.isInteger(size) && size >= 3 && size <= 8 ? size : 4;
    const safeTarget = Number.isInteger(target) && target >= 64 ? target : 2048;
    const state = {
      size: safeSize,
      target: safeTarget,
      board: Array(safeSize * safeSize).fill(0),
      score: 0,
      status: 'playing',
      won: false,
    };
    add2048Tile(state, random);
    add2048Tile(state, random);
    return state;
  }

  function canMove2048(state) {
    if (!state) return false;
    const size = Number.isInteger(state.size) ? state.size : 4;
    if (state.board.some((value) => value === 0)) return true;
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        const value = state.board[row * size + column];
        if (column < size - 1 && value === state.board[row * size + column + 1]) return true;
        if (row < size - 1 && value === state.board[(row + 1) * size + column]) return true;
      }
    }
    return false;
  }

  function move2048(state, direction, random = Math.random) {
    if (!state || !['left', 'right', 'up', 'down'].includes(direction) || state.status !== 'playing') {
      return { changed: false, scoreGained: 0 };
    }
    const size = Number.isInteger(state.size) ? state.size : 4;
    const target = Number.isInteger(state.target) ? state.target : 2048;
    const previous = state.board.slice();
    const next = Array(size * size).fill(0);
    let scoreGained = 0;
    for (let line = 0; line < size; line += 1) {
      const indexes = [];
      for (let offset = 0; offset < size; offset += 1) {
        const row = direction === 'up' ? offset : direction === 'down' ? size - 1 - offset : line;
        const column = direction === 'left' ? offset : direction === 'right' ? size - 1 - offset : line;
        indexes.push(row * size + column);
      }
      const values = indexes.map((index) => state.board[index]).filter(Boolean);
      const merged = [];
      for (let index = 0; index < values.length;) {
        if (values[index] === values[index + 1]) {
          const value = values[index] * 2;
          merged.push(value);
          scoreGained += value;
          index += 2;
        } else {
          merged.push(values[index]);
          index += 1;
        }
      }
      while (merged.length < size) merged.push(0);
      indexes.forEach((index, offset) => { next[index] = merged[offset]; });
    }

    const changed = next.some((value, index) => value !== previous[index]);
    if (!changed) return { changed: false, scoreGained: 0 };
    state.board = next;
    state.score += scoreGained;
    add2048Tile(state, random);
    if (!state.won && state.board.some((value) => value >= target)) {
      state.won = true;
      state.status = 'won';
    } else if (!canMove2048(state)) {
      state.status = 'lost';
    }
    return { changed: true, scoreGained, status: state.status };
  }

  function createMinesweeper({ rows = 9, columns = 9, mineCount = 10 } = {}) {
    const safeRows = Number.isInteger(rows) && rows >= 5 ? rows : 9;
    const safeColumns = Number.isInteger(columns) && columns >= 5 ? columns : 9;
    const maximumMines = Math.max(1, safeRows * safeColumns - 9);
    const safeMineCount = Number.isInteger(mineCount) ? Math.max(1, Math.min(maximumMines, mineCount)) : 10;
    return {
      rows: safeRows,
      columns: safeColumns,
      mineCount: safeMineCount,
      grid: Array.from({ length: safeRows * safeColumns }, () => ({ mine: false, adjacent: 0, revealed: false, flagged: false })),
      initialized: false,
      status: 'playing',
      flagsRemaining: safeMineCount,
      revealedSafe: 0,
      startedAt: null,
      elapsedSeconds: 0,
      flagMode: false,
    };
  }

  function indexOfMineCell(state, row, column) {
    if (!Number.isInteger(row) || !Number.isInteger(column)
      || row < 0 || column < 0 || row >= state.rows || column >= state.columns) return -1;
    return row * state.columns + column;
  }

  function initializeMinesweeper(state, firstRow, firstColumn, random) {
    const safe = new Set();
    for (let row = Math.max(0, firstRow - 1); row <= Math.min(state.rows - 1, firstRow + 1); row += 1) {
      for (let column = Math.max(0, firstColumn - 1); column <= Math.min(state.columns - 1, firstColumn + 1); column += 1) {
        safe.add(row * state.columns + column);
      }
    }
    let candidates = state.grid.map((_, index) => index).filter((index) => !safe.has(index));
    if (candidates.length < state.mineCount) candidates = state.grid.map((_, index) => index).filter((index) => index !== firstRow * state.columns + firstColumn);
    candidates = shuffle(candidates, random);
    for (const index of candidates.slice(0, state.mineCount)) state.grid[index].mine = true;
    for (let row = 0; row < state.rows; row += 1) {
      for (let column = 0; column < state.columns; column += 1) {
        const cell = state.grid[row * state.columns + column];
        if (cell.mine) continue;
        let adjacent = 0;
        for (let neighborRow = Math.max(0, row - 1); neighborRow <= Math.min(state.rows - 1, row + 1); neighborRow += 1) {
          for (let neighborColumn = Math.max(0, column - 1); neighborColumn <= Math.min(state.columns - 1, column + 1); neighborColumn += 1) {
            if (state.grid[neighborRow * state.columns + neighborColumn].mine) adjacent += 1;
          }
        }
        cell.adjacent = adjacent;
      }
    }
    state.initialized = true;
  }

  function revealMinesweeper(state, row, column, random = Math.random) {
    if (!state) return { changed: false };
    const firstIndex = indexOfMineCell(state, row, column);
    if (firstIndex < 0 || state.status !== 'playing') return { changed: false };
    const firstCell = state.grid[firstIndex];
    if (firstCell.revealed || firstCell.flagged) return { changed: false };
    if (!state.initialized) {
      initializeMinesweeper(state, row, column, random);
      state.startedAt = Date.now();
    }
    if (state.grid[firstIndex].mine) {
      state.grid[firstIndex].revealed = true;
      for (const cell of state.grid) if (cell.mine) cell.revealed = true;
      state.status = 'lost';
      return { changed: true, exploded: true, status: state.status };
    }

    const queue = [firstIndex];
    const visited = new Set();
    while (queue.length) {
      const index = queue.pop();
      if (visited.has(index)) continue;
      visited.add(index);
      const cell = state.grid[index];
      if (cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      state.revealedSafe += 1;
      if (cell.adjacent !== 0) continue;
      const cellRow = Math.floor(index / state.columns);
      const cellColumn = index % state.columns;
      for (let nextRow = Math.max(0, cellRow - 1); nextRow <= Math.min(state.rows - 1, cellRow + 1); nextRow += 1) {
        for (let nextColumn = Math.max(0, cellColumn - 1); nextColumn <= Math.min(state.columns - 1, cellColumn + 1); nextColumn += 1) {
          const nextIndex = nextRow * state.columns + nextColumn;
          if (!visited.has(nextIndex)) queue.push(nextIndex);
        }
      }
    }
    if (state.revealedSafe === state.grid.length - state.mineCount) {
      state.status = 'won';
      for (const cell of state.grid) if (cell.mine) cell.flagged = true;
      state.flagsRemaining = 0;
    }
    return { changed: true, exploded: false, status: state.status };
  }

  function toggleMinesweeperFlag(state, row, column) {
    const index = indexOfMineCell(state, row, column);
    if (!state || index < 0 || state.status !== 'playing') return false;
    const cell = state.grid[index];
    if (cell.revealed || (!cell.flagged && state.flagsRemaining === 0)) return false;
    cell.flagged = !cell.flagged;
    state.flagsRemaining += cell.flagged ? -1 : 1;
    return true;
  }

  function createMemory({ symbols = null, pairs = 8, random = Math.random } = {}) {
    const requestedPairs = Number.isInteger(pairs)
      ? Math.max(2, Math.min(MEMORY_SYMBOLS.length, pairs))
      : 8;
    const pairSymbols = Array.isArray(symbols) && symbols.length >= 2
      ? symbols
      : MEMORY_SYMBOLS.slice(0, requestedPairs);
    const cards = shuffle(pairSymbols.flatMap((symbol, index) => [
      { id: `memory-${index}-a`, pairId: index, symbol, revealed: false, matched: false },
      { id: `memory-${index}-b`, pairId: index, symbol, revealed: false, matched: false },
    ]), random);
    return {
      cards,
      pairCount: pairSymbols.length,
      firstId: null,
      pendingMismatch: null,
      locked: false,
      moves: 0,
      matches: 0,
      status: 'playing',
      startedAt: Date.now(),
      elapsedSeconds: 0,
    };
  }

  function revealMemory(state, cardId) {
    if (!state || state.status !== 'playing' || state.locked) return { changed: false };
    const card = state.cards.find((candidate) => candidate.id === cardId);
    if (!card || card.revealed || card.matched) return { changed: false };
    card.revealed = true;
    if (!state.firstId) {
      state.firstId = card.id;
      return { changed: true, first: true };
    }
    const first = state.cards.find((candidate) => candidate.id === state.firstId);
    state.moves += 1;
    if (first && first.pairId === card.pairId) {
      first.matched = true;
      card.matched = true;
      state.firstId = null;
      state.matches += 1;
      if (state.matches === state.pairCount) state.status = 'won';
      return { changed: true, matched: true, complete: state.status === 'won' };
    }
    state.pendingMismatch = [first?.id, card.id].filter(Boolean);
    state.firstId = null;
    state.locked = true;
    return { changed: true, matched: false, mismatch: true };
  }

  function hideMemoryMismatch(state) {
    if (!state || !state.pendingMismatch) return false;
    for (const id of state.pendingMismatch) {
      const card = state.cards.find((candidate) => candidate.id === id);
      if (card && !card.matched) card.revealed = false;
    }
    state.pendingMismatch = null;
    state.locked = false;
    return true;
  }

  return Object.freeze({
    createSnake,
    setSnakeDirection,
    stepSnake,
    create2048,
    add2048Tile,
    move2048,
    canMove2048,
    createMinesweeper,
    revealMinesweeper,
    toggleMinesweeperFlag,
    createMemory,
    revealMemory,
    hideMemoryMismatch,
  });
}));
