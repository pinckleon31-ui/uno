'use strict';

const crypto = require('node:crypto');

const MAX_BOT_ACTIONS_PER_UPDATE = 40;
const NIGHT_ACTION_MS = 45_000;
const DAY_VOTE_MS = 120_000;
const HUNTER_ACTION_MS = 25_000;
const ROLE_INFO = Object.freeze({
  wolf: { name: 'Loup-garou', icon: '🐺', description: 'La nuit, élimine avec les autres loups un joueur du village. Les loups gagnent quand ils sont aussi nombreux que les autres joueurs.' },
  seer: { name: 'Voyante', icon: '🔮', description: 'Chaque nuit, inspecte secrètement un joueur pour découvrir s’il est loup-garou.' },
  doctor: { name: 'Médecin', icon: '🩺', description: 'Chaque nuit, protège une personne de l’attaque des loups. Tu peux aussi te protéger.' },
  witch: { name: 'Sorcière', icon: '🧙', description: 'Tu possèdes une potion de vie et une potion de mort. Tu peux sauver la victime des loups et empoisonner un joueur, une fois chacune.' },
  cupid: { name: 'Cupidon', icon: '💘', description: 'La première nuit, désigne deux amoureux. Si l’un meurt, l’autre meurt de chagrin. S’ils sont les deux derniers, ils gagnent ensemble.' },
  hunter: { name: 'Chasseur', icon: '🏹', description: 'Quand tu es éliminé, tu as un dernier tir : choisis un joueur vivant à emporter avec toi.' },
  elder: { name: 'Ancien', icon: '🧓', description: 'Tu résistes à la première attaque des loups. Le vote du village te tue et prive le village de ses pouvoirs spéciaux.' },
  villager: { name: 'Villageois·e', icon: '🌾', description: 'Écoute les indices, discute le jour et vote pour démasquer les loups.' },
});
const NIGHT_ROLE_FOR_STEP = Object.freeze({
  cupid: 'cupid',
  wolves: 'wolf',
  seer: 'seer',
  doctor: 'doctor',
  witch: 'witch',
});

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

function livingPlayers(state) {
  return state.alivePlayerIds;
}

function livingWolves(state) {
  return state.alivePlayerIds.filter((playerId) => state.roles[playerId] === 'wolf');
}

function actionRecord(type, player, message) {
  return {
    type,
    playerId: player ? player.id : null,
    nickname: player ? player.nickname : '',
    message,
    at: Date.now(),
  };
}

function finishGame(state, result, winnerIds, faction, message) {
  state.phase = 'finished';
  state.result = result;
  state.winnerIds = winnerIds.slice();
  state.winnerId = winnerIds.length === 1 ? winnerIds[0] : null;
  state.winnerFaction = faction;
  state.nightStep = null;
  state.deadlineAt = null;
  state.pendingHunterId = null;
  state.pendingDeaths = [];
  state.pendingHunters = [];
  state.afterDeathsPhase = null;
  state.lastAction = actionRecord('finished', null, message);
}

function checkVictory(room) {
  const state = room.gameState;
  const alive = livingPlayers(state);
  if (!alive.length) {
    finishGame(state, 'draw', [], null, 'Le village est désert : la partie se termine sans vainqueur.');
    return true;
  }

  const lovers = Array.isArray(state.lovers) ? state.lovers : [];
  if (lovers.length === 2 && alive.length === 2 && lovers.every((playerId) => alive.includes(playerId))) {
    finishGame(state, 'win', lovers, 'lovers', 'Les deux amoureux sont les derniers survivants : ils gagnent ensemble.');
    return true;
  }

  const wolves = livingWolves(state);
  const villagers = alive.filter((playerId) => state.roles[playerId] !== 'wolf');
  if (wolves.length === 0) {
    finishGame(state, 'win', alive, 'village', 'Tous les loups sont démasqués : le village est sauvé !');
    return true;
  }
  if (wolves.length >= villagers.length) {
    finishGame(state, 'win', wolves, 'wolves', 'Les loups sont désormais aussi nombreux que le village : ils remportent la partie.');
    return true;
  }
  return false;
}

function hasLivingRole(state, role) {
  return state.alivePlayerIds.some((playerId) => state.roles[playerId] === role);
}

function canRunNightStep(state, step) {
  if (state.villagePowersDisabled && ['cupid', 'seer', 'doctor', 'witch'].includes(step)) return false;
  if (step === 'cupid') return state.round === 1 && !state.cupidDone && hasLivingRole(state, 'cupid');
  if (step === 'wolves') return livingWolves(state).length > 0;
  if (step === 'seer') {
    const seerId = state.alivePlayerIds.find((playerId) => state.roles[playerId] === 'seer');
    return Boolean(seerId && state.seerFindings[seerId]?.round !== state.round);
  }
  if (step === 'doctor') return hasLivingRole(state, 'doctor') && !state.doctorActed;
  if (step === 'witch') {
    return hasLivingRole(state, 'witch') && !state.witchActed
      && (state.witchHealAvailable || state.witchPoisonAvailable);
  }
  return false;
}

function continueNight(room) {
  const state = room.gameState;
  if (state.phase !== 'night') return;
  if (checkVictory(room)) return;

  if (!canRunNightStep(state, state.nightStep)) {
    advanceNightStep(room);
    return;
  }

  if (state.nightStep === 'wolves') {
    const wolves = livingWolves(state);
    if (!wolves.every((playerId) => Object.hasOwn(state.wolfVotes, playerId))) return;
    state.wolfTargetId = pluralityTarget(state.wolfVotes);
    advanceNightStep(room);
    return;
  }

  if (state.nightStep === 'seer') {
    const seerId = state.alivePlayerIds.find((playerId) => state.roles[playerId] === 'seer');
    if (seerId && state.seerFindings[seerId]?.round === state.round) advanceNightStep(room);
    return;
  }

  if (state.nightStep === 'doctor') {
    if (state.doctorActed) advanceNightStep(room);
    return;
  }

  if (state.nightStep === 'witch') {
    if (state.witchActed) advanceNightStep(room);
    return;
  }

  if (state.nightStep === 'cupid' && state.cupidDone) advanceNightStep(room);
}

function pluralityTarget(votes) {
  const totals = new Map();
  for (const targetId of Object.values(votes || {})) {
    totals.set(targetId, (totals.get(targetId) || 0) + 1);
  }
  if (!totals.size) return null;
  const highest = Math.max(...totals.values());
  const tiedTargets = Array.from(totals.entries())
    .filter(([, count]) => count === highest)
    .map(([id]) => id);
  return tiedTargets[crypto.randomInt(tiedTargets.length)];
}

function advanceNightStep(room) {
  const state = room.gameState;
  if (state.phase !== 'night') return;
  const currentIndex = state.nightSteps.indexOf(state.nightStep);
  for (let index = currentIndex + 1; index < state.nightSteps.length; index += 1) {
    const step = state.nightSteps[index];
    if (!canRunNightStep(state, step)) continue;
    state.nightStep = step;
    state.deadlineAt = Date.now() + NIGHT_ACTION_MS;
    continueNight(room);
    return;
  }
  state.nightStep = null;
  state.deadlineAt = null;
  resolveNight(room);
}

function startNight(room, incrementRound = false) {
  const state = room.gameState;
  if (incrementRound) state.round += 1;
  state.phase = 'night';
  state.wolfVotes = {};
  state.wolfTargetId = null;
  state.doctorTargetId = null;
  state.doctorActed = false;
  state.witchActed = false;
  state.witchSaveTargetId = null;
  state.witchPoisonTargetId = null;
  state.dayVotes = {};
  state.nightSteps = [];
  if (state.round === 1 && !state.cupidDone && hasLivingRole(state, 'cupid')) state.nightSteps.push('cupid');
  state.nightSteps.push('wolves');
  if (hasLivingRole(state, 'seer')) state.nightSteps.push('seer');
  if (hasLivingRole(state, 'doctor')) state.nightSteps.push('doctor');
  if (hasLivingRole(state, 'witch') && (state.witchHealAvailable || state.witchPoisonAvailable)) {
    state.nightSteps.push('witch');
  }
  state.nightStep = state.nightSteps[0] || null;
  state.deadlineAt = Date.now() + NIGHT_ACTION_MS;
  state.lastAction = actionRecord('night', null, `La nuit tombe sur le village · nuit ${state.round}. Le village s’endort.`);
  if (state.nightStep) continueNight(room);
  else resolveNight(room);
}

function eliminate(room, playerId, cause) {
  const state = room.gameState;
  if (!playerId || !state.alivePlayerIds.includes(playerId)) return null;
  state.alivePlayerIds = state.alivePlayerIds.filter((candidate) => candidate !== playerId);
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (state.roles[playerId] === 'elder' && cause === 'a été choisi·e par le village') {
    state.villagePowersDisabled = true;
  }
  const role = ROLE_INFO[state.roles[playerId]]?.name || ROLE_INFO.villager.name;
  state.lastAction = actionRecord(
    'elimination',
    player,
    `${player ? player.nickname : 'Un joueur'} ${cause} : son rôle était ${role}.`,
  );
  return player;
}

function enqueueDeath(queue, queuedIds, playerId, cause) {
  if (!playerId || queuedIds.has(playerId)) return;
  queuedIds.add(playerId);
  queue.push({ playerId, cause });
}

function continueEliminations(room) {
  const state = room.gameState;
  if (!state.pendingDeaths) state.pendingDeaths = [];
  if (!state.pendingHunters) state.pendingHunters = [];

  while (state.pendingDeaths.length) {
    const death = state.pendingDeaths.shift();
    if (!state.alivePlayerIds.includes(death.playerId)) continue;
    const player = eliminate(room, death.playerId, death.cause);
    if (!player) continue;

    const lovers = Array.isArray(state.lovers) ? state.lovers : [];
    const partnerId = lovers.includes(player.id)
      ? lovers.find((playerId) => playerId !== player.id && state.alivePlayerIds.includes(playerId))
      : null;
    if (partnerId && !state.pendingDeaths.some((item) => item.playerId === partnerId)) {
      state.pendingDeaths.unshift({
        playerId: partnerId,
        cause: `est mort·e de chagrin après la mort de ${player.nickname}`,
      });
    }
    if (state.roles[player.id] === 'hunter' && !state.villagePowersDisabled && !state.pendingHunters.includes(player.id)) {
      state.pendingHunters.push(player.id);
    }
  }

  while (state.pendingHunters.length) {
    const hunterId = state.pendingHunters.shift();
    const hunter = room.players.find((player) => player.id === hunterId);
    if (!hunter || state.alivePlayerIds.length === 0) continue;
    state.pendingHunterId = hunterId;
    state.phase = 'hunter';
    state.deadlineAt = Date.now() + HUNTER_ACTION_MS;
    state.lastAction = actionRecord(
      'hunter-prompt',
      hunter,
      `${hunter.nickname} était le Chasseur : il peut choisir une dernière cible.`,
    );
    return;
  }

  state.pendingHunterId = null;
  state.pendingDeaths = [];
  if (checkVictory(room)) return;

  const nextPhase = state.afterDeathsPhase;
  state.afterDeathsPhase = null;
  if (nextPhase === 'day') {
    state.phase = 'day';
    state.dayVotes = {};
    state.deadlineAt = Date.now() + DAY_VOTE_MS;
    if (!state.lastAction || !['elimination', 'save', 'elder-survived', 'night-result'].includes(state.lastAction.type)) {
      state.lastAction = actionRecord('day', null, 'Le village se réveille. Discutez et votez avant la fin du jour.');
    }
    return;
  }
  if (nextPhase === 'night') {
    startNight(room, true);
    return;
  }
  state.phase = 'day';
  state.deadlineAt = Date.now() + DAY_VOTE_MS;
}

function beginEliminationResolution(room, deaths, nextPhase) {
  const state = room.gameState;
  const queuedIds = new Set();
  state.pendingDeaths = [];
  for (const death of deaths) enqueueDeath(state.pendingDeaths, queuedIds, death.playerId, death.cause);
  state.pendingHunters = [];
  state.pendingHunterId = null;
  state.afterDeathsPhase = nextPhase;
  continueEliminations(room);
}

function resolveNight(room) {
  const state = room.gameState;
  if (state.phase !== 'night') return;
  const victimId = state.wolfTargetId;
  const deaths = [];
  const events = [];
  const victimAlive = victimId && state.alivePlayerIds.includes(victimId);
  const isProtected = victimId && (victimId === state.doctorTargetId || victimId === state.witchSaveTargetId);

  if (victimAlive && isProtected) {
    events.push('Les loups ont attaqué, mais la victime a été protégée.');
    state.lastAction = actionRecord('save', null, events[0]);
  } else if (victimAlive && state.roles[victimId] === 'elder' && !state.elderSurvivedAttack) {
    state.elderSurvivedAttack = true;
    events.push('Une attaque nocturne a échoué : la victime a survécu.');
    state.lastAction = actionRecord('night-result', null, events[0]);
  } else if (victimAlive) {
    enqueueDeath(deaths, new Set(), victimId, 'a été retrouvé·e au petit matin');
  }

  const poisonId = state.witchPoisonTargetId;
  if (poisonId && state.alivePlayerIds.includes(poisonId)) {
    enqueueDeath(deaths, new Set(deaths.map((death) => death.playerId)), poisonId, 'a été empoisonné·e pendant la nuit');
    events.push('Une potion de mort a été utilisée.');
  }

  if (!victimAlive && !poisonId) {
    state.lastAction = actionRecord('quiet-night', null, 'Une nuit calme : personne ne disparaît.');
  } else if (!victimAlive && poisonId && !state.lastAction?.message) {
    state.lastAction = actionRecord('night-result', null, 'Le village se réveille après une nuit mystérieuse.');
  }
  state.nightStep = null;
  state.deadlineAt = null;
  beginEliminationResolution(room, deaths, 'day');
}

function resolveDay(room) {
  const state = room.gameState;
  if (state.phase !== 'day') return;
  const eligibleIds = new Set(state.alivePlayerIds);
  const votes = Object.fromEntries(Object.entries(state.dayVotes).filter(([, targetId]) => eligibleIds.has(targetId)));
  const totals = new Map();
  for (const targetId of Object.values(votes)) totals.set(targetId, (totals.get(targetId) || 0) + 1);
  const highest = totals.size ? Math.max(...totals.values()) : 0;
  const winners = Array.from(totals.entries()).filter(([, count]) => count === highest).map(([id]) => id);
  let deaths = [];
  if (winners.length === 1) {
    const target = room.players.find((player) => player.id === winners[0]);
    state.lastAction = actionRecord(
      'day-elimination',
      target,
      `${target ? target.nickname : 'Un joueur'} a été choisi·e par le village.`,
    );
    deaths = [{ playerId: winners[0], cause: 'a été choisi·e par le village' }];
  } else {
    state.lastAction = actionRecord('tie', null, 'Les votes sont à égalité (ou personne n’a voté) : personne n’est éliminé aujourd’hui.');
  }
  beginEliminationResolution(room, deaths, 'night');
}

function createGame(players) {
  if (!Array.isArray(players) || players.length < 4) {
    throw gameError(400, 'Il faut au moins quatre joueurs pour lancer le Loup-garou.');
  }
  const playerOrder = players.map((player) => player.id);
  const roleBag = [];
  const wolfCount = Math.max(1, Math.floor(players.length / 4));
  for (let index = 0; index < wolfCount; index += 1) roleBag.push('wolf');
  if (players.length >= 5) roleBag.push('seer');
  if (players.length >= 6) roleBag.push('doctor');
  if (players.length >= 7) roleBag.push('witch');
  if (players.length >= 8) roleBag.push('cupid');
  if (players.length >= 9) roleBag.push('hunter');
  if (players.length >= 10) roleBag.push('elder');
  while (roleBag.length < players.length) roleBag.push('villager');
  const shuffledRoles = shuffle(roleBag);
  const roles = Object.fromEntries(playerOrder.map((playerId, index) => [playerId, shuffledRoles[index]]));
  const game = {
    phase: 'night',
    result: null,
    playerOrder,
    alivePlayerIds: playerOrder.slice(),
    roles,
    round: 1,
    nightStep: 'wolves',
    nightSteps: [],
    deadlineAt: null,
    wolfVotes: {},
    wolfTargetId: null,
    seerFindings: {},
    doctorTargetId: null,
    doctorActed: false,
    witchActed: false,
    witchHealAvailable: Boolean(roles && Object.values(roles).includes('witch')),
    witchPoisonAvailable: Boolean(roles && Object.values(roles).includes('witch')),
    witchSaveTargetId: null,
    witchPoisonTargetId: null,
    cupidDone: false,
    lovers: null,
    elderSurvivedAttack: false,
    villagePowersDisabled: false,
    dayVotes: {},
    pendingDeaths: [],
    pendingHunters: [],
    pendingHunterId: null,
    afterDeathsPhase: null,
    winnerId: null,
    winnerIds: [],
    winnerFaction: null,
    startedAt: Date.now(),
    lastAction: actionRecord('start', null, 'Les rôles sont distribués en secret. La première nuit commence.'),
  };
  const room = { players, hostPlayerId: players[0].id, gameState: game };
  startNight(room, false);
  return game;
}

function aliveTarget(room, targetId, { allowSelf = false, player = null, message = 'Choisis un autre joueur encore en jeu.' } = {}) {
  const target = room.players.find((candidate) => candidate.id === targetId);
  if (!target || !room.gameState.alivePlayerIds.includes(target.id) || (!allowSelf && player && target.id === player.id)) {
    throw gameError(400, message);
  }
  return target;
}

function submitAction(room, player, submittedAction) {
  const state = room.gameState;
  if (!state || state.phase === 'finished') throw gameError(409, 'La partie de Loup-garou est terminée.');
  const action = typeof submittedAction === 'string'
    ? { targetId: submittedAction }
    : (submittedAction && typeof submittedAction === 'object' ? submittedAction : {});

  if (state.phase === 'hunter') {
    if (!player || player.id !== state.pendingHunterId || state.roles[player.id] !== 'hunter') {
      throw gameError(403, 'Seul le Chasseur éliminé peut effectuer son dernier tir.');
    }
    const target = aliveTarget(room, String(action.targetId || ''), { player, message: 'Choisis une cible encore en jeu pour ton dernier tir.' });
    state.pendingHunterId = null;
    state.deadlineAt = null;
    state.pendingDeaths.unshift({
      playerId: target.id,
      cause: `a été emporté·e par le dernier tir de ${player.nickname}`,
    });
    state.lastAction = actionRecord('hunter-shot', player, `${player.nickname} tire une dernière fois avant de quitter le village.`);
    continueEliminations(room);
    return;
  }

  if (!player || !state.alivePlayerIds.includes(player.id)) {
    throw gameError(403, 'Seuls les joueurs encore en jeu peuvent agir.');
  }

  if (state.phase === 'night') {
    if (state.nightStep === 'cupid') {
      if (state.roles[player.id] !== 'cupid') throw gameError(403, 'Seul Cupidon peut choisir les amoureux.');
      if (state.cupidDone || state.round !== 1) throw gameError(409, 'Cupidon a déjà joué cette partie.');
      const first = aliveTarget(room, String(action.firstTargetId || action.targetId || ''), {
        allowSelf: true,
        player,
        message: 'Choisis deux joueurs encore en vie.',
      });
      const second = aliveTarget(room, String(action.secondTargetId || ''), {
        allowSelf: true,
        player,
        message: 'Choisis deux joueurs encore en vie.',
      });
      if (first.id === second.id) throw gameError(400, 'Les deux amoureux doivent être deux personnes différentes.');
      state.lovers = [first.id, second.id];
      state.cupidDone = true;
      state.lastAction = actionRecord('night-action', null, 'Un choix nocturne a été enregistré.');
      continueNight(room);
      return;
    }

    if (state.nightStep === 'wolves') {
      if (state.roles[player.id] !== 'wolf') throw gameError(403, 'Seuls les loups choisissent une cible cette nuit.');
      const target = aliveTarget(room, String(action.targetId || ''), { player });
      if (state.roles[target.id] === 'wolf') throw gameError(400, 'Les loups ne peuvent pas voter contre un des leurs.');
      if (state.wolfVotes[player.id] === target.id) {
        throw gameError(409, 'Ton vote est déjà enregistré contre cette personne.');
      }
      state.wolfVotes[player.id] = target.id;
      state.lastAction = actionRecord('night-action', null, 'Un choix nocturne a été enregistré.');
      continueNight(room);
      return;
    }

    if (state.nightStep === 'seer') {
      if (state.roles[player.id] !== 'seer') throw gameError(403, 'Seule la voyante peut inspecter un joueur.');
      const target = aliveTarget(room, String(action.targetId || ''), { player });
      if (state.seerFindings[player.id]?.round === state.round) throw gameError(409, 'Tu as déjà inspecté un joueur cette nuit.');
      state.seerFindings[player.id] = {
        round: state.round,
        targetId: target.id,
        isWolf: state.roles[target.id] === 'wolf',
      };
      state.lastAction = actionRecord('night-action', null, 'Un choix nocturne a été enregistré.');
      continueNight(room);
      return;
    }

    if (state.nightStep === 'doctor') {
      if (state.roles[player.id] !== 'doctor') throw gameError(403, 'Seul le médecin peut protéger un joueur.');
      if (state.doctorActed) throw gameError(409, 'Ton choix de protection est déjà enregistré.');
      const target = aliveTarget(room, String(action.targetId || ''), { allowSelf: true, player });
      state.doctorTargetId = target.id;
      state.doctorActed = true;
      state.lastAction = actionRecord('night-action', null, 'Un choix nocturne a été enregistré.');
      continueNight(room);
      return;
    }

    if (state.nightStep === 'witch') {
      if (state.roles[player.id] !== 'witch') throw gameError(403, 'Seule la Sorcière peut utiliser les potions.');
      if (state.witchActed) throw gameError(409, 'La Sorcière a déjà agi cette nuit.');
      const save = action.save === true;
      const poisonTargetId = String(action.poisonTargetId || '');
      if (!save && !poisonTargetId) {
        state.witchActed = true;
        state.lastAction = actionRecord('night-action', null, 'Un choix nocturne a été enregistré.');
        continueNight(room);
        return;
      }
      let saveTargetId = '';
      let poisonTarget = null;
      if (save) {
        if (!state.witchHealAvailable) throw gameError(409, 'La potion de vie a déjà été utilisée.');
        if (!state.wolfTargetId || !state.alivePlayerIds.includes(state.wolfTargetId)) {
          throw gameError(409, 'Il n’y a personne à sauver cette nuit.');
        }
        saveTargetId = state.wolfTargetId;
      }
      if (poisonTargetId) {
        if (!state.witchPoisonAvailable) throw gameError(409, 'La potion de mort a déjà été utilisée.');
        poisonTarget = aliveTarget(room, poisonTargetId, {
          allowSelf: true,
          player,
          message: 'Choisis une personne encore en vie à empoisonner.',
        });
      }
      // Valide toutes les cibles avant de consommer une potion : une action refusée
      // ne doit jamais modifier partiellement l’état de la Sorcière.
      if (saveTargetId) {
        state.witchSaveTargetId = saveTargetId;
        state.witchHealAvailable = false;
      }
      if (poisonTarget) {
        state.witchPoisonTargetId = poisonTarget.id;
        state.witchPoisonAvailable = false;
      }
      state.witchActed = true;
      state.lastAction = actionRecord('night-action', null, 'Un choix nocturne a été enregistré.');
      continueNight(room);
      return;
    }
    throw gameError(409, 'Cette action n’est pas disponible pendant la nuit.');
  }

  if (state.phase === 'day') {
    const target = aliveTarget(room, String(action.targetId || ''), { player });
    if (state.dayVotes[player.id] === target.id) {
      throw gameError(409, 'Ton vote est déjà enregistré contre cette personne.');
    }
    state.dayVotes[player.id] = target.id;
    state.lastAction = actionRecord('day-vote', player, `${player.nickname} a voté.`);
    if (state.alivePlayerIds.every((playerId) => Object.hasOwn(state.dayVotes, playerId))) resolveDay(room);
    return;
  }
  throw gameError(409, 'Cette action n’est pas disponible maintenant.');
}

function advanceTimedGame(room, now = Date.now()) {
  const state = room.gameState;
  if (!state || state.phase === 'finished') return false;
  if (!Number.isFinite(state.deadlineAt)) {
    state.deadlineAt = now + (state.phase === 'day' ? DAY_VOTE_MS : (state.phase === 'hunter' ? HUNTER_ACTION_MS : NIGHT_ACTION_MS));
    return true;
  }
  if (state.deadlineAt > now) return false;
  if (state.phase === 'night') {
    const step = state.nightStep;
    if (step === 'wolves') state.wolfTargetId = pluralityTarget(state.wolfVotes);
    if (step === 'cupid' && !state.cupidDone) state.cupidDone = true;
    if (step === 'doctor') state.doctorActed = true;
    if (step === 'witch') state.witchActed = true;
    state.lastAction = actionRecord('night-timeout', null, 'La nuit avance : les rôles ont terminé leur tour.');
    advanceNightStep(room);
    return true;
  }
  if (state.phase === 'day') {
    state.lastAction = actionRecord('day-timeout', null, 'Le temps de discussion est écoulé : le village rend son verdict.');
    resolveDay(room);
    return true;
  }
  if (state.phase === 'hunter') {
    const hunter = room.players.find((player) => player.id === state.pendingHunterId);
    state.pendingHunterId = null;
    state.deadlineAt = null;
    state.lastAction = actionRecord('hunter-timeout', hunter, 'Le Chasseur n’a pas tiré avant la fin du délai.');
    continueEliminations(room);
    return true;
  }
  return false;
}

function chooseBotWitchAction(room, bot) {
  const state = room.gameState;
  const canSave = state.witchHealAvailable && state.wolfTargetId
    && state.alivePlayerIds.includes(state.wolfTargetId) && crypto.randomInt(100) < 45;
  const canPoison = state.witchPoisonAvailable && state.alivePlayerIds.some((playerId) => playerId !== bot.id)
    && crypto.randomInt(100) < 22;
  const poisonTargets = state.alivePlayerIds.filter((playerId) => playerId !== bot.id);
  return {
    save: Boolean(canSave),
    poisonTargetId: canPoison && poisonTargets.length ? poisonTargets[crypto.randomInt(poisonTargets.length)] : '',
  };
}

function processBots(room) {
  const state = room.gameState;
  if (!state || state.phase === 'finished') return;
  let actions = 0;
  while (state.phase !== 'finished' && actions < MAX_BOT_ACTIONS_PER_UPDATE) {
    if (state.phase === 'hunter') {
      const bot = room.players.find((player) => player.id === state.pendingHunterId && player.isBot);
      if (!bot) break;
      const targets = state.alivePlayerIds.filter((playerId) => playerId !== bot.id);
      if (!targets.length) {
        state.pendingHunterId = null;
        continueEliminations(room);
      } else {
        submitAction(room, bot, { targetId: targets[crypto.randomInt(targets.length)] });
        actions += 1;
      }
      continue;
    }

    if (state.phase === 'night') {
      continueNight(room);
      if (state.phase !== 'night') continue;
      const step = state.nightStep;
      let bot;
      let action;
      if (step === 'cupid') {
        bot = state.alivePlayerIds
          .filter((playerId) => state.roles[playerId] === 'cupid')
          .map((playerId) => room.players.find((player) => player.id === playerId))
          .find((player) => player && player.isBot && !state.cupidDone);
        const targets = state.alivePlayerIds;
        if (bot && targets.length >= 2) {
          const firstIndex = crypto.randomInt(targets.length);
          let secondIndex = crypto.randomInt(targets.length - 1);
          if (secondIndex >= firstIndex) secondIndex += 1;
          action = { firstTargetId: targets[firstIndex], secondTargetId: targets[secondIndex] };
        }
      } else if (step === 'wolves') {
        bot = livingWolves(state)
          .map((playerId) => room.players.find((player) => player.id === playerId))
          .find((player) => player && player.isBot && !Object.hasOwn(state.wolfVotes, player.id));
        const targets = state.alivePlayerIds.filter((playerId) => state.roles[playerId] !== 'wolf');
        if (bot && targets.length) action = { targetId: targets[crypto.randomInt(targets.length)] };
      } else if (step === 'seer') {
        bot = state.alivePlayerIds
          .filter((playerId) => state.roles[playerId] === 'seer')
          .map((playerId) => room.players.find((player) => player.id === playerId))
          .find((player) => player && player.isBot && state.seerFindings[player.id]?.round !== state.round);
        const targets = state.alivePlayerIds.filter((playerId) => playerId !== bot?.id);
        if (bot && targets.length) action = { targetId: targets[crypto.randomInt(targets.length)] };
      } else if (step === 'doctor') {
        bot = state.alivePlayerIds
          .filter((playerId) => state.roles[playerId] === 'doctor')
          .map((playerId) => room.players.find((player) => player.id === playerId))
          .find((player) => player && player.isBot && !state.doctorActed);
        const targets = state.alivePlayerIds;
        if (bot && targets.length) action = { targetId: targets[crypto.randomInt(targets.length)] };
      } else if (step === 'witch') {
        bot = state.alivePlayerIds
          .filter((playerId) => state.roles[playerId] === 'witch')
          .map((playerId) => room.players.find((player) => player.id === playerId))
          .find((player) => player && player.isBot && !state.witchActed);
        if (bot) action = chooseBotWitchAction(room, bot);
      }
      if (!bot || !action) break;
      submitAction(room, bot, action);
      actions += 1;
      continue;
    }

    if (state.phase === 'day') {
      const bot = state.alivePlayerIds
        .map((playerId) => room.players.find((player) => player.id === playerId))
        .find((player) => player && player.isBot && !Object.hasOwn(state.dayVotes, player.id));
      if (!bot) break;
      const targets = state.alivePlayerIds.filter((playerId) => playerId !== bot.id);
      if (!targets.length) break;
      submitAction(room, bot, { targetId: targets[crypto.randomInt(targets.length)] });
      actions += 1;
      continue;
    }
    break;
  }
}

function syncPlayers(room) {
  const state = room.gameState;
  if (!state) return;
  const oldOrder = state.playerOrder.slice();
  const present = new Set(room.players.map((player) => player.id));
  state.playerOrder = oldOrder.filter((playerId) => present.has(playerId));
  state.alivePlayerIds = state.alivePlayerIds.filter((playerId) => present.has(playerId));
  for (const playerId of oldOrder) {
    if (!present.has(playerId)) {
      delete state.wolfVotes[playerId];
      delete state.dayVotes[playerId];
      delete state.seerFindings[playerId];
    }
  }
  for (const [voterId, targetId] of Object.entries(state.wolfVotes)) {
    if (!state.alivePlayerIds.includes(voterId)
      || state.roles[voterId] !== 'wolf'
      || !state.alivePlayerIds.includes(targetId)
      || state.roles[targetId] === 'wolf') {
      delete state.wolfVotes[voterId];
    }
  }
  for (const [voterId, targetId] of Object.entries(state.dayVotes)) {
    if (!state.alivePlayerIds.includes(voterId) || !state.alivePlayerIds.includes(targetId)) {
      delete state.dayVotes[voterId];
    }
  }
  if (state.pendingHunterId && !present.has(state.pendingHunterId)) state.pendingHunterId = null;
  state.pendingHunters = state.pendingHunters.filter((playerId) => present.has(playerId));
  state.pendingDeaths = state.pendingDeaths.filter((death) => present.has(death.playerId));
  if (state.wolfTargetId && !state.alivePlayerIds.includes(state.wolfTargetId)) state.wolfTargetId = null;
  if (state.doctorTargetId && !state.alivePlayerIds.includes(state.doctorTargetId)) state.doctorTargetId = null;
  if (state.witchSaveTargetId && !state.alivePlayerIds.includes(state.witchSaveTargetId)) state.witchSaveTargetId = null;
  if (state.witchPoisonTargetId && !state.alivePlayerIds.includes(state.witchPoisonTargetId)) state.witchPoisonTargetId = null;
  if (checkVictory(room)) return;
  if (state.phase === 'hunter' && !state.pendingHunterId) continueEliminations(room);
  else if (state.phase === 'night') continueNight(room);
  else if (state.phase === 'day' && state.alivePlayerIds.every((playerId) => Object.hasOwn(state.dayVotes, playerId))) resolveDay(room);
}

function publicState(room, currentPlayer) {
  const state = room.gameState;
  if (!state) return null;
  const isAlive = Boolean(currentPlayer && state.alivePlayerIds.includes(currentPlayer.id));
  const myRole = currentPlayer ? state.roles[currentPlayer.id] || null : null;
  const stepRole = NIGHT_ROLE_FOR_STEP[state.nightStep] || null;
  const isNightActor = Boolean(state.phase === 'night' && isAlive && stepRole && myRole === stepRole);
  const isHunterActor = Boolean(state.phase === 'hunter' && currentPlayer && currentPlayer.id === state.pendingHunterId);
  const hasNightAction = currentPlayer && state.phase === 'night' && (
    (state.nightStep === 'wolves' && myRole === 'wolf' && Object.hasOwn(state.wolfVotes, currentPlayer.id))
    || (state.nightStep === 'seer' && myRole === 'seer' && state.seerFindings[currentPlayer.id]?.round === state.round)
    || (state.nightStep === 'doctor' && myRole === 'doctor' && state.doctorActed)
    || (state.nightStep === 'witch' && myRole === 'witch' && state.witchActed)
    || (state.nightStep === 'cupid' && myRole === 'cupid' && state.cupidDone)
  );
  const hasDayVote = Boolean(currentPlayer && Object.hasOwn(state.dayVotes, currentPlayer.id));
  const myDayVoteId = currentPlayer && state.phase === 'day' ? state.dayVotes[currentPlayer.id] || null : null;
  const myDayVoteNickname = myDayVoteId
    ? room.players.find((player) => player.id === myDayVoteId)?.nickname || null
    : null;
  const myWolfVoteId = currentPlayer && state.phase === 'night' && state.nightStep === 'wolves' && myRole === 'wolf'
    ? state.wolfVotes[currentPlayer.id] || null
    : null;
  const myWolfVoteNickname = myWolfVoteId
    ? room.players.find((player) => player.id === myWolfVoteId)?.nickname || null
    : null;
  let eligibleTargets = [];
  if (state.phase === 'night' && isNightActor) {
    if (state.nightStep === 'wolves') {
      eligibleTargets = state.alivePlayerIds.filter((playerId) => state.roles[playerId] !== 'wolf' && playerId !== currentPlayer.id);
    } else if (state.nightStep === 'seer') {
      eligibleTargets = state.alivePlayerIds.filter((playerId) => playerId !== currentPlayer.id);
    } else if (state.nightStep === 'doctor' || state.nightStep === 'witch' || state.nightStep === 'cupid') {
      eligibleTargets = state.alivePlayerIds.slice();
    }
  } else if (state.phase === 'day' && isAlive) {
    eligibleTargets = state.alivePlayerIds.filter((playerId) => playerId !== currentPlayer.id);
  } else if (isHunterActor) {
    eligibleTargets = state.alivePlayerIds.filter((playerId) => playerId !== currentPlayer.id);
  }
  const canAct = Boolean((isNightActor && (
    (state.nightStep === 'wolves' && eligibleTargets.length > 0)
    || (state.nightStep !== 'wolves' && !hasNightAction && (eligibleTargets.length || myRole === 'witch'))
  ))
    || (state.phase === 'day' && isAlive && eligibleTargets.length)
    || (isHunterActor && eligibleTargets.length));
  const myFinding = currentPlayer && state.seerFindings[currentPlayer.id];
  const wolfAllies = myRole === 'wolf'
    ? livingWolves(state)
      .filter((playerId) => playerId !== currentPlayer?.id)
      .map((playerId) => room.players.find((player) => player.id === playerId)?.nickname)
      .filter(Boolean)
    : [];
  const lovers = Array.isArray(state.lovers) ? state.lovers : [];
  const myLoverId = currentPlayer && lovers.includes(currentPlayer.id)
    ? lovers.find((playerId) => playerId !== currentPlayer.id)
    : null;
  const myLoverNickname = myLoverId
    ? room.players.find((player) => player.id === myLoverId)?.nickname || null
    : null;
  const myCupidLovers = myRole === 'cupid' && state.cupidDone
    ? lovers.map((playerId) => room.players.find((player) => player.id === playerId)?.nickname).filter(Boolean)
    : [];
  const wolfChat = myRole === 'wolf' && isAlive && state.phase === 'night'
    ? (Array.isArray(room.wolfChatMessages) ? room.wolfChatMessages : []).slice(-80).map((message) => ({
      id: message.id,
      nickname: message.nickname || room.players.find((player) => player.id === message.playerId)?.nickname || 'Loup',
      emoji: message.emoji || '🐺',
      color: message.color || '#6d28d9',
      text: String(message.text || ''),
      kind: message.kind === 'reaction' ? 'reaction' : 'message',
      createdAt: Number(message.createdAt) || Date.now(),
    }))
    : [];
  const nightStepLabel = state.phase === 'night'
    ? (isNightActor
      ? ({
        cupid: 'Tu choisis secrètement deux amoureux.',
        wolves: 'Les loups se réveillent et choisissent une victime.',
        seer: 'La voyante ouvre les yeux : inspecte un joueur.',
        doctor: 'Le médecin veille : protège une personne.',
        witch: 'La Sorcière se réveille : ses potions sont prêtes.',
      })[state.nightStep] || 'Ton rôle agit cette nuit.'
      : (isAlive ? 'Le village dort. Les rôles agissent en secret.' : 'Tu es éliminé·e : la nuit continue en secret.'))
    : (state.phase === 'hunter'
      ? (isHunterActor ? 'Ton dernier tir : choisis un joueur vivant à emporter avec toi.' : 'Un dernier tir est en cours avant la suite de la partie.')
      : '');
  const winnerNames = (state.winnerIds || [])
    .map((playerId) => room.players.find((player) => player.id === playerId)?.nickname)
    .filter(Boolean);
  const currentLoverIsForViewer = currentPlayer && myLoverId;
  const deadlineSeconds = Number.isFinite(state.deadlineAt)
    ? Math.max(0, Math.ceil((state.deadlineAt - Date.now()) / 1000))
    : null;

  return {
    phase: state.phase,
    result: state.result,
    startedAt: state.startedAt,
    round: state.round,
    villagePowersDisabled: Boolean(state.villagePowersDisabled),
    nightStep: isNightActor || isHunterActor ? state.nightStep : null,
    nightStepLabel,
    secondsRemaining: deadlineSeconds,
    myRole,
    myRoleName: myRole ? ROLE_INFO[myRole].name : null,
    myRoleIcon: myRole ? ROLE_INFO[myRole].icon : null,
    myRoleDescription: myRole ? ROLE_INFO[myRole].description : null,
    mySeerFinding: myRole === 'seer' && myFinding
      ? {
        nickname: room.players.find((player) => player.id === myFinding.targetId)?.nickname || 'Joueur',
        isWolf: myFinding.isWolf,
        round: myFinding.round,
      }
      : null,
    myAllies: wolfAllies,
    wolfChat,
    myLoverNickname,
    myCupidLovers,
    myPotions: myRole === 'witch'
      ? { healAvailable: state.witchHealAvailable, poisonAvailable: state.witchPoisonAvailable }
      : null,
    witchCanSave: Boolean(myRole === 'witch' && state.phase === 'night' && state.nightStep === 'witch'
      && state.witchHealAvailable && state.wolfTargetId && state.alivePlayerIds.includes(state.wolfTargetId)),
    witchCanPoison: Boolean(myRole === 'witch' && state.phase === 'night' && state.nightStep === 'witch'
      && state.witchPoisonAvailable),
    witchVictimId: myRole === 'witch' && state.phase === 'night' && state.nightStep === 'witch'
      ? state.wolfTargetId
      : null,
    witchVictimNickname: myRole === 'witch' && state.phase === 'night' && state.nightStep === 'witch'
      ? room.players.find((player) => player.id === state.wolfTargetId)?.nickname || null
      : null,
    isAlive,
    canAct,
    actionKind: isHunterActor ? 'hunter' : (isNightActor ? state.nightStep : (state.phase === 'day' ? 'vote' : null)),
    hasVoted: Boolean(hasNightAction || hasDayVote),
    myDayVoteId,
    myDayVoteNickname,
    myWolfVoteId,
    myWolfVoteNickname,
    eligibleTargets: eligibleTargets.map((playerId) => {
      const player = room.players.find((candidate) => candidate.id === playerId);
      const isMyLover = Boolean(currentLoverIsForViewer && player && player.id === myLoverId);
      return player ? { id: player.id, nickname: player.nickname, isYou: player.id === currentPlayer?.id, isMyLover } : null;
    }).filter(Boolean),
    actionCount: state.phase === 'night' && state.nightStep === 'wolves' && myRole === 'wolf'
      ? Object.keys(state.wolfVotes).length
      : (state.phase === 'day' ? Object.keys(state.dayVotes).length : 0),
    actionTotal: state.phase === 'night' && state.nightStep === 'wolves' && myRole === 'wolf'
      ? livingWolves(state).length
      : (state.phase === 'day' ? state.alivePlayerIds.length : 0),
    players: state.playerOrder
      .map((playerId) => {
        const player = room.players.find((candidate) => candidate.id === playerId);
        if (!player) return null;
        const alive = state.alivePlayerIds.includes(playerId);
        const revealRole = !alive || state.phase === 'finished';
        return {
          id: player.id,
          nickname: player.nickname,
          isBot: Boolean(player.isBot),
          isAlive: alive,
          isYou: Boolean(currentPlayer && currentPlayer.id === player.id),
          isMyLover: Boolean(currentLoverIsForViewer && player.id === myLoverId),
          role: revealRole ? state.roles[playerId] : null,
          roleName: revealRole ? ROLE_INFO[state.roles[playerId]]?.name || ROLE_INFO.villager.name : null,
        };
      })
      .filter(Boolean),
    winnerId: state.winnerId,
    winnerIds: state.winnerIds.slice(),
    winnerNames,
    winnerFaction: state.winnerFaction,
    lastAction: state.lastAction,
  };
}

function cheatRoles(room) {
  const state = room.gameState;
  if (!state) return [];
  return state.playerOrder
    .map((playerId) => {
      const player = room.players.find((candidate) => candidate.id === playerId);
      if (!player) return null;
      const role = state.roles[playerId] || 'villager';
      return {
        playerId,
        nickname: player.nickname,
        isBot: Boolean(player.isBot),
        isAlive: state.alivePlayerIds.includes(playerId),
        role,
        roleName: ROLE_INFO[role]?.name || ROLE_INFO.villager.name,
      };
    })
    .filter(Boolean);
}

module.exports = {
  advanceTimedGame,
  cheatRoles,
  createGame,
  submitAction,
  processBots,
  publicState,
  syncPlayers,
};
