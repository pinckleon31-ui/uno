'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loupGarou = require('../loup-garou');

function makeRoom(count = 4, playerTypes = []) {
  const players = Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    nickname: playerTypes[index] === 'bot' ? `Bot ${index + 1}` : `Joueur ${index + 1}`,
    isBot: playerTypes[index] === 'bot',
  }));
  return {
    id: 'room-loup-test',
    game: 'loup-garou',
    hostPlayerId: players[0].id,
    players,
    gameState: loupGarou.createGame(players),
  };
}

function playerForRole(room, role) {
  return room.players.find((player) => room.gameState.roles[player.id] === role);
}

function playersForRole(room, role) {
  return room.players.filter((player) => room.gameState.roles[player.id] === role);
}

function safeNightOptions(room, { avoidRoles = [] } = {}) {
  const state = room.gameState;
  const cupid = playerForRole(room, 'cupid');
  const villagers = state.alivePlayerIds.filter((playerId) => (
    state.roles[playerId] !== 'wolf' && playerId !== cupid.id
  ));
  const lovers = villagers.slice(0, 2);
  const wolfTargetId = villagers.find((playerId) => (
    !lovers.includes(playerId) && !avoidRoles.includes(state.roles[playerId])
  ));
  return { lovers, wolfTargetId };
}

function completeNight(room, options = {}) {
  let guard = 0;
  while (room.gameState.phase === 'night' && guard < 20) {
    const state = room.gameState;
    if (state.nightStep === 'cupid') {
      const cupid = playerForRole(room, 'cupid');
      const lovers = options.lovers || state.alivePlayerIds.filter((id) => id !== cupid.id).slice(0, 2);
      loupGarou.submitAction(room, cupid, {
        firstTargetId: lovers[0],
        secondTargetId: lovers[1],
      });
    } else if (state.nightStep === 'wolves') {
      const wolves = state.alivePlayerIds
        .filter((id) => state.roles[id] === 'wolf')
        .map((id) => room.players.find((player) => player.id === id));
      const targetId = options.wolfTargetId || state.alivePlayerIds.find((id) => state.roles[id] !== 'wolf');
      for (const wolf of wolves) {
        if (!Object.hasOwn(state.wolfVotes, wolf.id)) loupGarou.submitAction(room, wolf, { targetId });
      }
    } else if (state.nightStep === 'seer') {
      const seer = playerForRole(room, 'seer');
      const targetId = state.alivePlayerIds.find((id) => id !== seer.id);
      loupGarou.submitAction(room, seer, { targetId });
    } else if (state.nightStep === 'doctor') {
      const doctor = playerForRole(room, 'doctor');
      const targetId = options.doctorTargetId || doctor.id;
      loupGarou.submitAction(room, doctor, { targetId });
    } else if (state.nightStep === 'witch') {
      const witch = playerForRole(room, 'witch');
      loupGarou.submitAction(room, witch, {
        action: 'witch',
        save: false,
        poisonTargetId: '',
        ...(options.witchAction || {}),
      });
    } else {
      assert.fail(`Étape de nuit inattendue : ${state.nightStep}`);
    }
    guard += 1;
  }
  assert.ok(guard < 20, 'la séquence nocturne termine ses actions');
}

test('distribue des rôles secrets selon la taille de la partie', () => {
  const four = makeRoom(4);
  const fourRoles = Object.values(four.gameState.roles);
  assert.equal(fourRoles.filter((role) => role === 'wolf').length, 1);
  assert.equal(fourRoles.filter((role) => role === 'seer').length, 0);
  assert.equal(fourRoles.filter((role) => role === 'doctor').length, 0);
  const fourView = loupGarou.publicState(four, four.players[0]);
  assert.equal(fourView.phase, 'night');
  assert.ok(fourView.myRole);
  assert.ok(fourView.myRoleDescription);
  assert.ok(fourView.players.every((player) => player.role === null), 'les rôles des joueurs vivants restent secrets');
  assert.throws(() => loupGarou.createGame(four.players.slice(0, 3)), { statusCode: 400 });

  const six = makeRoom(6);
  assert.equal(playersForRole(six, 'seer').length, 1);
  assert.equal(playersForRole(six, 'doctor').length, 1);
  assert.equal(playersForRole(six, 'witch').length, 0);

  const eight = makeRoom(8);
  assert.equal(playersForRole(eight, 'wolf').length, 2);
  for (const role of ['seer', 'doctor', 'witch', 'cupid']) assert.equal(playersForRole(eight, role).length, 1);
  assert.equal(playersForRole(eight, 'villager').length, 2);

  const ten = makeRoom(10);
  for (const role of ['hunter', 'elder']) assert.equal(playersForRole(ten, role).length, 1);
  assert.equal(playersForRole(ten, 'villager').length, 2);
});

test('la voyante inspecte en secret et le médecin peut protéger y compris lui-même', () => {
  const room = makeRoom(6);
  const state = room.gameState;
  const wolf = playerForRole(room, 'wolf');
  const seer = playerForRole(room, 'seer');
  const doctor = playerForRole(room, 'doctor');

  loupGarou.submitAction(room, wolf, doctor.id);
  assert.equal(state.nightStep, 'seer');
  loupGarou.submitAction(room, seer, doctor.id);
  assert.equal(loupGarou.publicState(room, seer).mySeerFinding.isWolf, false);
  const other = room.players.find((player) => player.id !== seer.id && player.id !== doctor.id);
  const otherView = loupGarou.publicState(room, other);
  assert.equal(otherView.mySeerFinding, null);
  assert.equal(otherView.nightStep, null, 'l’étape active de la nuit reste cachée aux autres rôles');
  assert.doesNotMatch(otherView.nightStepLabel, /voyante|médecin|sorcière/i);
  assert.equal(state.nightStep, 'doctor');
  loupGarou.submitAction(room, doctor, doctor.id);
  assert.equal(state.phase, 'day');
  assert.ok(state.alivePlayerIds.includes(doctor.id), 'le médecin a pu se protéger lui-même');
  assert.equal(state.lastAction.type, 'save');
});

test('Cupidon, amoureux et Sorcière peuvent transformer la première nuit', () => {
  const room = makeRoom(8);
  const state = room.gameState;
  const cupid = playerForRole(room, 'cupid');
  const seer = playerForRole(room, 'seer');
  const doctor = playerForRole(room, 'doctor');
  const witch = playerForRole(room, 'witch');
  const wolves = playersForRole(room, 'wolf');
  const victim = playerForRole(room, 'villager');

  loupGarou.submitAction(room, cupid, { firstTargetId: seer.id, secondTargetId: doctor.id });
  assert.deepEqual(state.lovers, [seer.id, doctor.id]);
  const cupidView = loupGarou.publicState(room, cupid);
  assert.equal(cupidView.myCupidLovers.length, 2);
  assert.equal(loupGarou.publicState(room, seer).myLoverNickname, doctor.nickname);
  assert.equal(loupGarou.publicState(room, wolves[0]).myLoverNickname, null);
  assert.equal(state.nightStep, 'wolves');
  assert.throws(() => loupGarou.submitAction(room, playerForRole(room, 'villager'), {
    firstTargetId: seer.id, secondTargetId: doctor.id,
  }), { statusCode: 403 });

  for (const wolf of wolves) loupGarou.submitAction(room, wolf, { targetId: victim.id });
  assert.equal(state.wolfTargetId, victim.id);
  assert.equal(state.nightStep, 'seer');
  loupGarou.submitAction(room, seer, { targetId: victim.id });
  assert.equal(state.nightStep, 'doctor');
  loupGarou.submitAction(room, doctor, { targetId: doctor.id });
  assert.equal(state.nightStep, 'witch');
  const witchView = loupGarou.publicState(room, witch);
  assert.equal(witchView.witchVictimNickname, victim.nickname);
  assert.equal(witchView.witchCanSave, true);
  assert.equal(loupGarou.publicState(room, cupid).witchVictimNickname, null, 'seule la Sorcière voit la victime de la nuit');

  loupGarou.submitAction(room, witch, { action: 'witch', save: true, poisonTargetId: wolves[0].id });
  assert.equal(state.phase, 'day');
  assert.ok(state.alivePlayerIds.includes(victim.id), 'la potion de vie sauve la victime des loups');
  assert.equal(state.alivePlayerIds.includes(wolves[0].id), false, 'la potion de mort élimine sa cible');
  assert.equal(state.witchHealAvailable, false);
  assert.equal(state.witchPoisonAvailable, false);
  assert.equal(loupGarou.publicState(room, witch).myPotions.healAvailable, false);
});

test('le Chasseur tire à sa mort et le lien amoureux entraîne les deux éliminations', () => {
  const room = makeRoom(9);
  const state = room.gameState;
  const cupid = playerForRole(room, 'cupid');
  const hunter = playerForRole(room, 'hunter');
  const lover = playerForRole(room, 'villager');
  const wolves = playersForRole(room, 'wolf');
  const doctor = playerForRole(room, 'doctor');

  completeNight(room, {
    lovers: [hunter.id, lover.id],
    wolfTargetId: hunter.id,
    doctorTargetId: doctor.id,
    witchAction: { save: false, poisonTargetId: '' },
  });
  assert.equal(state.lovers[0], hunter.id);
  assert.equal(state.phase, 'hunter', 'la partie attend le dernier tir du Chasseur');
  assert.equal(state.alivePlayerIds.includes(hunter.id), false);
  assert.equal(state.alivePlayerIds.includes(lover.id), false, 'l’amoureux meurt de chagrin');
  const hunterView = loupGarou.publicState(room, hunter);
  assert.equal(hunterView.isAlive, false);
  assert.equal(hunterView.canAct, true);
  assert.equal(hunterView.actionKind, 'hunter');
  assert.ok(hunterView.eligibleTargets.some((target) => wolves.some((wolf) => wolf.id === target.id)));

  loupGarou.submitAction(room, hunter, { targetId: wolves[0].id });
  assert.equal(state.alivePlayerIds.includes(wolves[0].id), false, 'le dernier tir élimine le loup choisi');
  assert.equal(state.phase, 'day');
});

test('les amoureux gagnent comme troisième camp quand ils sont les deux derniers', () => {
  const room = makeRoom(8);
  const state = room.gameState;
  const wolf = playerForRole(room, 'wolf');
  const villager = playerForRole(room, 'villager');
  state.lovers = [wolf.id, villager.id];
  state.alivePlayerIds = [wolf.id, villager.id];
  loupGarou.syncPlayers(room);
  assert.equal(state.phase, 'finished');
  assert.equal(state.winnerFaction, 'lovers');
  assert.deepEqual(new Set(state.winnerIds), new Set([wolf.id, villager.id]));
});

test('l’Ancien résiste à une attaque, puis peut être tué par une seconde nuit', () => {
  const room = makeRoom(10);
  const state = room.gameState;
  const elder = playerForRole(room, 'elder');
  const doctor = playerForRole(room, 'doctor');
  const seer = playerForRole(room, 'seer');
  const firstLovers = [seer.id, doctor.id];

  completeNight(room, { wolfTargetId: elder.id, doctorTargetId: doctor.id, lovers: firstLovers });
  assert.equal(state.phase, 'day');
  assert.equal(state.elderSurvivedAttack, true);
  assert.ok(state.alivePlayerIds.includes(elder.id), 'l’Ancien survit à la première attaque des loups');

  loupGarou.advanceTimedGame(room, state.deadlineAt);
  assert.equal(state.phase, 'night', 'la fin du délai de vote relance la nuit');
  assert.equal(state.round, 2);
  completeNight(room, { wolfTargetId: elder.id, doctorTargetId: doctor.id });
  assert.equal(state.phase, 'day');
  assert.equal(state.alivePlayerIds.includes(elder.id), false, 'la seconde attaque des loups élimine l’Ancien');
});

test('l’exécution de l’Ancien par le village désactive les pouvoirs spéciaux', () => {
  const room = makeRoom(10);
  const state = room.gameState;
  const elder = playerForRole(room, 'elder');
  const seer = playerForRole(room, 'seer');
  const doctor = playerForRole(room, 'doctor');
  const hunter = playerForRole(room, 'hunter');
  const firstVictim = playerForRole(room, 'villager');

  completeNight(room, {
    wolfTargetId: firstVictim.id,
    doctorTargetId: doctor.id,
    lovers: [seer.id, doctor.id],
  });
  assert.equal(state.phase, 'day');
  assert.ok(state.alivePlayerIds.includes(elder.id));
  for (const voterId of state.alivePlayerIds.slice()) {
    const voter = room.players.find((player) => player.id === voterId);
    const targetId = voterId === elder.id
      ? state.alivePlayerIds.find((playerId) => playerId !== elder.id)
      : elder.id;
    loupGarou.submitAction(room, voter, { targetId });
  }
  assert.equal(state.alivePlayerIds.includes(elder.id), false);
  assert.equal(state.villagePowersDisabled, true);
  assert.equal(state.phase, 'night');

  completeNight(room, { wolfTargetId: hunter.id, doctorTargetId: doctor.id });
  assert.equal(state.phase, 'day', 'le Chasseur n’obtient plus de dernier tir une fois les pouvoirs perdus');
  assert.equal(state.alivePlayerIds.includes(hunter.id), false);
});

test('les bots exécutent les rôles spéciaux sans bloquer une partie', () => {
  const room = makeRoom(8, ['human', 'bot', 'bot', 'bot', 'bot', 'bot', 'bot', 'bot']);
  loupGarou.processBots(room);
  assert.ok(['night', 'day', 'hunter', 'finished'].includes(room.gameState.phase));
  assert.ok(room.gameState.alivePlayerIds.length > 0);
  if (room.gameState.phase === 'night') {
    assert.ok(room.gameState.deadlineAt > Date.now(), 'une action humaine en attente possède un délai');
  }
});

test('un choix invalide de la Sorcière ne consomme aucune potion', () => {
  const room = makeRoom(8);
  const state = room.gameState;
  const witch = playerForRole(room, 'witch');
  const savedTarget = room.players.find((player) => player.id !== witch.id);
  state.nightStep = 'witch';
  state.wolfTargetId = savedTarget.id;
  state.witchHealAvailable = true;
  state.witchPoisonAvailable = true;
  state.witchSaveTargetId = null;
  state.witchPoisonTargetId = null;
  state.witchActed = false;

  assert.throws(() => loupGarou.submitAction(room, witch, {
    action: 'witch',
    save: true,
    poisonTargetId: 'joueur-inexistant',
  }), { statusCode: 400 });
  assert.equal(state.witchHealAvailable, true);
  assert.equal(state.witchPoisonAvailable, true);
  assert.equal(state.witchSaveTargetId, null);
  assert.equal(state.witchPoisonTargetId, null);
  assert.equal(state.witchActed, false);
});

test('les loups et le village peuvent corriger leur vote, sans voir celui des autres', () => {
  const nightRoom = makeRoom(8);
  const nightState = nightRoom.gameState;
  const cupid = playerForRole(nightRoom, 'cupid');
  const wolves = playersForRole(nightRoom, 'wolf');
  const targets = nightState.alivePlayerIds.filter((playerId) => nightState.roles[playerId] !== 'wolf');
  loupGarou.submitAction(nightRoom, cupid, {
    firstTargetId: nightState.alivePlayerIds[0],
    secondTargetId: nightState.alivePlayerIds[1],
  });
  assert.equal(nightState.nightStep, 'wolves');

  loupGarou.submitAction(nightRoom, wolves[0], { targetId: targets[0] });
  const wolfView = loupGarou.publicState(nightRoom, wolves[0]);
  assert.equal(wolfView.canAct, true, 'le loup peut corriger tant que son équipe n’a pas terminé');
  assert.equal(wolfView.myWolfVoteId, targets[0]);
  assert.equal(loupGarou.publicState(nightRoom, nightRoom.players.find((player) => player.id === targets[0])).myWolfVoteId, null,
    'la cible ne reçoit pas le vote des loups');
  loupGarou.submitAction(nightRoom, wolves[0], { targetId: targets[1] });
  assert.equal(nightState.wolfVotes[wolves[0].id], targets[1]);
  loupGarou.submitAction(nightRoom, wolves[1], { targetId: targets[1] });
  assert.equal(nightState.nightStep, 'seer');

  const dayRoom = makeRoom(8);
  completeNight(dayRoom, safeNightOptions(dayRoom));
  const dayState = dayRoom.gameState;
  assert.equal(dayState.phase, 'day');
  const voter = dayRoom.players.find((player) => dayState.alivePlayerIds.includes(player.id));
  const dayTargets = dayState.alivePlayerIds.filter((playerId) => playerId !== voter.id);
  loupGarou.submitAction(dayRoom, voter, { targetId: dayTargets[0] });
  const voterView = loupGarou.publicState(dayRoom, voter);
  assert.equal(voterView.canAct, true, 'le vote reste modifiable jusqu’au verdict');
  assert.equal(voterView.myDayVoteId, dayTargets[0]);
  const observer = dayRoom.players.find((player) => player.id !== voter.id && dayState.alivePlayerIds.includes(player.id));
  assert.equal(loupGarou.publicState(dayRoom, observer).myDayVoteId, null, 'les votes individuels restent privés');
  loupGarou.submitAction(dayRoom, voter, { targetId: dayTargets[1] });
  assert.equal(dayState.dayVotes[voter.id], dayTargets[1]);
  assert.throws(() => loupGarou.submitAction(dayRoom, voter, { targetId: dayTargets[1] }), { statusCode: 409 });
});

test('retire un vote nocturne devenu invalide quand sa cible quitte le salon', () => {
  const room = makeRoom(8);
  const state = room.gameState;
  const cupid = playerForRole(room, 'cupid');
  const wolves = playersForRole(room, 'wolf');
  const nightOptions = safeNightOptions(room);
  const targets = state.alivePlayerIds.filter((playerId) => (
    state.roles[playerId] !== 'wolf' && !nightOptions.lovers.includes(playerId)
  ));
  const departingTarget = nightOptions.wolfTargetId;
  const replacementTarget = targets.find((playerId) => playerId !== departingTarget);
  loupGarou.submitAction(room, cupid, {
    firstTargetId: nightOptions.lovers[0],
    secondTargetId: nightOptions.lovers[1],
  });
  loupGarou.submitAction(room, wolves[0], { targetId: departingTarget });
  assert.equal(state.wolfVotes[wolves[0].id], departingTarget);

  room.players = room.players.filter((player) => player.id !== departingTarget);
  loupGarou.syncPlayers(room);
  assert.equal(state.wolfVotes[wolves[0].id], undefined);
  assert.equal(loupGarou.publicState(room, wolves[0]).myWolfVoteId, null);
  loupGarou.submitAction(room, wolves[0], { targetId: replacementTarget });
  loupGarou.submitAction(room, wolves[1], { targetId: replacementTarget });
  assert.equal(state.wolfTargetId, replacementTarget);
  assert.notEqual(state.phase, 'finished');
});

test('permet de revoter si la cible du vote du village quitte le salon', () => {
  const room = makeRoom(12);
  completeNight(room, safeNightOptions(room, { avoidRoles: ['hunter'] }));
  const state = room.gameState;
  assert.equal(state.phase, 'day', 'la nuit se termine sur un vote du village');
  const voter = room.players.find((player) => state.alivePlayerIds.includes(player.id));
  // Un villageois sans lien amoureux quitte la partie : aucun camp ne peut gagner par ce seul départ.
  const leaving = room.players.find((player) => (
    state.alivePlayerIds.includes(player.id)
    && player.id !== voter.id
    && state.roles[player.id] !== 'wolf'
    && !(state.lovers || []).includes(player.id)
  ));
  const targets = [leaving.id];
  loupGarou.submitAction(room, voter, { targetId: targets[0] });
  assert.equal(state.dayVotes[voter.id], targets[0]);

  room.players = room.players.filter((player) => player.id !== targets[0]);
  loupGarou.syncPlayers(room);
  assert.equal(state.phase, 'day', 'le départ d’un villageois ne termine pas la partie');
  assert.equal(state.dayVotes[voter.id], undefined);
  const view = loupGarou.publicState(room, voter);
  assert.equal(view.canAct, true);
  assert.equal(view.myDayVoteId, null);
  const nextTarget = state.alivePlayerIds.find((playerId) => playerId !== voter.id);
  loupGarou.submitAction(room, voter, { targetId: nextTarget });
  assert.equal(state.dayVotes[voter.id], nextTarget);
});

test('les délais font avancer automatiquement la nuit puis le vote du village', () => {
  const room = makeRoom(8);
  const state = room.gameState;
  const future = Date.now() + 60 * 60 * 1000;
  let guard = 0;
  while (state.phase === 'night' && guard < 10) {
    assert.equal(loupGarou.advanceTimedGame(room, future), true);
    guard += 1;
  }
  assert.equal(state.phase, 'day');
  assert.equal(loupGarou.advanceTimedGame(room, future), true);
  assert.equal(state.phase, 'night');
  assert.equal(state.round, 2);
});

test('une mort ordinaire n’emporte plus un amoureux au hasard', () => {
  const room = makeRoom(12);
  completeNight(room, safeNightOptions(room, { avoidRoles: ['hunter'] }));
  const state = room.gameState;
  const lovers = state.lovers || [];
  assert.equal(lovers.length, 2);
  assert.ok(
    lovers.every((playerId) => state.alivePlayerIds.includes(playerId)),
    'la victime des loups n’était pas amoureuse : les deux amoureux restent en vie',
  );
});

test('la mort d’un amoureux emporte bien son partenaire', () => {
  const room = makeRoom(12);
  const state = room.gameState;
  const cupid = playerForRole(room, 'cupid');
  const protectedRoles = new Set(['wolf', 'hunter', 'elder', 'doctor']);
  const lovers = state.alivePlayerIds
    .filter((playerId) => playerId !== cupid.id && !protectedRoles.has(state.roles[playerId]))
    .slice(0, 2);
  assert.equal(lovers.length, 2);
  completeNight(room, { lovers, wolfTargetId: lovers[0] });
  assert.equal(state.alivePlayerIds.includes(lovers[0]), false, 'la victime des loups meurt');
  assert.equal(state.alivePlayerIds.includes(lovers[1]), false, 'son amoureux meurt de chagrin');
});
