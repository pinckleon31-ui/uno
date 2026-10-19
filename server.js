'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const unoEngine = require('./uno');
const puissance4Engine = require('./puissance4');
const loupGarouEngine = require('./loup-garou');
const quizEngine = require('./quiz');
const blindTestEngine = require('./blind_melody');
const morpionEngine = require('./morpion');
const memoireEngine = require('./memoire');

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '.data'));
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const CREATOR_CODE = String(process.env.CREATOR_CODE || '').trim();
const PRESENCE_TTL = 2 * 60 * 1000;
const ACCOUNT_SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const ACCOUNT_LOGIN_LOCK_DURATION = 10 * 60 * 1000;
const MAX_ACCOUNT_LOGIN_FAILURES = 5;
const MAX_ACCOUNT_SESSIONS = 5;
const MIN_ACCOUNT_PASSWORD_LENGTH = 4;
const MAX_ACCOUNT_PASSWORD_LENGTH = 64;
const SCRYPT_KEY_LENGTH = 64;
const DUMMY_PASSWORD_SALT = crypto.randomBytes(16).toString('base64url');
const EMPTY_ROOM_TTL = 12 * 60 * 60 * 1000;
const CREATOR_TICKET_TTL = 30 * 60 * 1000;
const ADMIN_SESSION_TTL = 30 * 60 * 1000;
// Présence en ligne : une personne disparaît de la liste 40 s après son dernier signe de vie.
const ONLINE_TTL = 40 * 1000;
const MAX_ONLINE_ENTRIES = 400;
const BUZZ_SOUNDS = ['cloche', 'alarme', 'tada', 'mega'];
const BUZZ_SOUND_LABELS = Object.freeze({
  cloche: '🔔 Cloche',
  alarme: '🚨 Alarme',
  tada: '🎉 Tada',
  mega: '📢 MÉGA',
});

function soundLabel(sound) {
  return BUZZ_SOUND_LABELS[sound] || String(sound || '');
}

// Le journal garde les actions utiles (connexion, salons, parties, victoires,
// gestes admin). Il ne contient JAMAIS de frappe au clavier, de mot de passe,
// ni le code organisateur.
const MAX_ACTIVITY_ENTRIES = 600;
const ACTIVITY_KINDS = Object.freeze(['visite', 'compte', 'salon', 'partie', 'victoire', 'admin', 'clic', 'touche', 'tchat']);

// Liste blanche des boutons suivis. Le navigateur n'envoie qu'une CLÉ courte :
// le serveur choisit lui-même la phrase. Aucun contenu de champ, aucune touche
// de clavier et aucun texte libre ne transitent par cette route.
const UI_ACTIONS = Object.freeze({
  'accueil': 'est revenu à l’accueil',
  'compte': 'a ouvert son compte',
  'creation-partie': 'a ouvert la création de partie',
  'rejoindre-partie': 'a ouvert la fenêtre pour rejoindre un salon',
  'code-organisateur': 'a ouvert la saisie du code organisateur',
  'salon': 'a ouvert un salon',
  'jeux-solo': 'a ouvert les jeux solo',
  'solo-snake': 'a lancé une partie de Snake',
  'solo-2048': 'a lancé une partie de 2048',
  'solo-demineur': 'a lancé une partie de Démineur',
  'solo-memory': 'a lancé une partie de Memory',
  'plein-ecran': 'a basculé le jeu en plein écran',
  'admin': 'a ouvert le panneau administrateur',
});

const SOLO_GAME_NAMES = Object.freeze({
  snake: 'Snake',
  '2048': '2048',
  demineur: 'Démineur',
  memory: 'Memory',
});
const DIRECTION_SYMBOLS = Object.freeze({ up: '↑', down: '↓', left: '←', right: '→' });

// Traduit une CLÉ reçue du navigateur en phrase. Tout ce qui n'est pas dans ce
// catalogue est refusé : le client ne peut jamais faire écrire un texte libre.
// Aucune lettre, aucun chiffre et aucun contenu de champ ne passe par ici :
// seules les flèches de jeu et les boutons de l'interface sont connus.
function actionLabel(action) {
  const key = String(action || '');
  if (UI_ACTIONS[key]) return { text: UI_ACTIONS[key], kind: 'clic' };

  let match = /^solo-(snake|2048|demineur|memory)$/.exec(key);
  if (match) return { text: `a lancé une partie de ${SOLO_GAME_NAMES[match[1]]}`, kind: 'clic' };

  match = /^solo-touche-(snake|2048|demineur)-(up|down|left|right)$/.exec(key);
  if (match) {
    return {
      text: `a appuyé sur ${DIRECTION_SYMBOLS[match[2]]} au ${SOLO_GAME_NAMES[match[1]]}`,
      kind: 'touche',
    };
  }

  if (key === 'solo-pause') return { text: 'a mis le jeu en pause', kind: 'clic' };
  if (key === 'solo-reprendre') return { text: 'a repris le jeu', kind: 'clic' };
  if (key === 'solo-rejouer') return { text: 'a recommencé une partie', kind: 'clic' };
  if (key === 'solo-reglage') return { text: 'a changé un réglage du jeu', kind: 'clic' };
  if (key === 'solo-drapeau') return { text: 'a basculé le mode drapeau du Démineur', kind: 'clic' };
  if (key === 'solo-continuer') return { text: 'a enchaîné sur la manche suivante', kind: 'clic' };
  if (key === 'memoire-retourner-carte') return { text: 'a retourné une carte au Memory', kind: 'clic' };
  if (key === 'salon-reaction') return { text: 'a envoyé une réaction rapide dans le tchat', kind: 'clic' };
  return null;
}
const CODE_LOCK_DURATION = 10 * 60 * 1000;
const MAX_FAILED_CODES = 5;
const MAX_BODY_SIZE = 16 * 1024;

const GAMES = Object.freeze({
  uno: { label: 'UNO', minPlayers: 2, maxPlayers: 10 },
  'loup-garou': { label: 'Loup-garou', minPlayers: 4, maxPlayers: 12 },
  quiz: { label: 'Quiz express', minPlayers: 2, maxPlayers: 20 },
  'puissance-4': { label: 'Puissance 4', minPlayers: 2, maxPlayers: 2 },
  'blind-test': { label: 'Blind test', minPlayers: 2, maxPlayers: 12 },
  morpion: { label: 'Morpion', minPlayers: 2, maxPlayers: 2 },
  memoire: { label: 'Memory', minPlayers: 2, maxPlayers: 4 },
});
const BOT_NAMES = ['Mila', 'Noé', 'Lou', 'Sam', 'Zoé', 'Tom', 'Inès', 'Eden', 'Milo', 'Jade'];
const CHAT_MAX_MESSAGES = 80;
const CHAT_MAX_LENGTH = 220;
const CHAT_MIN_INTERVAL = 650;
const CHAT_REACTIONS = new Set(['👏', '😂', '🤔', '🎉', '❤️', '🔥', '🤝', '💡']);
const CHAT_EMOJIS = ['🦊', '🐼', '🐸', '🦉', '🐯', '🐙', '🐝', '🐳', '🦄', '🐢', '🐨', '🐵', '🐧', '🐬', '🐰', '🦋', '🐲', '🦖', '🐱', '🐻'];
const CHAT_COLORS = ['#c2410c', '#6d28d9', '#0369a1', '#15803d', '#be185d', '#4338ca', '#a16207', '#0f766e', '#7e22ce', '#b91c1c', '#4d7c0f', '#a21caf', '#1d4ed8', '#c026d3', '#047857', '#b45309', '#7c3aed', '#0e7490', '#be123c', '#3f6212'];

let rooms = loadRooms();
let accounts = loadAccounts();
const creatorTickets = new Map();
const adminSessions = new Map();
const onlinePeople = new Map();
let activityLog = loadActivity();
const activityDedupe = new Map();
const failedCodes = new Map();
const failedAccountLogins = new Map();
const chatLastSent = new Map();

function loadRooms() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.rooms)) return [];
    return parsed.rooms.filter((room) => (
      room && typeof room.id === 'string' && Array.isArray(room.players)
    ));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Impossible de lire les salons enregistrés :', error.message);
    }
    return [];
  }
}

function saveRooms() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(DATA_FILE, JSON.stringify({ rooms }, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(DATA_FILE, 0o600);
  } catch {
    // Les permissions POSIX ne sont pas disponibles sur tous les systèmes.
  }
}

function loadAccounts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.accounts)) return [];
    return parsed.accounts
      .filter((account) => (
        account && typeof account.id === 'string' && typeof account.nickname === 'string'
        && typeof account.passwordSalt === 'string' && typeof account.passwordHash === 'string'
      ))
      .map((account) => ({
        ...account,
        nicknameKey: account.nickname.normalize('NFKC').toLocaleLowerCase('fr-FR'),
        wins: Number.isInteger(account.wins) && account.wins > 0 ? account.wins : 0,
        isAdmin: account.isAdmin === true,
        isCheater: account.isCheater === true,
        sessions: Array.isArray(account.sessions) ? account.sessions : [],
      }));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Impossible de lire les comptes enregistrés :', error.message);
    }
    return [];
  }
}

function saveAccounts() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts }, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(ACCOUNTS_FILE, 0o600);
  } catch {
    // Les permissions POSIX ne sont pas disponibles sur tous les systèmes.
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function loadActivity() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter((entry) => (
        entry && typeof entry.nickname === 'string' && typeof entry.text === 'string' && Number.isFinite(entry.at)
      ))
      .slice(0, MAX_ACTIVITY_ENTRIES);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Impossible de lire le journal d’activité :', error.message);
    }
    return [];
  }
}

function saveActivity() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ACTIVITY_FILE, JSON.stringify({ entries: activityLog }, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(ACTIVITY_FILE, 0o600);
  } catch {
    // Les permissions POSIX ne sont pas disponibles sur tous les systèmes.
  }
}

// Enregistre UNE action lisible. `dedupeKey` évite les doublons quand le
// navigateur renvoie plusieurs fois la même requête en quelques secondes.
// Ne jamais passer ici un mot de passe, un code ou une frappe de clavier.
function logActivity({ nickname, accountId = null, kind = 'visite', text, dedupeKey = '', dedupeMs = 5000, maxTextLength = 160 }) {
  const safeNickname = cleanText(nickname, 18) || 'Visiteur';
  const safeText = cleanText(text, maxTextLength);
  if (!safeText || !ACTIVITY_KINDS.includes(kind)) return null;
  const now = Date.now();
  if (dedupeKey) {
    const lastAt = activityDedupe.get(dedupeKey) || 0;
    if (now - lastAt < dedupeMs) return null;
    activityDedupe.set(dedupeKey, now);
    if (activityDedupe.size > 500) {
      for (const [key, at] of activityDedupe) {
        if (now - at > 60 * 60 * 1000) activityDedupe.delete(key);
      }
    }
  }
  const entry = {
    id: crypto.randomBytes(8).toString('hex'),
    at: now,
    nickname: safeNickname,
    accountId: accountId || null,
    kind,
    text: safeText,
  };
  activityLog.unshift(entry);
  if (activityLog.length > MAX_ACTIVITY_ENTRIES) activityLog.length = MAX_ACTIVITY_ENTRIES;
  saveActivity();
  return entry;
}

function sameSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function findParticipant(room, token) {
  if (!token || typeof token !== 'string') return null;
  const candidateHash = hashToken(token);
  return room.players.find((player) => sameSecret(player.tokenHash, candidateHash)) || null;
}

function derivePasswordHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: 1 << 14,
      r: 8,
      p: 1,
      maxmem: 32 * 1024 * 1024,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function accountSessionToken(account, now = Date.now()) {
  account.sessions = (Array.isArray(account.sessions) ? account.sessions : [])
    .filter((session) => session && Number(session.expiresAt) > now);
  const token = createToken();
  account.sessions.push({ tokenHash: hashToken(token), expiresAt: now + ACCOUNT_SESSION_TTL });
  if (account.sessions.length > MAX_ACCOUNT_SESSIONS) {
    account.sessions.splice(0, account.sessions.length - MAX_ACCOUNT_SESSIONS);
  }
  return token;
}

function findAccountByToken(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const tokenHash = hashToken(token);
  const now = Date.now();
  for (const account of accounts) {
    const session = account.sessions.find((candidate) => (
      candidate && Number(candidate.expiresAt) > now && sameSecret(candidate.tokenHash, tokenHash)
    ));
    if (session) return account;
  }
  return null;
}

function publicAccount(account) {
  return {
    nickname: account.nickname,
    wins: Number(account.wins) || 0,
    isAdmin: account.isAdmin === true,
    isCheater: account.isCheater === true,
  };
}

function roomEngine(room) {
  if (room.game === 'uno') return unoEngine;
  if (room.game === 'puissance-4') return puissance4Engine;
  if (room.game === 'loup-garou') return loupGarouEngine;
  if (room.game === 'quiz') return quizEngine;
  if (room.game === 'blind-test') return blindTestEngine;
  if (room.game === 'morpion') return morpionEngine;
  if (room.game === 'memoire') return memoireEngine;
  return null;
}

function playerChatStyle(playerId) {
  const identity = String(playerId || 'guest');
  let hash = 2166136261;
  for (const character of identity) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const paletteSize = Math.min(CHAT_EMOJIS.length, CHAT_COLORS.length);
  const index = (hash >>> 0) % paletteSize;
  return {
    chatEmoji: CHAT_EMOJIS[index],
    chatColor: CHAT_COLORS[index],
  };
}

function decorateGameState(room, state) {
  if (!state) return state;
  const decoratePlayer = (player) => ({ ...player, ...playerChatStyle(player.id) });
  return {
    ...state,
    ...(Array.isArray(state.players) ? { players: state.players.map(decoratePlayer) } : {}),
    ...(Array.isArray(state.scores) ? { scores: state.scores.map(decoratePlayer) } : {}),
  };
}

function publicChatMessages(room) {
  return (Array.isArray(room.chatMessages) ? room.chatMessages : []).slice(-CHAT_MAX_MESSAGES).map((message) => {
    const player = room.players.find((candidate) => candidate.id === message.playerId);
    const style = playerChatStyle(message.playerId);
    return {
      id: message.id,
      nickname: message.nickname || (player && player.nickname) || 'Joueur',
      emoji: message.emoji || style.chatEmoji,
      color: CHAT_COLORS.includes(message.color) ? message.color : style.chatColor,
      text: String(message.text || ''),
      kind: message.kind === 'reaction' ? 'reaction' : 'message',
      createdAt: Number(message.createdAt) || Date.now(),
    };
  });
}

function syncRoomPlayers(room) {
  roomEngine(room)?.syncPlayers(room);
}

function processRoomBots(room) {
  roomEngine(room)?.processBots(room);
}

function recordRoomVictory(room) {
  const state = room.gameState;
  if (!state || state.phase !== 'finished' || state.victoryRecorded) return false;
  const winnerIds = Array.isArray(state.winnerIds) ? Array.from(new Set(state.winnerIds)) : [];
  if (!winnerIds.length && state.winnerId) winnerIds.push(state.winnerId);
  state.victoryRecorded = true;
  let accountsChanged = false;
  for (const winnerId of winnerIds) {
    const winner = room.players.find((player) => player.id === winnerId);
    const account = winner && winner.accountId
      ? accounts.find((candidate) => candidate.id === winner.accountId)
      : null;
    if (account) {
      account.wins = (Number(account.wins) || 0) + 1;
      accountsChanged = true;
    }
    if (winner) {
      logActivity({
        nickname: winner.nickname,
        accountId: winner.accountId || null,
        kind: 'victoire',
        text: `a gagné une partie de ${GAMES[room.game]?.label || room.game} dans « ${room.title} »`,
        dedupeKey: `victoire:${room.id}:${winnerId}:${state.startedAt}`,
        dedupeMs: 600000,
      });
    }
  }
  if (accountsChanged) saveAccounts();
  return true;
}

function secretRoomState(room, player) {
  if (!room.gameState) return null;
  if (room.game === 'uno') {
    return { ...unoEngine.cheatState(room), viewerPlayerId: player.id };
  }
  if (room.game === 'loup-garou') {
    return {
      game: 'loup-garou',
      phase: room.gameState.phase,
      round: room.gameState.round,
      viewerPlayerId: player.id,
      roles: loupGarouEngine.cheatRoles(room),
    };
  }
  return null;
}

function publicRoom(room, token = '') {
  const currentPlayer = findParticipant(room, token);
  const players = room.players.map((player) => ({
    id: player.id,
    nickname: player.nickname,
    isBot: Boolean(player.isBot),
    isHost: player.id === room.hostPlayerId,
    isCurrentPlayer: Boolean(currentPlayer && player.id === currentPlayer.id),
    ...playerChatStyle(player.id),
  }));
  const host = room.players.find((player) => player.id === room.hostPlayerId);
  const currentAccount = currentPlayer?.accountId
    ? accounts.find((account) => account.id === currentPlayer.accountId)
    : null;
  const uno = room.game === 'uno' ? decorateGameState(room, unoEngine.publicState(room, currentPlayer)) : null;
  const puissance4 = room.game === 'puissance-4' ? decorateGameState(room, puissance4Engine.publicState(room, currentPlayer)) : null;
  const loupGarou = room.game === 'loup-garou' ? decorateGameState(room, loupGarouEngine.publicState(room, currentPlayer)) : null;
  const canSeeRoomChat = Boolean(currentPlayer && (
    room.game !== 'loup-garou' || !room.gameState || ['day', 'finished'].includes(room.gameState.phase)
  ));
  const quiz = room.game === 'quiz' ? decorateGameState(room, quizEngine.publicState(room, currentPlayer)) : null;
  const blindTest = room.game === 'blind-test' ? decorateGameState(room, blindTestEngine.publicState(room, currentPlayer)) : null;
  const morpion = room.game === 'morpion' ? decorateGameState(room, morpionEngine.publicState(room, currentPlayer)) : null;
  const memoire = room.game === 'memoire' ? decorateGameState(room, memoireEngine.publicState(room, currentPlayer)) : null;

  return {
    id: room.id,
    title: room.title,
    game: room.game,
    status: room.status || 'waiting',
    startedAt: room.startedAt || null,
    minPlayersToStart: GAMES[room.game]?.minPlayers || 1,
    createdAt: room.createdAt,
    maxPlayers: room.maxPlayers,
    playerCount: players.length,
    isFull: players.length >= room.maxPlayers,
    hostName: host ? host.nickname : 'Organisateur',
    isCurrentPlayer: Boolean(currentPlayer),
    isHost: Boolean(currentPlayer && currentPlayer.id === room.hostPlayerId),
    isCheater: Boolean(currentAccount && currentAccount.isCheater),
    currentPlayerId: currentPlayer ? currentPlayer.id : null,
    players,
    chat: canSeeRoomChat ? publicChatMessages(room) : [],
    uno,
    puissance4,
    loupGarou,
    quiz,
    blindTest,
    morpion,
    memoire,
  };
}

function cleanRooms() {
  const now = Date.now();
  let changed = false;
  const remainingRooms = [];

  for (const room of rooms) {
    const previousPlayerIds = room.players.map((player) => player.id);
    const activePlayers = room.players.filter((player) => (
      player.isBot === true || (
        Number.isFinite(player.lastSeenAt) && now - player.lastSeenAt <= PRESENCE_TTL
      )
    ));
    if (activePlayers.length !== room.players.length) changed = true;
    room.players = activePlayers;

    const activeHumans = room.players.filter((player) => !player.isBot);
    if (room.players.length > 0 && activeHumans.length === 0) {
      room.players = [];
      changed = true;
    }
    const removedPlayerIds = previousPlayerIds.filter((playerId) => (
      !room.players.some((player) => player.id === playerId)
    ));
    if (removedPlayerIds.length && room.gameState) {
      syncRoomPlayers(room);
      processRoomBots(room);
      changed = true;
    }
    if (recordRoomVictory(room)) changed = true;

    if (room.players.length === 0 && now - Number(room.createdAt || 0) > EMPTY_ROOM_TTL) {
      changed = true;
      continue;
    }

    if (room.players.length > 0 && !room.players.some((player) => player.id === room.hostPlayerId)) {
      activeHumans.sort((a, b) => Number(a.joinedAt || 0) - Number(b.joinedAt || 0));
      room.hostPlayerId = activeHumans[0].id;
      changed = true;
    }
    remainingRooms.push(room);
  }

  if (remainingRooms.length !== rooms.length) changed = true;
  rooms = remainingRooms;
  if (changed) saveRooms();
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(normalized).slice(0, maxLength).join('');
}

function createToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function issueCreatorTicket() {
  const ticket = createToken();
  creatorTickets.set(hashToken(ticket), Date.now() + CREATOR_TICKET_TTL);
  return ticket;
}

function hasValidCreatorTicket(req) {
  const ticket = req.headers['x-creator-ticket'];
  if (typeof ticket !== 'string') return false;
  const ticketHash = hashToken(ticket);
  const expiresAt = creatorTickets.get(ticketHash);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    creatorTickets.delete(ticketHash);
    return false;
  }
  return true;
}

function issueAdminSession() {
  const token = createToken();
  adminSessions.set(hashToken(token), Date.now() + ADMIN_SESSION_TTL);
  return token;
}

function activeAdminSessionKey(token) {
  if (typeof token !== 'string' || !token) return null;
  const key = hashToken(token);
  const expiresAt = adminSessions.get(key);
  if (!expiresAt) return null;
  if (expiresAt <= Date.now()) {
    adminSessions.delete(key);
    return null;
  }
  return key;
}

function cleanOnlinePeople() {
  const now = Date.now();
  for (const [id, person] of onlinePeople) {
    if (now - person.lastSeenAt > ONLINE_TTL) onlinePeople.delete(id);
  }
  if (onlinePeople.size > MAX_ONLINE_ENTRIES) {
    const oldest = [...onlinePeople.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    for (const [id] of oldest.slice(0, onlinePeople.size - MAX_ONLINE_ENTRIES)) onlinePeople.delete(id);
  }
}

function deviceLabel(userAgent) {
  const agent = String(userAgent || '');
  if (/iPad|Tablet/i.test(agent)) return 'Tablette';
  if (/Mobi|Android|iPhone/i.test(agent)) return 'Téléphone';
  if (!agent) return 'Appareil inconnu';
  return 'Ordinateur';
}

function cleanText(value, maxLength) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function publicPresence(person) {
  return {
    id: person.id,
    nickname: person.nickname || 'Visiteur',
    accountNickname: person.accountNickname || '',
    isAccount: Boolean(person.accountNickname),
    isAdmin: person.isAdmin === true,
    activity: person.activity || 'Sur le site',
    device: person.device || 'Appareil inconnu',
    firstSeenAt: person.firstSeenAt,
    lastSeenAt: person.lastSeenAt,
    buzzPending: Boolean(person.buzz),
    buzzCount: Number(person.buzzCount) || 0,
  };
}

// Bloc-notes d'une personne : ses dernières actions. On rattache par compte
// quand il y en a un, sinon par pseudo (deux invités homonymes partagent alors
// le même bloc-notes).
function notesForPerson(person, limit = 14) {
  const nicknameKey = String(person.nickname || '').toLocaleLowerCase('fr-FR');
  return activityLog
    .filter((entry) => (
      person.accountId
        ? entry.accountId === person.accountId
        : entry.nickname.toLocaleLowerCase('fr-FR') === nicknameKey
    ))
    .slice(0, limit)
    .map((entry) => ({ at: entry.at, kind: entry.kind, text: entry.text }));
}

function clientKey(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim().slice(0, 100);
  }
  return req.socket.remoteAddress || 'unknown';
}

function safeEqualCode(submittedCode) {
  if (!CREATOR_CODE || typeof submittedCode !== 'string') return false;
  // Les espaces avant/après (copier-coller, correction automatique du clavier)
  // ne doivent pas faire échouer un code pourtant juste.
  return sameSecret(submittedCode.trim(), CREATOR_CODE);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'",
  );
}

function sendJson(res, statusCode, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', body.length);
  res.end(body);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) throw httpError(413, 'La demande est trop volumineuse.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'La demande envoyée est invalide.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw httpError(400, 'La demande envoyée est invalide.');
  }
  return parsed;
}

function transferHostIfNeeded(room, departingPlayerId) {
  if (room.hostPlayerId !== departingPlayerId) return;
  const nextHost = room.players
    .filter((player) => !player.isBot)
    .sort((a, b) => Number(a.joinedAt || 0) - Number(b.joinedAt || 0))[0];
  room.hostPlayerId = nextHost ? nextHost.id : '';
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') {
    cleanRooms();
    return sendJson(res, 200, { ok: true, rooms: rooms.length });
  }

  if (req.method === 'POST' && pathname === '/api/creator/unlock') {
    if (!CREATOR_CODE) {
      return sendJson(res, 503, { error: 'Le code organisateur n’est pas encore configuré sur le serveur.' });
    }

    const key = clientKey(req);
    const now = Date.now();
    const previous = failedCodes.get(key);
    if (previous && previous.lockedUntil > now) {
      const seconds = Math.ceil((previous.lockedUntil - now) / 1000);
      return sendJson(res, 429, { error: `Trop d’essais. Réessaie dans ${seconds} secondes.` });
    }

    const body = await readJson(req);
    if (!safeEqualCode(body.code)) {
      const entry = previous && previous.windowStartedAt + CODE_LOCK_DURATION > now
        ? previous
        : { failures: 0, windowStartedAt: now, lockedUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= MAX_FAILED_CODES) {
        entry.lockedUntil = now + CODE_LOCK_DURATION;
        entry.failures = 0;
      }
      failedCodes.set(key, entry);
      if (entry.lockedUntil > now) {
        return sendJson(res, 429, { error: 'Trop d’essais. Réessaie dans quelques minutes.' });
      }
      return sendJson(res, 401, { error: 'Ce code ne correspond pas. Vérifie-le et réessaie.' });
    }

    failedCodes.delete(key);
    const ticket = issueCreatorTicket();
    return sendJson(res, 200, { ticket, expiresIn: CREATOR_TICKET_TTL });
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    if (!CREATOR_CODE) {
      return sendJson(res, 503, { error: 'Le code organisateur n’est pas encore configuré sur le serveur.' });
    }

    const key = clientKey(req);
    const now = Date.now();
    const previous = failedCodes.get(key);
    if (previous && previous.lockedUntil > now) {
      const seconds = Math.ceil((previous.lockedUntil - now) / 1000);
      req.resume();
      return sendJson(res, 429, { error: `Trop d’essais. Réessaie dans ${seconds} secondes.` });
    }

    const body = await readJson(req);
    if (!safeEqualCode(body.code)) {
      const entry = previous && previous.windowStartedAt + CODE_LOCK_DURATION > now
        ? previous
        : { failures: 0, windowStartedAt: now, lockedUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= MAX_FAILED_CODES) {
        entry.lockedUntil = now + CODE_LOCK_DURATION;
        entry.failures = 0;
      }
      failedCodes.set(key, entry);
      if (entry.lockedUntil > now) {
        return sendJson(res, 429, { error: 'Trop d’essais. Réessaie dans quelques minutes.' });
      }
      return sendJson(res, 401, { error: 'Ce code ne correspond pas. Vérifie-le et réessaie.' });
    }

    failedCodes.delete(key);
    const token = issueAdminSession();
    return sendJson(res, 200, { token, expiresIn: ADMIN_SESSION_TTL });
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    const sessionKey = activeAdminSessionKey(req.headers['x-admin-token']);
    if (sessionKey) adminSessions.delete(sessionKey);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/admin/accounts') {
    if (!activeAdminSessionKey(req.headers['x-admin-token'])) {
      return sendJson(res, 401, { error: 'La session administrateur a expiré. Saisis à nouveau le code.' });
    }
    const result = accounts
      .slice()
      .sort((a, b) => a.nickname.localeCompare(b.nickname, 'fr-FR'))
      .map((account) => ({
        id: account.id,
        ...publicAccount(account),
        createdAt: Number(account.createdAt) || 0,
        lastLoginAt: Number(account.lastLoginAt) || 0,
      }));
    return sendJson(res, 200, { count: result.length, accounts: result });
  }

  const adminAccountPath = pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/);
  if (adminAccountPath && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!activeAdminSessionKey(req.headers['x-admin-token'])) {
      req.resume();
      return sendJson(res, 401, { error: 'La session administrateur a expiré. Saisis à nouveau le code.' });
    }

    let accountId;
    try {
      accountId = decodeURIComponent(adminAccountPath[1]);
    } catch {
      req.resume();
      return sendJson(res, 400, { error: 'Identifiant de compte invalide.' });
    }
    const accountIndex = accounts.findIndex((candidate) => candidate.id === accountId);
    if (accountIndex < 0) {
      req.resume();
      return sendJson(res, 404, { error: 'Ce compte n’existe plus.' });
    }
    const account = accounts[accountIndex];

    if (req.method === 'DELETE') {
      accounts.splice(accountIndex, 1);
      saveAccounts();
      let roomsChanged = false;
      for (const room of rooms) {
        for (const player of room.players) {
          if (player.accountId === account.id) {
            player.accountId = null;
            roomsChanged = true;
          }
        }
      }
      if (roomsChanged) saveRooms();
      logActivity({
        nickname: 'Organisateur',
        kind: 'admin',
        text: `a supprimé le compte « ${account.nickname} »`,
        dedupeKey: `suppression:${account.id}`,
      });
      return sendJson(res, 200, {
        ok: true,
        deleted: { id: account.id, nickname: account.nickname },
        count: accounts.length,
      });
    }

    const body = await readJson(req);
    const hasNickname = Object.hasOwn(body, 'nickname');
    const hasAdminRole = Object.hasOwn(body, 'isAdmin');
    const hasCheaterRole = Object.hasOwn(body, 'isCheater');
    if (!hasNickname && !hasAdminRole && !hasCheaterRole) {
      return sendJson(res, 400, { error: 'Indique un pseudo ou un rôle à modifier.' });
    }
    if (hasAdminRole && typeof body.isAdmin !== 'boolean') {
      return sendJson(res, 400, { error: 'Le rôle administrateur doit être activé ou désactivé.' });
    }
    if (hasCheaterRole && typeof body.isCheater !== 'boolean') {
      return sendJson(res, 400, { error: 'Le rôle tricheur doit être activé ou désactivé.' });
    }

    let nicknameChanged = false;
    const previousNickname = account.nickname;
    if (hasNickname) {
      const nickname = cleanText(body.nickname, 18);
      const nicknameLength = Array.from(nickname).length;
      if (nicknameLength < 2 || nicknameLength > 18) {
        return sendJson(res, 400, { error: 'Le pseudo doit faire entre 2 et 18 caractères.' });
      }
      const nicknameKey = nickname.normalize('NFKC').toLocaleLowerCase('fr-FR');
      if (accounts.some((candidate) => candidate.id !== account.id && candidate.nicknameKey === nicknameKey)) {
        return sendJson(res, 409, { error: 'Ce pseudo est déjà utilisé par un autre compte.' });
      }
      nicknameChanged = nickname !== account.nickname;
      account.nickname = nickname;
      account.nicknameKey = nicknameKey;
    }
    if (hasAdminRole) account.isAdmin = body.isAdmin;
    if (hasCheaterRole) account.isCheater = body.isCheater;

    saveAccounts();
    if (nicknameChanged) {
      logActivity({
        nickname: 'Organisateur',
        kind: 'admin',
        text: `a renommé le compte « ${previousNickname} » en « ${account.nickname} »`,
        dedupeKey: `renommage:${account.id}:${account.nickname}`,
      });
    }
    if (hasAdminRole) {
      logActivity({
        nickname: 'Organisateur',
        kind: 'admin',
        text: `${body.isAdmin ? 'a donné' : 'a retiré'} le rôle administrateur ${body.isAdmin ? 'à' : 'de'} « ${account.nickname} »`,
        dedupeKey: `role-admin:${account.id}:${body.isAdmin}`,
      });
    }
    if (hasCheaterRole) {
      logActivity({
        nickname: 'Organisateur',
        kind: 'admin',
        text: `${body.isCheater ? 'a donné' : 'a retiré'} le rôle tricheur ${body.isCheater ? 'à' : 'de'} « ${account.nickname} »`,
        dedupeKey: `role-tricheur:${account.id}:${body.isCheater}`,
      });
    }
    if (nicknameChanged) {
      let roomsChanged = false;
      for (const room of rooms) {
        let roomChanged = false;
        for (const player of room.players) {
          if (player.accountId === account.id) {
            player.nickname = account.nickname;
            roomChanged = true;
            roomsChanged = true;
          }
        }
        if (roomChanged) syncRoomPlayers(room);
      }
      if (roomsChanged) saveRooms();
    }
    return sendJson(res, 200, {
      account: {
        id: account.id,
        ...publicAccount(account),
        createdAt: Number(account.createdAt) || 0,
        lastLoginAt: Number(account.lastLoginAt) || 0,
      },
    });
  }

  // Signal de présence envoyé régulièrement par chaque navigateur ouvert.
  if (req.method === 'POST' && pathname === '/api/presence') {
    const body = await readJson(req);
    cleanOnlinePeople();
    const account = findAccountByToken(req.headers['x-account-token']);
    const requestedId = typeof body.id === 'string' && /^[a-f0-9]{8,48}$/i.test(body.id) ? body.id : '';
    const id = requestedId || crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    const existing = onlinePeople.get(id);
    const person = existing || { id, firstSeenAt: now, buzz: null, buzzCount: 0 };
    person.nickname = account ? account.nickname : (cleanText(body.nickname, 24) || 'Visiteur');
    person.accountNickname = account ? account.nickname : '';
    person.accountId = account ? account.id : null;
    person.isAdmin = account ? account.isAdmin === true : false;
    person.activity = cleanText(body.activity, 60) || 'Sur le site';
    person.device = deviceLabel(req.headers['user-agent']);
    person.lastSeenAt = now;
    onlinePeople.set(id, person);
    if (!existing) {
      logActivity({
        nickname: person.nickname,
        accountId: account ? account.id : null,
        kind: 'visite',
        text: `a rejoint le site (${person.device})`,
        dedupeKey: `visite:${id}`,
        dedupeMs: 600000,
      });
    }

    // Le son en attente est remis une seule fois, puis consommé.
    const buzz = person.buzz;
    person.buzz = null;
    return sendJson(res, 200, { id, buzz: buzz || null });
  }

  // Le navigateur signale un bouton précis (clé de la liste blanche).
  if (req.method === 'POST' && pathname === '/api/presence/action') {
    const body = await readJson(req);
    cleanOnlinePeople();
    const person = onlinePeople.get(typeof body.id === 'string' ? body.id : '');
    if (!person) return sendJson(res, 404, { error: 'Cette présence n’est plus active.' });
    const decoded = actionLabel(body.action);
    if (!decoded) return sendJson(res, 400, { error: 'Action inconnue.' });
    logActivity({
      nickname: person.nickname,
      accountId: person.accountId || null,
      kind: decoded.kind,
      text: decoded.text,
      dedupeKey: `action:${person.id}:${body.action}`,
      dedupeMs: decoded.kind === 'touche' ? 700 : 4000,
    });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/admin/presence') {
    if (!activeAdminSessionKey(req.headers['x-admin-token'])) {
      return sendJson(res, 401, { error: 'La session administrateur a expiré. Saisis à nouveau le code.' });
    }
    cleanOnlinePeople();
    const people = [...onlinePeople.values()]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((person) => ({ ...publicPresence(person), notes: notesForPerson(person) }));
    return sendJson(res, 200, { count: people.length, people, sounds: BUZZ_SOUNDS });
  }

  // Journal d'activité : les actions réelles des joueurs, jamais leurs frappes.
  if (req.method === 'GET' && pathname === '/api/admin/activity') {
    if (!activeAdminSessionKey(req.headers['x-admin-token'])) {
      return sendJson(res, 401, { error: 'La session administrateur a expiré. Saisis à nouveau le code.' });
    }
    const limitValue = Number.parseInt(url.searchParams.get('limit'), 10);
    const limit = Number.isInteger(limitValue) ? Math.min(200, Math.max(1, limitValue)) : 80;
    const person = cleanText(url.searchParams.get('person'), 24);
    const entries = activityLog
      .filter((entry) => !person || entry.nickname === person)
      .slice(0, limit);
    const people = [...new Set(activityLog.map((entry) => entry.nickname))]
      .sort((a, b) => a.localeCompare(b, 'fr-FR'));
    return sendJson(res, 200, {
      count: activityLog.length,
      entries,
      people,
      kinds: ACTIVITY_KINDS,
      maxEntries: MAX_ACTIVITY_ENTRIES,
    });
  }

  if (req.method === 'DELETE' && pathname === '/api/admin/activity') {
    if (!activeAdminSessionKey(req.headers['x-admin-token'])) {
      req.resume();
      return sendJson(res, 401, { error: 'La session administrateur a expiré. Saisis à nouveau le code.' });
    }
    activityLog = [];
    activityDedupe.clear();
    const entry = logActivity({
      nickname: 'Organisateur',
      kind: 'admin',
      text: 'a vidé le journal d’activité',
      dedupeKey: `vidage:${Date.now()}`,
      dedupeMs: 0,
    });
    return sendJson(res, 200, { ok: true, count: activityLog.length, entries: entry ? [entry] : [] });
  }

  const buzzPath = pathname.match(/^\/api\/admin\/presence\/([^/]+)\/buzz$/);
  if (buzzPath && req.method === 'POST') {
    if (!activeAdminSessionKey(req.headers['x-admin-token'])) {
      req.resume();
      return sendJson(res, 401, { error: 'La session administrateur a expiré. Saisis à nouveau le code.' });
    }
    const body = await readJson(req);
    cleanOnlinePeople();
    const sound = BUZZ_SOUNDS.includes(body.sound) ? body.sound : BUZZ_SOUNDS[0];
    const buzz = { sound, message: cleanText(body.message, 120), at: Date.now() };

    // « tous » : la même alerte part sur tous les appareils connectés.
    if (buzzPath[1] === 'tous') {
      const targets = [...onlinePeople.values()];
      targets.forEach((target) => {
        target.buzz = { ...buzz };
        target.buzzCount = (Number(target.buzzCount) || 0) + 1;
      });
      logActivity({
        nickname: 'Organisateur',
        kind: 'admin',
        text: `a envoyé le son ${soundLabel(sound)} à tout le monde (${targets.length} personne${targets.length > 1 ? 's' : ''})`,
        dedupeKey: `buzz-tous:${buzz.at}`,
        dedupeMs: 0,
      });
      return sendJson(res, 200, { ok: true, count: targets.length, sound });
    }

    const person = onlinePeople.get(buzzPath[1]);
    if (!person) {
      return sendJson(res, 404, { error: 'Cette personne vient de quitter le site.' });
    }
    person.buzz = buzz;
    person.buzzCount = (Number(person.buzzCount) || 0) + 1;
    logActivity({
      nickname: 'Organisateur',
      kind: 'admin',
      text: `a envoyé le son ${soundLabel(sound)} à « ${person.nickname} »`,
      dedupeKey: `buzz:${person.id}:${sound}:${buzz.at}`,
      dedupeMs: 0,
    });
    return sendJson(res, 200, { ok: true, count: 1, nickname: person.nickname, sound });
  }

  if (req.method === 'POST' && pathname === '/api/accounts/register') {
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, 18);
    const password = typeof body.password === 'string' ? body.password : '';
    const nicknameLength = Array.from(nickname).length;
    const passwordLength = Array.from(password).length;
    if (nicknameLength < 2 || nicknameLength > 18) {
      return sendJson(res, 400, { error: 'Choisis un pseudo de 2 à 18 caractères.' });
    }
    if (passwordLength < MIN_ACCOUNT_PASSWORD_LENGTH || passwordLength > MAX_ACCOUNT_PASSWORD_LENGTH || !/\S/u.test(password)) {
      return sendJson(res, 400, { error: 'Le mot de passe doit faire entre 4 et 64 caractères.' });
    }

    const nicknameKey = nickname.normalize('NFKC').toLocaleLowerCase('fr-FR');
    if (accounts.some((account) => account.nicknameKey === nicknameKey)) {
      return sendJson(res, 409, { error: 'Ce pseudo est déjà utilisé. Essaie de te connecter ou choisis-en un autre.' });
    }

    const passwordSalt = crypto.randomBytes(16).toString('base64url');
    const passwordHash = (await derivePasswordHash(password, passwordSalt)).toString('base64url');
    if (accounts.some((account) => account.nicknameKey === nicknameKey)) {
      return sendJson(res, 409, { error: 'Ce pseudo vient d’être créé. Essaie de te connecter.' });
    }

    const now = Date.now();
    const account = {
      id: crypto.randomUUID(),
      nickname,
      nicknameKey,
      passwordSalt,
      passwordHash,
      createdAt: now,
      lastLoginAt: now,
      wins: 0,
      isAdmin: false,
      isCheater: false,
      sessions: [],
    };
    const token = accountSessionToken(account, now);
    accounts.push(account);
    saveAccounts();
    logActivity({
      nickname: account.nickname,
      accountId: account.id,
      kind: 'compte',
      text: 'a créé son compte',
      dedupeKey: `compte:${account.id}`,
    });
    return sendJson(res, 201, {
      account: publicAccount(account),
      token,
      expiresIn: ACCOUNT_SESSION_TTL,
    });
  }

  if (req.method === 'POST' && pathname === '/api/accounts/login') {
    const key = clientKey(req);
    const now = Date.now();
    const previous = failedAccountLogins.get(key);
    if (previous && previous.lockedUntil > now) {
      req.resume();
      const seconds = Math.ceil((previous.lockedUntil - now) / 1000);
      return sendJson(res, 429, { error: `Trop d’essais. Réessaie dans ${seconds} secondes.` });
    }

    const body = await readJson(req);
    const nickname = cleanText(body.nickname, 18);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!nickname || !password) {
      return sendJson(res, 400, { error: 'Renseigne ton pseudo et ton mot de passe.' });
    }

    const nicknameKey = nickname.normalize('NFKC').toLocaleLowerCase('fr-FR');
    const account = accounts.find((candidate) => candidate.nicknameKey === nicknameKey) || null;
    const salt = account ? account.passwordSalt : DUMMY_PASSWORD_SALT;
    const passwordHash = await derivePasswordHash(password, salt);
    const expectedHash = account ? Buffer.from(account.passwordHash, 'base64url') : Buffer.alloc(SCRYPT_KEY_LENGTH);
    const passwordMatches = expectedHash.length === passwordHash.length
      && crypto.timingSafeEqual(expectedHash, passwordHash);

    if (!account || !passwordMatches) {
      const entry = previous && previous.windowStartedAt + ACCOUNT_LOGIN_LOCK_DURATION > now
        ? previous
        : { failures: 0, windowStartedAt: now, lockedUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= MAX_ACCOUNT_LOGIN_FAILURES) {
        entry.lockedUntil = now + ACCOUNT_LOGIN_LOCK_DURATION;
        entry.failures = 0;
      }
      failedAccountLogins.set(key, entry);
      if (entry.lockedUntil > now) {
        return sendJson(res, 429, { error: 'Trop d’essais. Réessaie dans quelques minutes.' });
      }
      return sendJson(res, 401, { error: 'Pseudo ou mot de passe incorrect.' });
    }

    failedAccountLogins.delete(key);
    account.lastLoginAt = now;
    const token = accountSessionToken(account, now);
    saveAccounts();
    logActivity({
      nickname: account.nickname,
      accountId: account.id,
      kind: 'compte',
      text: 'a ouvert une session',
      dedupeKey: `connexion:${account.id}`,
      dedupeMs: 30000,
    });
    return sendJson(res, 200, {
      account: publicAccount(account),
      token,
      expiresIn: ACCOUNT_SESSION_TTL,
    });
  }

  if (req.method === 'GET' && pathname === '/api/accounts/me') {
    const account = findAccountByToken(req.headers['x-account-token']);
    if (!account) return sendJson(res, 401, { error: 'Ta session a expiré. Connecte-toi à nouveau.' });
    return sendJson(res, 200, { account: publicAccount(account) });
  }

  if (req.method === 'POST' && pathname === '/api/accounts/logout') {
    const token = req.headers['x-account-token'];
    const account = findAccountByToken(token);
    if (account) {
      const tokenHash = hashToken(token);
      account.sessions = account.sessions.filter((session) => !sameSecret(session.tokenHash, tokenHash));
      saveAccounts();
      logActivity({
        nickname: account.nickname,
        accountId: account.id,
        kind: 'compte',
        text: 'a fermé sa session',
        dedupeKey: `deconnexion:${account.id}`,
        dedupeMs: 30000,
      });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const players = accounts
      .map((account) => ({ nickname: account.nickname, wins: Number(account.wins) || 0 }))
      .sort((a, b) => b.wins - a.wins || a.nickname.localeCompare(b.nickname, 'fr-FR'))
      .slice(0, 10);
    return sendJson(res, 200, { players });
  }

  if (req.method === 'GET' && pathname === '/api/rooms') {
    cleanRooms();
    let roomTokensById = {};
    const rawRoomTokens = req.headers['x-room-tokens'];
    if (typeof rawRoomTokens === 'string' && rawRoomTokens.length <= 12_000) {
      try {
        const parsedRoomTokens = JSON.parse(rawRoomTokens);
        if (parsedRoomTokens && typeof parsedRoomTokens === 'object' && !Array.isArray(parsedRoomTokens)) {
          roomTokensById = parsedRoomTokens;
        }
      } catch {
        // Les jetons de la liste sont facultatifs : un en-tête invalide ne bloque pas l’accueil.
      }
    }
    const result = rooms
      .slice()
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
      .map((room) => {
        const publicData = publicRoom(room);
        const token = typeof roomTokensById[room.id] === 'string' ? roomTokensById[room.id] : '';
        const player = findParticipant(room, token);
        publicData.isHost = Boolean(player && player.id === room.hostPlayerId);
        return publicData;
      });
    return sendJson(res, 200, { rooms: result });
  }

  if (req.method === 'POST' && pathname === '/api/rooms') {
    const rawAccountToken = req.headers['x-account-token'];
    const account = rawAccountToken === undefined ? null : findAccountByToken(rawAccountToken);
    if (rawAccountToken !== undefined && !account) {
      req.resume();
      return sendJson(res, 401, { error: 'Ta session de compte a expiré. Connecte-toi à nouveau.' });
    }
    if (!hasValidCreatorTicket(req) && !(account && account.isAdmin)) {
      req.resume();
      return sendJson(res, 401, { error: 'Saisis le code organisateur ou connecte-toi avec un compte administrateur pour créer une partie.' });
    }

    const body = await readJson(req);
    const game = Object.hasOwn(GAMES, body.game) ? GAMES[body.game] : null;
    if (!game) return sendJson(res, 400, { error: 'Choisis un jeu disponible.' });

    const title = cleanText(body.title, 32);
    const nickname = account ? account.nickname : cleanText(body.nickname, 18);
    const maxPlayers = Number.parseInt(body.maxPlayers, 10);
    if (!title) return sendJson(res, 400, { error: 'Donne un nom à ta partie.' });
    if (!nickname) return sendJson(res, 400, { error: 'Choisis un pseudo pour rejoindre le salon.' });
    if (!Number.isInteger(maxPlayers) || maxPlayers < game.minPlayers || maxPlayers > game.maxPlayers) {
      return sendJson(res, 400, {
        error: `Pour ${game.label}, le nombre de joueurs doit être compris entre ${game.minPlayers} et ${game.maxPlayers}.`,
      });
    }

    const now = Date.now();
    const playerToken = createToken();
    const hostId = crypto.randomUUID();
    const room = {
      id: crypto.randomUUID(),
      title,
      game: body.game,
      createdAt: now,
      maxPlayers,
      status: 'waiting',
      startedAt: null,
      gameState: null,
      chatMessages: [],
      wolfChatMessages: [],
      hostPlayerId: hostId,
      players: [{
        id: hostId,
        nickname,
        accountId: account ? account.id : null,
        isBot: false,
        tokenHash: hashToken(playerToken),
        joinedAt: now,
        lastSeenAt: now,
      }],
    };
    rooms.unshift(room);
    saveRooms();
    logActivity({
      nickname,
      accountId: account ? account.id : null,
      kind: 'salon',
      text: `a créé la partie « ${title} » (${game.label})`,
      dedupeKey: `creation:${room.id}`,
    });
    return sendJson(res, 201, { room: publicRoom(room, playerToken), playerToken });
  }

  const roomPath = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(.*))?$/);
  if (roomPath) {
    let roomId;
    try {
      roomId = decodeURIComponent(roomPath[1]);
    } catch {
      return sendJson(res, 400, { error: 'Identifiant de partie invalide.' });
    }
    cleanRooms();
    const room = rooms.find((candidate) => candidate.id === roomId);
    if (!room) return sendJson(res, 404, { error: 'Cette partie n’est plus disponible.' });
    const action = roomPath[2] || '';
    const playerToken = req.headers['x-player-token'];
    if (room.game === 'loup-garou' && loupGarouEngine.advanceTimedGame(room)) {
      processRoomBots(room);
      recordRoomVictory(room);
      saveRooms();
    }

    if (action === 'cheat' && (req.method === 'GET' || req.method === 'POST')) {
      const account = findAccountByToken(req.headers['x-account-token']);
      if (!account) {
        req.resume();
        return sendJson(res, 401, { error: 'Connecte-toi à ton compte pour utiliser les outils secrets.' });
      }
      const player = findParticipant(room, playerToken);
      if (!account.isCheater || !player || player.isBot || player.accountId !== account.id) {
        req.resume();
        return sendJson(res, 403, { error: 'Ces outils secrets ne sont pas disponibles pour cette session de jeu.' });
      }
      if (!room.gameState) {
        req.resume();
        return sendJson(res, 409, { error: 'Lance la partie avant d’ouvrir les outils secrets.' });
      }
      const cheat = secretRoomState(room, player);
      if (!cheat) {
        req.resume();
        return sendJson(res, 409, { error: 'Les outils secrets sont disponibles uniquement pour UNO et Loup-garou.' });
      }
      if (req.method === 'GET') return sendJson(res, 200, { cheat });

      const body = await readJson(req);
      if (room.game !== 'uno') {
        return sendJson(res, 409, { error: 'Cette action secrète est disponible uniquement pour UNO.' });
      }
      let result;
      if (body.action === 'force-next-draw') {
        result = { forcedCard: unoEngine.cheatForceNextDraw(room, String(body.cardId || '')) };
      } else if (body.action === 'give-card') {
        result = {
          given: unoEngine.cheatGiveCard(
            room,
            String(body.cardId || ''),
            String(body.targetPlayerId || ''),
          ),
        };
      } else {
        return sendJson(res, 400, { error: 'Choisis une action secrète valide.' });
      }
      saveRooms();
      return sendJson(res, 200, { ...result, cheat: secretRoomState(room, player) });
    }

    if (req.method === 'GET' && !action) {
      return sendJson(res, 200, { room: publicRoom(room, playerToken) });
    }

    if (req.method === 'POST' && action === 'loup-garou/wolf-chat') {
      const player = findParticipant(room, playerToken);
      if (!player || player.isBot) {
        req.resume();
        return sendJson(res, 401, { error: 'Rejoins ce salon avec ton compte joueur pour parler aux loups.' });
      }
      if (room.game !== 'loup-garou' || !room.gameState || room.gameState.phase !== 'night') {
        req.resume();
        return sendJson(res, 409, { error: 'Le tchat secret des loups est disponible uniquement pendant la nuit.' });
      }
      if (room.gameState.roles[player.id] !== 'wolf' || !room.gameState.alivePlayerIds.includes(player.id)) {
        req.resume();
        return sendJson(res, 403, { error: 'Seuls les loups encore en jeu peuvent utiliser ce tchat secret.' });
      }
      const body = await readJson(req);
      const text = cleanText(body.message, CHAT_MAX_LENGTH + 1);
      if (!text) return sendJson(res, 400, { error: 'Écris un message avant de l’envoyer.' });
      if (Array.from(text).length > CHAT_MAX_LENGTH) {
        return sendJson(res, 400, { error: `Le message doit faire ${CHAT_MAX_LENGTH} caractères maximum.` });
      }
      const now = Date.now();
      const cooldownKey = `${room.id}:${player.id}:wolves`;
      const lastSentAt = chatLastSent.get(cooldownKey) || 0;
      if (now - lastSentAt < CHAT_MIN_INTERVAL) {
        return sendJson(res, 429, { error: 'Doucement ! Attends un petit instant avant de renvoyer un message.' });
      }
      chatLastSent.set(cooldownKey, now);
      player.lastSeenAt = now;
      const style = playerChatStyle(player.id);
      if (!Array.isArray(room.wolfChatMessages)) room.wolfChatMessages = [];
      room.wolfChatMessages.push({
        id: crypto.randomUUID(),
        playerId: player.id,
        nickname: player.nickname,
        emoji: style.chatEmoji,
        color: style.chatColor,
        text,
        kind: 'message',
        createdAt: now,
      });
      if (room.wolfChatMessages.length > CHAT_MAX_MESSAGES) {
        room.wolfChatMessages.splice(0, room.wolfChatMessages.length - CHAT_MAX_MESSAGES);
      }
      saveRooms();
      return sendJson(res, 201, { room: publicRoom(room, playerToken) });
    }

    if (req.method === 'POST' && action === 'chat') {
      const player = findParticipant(room, playerToken);
      if (!player || player.isBot) {
        req.resume();
        return sendJson(res, 401, { error: 'Rejoins ce salon pour participer au tchat.' });
      }
      if (room.game === 'loup-garou' && room.gameState) {
        if (!['day', 'finished'].includes(room.gameState.phase)) {
          req.resume();
          return sendJson(res, 409, { error: 'Le village dort : le tchat public rouvrira au lever du jour.' });
        }
        if (room.gameState.phase !== 'finished' && !room.gameState.alivePlayerIds.includes(player.id)) {
          req.resume();
          return sendJson(res, 403, { error: 'Les joueurs éliminés peuvent observer, mais ne peuvent plus écrire au village.' });
        }
      }
      const body = await readJson(req);
      const reaction = typeof body.reaction === 'string' ? body.reaction : '';
      const isReaction = reaction.length > 0;
      const text = isReaction ? reaction : cleanText(body.message, CHAT_MAX_LENGTH + 1);
      if (isReaction && !CHAT_REACTIONS.has(reaction)) {
        return sendJson(res, 400, { error: 'Cette réaction rapide n’est pas disponible.' });
      }
      if (!text) return sendJson(res, 400, { error: 'Écris un message avant de l’envoyer.' });
      if (Array.from(text).length > CHAT_MAX_LENGTH) {
        return sendJson(res, 400, { error: `Le message doit faire ${CHAT_MAX_LENGTH} caractères maximum.` });
      }
      const now = Date.now();
      const cooldownKey = `${room.id}:${player.id}`;
      const lastSentAt = chatLastSent.get(cooldownKey) || 0;
      if (now - lastSentAt < CHAT_MIN_INTERVAL) {
        return sendJson(res, 429, { error: 'Doucement ! Attends un petit instant avant de renvoyer un message.' });
      }
      chatLastSent.set(cooldownKey, now);
      player.lastSeenAt = now;
      const style = playerChatStyle(player.id);
      if (!Array.isArray(room.chatMessages)) room.chatMessages = [];
      room.chatMessages.push({
        id: crypto.randomUUID(),
        playerId: player.id,
        nickname: player.nickname,
        emoji: style.chatEmoji,
        color: style.chatColor,
        text,
        kind: isReaction ? 'reaction' : 'message',
        createdAt: now,
      });
      if (room.chatMessages.length > CHAT_MAX_MESSAGES) {
        room.chatMessages.splice(0, room.chatMessages.length - CHAT_MAX_MESSAGES);
      }
      saveRooms();
      // Seul le tchat PUBLIC du salon est archivé pour la modération. Le tchat
      // privé des loups et tout contenu de formulaire restent hors du journal.
      logActivity({
        nickname: player.nickname,
        accountId: player.accountId || null,
        kind: 'tchat',
        text: isReaction
          ? `a réagi ${text} dans le tchat de « ${room.title} »`
          : `a écrit dans le tchat de « ${room.title} » : « ${text} »`,
        dedupeKey: `tchat:${room.id}:${player.id}:${now}`,
        dedupeMs: 0,
        maxTextLength: 300,
      });
      return sendJson(res, 201, { room: publicRoom(room, playerToken) });
    }

    if (req.method === 'POST' && action === 'join') {
      const body = await readJson(req);
      const rawAccountToken = req.headers['x-account-token'];
      const account = rawAccountToken === undefined ? null : findAccountByToken(rawAccountToken);
      if (rawAccountToken !== undefined && !account) {
        return sendJson(res, 401, { error: 'Ta session de compte a expiré. Connecte-toi à nouveau.' });
      }
      let player = findParticipant(room, playerToken);
      if (account) {
        const otherSession = room.players.find((candidate) => candidate.accountId === account.id && candidate.id !== player?.id);
        if (otherSession) {
          return sendJson(res, 409, { error: 'Ce compte est déjà dans ce salon avec une autre session.' });
        }
      }
      if (player) {
        if (account && player.accountId && player.accountId !== account.id) {
          return sendJson(res, 403, { error: 'Cette session de salon est associée à un autre compte.' });
        }
        if (account) {
          player.accountId = account.id;
          player.nickname = account.nickname;
        } else if (!player.accountId) {
          const nickname = cleanText(body.nickname, 18);
          if (nickname) player.nickname = nickname;
        }
        player.lastSeenAt = Date.now();
        saveRooms();
        return sendJson(res, 200, { room: publicRoom(room, playerToken), playerToken });
      }

      if (room.status === 'started') {
        return sendJson(res, 409, { error: 'Cette partie a déjà commencé. Les nouveaux joueurs ne peuvent plus entrer.' });
      }
      if (room.players.length >= room.maxPlayers) {
        return sendJson(res, 409, { error: 'Cette partie est complète. Choisis un autre salon.' });
      }
      const nickname = account ? account.nickname : cleanText(body.nickname, 18);
      if (!nickname) return sendJson(res, 400, { error: 'Choisis un pseudo pour rejoindre le salon.' });

      const newPlayerToken = createToken();
      const now = Date.now();
      const newPlayer = {
        id: crypto.randomUUID(),
        nickname,
        accountId: account ? account.id : null,
        isBot: false,
        tokenHash: hashToken(newPlayerToken),
        joinedAt: now,
        lastSeenAt: now,
      };
      room.players.push(newPlayer);
      if (!room.players.some((candidate) => candidate.id === room.hostPlayerId)) {
        room.hostPlayerId = newPlayer.id;
      }
      saveRooms();
      logActivity({
        nickname,
        accountId: account ? account.id : null,
        kind: 'salon',
        text: `a rejoint le salon « ${room.title} »`,
        dedupeKey: `entree:${room.id}:${newPlayer.id}`,
      });
      return sendJson(res, 201, { room: publicRoom(room, newPlayerToken), playerToken: newPlayerToken });
    }

    if (req.method === 'POST' && action === 'start') {
      const host = findParticipant(room, playerToken);
      if (!host || host.id !== room.hostPlayerId) {
        req.resume();
        return sendJson(res, 403, { error: 'Seul l’organisateur peut lancer cette partie.' });
      }
      if (room.status === 'started') {
        req.resume();
        return sendJson(res, 409, { error: 'Cette partie est déjà lancée.' });
      }
      const engine = roomEngine(room);
      if (!engine) {
        req.resume();
        return sendJson(res, 409, { error: 'Ce jeu n’est pas encore disponible.' });
      }
      const game = GAMES[room.game];
      const minimum = game ? game.minPlayers : 1;
      if (room.players.length < minimum) {
        req.resume();
        return sendJson(res, 400, { error: `Il faut au moins ${minimum} joueurs pour lancer cette partie. Tu peux ajouter des bots de test.` });
      }
      await readJson(req);
      room.status = 'started';
      room.gameState = engine.createGame(room.players);
      room.startedAt = room.gameState.startedAt;
      room.startedBy = host.id;
      processRoomBots(room);
      recordRoomVictory(room);
      saveRooms();
      logActivity({
        nickname: host.nickname,
        accountId: host.accountId || null,
        kind: 'partie',
        text: `a lancé la partie « ${room.title} » (${room.players.length} joueur${room.players.length > 1 ? 's' : ''})`,
        dedupeKey: `lancement:${room.id}:${room.startedAt}`,
      });
      return sendJson(res, 200, { room: publicRoom(room, playerToken) });
    }

    if (req.method === 'POST' && action.startsWith('uno/')) {
      const player = findParticipant(room, playerToken);
      if (!player || player.isBot) {
        req.resume();
        return sendJson(res, 401, { error: 'Rejoins cette partie avec ton pseudo pour jouer.' });
      }
      if (room.game !== 'uno') {
        req.resume();
        return sendJson(res, 409, { error: 'Ces actions sont disponibles pour UNO uniquement.' });
      }

      if (action === 'uno/restart') {
        if (player.id !== room.hostPlayerId) {
          req.resume();
          return sendJson(res, 403, { error: 'Seul l’organisateur peut relancer une manche.' });
        }
        if (!room.gameState || room.gameState.phase !== 'finished') {
          req.resume();
          return sendJson(res, 409, { error: 'La manche actuelle doit se terminer avant de rejouer.' });
        }
        if (room.players.length < GAMES.uno.minPlayers) {
          req.resume();
          return sendJson(res, 400, { error: 'Il faut au moins deux joueurs pour rejouer.' });
        }
        await readJson(req);
        room.gameState = unoEngine.createGame(room.players);
        room.startedAt = room.gameState.startedAt;
        processRoomBots(room);
        recordRoomVictory(room);
        saveRooms();
        return sendJson(res, 200, { room: publicRoom(room, playerToken) });
      }

      if (!room.gameState || room.gameState.phase !== 'playing') {
        req.resume();
        return sendJson(res, 409, { error: 'La manche UNO n’est pas en cours.' });
      }

      const body = await readJson(req);
      if (action === 'uno/play') {
        unoEngine.playCard(room, player, String(body.cardId || ''), String(body.color || ''));
      } else if (action === 'uno/draw') {
        unoEngine.drawForPlayer(room, player);
      } else if (action === 'uno/pass') {
        unoEngine.passTurn(room, player);
      } else {
        return sendJson(res, 404, { error: 'Cette action UNO n’existe pas.' });
      }
      unoEngine.processBots(room);
      recordRoomVictory(room);
      saveRooms();
      return sendJson(res, 200, { room: publicRoom(room, playerToken) });
    }

    if (req.method === 'POST' && action.startsWith('puissance-4/')) {
      const player = findParticipant(room, playerToken);
      if (!player || player.isBot) {
        req.resume();
        return sendJson(res, 401, { error: 'Rejoins cette partie avec ton pseudo pour jouer.' });
      }
      if (room.game !== 'puissance-4') {
        req.resume();
        return sendJson(res, 409, { error: 'Ces actions sont disponibles pour Puissance 4 uniquement.' });
      }

      if (action === 'puissance-4/restart') {
        if (player.id !== room.hostPlayerId) {
          req.resume();
          return sendJson(res, 403, { error: 'Seul l’organisateur peut relancer une partie.' });
        }
        if (!room.gameState || room.gameState.phase !== 'finished') {
          req.resume();
          return sendJson(res, 409, { error: 'La partie actuelle doit se terminer avant de rejouer.' });
        }
        if (room.players.length < GAMES['puissance-4'].minPlayers) {
          req.resume();
          return sendJson(res, 400, { error: 'Il faut deux joueurs pour rejouer à Puissance 4.' });
        }
        await readJson(req);
        room.gameState = puissance4Engine.createGame(room.players);
        room.startedAt = room.gameState.startedAt;
        processRoomBots(room);
        recordRoomVictory(room);
        saveRooms();
        return sendJson(res, 200, { room: publicRoom(room, playerToken) });
      }

      if (!room.gameState || room.gameState.phase !== 'playing') {
        req.resume();
        return sendJson(res, 409, { error: 'La partie de Puissance 4 n’est pas en cours.' });
      }

      const body = await readJson(req);
      if (action !== 'puissance-4/play') {
        return sendJson(res, 404, { error: 'Cette action Puissance 4 n’existe pas.' });
      }
      puissance4Engine.playColumn(room, player, body.column);
      processRoomBots(room);
      recordRoomVictory(room);
      saveRooms();
      return sendJson(res, 200, { room: publicRoom(room, playerToken) });
    }

    if (req.method === 'POST' && ['loup-garou/restart', 'quiz/restart', 'blind-test/restart', 'morpion/restart', 'memoire/restart'].includes(action)) {
      const player = findParticipant(room, playerToken);
      if (!player || player.isBot) {
        req.resume();
        return sendJson(res, 401, { error: 'Rejoins cette partie avec ton pseudo pour jouer.' });
      }
      const engine = roomEngine(room);
      if (!engine || action.split('/')[0] !== room.game) {
        req.resume();
        return sendJson(res, 409, { error: 'Cette action de revanche ne correspond pas à ce jeu.' });
      }
      if (player.id !== room.hostPlayerId) {
        req.resume();
        return sendJson(res, 403, { error: 'Seul l’organisateur peut lancer une revanche.' });
      }
      if (!room.gameState || room.gameState.phase !== 'finished') {
        req.resume();
        return sendJson(res, 409, { error: 'La partie doit se terminer avant de rejouer.' });
      }
      const minimum = GAMES[room.game]?.minPlayers || 2;
      if (room.players.length < minimum) {
        req.resume();
        return sendJson(res, 400, { error: `Il faut au moins ${minimum} joueurs pour rejouer.` });
      }
      await readJson(req);
      room.gameState = engine.createGame(room.players);
      if (room.game === 'loup-garou') room.wolfChatMessages = [];
      room.startedAt = room.gameState.startedAt;
      processRoomBots(room);
      recordRoomVictory(room);
      saveRooms();
      return sendJson(res, 200, { room: publicRoom(room, playerToken) });
    }

    const supportedGameAction = action.match(/^(loup-garou|quiz|blind-test|morpion|memoire)\/(act|answer|next|play|flip|continue)$/);
    if (req.method === 'POST' && supportedGameAction) {
      const [, gameId, verb] = supportedGameAction;
      const player = findParticipant(room, playerToken);
      if (!player || player.isBot) {
        req.resume();
        return sendJson(res, 401, { error: 'Rejoins cette partie avec ton pseudo pour jouer.' });
      }
      if (room.game !== gameId) {
        req.resume();
        return sendJson(res, 409, { error: 'Cette action ne correspond pas au jeu de ce salon.' });
      }
      const body = await readJson(req);
      if (gameId === 'loup-garou' && verb === 'act') {
        loupGarouEngine.submitAction(room, player, body);
      } else if ((gameId === 'quiz' || gameId === 'blind-test') && verb === 'answer') {
        const engine = roomEngine(room);
        engine.answerQuestion(room, player, body.choiceIndex);
      } else if ((gameId === 'quiz' || gameId === 'blind-test') && verb === 'next') {
        const engine = roomEngine(room);
        engine.advanceQuestion(room, player);
      } else if (gameId === 'morpion' && verb === 'play') {
        morpionEngine.playCell(room, player, body.cell);
      } else if (gameId === 'memoire' && verb === 'flip') {
        memoireEngine.flipCard(room, player, String(body.cardId || ''));
      } else if (gameId === 'memoire' && verb === 'continue') {
        memoireEngine.continueAfterMismatch(room, player);
      } else {
        return sendJson(res, 404, { error: 'Cette action n’existe pas pour ce jeu.' });
      }
      processRoomBots(room);
      recordRoomVictory(room);
      saveRooms();
      return sendJson(res, 200, { room: publicRoom(room, playerToken) });
    }

    if (req.method === 'POST' && action === 'bots') {
      const host = findParticipant(room, playerToken);
      if (!host || host.id !== room.hostPlayerId) {
        req.resume();
        return sendJson(res, 403, { error: 'Seul l’organisateur peut ajouter des bots de test.' });
      }
      if (room.status === 'started') {
        req.resume();
        return sendJson(res, 409, { error: 'La partie a commencé : les bots ne peuvent plus être modifiés.' });
      }

      const body = await readJson(req);
      const requestedCount = Number(body.count);
      const availableSeats = Math.max(0, room.maxPlayers - room.players.length);
      if (!Number.isInteger(requestedCount) || requestedCount < 1) {
        return sendJson(res, 400, { error: 'Choisis au moins un bot à ajouter.' });
      }
      if (availableSeats === 0) {
        return sendJson(res, 409, { error: 'Le salon est déjà complet.' });
      }

      const count = Math.min(requestedCount, availableSeats);
      const usedNames = new Set(room.players.map((player) => player.nickname.toLocaleLowerCase('fr-FR')));
      let nameIndex = room.players.filter((player) => player.isBot).length;
      const now = Date.now();
      for (let added = 0; added < count; added += 1) {
        let nickname;
        do {
          const baseName = BOT_NAMES[nameIndex % BOT_NAMES.length];
          const suffix = Math.floor(nameIndex / BOT_NAMES.length);
          nickname = `Bot ${baseName}${suffix ? ` ${suffix + 1}` : ''}`;
          nameIndex += 1;
        } while (usedNames.has(nickname.toLocaleLowerCase('fr-FR')));
        usedNames.add(nickname.toLocaleLowerCase('fr-FR'));
        room.players.push({
          id: crypto.randomUUID(),
          nickname,
          isBot: true,
          joinedAt: now + added,
          lastSeenAt: now,
        });
      }
      saveRooms();
      return sendJson(res, 200, { room: publicRoom(room, playerToken), addedCount: count });
    }

    if (req.method === 'DELETE' && action === 'bots') {
      const host = findParticipant(room, playerToken);
      if (!host || host.id !== room.hostPlayerId) {
        return sendJson(res, 403, { error: 'Seul l’organisateur peut retirer les bots de test.' });
      }
      if (room.status === 'started') {
        return sendJson(res, 409, { error: 'La partie a commencé : les bots ne peuvent plus être modifiés.' });
      }
      const previousCount = room.players.length;
      room.players = room.players.filter((player) => !player.isBot);
      const removedCount = previousCount - room.players.length;
      saveRooms();
      return sendJson(res, 200, { room: publicRoom(room, playerToken), removedCount });
    }

    if (req.method === 'POST' && action === 'heartbeat') {
      const player = findParticipant(room, playerToken);
      if (!player) return sendJson(res, 401, { error: 'Ta présence dans ce salon a expiré.' });
      player.lastSeenAt = Date.now();
      saveRooms();
      return sendJson(res, 200, { room: publicRoom(room, playerToken) });
    }

    if (req.method === 'DELETE' && action === 'players/me') {
      const player = findParticipant(room, playerToken);
      if (!player) return sendJson(res, 401, { error: 'Tu n’es plus dans ce salon.' });
      room.players = room.players.filter((candidate) => candidate.id !== player.id);
      if (room.gameState) {
        syncRoomPlayers(room);
        processRoomBots(room);
        recordRoomVictory(room);
      }
      transferHostIfNeeded(room, player.id);
      saveRooms();
      logActivity({
        nickname: player.nickname,
        accountId: player.accountId || null,
        kind: 'salon',
        text: `a quitté le salon « ${room.title} »`,
        dedupeKey: `sortie:${room.id}:${player.id}`,
      });
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE' && !action) {
      const player = findParticipant(room, playerToken);
      if (!player || player.id !== room.hostPlayerId) {
        return sendJson(res, 403, { error: 'Seul l’organisateur de cette partie peut la fermer.' });
      }
      rooms = rooms.filter((candidate) => candidate.id !== room.id);
      saveRooms();
      logActivity({
        nickname: player.nickname,
        accountId: player.accountId || null,
        kind: 'salon',
        text: `a fermé le salon « ${room.title} »`,
        dedupeKey: `fermeture:${room.id}`,
      });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: 'Cette action n’est pas disponible.' });
  }

  return sendJson(res, 404, { error: 'Cette page n’existe pas.' });
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  })[extension] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end('Method not allowed');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  let file;
  try {
    file = fs.readFileSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      res.statusCode = 404;
      return res.end('Not found');
    }
    throw error;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType(filePath));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', file.length);
  return res.end(req.method === 'HEAD' ? undefined : file);
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    return serveStatic(req, res, url.pathname);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode >= 500) console.error('Erreur serveur :', error);
    return sendJson(res, statusCode, {
      error: statusCode === 500 ? 'Un problème est survenu. Réessaie dans un instant.' : error.message,
    });
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const listeningPort = address && typeof address === 'object' ? address.port : PORT;
  console.log(`Récré’Jeux est disponible sur http://${HOST}:${listeningPort}`);
  if (!CREATOR_CODE) {
    console.warn('Définis CREATOR_CODE dans l’environnement pour activer la création de salons.');
  }
});
