'use strict';

(() => {
  const GAMES = [
    { id: 'uno', name: 'UNO', category: 'Cartes', icon: '🃏', minPlayers: 2, maxPlayers: 10, defaultPlayers: 6 },
    { id: 'loup-garou', name: 'Loup-garou', category: 'Ambiance', icon: '🐺', minPlayers: 4, maxPlayers: 12, defaultPlayers: 8 },
    { id: 'quiz', name: 'Quiz express', category: 'Quiz', icon: '🧠', minPlayers: 2, maxPlayers: 20, defaultPlayers: 8 },
    { id: 'puissance-4', name: 'Puissance 4', category: 'Stratégie', icon: '🔴', minPlayers: 2, maxPlayers: 2, defaultPlayers: 2 },
    { id: 'blind-test', name: 'Blind test', category: 'Musique', icon: '🎧', minPlayers: 2, maxPlayers: 12, defaultPlayers: 6 },
    { id: 'morpion', name: 'Morpion', category: 'Stratégie', icon: '⭕', minPlayers: 2, maxPlayers: 2, defaultPlayers: 2 },
    { id: 'memoire', name: 'Memory', category: 'Réflexion', icon: '🧩', minPlayers: 2, maxPlayers: 4, defaultPlayers: 4 },
  ];
  const TOKEN_STORAGE_KEY = 'recre-jeux-room-sessions';
  const NICKNAME_STORAGE_KEY = 'recre-jeux-nickname';
  const ACCOUNT_STORAGE_KEY = 'recre-jeux-account-session';
  const LAST_ACCOUNT_NICKNAME_KEY = 'recre-jeux-last-account-nickname';
  const PRESENCE_ID_KEY = 'recre-jeux-presence-id';
  const SOLO_RECORDS_KEY = 'recre-jeux-solo-records';
  const SOLO_SETTINGS_KEY = 'recre-jeux-solo-settings';
  const CHAT_REACTIONS = ['👏', '😂', '🤔', '🎉', '❤️', '🔥', '🤝', '💡'];
  const SOLO_GAME_DETAILS = {
    snake: {
      name: 'Snake',
      icon: '🐍',
      subtitle: 'Guide le serpent, mange les fruits et évite les murs.',
      optionLabel: 'Vitesse',
      variants: [
        { id: 'tranquille', label: 'Tranquille', note: '18 × 18 · départ lent', size: 18, interval: 200, step: 3, minimum: 110 },
        { id: 'normal', label: 'Normal', note: '20 × 20 · accélère', size: 20, interval: 150, step: 3, minimum: 85, default: true },
        { id: 'rapide', label: 'Rapide', note: '24 × 24 · nerveux', size: 24, interval: 105, step: 2, minimum: 62 },
        { id: 'turbo', label: 'Turbo', note: '28 × 28 · pour experts', size: 28, interval: 78, step: 2, minimum: 45 },
      ],
    },
    '2048': {
      name: '2048',
      icon: '🔢',
      subtitle: 'Fais glisser les tuiles et fusionne les nombres identiques.',
      optionLabel: 'Grille',
      variants: [
        { id: 'classique', label: '4 × 4', note: 'objectif 2048', size: 4, target: 2048 },
        { id: 'large', label: '5 × 5', note: 'objectif 4096', size: 5, target: 4096 },
        { id: 'geant', label: '6 × 6', note: 'objectif 8192', size: 6, target: 8192 },
      ],
    },
    demineur: {
      name: 'Démineur',
      icon: '💣',
      subtitle: 'Lis les indices, marque les mines et révèle les cases sûres.',
      optionLabel: 'Difficulté',
      variants: [
        { id: 'facile', label: 'Facile', note: '9 × 9 · 10 mines', rows: 9, columns: 9, mines: 10 },
        { id: 'moyen', label: 'Moyen', note: '12 × 12 · 25 mines', rows: 12, columns: 12, mines: 25 },
        { id: 'difficile', label: 'Difficile', note: '16 × 16 · 50 mines', rows: 16, columns: 16, mines: 50 },
        { id: 'expert', label: 'Expert', note: '20 × 20 · 90 mines', rows: 20, columns: 20, mines: 90 },
      ],
    },
    memory: {
      name: 'Memory solo',
      icon: '🧩',
      subtitle: 'Retrouve toutes les paires cachées avec le moins de coups possible.',
      optionLabel: 'Taille',
      variants: [
        { id: 'petit', label: '8 paires', note: 'grille 4 × 4', pairs: 8, columns: 4 },
        { id: 'moyen', label: '12 paires', note: 'grille 6 × 4', pairs: 12, columns: 6 },
        { id: 'grand', label: '18 paires', note: 'grille 6 × 6', pairs: 18, columns: 6 },
      ],
    },
  };
  const dialog = document.querySelector('#app-dialog');
  const dialogContent = document.querySelector('#dialog-content');
  const roomGrid = document.querySelector('#room-grid');
  const roomCount = document.querySelector('#room-count');
  const leaderboardList = document.querySelector('#leaderboard-list');
  const leaderboardRefresh = document.querySelector('#leaderboard-refresh');
  const connectionStatus = document.querySelector('#connection-status');
  const connectionLabel = document.querySelector('#connection-label');
  const refreshButton = document.querySelector('#refresh-button');
  const searchInput = document.querySelector('#room-search');
  const menuToggle = document.querySelector('#menu-toggle');
  const mobileNav = document.querySelector('#mobile-nav');
  const accountButton = document.querySelector('#account-button');
  const accountLabel = document.querySelector('#account-label');
  const cachedAccountData = readPersistent(ACCOUNT_STORAGE_KEY, {});
  const cachedAccountSession = cachedAccountData && typeof cachedAccountData === 'object' ? cachedAccountData : {};

  let rooms = [];
  let selectedFilter = 'Tous';
  let searchTerm = '';
  let hasLoadedRooms = false;
  let roomsRequestInFlight = false;
  let creatorTicket = '';
  let adminToken = '';
  let presenceId = readPersistent(PRESENCE_ID_KEY, '');
  let adminPresence = [];
  let adminPresenceTimerId = 0;
  let buzzAudioContext = null;
  let adminAccounts = [];
  let adminActivity = [];
  let adminActivityPeople = [];
  let adminActivityFilter = '';
  let toastTimer = 0;
  let roomTokens = readSession(TOKEN_STORAGE_KEY, {});
  let accountToken = typeof cachedAccountSession.token === 'string' ? cachedAccountSession.token : '';
  let currentAccount = cachedAccountSession.account && typeof cachedAccountSession.account.nickname === 'string'
    ? cachedAccountSession.account
    : null;
  let activeRoomSnapshot = null;
  let selectedUnoCardId = '';
  let unoActionInFlight = false;
  let chatActionInFlight = false;
  let blindAudioContext = null;
  let roomStartInFlight = false;
  let soloStartInFlight = false;
  let soloArcadeState = null;
  let soloTickerId = 0;
  let soloMemoryTimeoutId = 0;
  let cheatActionMode = 'force-next-draw';
  let cheatActionInFlight = false;
  const roomsClosing = new Set();

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  function readSession(key, fallback) {
    try {
      const value = sessionStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeSession(key, value) {
    try {
      sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    } catch {
      // La partie reste utilisable pendant l’onglet même si le stockage est désactivé.
    }
  }

  function readPersistent(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function writePersistent(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // La connexion fonctionne jusqu’à la fermeture de l’onglet si le stockage est désactivé.
    }
  }

  function clearPersistent(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Le stockage peut être désactivé par le navigateur.
    }
  }

  function updateAccountButton() {
    if (!accountButton || !accountLabel) return;
    accountLabel.textContent = currentAccount ? currentAccount.nickname : 'Mon compte';
    const accessibleName = currentAccount
      ? `Compte de ${currentAccount.nickname}, gérer le compte`
      : 'Créer un compte ou se connecter';
    accountButton.setAttribute('aria-label', accessibleName);
    accountButton.title = accessibleName;
  }

  function saveAccountSession(account, token) {
    currentAccount = account;
    accountToken = token;
    writePersistent(ACCOUNT_STORAGE_KEY, { account, token });
    writePersistent(LAST_ACCOUNT_NICKNAME_KEY, account.nickname);
    saveNickname(account.nickname);
    updateAccountButton();
  }

  function clearAccountSession() {
    if (currentAccount && typeof currentAccount.nickname === 'string') {
      writePersistent(LAST_ACCOUNT_NICKNAME_KEY, currentAccount.nickname);
    }
    currentAccount = null;
    accountToken = '';
    clearPersistent(ACCOUNT_STORAGE_KEY);
    updateAccountButton();
  }

  async function loadAccountSession() {
    updateAccountButton();
    if (!accountToken) {
      if (currentAccount) clearAccountSession();
      return;
    }
    try {
      const data = await api('/api/accounts/me', { headers: { 'X-Account-Token': accountToken } });
      currentAccount = data.account;
      writePersistent(ACCOUNT_STORAGE_KEY, { account: currentAccount, token: accountToken });
      writePersistent(LAST_ACCOUNT_NICKNAME_KEY, currentAccount.nickname);
      saveNickname(currentAccount.nickname);
      updateAccountButton();
    } catch (error) {
      if (error.status === 401) clearAccountSession();
    }
  }

  function accountHeaders(headers = {}) {
    const result = { ...headers };
    if (accountToken) result['X-Account-Token'] = accountToken;
    return result;
  }

  function saveRoomTokens() {
    writeSession(TOKEN_STORAGE_KEY, roomTokens);
  }

  function rememberRoomToken(roomId, token) {
    roomTokens[roomId] = token;
    saveRoomTokens();
  }

  function forgetRoomToken(roomId) {
    delete roomTokens[roomId];
    saveRoomTokens();
  }

  function getNickname() {
    if (currentAccount && currentAccount.nickname) return currentAccount.nickname;
    try {
      const sessionNickname = sessionStorage.getItem(NICKNAME_STORAGE_KEY);
      if (sessionNickname) return sessionNickname;
    } catch {
      // Les pseudos enregistrés localement peuvent toujours être repris.
    }
    const rememberedNickname = readPersistent(LAST_ACCOUNT_NICKNAME_KEY, '');
    return typeof rememberedNickname === 'string' ? rememberedNickname : '';
  }

  function saveNickname(nickname) {
    writeSession(NICKNAME_STORAGE_KEY, nickname);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character]);
  }

  function gameFor(gameId) {
    return GAMES.find((game) => game.id === gameId) || {
      id: 'fallback', name: 'Jeu', category: 'Autre', icon: '🎲', minPlayers: 2, maxPlayers: 10,
    };
  }

  async function api(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const init = { method: options.method || 'GET', headers, cache: 'no-store' };
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, init);
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new ApiError(data.error || 'Une erreur est survenue. Réessaie.', response.status);
    }
    return data;
  }

  function currentActivityLabel() {
    if (dialog.open && dialog.dataset.view === 'solo-game' && soloArcadeState) {
      return `Jeu solo : ${SOLO_GAME_DETAILS[soloArcadeState.gameId]?.name || soloArcadeState.gameId}`;
    }
    if (dialog.open && dialog.dataset.view === 'room') {
      const title = activeRoomSnapshot?.title || '';
      return title ? `Partie : ${title}` : 'Dans une partie';
    }
    if (dialog.open && dialog.dataset.view === 'admin-panel') return 'Panneau administrateur';
    if (dialog.open) return 'Navigation sur le site';
    return 'Sur le site';
  }

  const BUZZ_PATTERNS = {
    cloche: { notes: [1319, 988, 1319, 1568], duration: 0.28, type: 'sine', gap: 0.22, level: 0.22 },
    alarme: { notes: [880, 587, 880, 587, 880], duration: 0.2, type: 'square', gap: 0.21, level: 0.26 },
    tada: { notes: [523, 659, 784, 1047], duration: 0.34, type: 'triangle', gap: 0.14, level: 0.24 },
  };

  // Le contexte audio est gardé ouvert et débloqué au premier geste de la
  // personne : sans cela, un navigateur refuse de jouer un son déclenché à
  // distance par l'organisateur.
  function audioEngine() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    try {
      if (!buzzAudioContext || buzzAudioContext.state === 'closed') {
        buzzAudioContext = new AudioContextClass();
      }
      if (buzzAudioContext.state === 'suspended') buzzAudioContext.resume().catch(() => {});
      return buzzAudioContext;
    } catch {
      return null;
    }
  }

  function unlockAudio() {
    const context = audioEngine();
    if (!context || context.state === 'suspended') return;
    document.removeEventListener('pointerdown', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
  }

  // Chaîne de sortie compressée : permet de pousser le volume au maximum
  // sans que le son ne sature et devienne inaudible.
  function buzzOutput(context, level) {
    const master = context.createGain();
    master.gain.value = level;
    if (typeof context.createDynamicsCompressor === 'function') {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.knee.value = 6;
      compressor.ratio.value = 18;
      compressor.attack.value = 0.002;
      compressor.release.value = 0.12;
      master.connect(compressor);
      compressor.connect(context.destination);
    } else {
      master.connect(context.destination);
    }
    return master;
  }

  function noiseBurst(context, output, start, duration) {
    if (typeof context.createBuffer !== 'function') return;
    const frames = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frames; index += 1) {
      data[index] = (Math.random() * 2) - 1;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.9, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(gain);
    gain.connect(output);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  // SON MÉGA : sirène montante et descendante répétée, doublée en octave et
  // désaccordée, avec rafales de bruit. Volume poussé au maximum autorisé.
  function playMegaAlarm(context) {
    const output = buzzOutput(context, 1);
    const start = context.currentTime + 0.04;
    const sweeps = 4;
    const sweep = 0.62;
    for (let index = 0; index < sweeps; index += 1) {
      const begin = start + (index * sweep);
      const middle = begin + (sweep * 0.5);
      const end = begin + sweep;
      noiseBurst(context, output, begin, 0.09);
      [
        { type: 'sawtooth', low: 620, high: 1500, gain: 0.5, detune: 0 },
        { type: 'sawtooth', low: 624, high: 1508, gain: 0.45, detune: 11 },
        { type: 'square', low: 310, high: 750, gain: 0.35, detune: -7 },
      ].forEach((voice) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = voice.type;
        if (oscillator.detune) oscillator.detune.value = voice.detune;
        oscillator.frequency.setValueAtTime(voice.low, begin);
        oscillator.frequency.linearRampToValueAtTime(voice.high, middle);
        oscillator.frequency.linearRampToValueAtTime(voice.low, end);
        gain.gain.setValueAtTime(0.0001, begin);
        gain.gain.exponentialRampToValueAtTime(voice.gain, begin + 0.03);
        gain.gain.setValueAtTime(voice.gain, end - 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain);
        gain.connect(output);
        oscillator.start(begin);
        oscillator.stop(end + 0.03);
      });
    }
    return (sweeps * sweep * 1000) + 300;
  }

  function playBuzzSound(sound) {
    const context = audioEngine();
    if (!context) return false;
    try {
      if (sound === 'mega') {
        playMegaAlarm(context);
        return true;
      }
      const pattern = BUZZ_PATTERNS[sound] || BUZZ_PATTERNS.cloche;
      const output = buzzOutput(context, pattern.level || 0.22);
      const startAt = context.currentTime + 0.05;
      pattern.notes.forEach((frequency, index) => {
        const start = startAt + (index * pattern.gap);
        const end = start + pattern.duration;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = pattern.type;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.9, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain);
        gain.connect(output);
        oscillator.start(start);
        oscillator.stop(end + 0.03);
      });
      return true;
    } catch {
      return false;
    }
  }

  function flashScreen(duration) {
    const flash = document.createElement('div');
    flash.className = 'buzz-flash';
    flash.setAttribute('aria-hidden', 'true');
    document.body.append(flash);
    window.setTimeout(() => flash.remove(), duration);
  }

  function receiveBuzz(buzz) {
    if (!buzz) return;
    const isMega = buzz.sound === 'mega';
    const played = playBuzzSound(buzz.sound);
    if (navigator.vibrate) {
      try {
        navigator.vibrate(isMega ? [400, 120, 400, 120, 400, 120, 600] : [130, 70, 130]);
      } catch { /* vibration indisponible */ }
    }
    if (isMega) flashScreen(2600);
    const message = String(buzz.message || '').trim();
    const prefix = isMega ? '📢 ALERTE DE L’ORGANISATEUR' : '🔔 Message de l’organisateur';
    showToast(
      message
        ? `${prefix} : ${message}`
        : (isMega
          ? '📢 ALERTE ! L’organisateur te demande de regarder l’écran.'
          : '🔔 L’organisateur t’envoie un signal sonore !'),
      played ? 'success' : 'info',
    );
  }

  async function pingPresence() {
    try {
      const data = await api('/api/presence', {
        method: 'POST',
        body: {
          id: presenceId || undefined,
          nickname: currentAccount?.nickname || readPersistent(LAST_ACCOUNT_NICKNAME_KEY, '') || '',
          activity: currentActivityLabel(),
        },
        headers: accountHeaders(),
      });
      if (data.id && data.id !== presenceId) {
        presenceId = data.id;
        writePersistent(PRESENCE_ID_KEY, presenceId);
      }
      if (data.buzz) receiveBuzz(data.buzz);
    } catch {
      /* la présence est secondaire : on réessaiera au prochain battement */
    }
  }

  function setConnection(state, label) {
    connectionStatus.classList.toggle('is-online', state === 'online');
    connectionStatus.classList.toggle('is-offline', state === 'offline');
    connectionLabel.textContent = label;
  }

  function playerInitials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return Array.from((parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0] || '?'))
      .slice(0, 2)
      .join('')
      .toLocaleUpperCase('fr-FR');
  }

  function timeAgo(timestamp) {
    const createdAt = Number(timestamp);
    if (!Number.isFinite(createdAt)) return 'à l’instant';
    const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
    if (seconds < 45) return 'à l’instant';
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `il y a ${minutes} min`;
    }
    const hours = Math.floor(seconds / 3600);
    if (hours < 24) return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
  }

  function setSelectedFilter(filter) {
    selectedFilter = filter;
    document.querySelectorAll('[data-filter]').forEach((button) => {
      const active = button.dataset.filter === filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    renderRooms();
  }

  function renderRoomCard(room, index) {
    const game = gameFor(room.game);
    const gameClass = `game-${escapeHtml(game.id)}`;
    const token = roomTokens[room.id];
    const isMine = Boolean(token);
    const canCloseRoom = Boolean(token && room.isHost);
    const isClosingRoom = roomsClosing.has(room.id);
    const isStarted = room.status === 'started';
    const closeLabel = isStarted ? 'Arrêter' : 'Fermer';
    const full = Boolean(room.isFull) && !isMine;
    const unavailable = !isMine && (full || isStarted);
    const buttonLabel = isMine
      ? (isStarted ? 'Voir la partie' : 'Ouvrir le salon')
      : (isStarted ? 'En cours' : (full ? 'Complet' : 'Rejoindre'));
    const visiblePlayers = (room.players || []).slice(0, 3);
    const extraPlayers = Math.max(0, Number(room.playerCount || 0) - visiblePlayers.length);
    const avatars = visiblePlayers.map((player) => (
      `<span class="player-avatar${player.isBot ? ' is-bot' : ''}" title="${player.isBot ? 'Bot de test · ' : ''}${escapeHtml(player.nickname)}">${escapeHtml(playerInitials(player.nickname))}</span>`
    )).join('');
    const extra = extraPlayers ? `<span class="avatar-extra">+${extraPlayers}</span>` : '';
    const playerCount = Number(room.playerCount || 0);
    const maxPlayers = Number(room.maxPlayers || 0);

    return `
      <article class="room-card">
        <div class="room-card-art ${gameClass}">
          <span class="room-status${isStarted ? ' is-started' : ''}"><span class="pulse-dot"></span> ${isStarted ? 'PARTIE EN COURS' : 'PARTIE OUVERTE'}</span>
          <span class="room-art-icon" aria-hidden="true">${game.icon}</span>
          <span class="room-art-short">${escapeHtml(game.name.toLocaleUpperCase('fr-FR'))}</span>
        </div>
        <div class="room-card-content">
          <div class="room-meta"><span class="meta-game">${escapeHtml(game.name)}</span><span aria-hidden="true">·</span><span>${escapeHtml(game.category)}</span><span aria-hidden="true">·</span><span>${escapeHtml(timeAgo(room.createdAt))}</span></div>
          <h3 title="${escapeHtml(room.title)}">${escapeHtml(room.title)}</h3>
          <p class="room-host-line">Organisé par <strong>${escapeHtml(room.hostName || 'un joueur')}</strong></p>
          <div class="room-card-footer">
            <div class="player-summary" aria-label="${playerCount} joueur${playerCount > 1 ? 's' : ''} sur ${maxPlayers}">
              <span class="avatar-stack">${avatars}${extra}</span>
              <span class="player-count">${playerCount}/${maxPlayers}</span>
            </div>
            <div class="room-card-actions">
              <button class="room-open-button${isMine ? ' is-mine' : ''}" type="button" data-room-open="${escapeHtml(room.id)}"${unavailable ? ' disabled' : ''}>${buttonLabel}<span aria-hidden="true">${unavailable ? '' : ' ↗'}</span></button>
              ${canCloseRoom ? `<button class="room-close-button" type="button" data-room-close="${escapeHtml(room.id)}" aria-label="${isStarted ? 'Arrêter la partie' : 'Fermer le salon'} ${escapeHtml(room.title)}" title="${isStarted ? 'Arrêter cette partie' : 'Fermer ce salon'}"${isClosingRoom ? ' disabled' : ''}><span aria-hidden="true">${isClosingRoom ? '…' : '×'}</span><span>${isClosingRoom ? 'Fermeture…' : closeLabel}</span></button>` : ''}
            </div>
          </div>
        </div>
      </article>`;
  }

  function renderEmptyState(filteredRooms) {
    if (rooms.length > 0) {
      const hasFilter = selectedFilter !== 'Tous' || searchTerm.trim();
      if (hasFilter) {
        return `
          <div class="empty-state">
            <span class="empty-illustration" aria-hidden="true">🔎</span>
            <h3>Aucun salon trouvé</h3>
            <p>Essaie un autre jeu ou une autre recherche : les parties peuvent changer rapidement.</p>
            <button class="button button-primary" type="button" data-action="reset-filters">Effacer les filtres</button>
          </div>`;
      }
    }
    return `
      <div class="empty-state">
        <span class="empty-illustration" aria-hidden="true">🎲</span>
        <h3>Pas encore de partie ouverte</h3>
        <p>Dès qu’un salon est créé, il apparaîtra ici pour que chacun puisse le voir et le rejoindre.</p>
        <button class="button button-primary" type="button" data-action="create">Créer une partie</button>
        <span class="empty-secondary">Le code organisateur est nécessaire pour créer un salon.</span>
      </div>`;
  }

  function renderRooms() {
    if (!hasLoadedRooms && rooms.length === 0) return;
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase('fr-FR');
    const filteredRooms = rooms.filter((room) => {
      const game = gameFor(room.game);
      const categoryMatches = selectedFilter === 'Tous' || game.category === selectedFilter;
      const searchText = [room.title, game.name, game.category, room.hostName, ...(room.players || []).map((player) => player.nickname)]
        .join(' ')
        .toLocaleLowerCase('fr-FR');
      return categoryMatches && (!normalizedSearch || searchText.includes(normalizedSearch));
    });

    const count = rooms.length;
    roomCount.textContent = `${count} partie${count === 1 ? '' : 's'} ouverte${count === 1 ? '' : 's'}`;
    roomGrid.setAttribute('aria-busy', 'false');
    if (filteredRooms.length === 0) {
      roomGrid.innerHTML = renderEmptyState(filteredRooms);
      return;
    }
    roomGrid.innerHTML = filteredRooms.map(renderRoomCard).join('');
  }

  async function loadRooms() {
    if (roomsRequestInFlight) return;
    roomsRequestInFlight = true;
    refreshButton.classList.add('is-loading');
    refreshButton.disabled = true;
    roomGrid.setAttribute('aria-busy', 'true');
    try {
      const roomTokenEntries = Object.entries(roomTokens)
        .filter(([, token]) => typeof token === 'string' && token.length > 0)
        .slice(0, 100);
      const headers = roomTokenEntries.length
        ? { 'X-Room-Tokens': JSON.stringify(Object.fromEntries(roomTokenEntries)) }
        : {};
      const data = await api('/api/rooms', { headers });
      rooms = Array.isArray(data.rooms) ? data.rooms : [];
      hasLoadedRooms = true;
      setConnection('online', 'En direct');
      renderRooms();
    } catch (error) {
      setConnection('offline', 'Hors ligne');
      if (!hasLoadedRooms) {
        roomCount.textContent = 'Impossible de charger les parties';
        roomGrid.innerHTML = `
          <div class="error-state">
            <strong>La salle de jeux ne répond pas.</strong>
            <p>Vérifie ta connexion et réessaie dans un instant.</p>
            <button type="button" data-action="refresh">Réessayer</button>
          </div>`;
      }
    } finally {
      roomsRequestInFlight = false;
      roomGrid.setAttribute('aria-busy', 'false');
      refreshButton.classList.remove('is-loading');
      refreshButton.disabled = false;
    }
  }

  async function loadLeaderboard() {
    if (!leaderboardList) return;
    leaderboardList.setAttribute('aria-busy', 'true');
    leaderboardRefresh?.classList.add('is-loading');
    if (leaderboardRefresh) leaderboardRefresh.disabled = true;
    try {
      const data = await api('/api/leaderboard');
      const players = Array.isArray(data.players) ? data.players : [];
      if (!players.length) {
        leaderboardList.innerHTML = `
          <li class="leaderboard-empty">
            <span aria-hidden="true">✨</span>
            <strong>Le classement attend ses premiers champions.</strong>
            <small>Crée un compte joueur pour garder ton pseudo et tes victoires.</small>
          </li>`;
      } else {
        leaderboardList.innerHTML = players.map((player, index) => {
          const wins = Number(player.wins) || 0;
          const rankClass = index < 3 ? ` is-top-${index + 1}` : '';
          return `
            <li class="leaderboard-item${rankClass}">
              <span class="leaderboard-rank" aria-label="Place ${index + 1}">${String(index + 1).padStart(2, '0')}</span>
              <span class="leaderboard-avatar" aria-hidden="true">${escapeHtml(playerInitials(player.nickname))}</span>
              <span class="leaderboard-name">${escapeHtml(player.nickname)}</span>
              <span class="leaderboard-score"><strong>${wins}</strong><small>victoire${wins === 1 ? '' : 's'}</small></span>
            </li>`;
        }).join('');
      }
    } catch {
      leaderboardList.innerHTML = '<li class="leaderboard-error">Le classement n’a pas pu être chargé. Réessaie dans un instant.</li>';
    } finally {
      leaderboardList.setAttribute('aria-busy', 'false');
      leaderboardRefresh?.classList.remove('is-loading');
      if (leaderboardRefresh) leaderboardRefresh.disabled = false;
    }
  }

  function openDialog(view, content, roomId = '') {
    dialog.dataset.view = view;
    dialog.dataset.roomId = roomId;
    dialogContent.innerHTML = content;
    dialog.classList.toggle('has-game-chat-layout', Boolean(dialogContent.querySelector('.game-chat')));
    if (!dialog.open) dialog.showModal();
  }

  function gameDialogIsFullscreen() {
    return document.fullscreenElement === dialog || dialog.classList.contains('is-game-fullscreen');
  }

  function updateFullscreenControls() {
    const isFullscreen = gameDialogIsFullscreen();
    const label = isFullscreen ? 'Quitter le plein écran' : 'Mettre la partie en plein écran';
    dialogContent.querySelectorAll('[data-fullscreen-toggle]').forEach((button) => {
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', String(isFullscreen));
      button.title = label;
      const icon = button.querySelector('[aria-hidden="true"]');
      if (icon) icon.textContent = isFullscreen ? '⤢' : '⛶';
      const hiddenLabel = button.querySelector('.visually-hidden');
      if (hiddenLabel) hiddenLabel.textContent = label;
    });
  }

  async function toggleGameFullscreen() {
    if (document.fullscreenElement === dialog) {
      try {
        await document.exitFullscreen();
      } catch {
        dialog.classList.remove('is-game-fullscreen');
      }
      updateFullscreenControls();
      return;
    }
    if (dialog.classList.contains('is-game-fullscreen')) {
      dialog.classList.remove('is-game-fullscreen');
      updateFullscreenControls();
      return;
    }
    if (typeof dialog.requestFullscreen === 'function') {
      try {
        await dialog.requestFullscreen();
        updateFullscreenControls();
        return;
      } catch {
        // Certains navigateurs refusent le plein écran natif pour un dialogue : le mode étendu sert de repli.
      }
    }
    dialog.classList.add('is-game-fullscreen');
    updateFullscreenControls();
  }

  function closeDialog() {
    if (dialog.dataset.view === 'solo-game') stopSoloPlay();
    if (dialog.dataset.view === 'admin-panel') stopAdminPresenceRefresh();
    if (document.fullscreenElement === dialog) {
      document.exitFullscreen().catch(() => {});
    }
    dialog.classList.remove('is-game-fullscreen');
    if (dialog.open) dialog.close();
  }

  function requestDialogClose() {
    closeDialog();
  }

  function accountDialog(mode = 'login') {
    if (currentAccount) {
      const nickname = escapeHtml(currentAccount.nickname);
      openDialog('account', `
        <div class="modal-kicker">MON COMPTE JOUEUR</div>
        <h2 id="dialog-title">Ton pseudo est bien gardé.</h2>
        <p class="modal-description">Tu es connecté sous ce pseudo. Il sera repris quand tu crées ou rejoins un salon.</p>
        <div class="account-profile">
          <span class="account-avatar" aria-hidden="true">${escapeHtml(playerInitials(currentAccount.nickname))}</span>
          <span><strong>${nickname}</strong><small>${Number(currentAccount.wins) || 0} victoire${Number(currentAccount.wins) === 1 ? '' : 's'} au classement${currentAccount.isAdmin ? ' · Administrateur' : ''}</small></span>
        </div>
        ${currentAccount.isAdmin ? '<button class="button button-primary account-admin-open" type="button" data-action="admin">Ouvrir le panneau administrateur</button>' : ''}
        <button class="button button-muted account-logout" type="button" data-account-logout>Se déconnecter</button>
        <p class="account-note">Tu peux continuer à jouer sans compte. Se déconnecter ne te fait pas quitter tes salons.</p>`);
      return;
    }

    const isRegister = mode === 'register';
    const rememberedNickname = readPersistent(LAST_ACCOUNT_NICKNAME_KEY, '');
    const defaultNickname = !isRegister && typeof rememberedNickname === 'string' && rememberedNickname
      ? rememberedNickname
      : getNickname();
    const savedNickname = escapeHtml(defaultNickname);
    openDialog('account', `
      <div class="modal-kicker">COMPTE JOUEUR · FACULTATIF</div>
      <h2 id="dialog-title">${isRegister ? 'Garde ton pseudo.' : 'Content de te revoir !'}</h2>
      <p class="modal-description">${isRegister
        ? 'Choisis un pseudo et un petit mot de passe pour retrouver ton identité d’une visite à l’autre.'
        : 'Connecte-toi pour rejouer avec le même pseudo.'}</p>
      <form class="modal-form" data-form="account" data-mode="${isRegister ? 'register' : 'login'}">
        <label class="form-label" for="account-nickname"><span>Pseudo <small>2 à 18 caractères</small></span>
          <input class="form-input" id="account-nickname" name="nickname" type="text" minlength="2" maxlength="18" autocomplete="username" autocapitalize="off" value="${savedNickname}" placeholder="Ex. Camille" required>
        </label>
        <label class="form-label" for="account-password"><span>Petit mot de passe <small>4 caractères minimum</small></span>
          <input class="form-input" id="account-password" name="password" type="password" minlength="4" maxlength="64" autocomplete="${isRegister ? 'new-password' : 'current-password'}" required>
        </label>
        <p class="field-error" data-error role="alert"></p>
        <button class="button button-primary modal-submit" type="submit">${isRegister ? 'Créer mon compte' : 'Se connecter'} <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5"/></svg></button>
        <p class="account-note">Pas d’adresse e-mail : retiens ton mot de passe. Évite d’utiliser ici un mot de passe important.</p>
      </form>
      <button class="account-switch" type="button" data-account-mode="${isRegister ? 'login' : 'register'}">${isRegister ? 'Tu as déjà un compte ? Se connecter' : 'Pas encore de compte ? En créer un'}</button>`);
    window.setTimeout(() => document.querySelector('#account-nickname')?.focus(), 30);
  }

  function creatorCodeDialog() {
    openDialog('creator-code', `
      <div class="modal-kicker">ACCÈS ORGANISATEUR</div>
      <h2 id="dialog-title">Tu as le code secret ?</h2>
      <p class="modal-description">Le code sert uniquement à créer un nouveau salon. Les autres pourront voir les parties ouvertes et les rejoindre sans code.</p>
      <form class="modal-form" data-form="creator-code">
        <label class="form-label" for="creator-code"><span>Code organisateur</span>
          <span class="password-wrap"><span class="input-lock" aria-hidden="true">⌑</span><input class="form-input" id="creator-code" name="code" type="password" inputmode="numeric" autocomplete="off" maxlength="24" placeholder="Saisis le code" required></span>
        </label>
        <p class="field-error" data-error role="alert"></p>
        <button class="button button-primary modal-submit" type="submit">Vérifier le code <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5"/></svg></button>
        <p class="modal-footnote"><span aria-hidden="true">🔒</span><span>Le code est vérifié côté serveur et n’est pas affiché sur la page.</span></p>
      </form>`);
    window.setTimeout(() => document.querySelector('#creator-code')?.focus(), 30);
  }

  function adminCodeDialog(message = '') {
    openDialog('admin-code', `
      <div class="modal-kicker">ACCÈS ADMINISTRATEUR</div>
      <h2 id="dialog-title">Espace réservé à l’organisateur.</h2>
      <p class="modal-description">Saisis le code organisateur pour consulter et gérer les comptes joueurs. Le code est vérifié uniquement par le serveur.</p>
      <form class="modal-form" data-form="admin-login">
        <label class="form-label" for="admin-code"><span>Code organisateur</span>
          <span class="password-wrap"><span class="input-lock" aria-hidden="true">⌑</span><input class="form-input" id="admin-code" name="code" type="password" inputmode="numeric" autocomplete="off" maxlength="24" placeholder="Saisis le code" required></span>
        </label>
        <p class="field-error" data-error role="alert">${escapeHtml(message)}</p>
        <button class="button button-primary modal-submit" type="submit">Ouvrir l’administration <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5"/></svg></button>
        <p class="modal-footnote"><span aria-hidden="true">🔒</span><span>Le code n’est jamais enregistré ni envoyé au navigateur autrement que pour vérification.</span></p>
      </form>`);
    window.setTimeout(() => document.querySelector('#admin-code')?.focus(), 30);
  }

  function formatAdminDate(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime()) || Number(timestamp) <= 0) return 'Date inconnue';
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
  }

  function presenceAge(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - Number(timestamp)) / 1000));
    if (seconds < 60) return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  const BUZZ_BUTTONS = [
    ['cloche', '🔔', 'Cloche', 'button-muted'],
    ['alarme', '🚨', 'Alarme', 'button-muted'],
    ['tada', '🎉', 'Tada', 'button-muted'],
    ['mega', '📢', 'MÉGA', 'button-danger'],
  ];

  const ACTIVITY_ICONS = {
    visite: '🚪',
    compte: '👤',
    salon: '🎪',
    partie: '🎮',
    victoire: '🏆',
    admin: '🛡️',
  };

  function formatActivityTime(timestamp) {
    const date = new Date(Number(timestamp));
    if (!Number.isFinite(date.getTime())) return '';
    const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (date >= startOfToday) return time;
    const day = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(date);
    return `${day} ${time}`;
  }

  function adminActivityRows() {
    if (!adminActivity.length) {
      return `<div class="admin-empty-state"><span aria-hidden="true">📝</span><strong>Journal vide pour le moment.</strong><small>Les connexions, salons et parties apparaîtront ici dès qu’un joueur agira.</small></div>`;
    }
    return adminActivity.map((entry) => `
      <li class="admin-activity-item" data-kind="${escapeHtml(entry.kind)}">
        <span class="admin-activity-icon" aria-hidden="true">${ACTIVITY_ICONS[entry.kind] || '•'}</span>
        <span class="admin-activity-body">
          <span class="admin-activity-time">${escapeHtml(formatActivityTime(entry.at))}</span>
          <span class="admin-activity-text"><strong>${escapeHtml(entry.nickname)}</strong> ${escapeHtml(entry.text)}</span>
        </span>
      </li>`).join('');
  }

  function updateAdminActivityList() {
    const container = dialogContent.querySelector('[data-admin-activity-list]');
    if (container) container.innerHTML = adminActivityRows();
    const counter = dialogContent.querySelector('[data-admin-activity-count]');
    if (counter) counter.textContent = adminActivity.length === 1 ? '1 action' : `${adminActivity.length} actions`;
    const select = dialogContent.querySelector('[data-admin-activity-filter]');
    if (select) {
      const options = ['<option value="">Tout le monde</option>'].concat(
        adminActivityPeople.map((name) => `<option value="${escapeHtml(name)}"${name === adminActivityFilter ? ' selected' : ''}>${escapeHtml(name)}</option>`),
      );
      if (adminActivityFilter && !adminActivityPeople.includes(adminActivityFilter)) {
        options.push(`<option value="${escapeHtml(adminActivityFilter)}" selected>${escapeHtml(adminActivityFilter)}</option>`);
      }
      select.innerHTML = options.join('');
    }
  }

  async function refreshAdminActivity() {
    if (!adminToken || dialog.dataset.view !== 'admin-panel') return;
    try {
      const query = adminActivityFilter ? `&person=${encodeURIComponent(adminActivityFilter)}` : '';
      const data = await api(`/api/admin/activity?limit=100${query}`, { headers: { 'X-Admin-Token': adminToken } });
      adminActivity = Array.isArray(data.entries) ? data.entries : [];
      adminActivityPeople = Array.isArray(data.people) ? data.people : [];
      if (dialog.dataset.view === 'admin-panel') updateAdminActivityList();
    } catch (error) {
      if (error.status === 401) adminToken = '';
    }
  }

  async function clearAdminActivity(button) {
    button.disabled = true;
    try {
      await api('/api/admin/activity', { method: 'DELETE', headers: { 'X-Admin-Token': adminToken } });
      adminActivityFilter = '';
      await refreshAdminActivity();
      showToast('Journal d’activité vidé.', 'info');
    } catch (error) {
      if (error.status === 401) {
        adminToken = '';
        adminCodeDialog(error.message);
        return;
      }
      showToast(error.message, 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async function copyAdminActivity(button) {
    const lines = adminActivity.map((entry) => (
      `${formatActivityTime(entry.at)} · ${entry.nickname} ${entry.text}`
    ));
    const text = lines.length ? lines.join('\n') : 'Journal d’activité vide.';
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${lines.length} ligne${lines.length > 1 ? 's' : ''} copiée${lines.length > 1 ? 's' : ''}.`, 'success');
    } catch {
      showToast('Copie impossible sur ce navigateur.', 'error');
    }
    if (button.isConnected) button.disabled = false;
  }

  function adminPresenceRows() {
    if (!adminPresence.length) {
      return '<div class="admin-empty-state"><span aria-hidden="true">💤</span><strong>Personne en ligne pour le moment.</strong><small>Les personnes qui ouvrent le site apparaissent ici en quelques secondes.</small></div>';
    }
    return adminPresence.map((person) => `
      <article class="admin-presence-card">
        <span class="admin-presence-dot" aria-hidden="true"></span>
        <span class="admin-presence-details">
          <strong>${escapeHtml(person.nickname)}${person.isAccount ? '<span class="admin-presence-badge">COMPTE</span>' : '<span class="admin-presence-badge is-guest">INVITÉ</span>'}${person.isAdmin ? '<span class="admin-role-badge">ADMIN</span>' : ''}</strong>
          <small>${escapeHtml(person.activity)} · ${escapeHtml(person.device)}</small>
          <small>En ligne depuis ${escapeHtml(presenceAge(person.firstSeenAt))} · vu il y a ${escapeHtml(presenceAge(person.lastSeenAt))}${person.buzzCount ? ` · ${person.buzzCount} son${person.buzzCount > 1 ? 's' : ''} envoyé${person.buzzCount > 1 ? 's' : ''}` : ''}</small>
        </span>
        <span class="admin-buzz-actions">
          ${BUZZ_BUTTONS.map(([sound, icon, label, variant]) => {
            const description = sound === 'mega'
              ? `Déclencher la sirène très forte sur l’appareil de ${person.nickname}`
              : `Envoyer le son ${label} à ${person.nickname}`;
            return `<button class="button ${variant} admin-buzz-button${sound === 'mega' ? ' is-mega' : ''}" type="button" data-admin-buzz="${escapeHtml(person.id)}" data-admin-buzz-sound="${sound}" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}"><span aria-hidden="true">${icon}</span>${label}</button>`;
          }).join('')}
        </span>
      </article>`).join('');
  }

  function updateAdminPresenceList() {
    const container = dialogContent.querySelector('[data-admin-presence-list]');
    if (container) container.innerHTML = adminPresenceRows();
    const counter = dialogContent.querySelector('[data-admin-presence-count]');
    if (counter) {
      counter.textContent = adminPresence.length === 1
        ? '1 personne connectée en ce moment'
        : `${adminPresence.length} personnes connectées en ce moment`;
    }
  }

  async function refreshAdminPresence() {
    if (!adminToken || dialog.dataset.view !== 'admin-panel') return;
    try {
      const data = await api('/api/admin/presence', { headers: { 'X-Admin-Token': adminToken } });
      adminPresence = Array.isArray(data.people) ? data.people : [];
      if (dialog.dataset.view === 'admin-panel') updateAdminPresenceList();
    } catch (error) {
      if (error.status === 401) adminToken = '';
    }
  }

  function startAdminPresenceRefresh() {
    stopAdminPresenceRefresh();
    adminPresenceTimerId = window.setInterval(() => {
      if (dialog.dataset.view !== 'admin-panel') {
        stopAdminPresenceRefresh();
        return;
      }
      refreshAdminPresence();
      refreshAdminActivity();
    }, 5000);
  }

  function stopAdminPresenceRefresh() {
    if (adminPresenceTimerId) window.clearInterval(adminPresenceTimerId);
    adminPresenceTimerId = 0;
  }

  async function sendAdminBuzzAll(button) {
    button.disabled = true;
    try {
      const data = await api('/api/admin/presence/tous/buzz', {
        method: 'POST',
        body: { sound: button.dataset.adminBuzzAll || 'mega' },
        headers: { 'X-Admin-Token': adminToken },
      });
      const count = Number(data.count) || 0;
      showToast(
        count
          ? `📢 Sirène très forte envoyée à ${count} personne${count > 1 ? 's' : ''}.`
          : 'Personne n’est connecté pour le moment.',
        count ? 'success' : 'info',
      );
      await refreshAdminPresence();
    } catch (error) {
      if (error.status === 401) {
        adminToken = '';
        adminCodeDialog(error.message);
        return;
      }
      showToast(error.message, 'error');
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async function sendAdminBuzz(button) {
    const personId = button.dataset.adminBuzz;
    const sound = button.dataset.adminBuzzSound || 'cloche';
    const person = adminPresence.find((candidate) => candidate.id === personId);
    button.disabled = true;
    try {
      const data = await api(`/api/admin/presence/${encodeURIComponent(personId)}/buzz`, {
        method: 'POST',
        body: { sound },
        headers: { 'X-Admin-Token': adminToken },
      });
      showToast(
        sound === 'mega'
          ? `📢 Sirène très forte envoyée à ${data.nickname || person?.nickname || 'cette personne'}.`
          : `🔔 Son envoyé à ${data.nickname || person?.nickname || 'cette personne'}.`,
        'success',
      );
      await refreshAdminPresence();
    } catch (error) {
      if (error.status === 401) {
        adminToken = '';
        adminCodeDialog(error.message);
        return;
      }
      showToast(error.message, 'error');
      await refreshAdminPresence();
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  function renderAdminPanel(data) {
    adminAccounts = Array.isArray(data.accounts) ? data.accounts : [];
    const count = Number(data.count) || 0;
    const accountRows = adminAccounts.map((account) => `
      <article class="admin-account-card">
        <div class="admin-account-summary">
          <span class="account-avatar admin-account-avatar" aria-hidden="true">${escapeHtml(playerInitials(account.nickname))}</span>
          <span class="admin-account-details">
            <strong>${escapeHtml(account.nickname)}${account.isAdmin ? '<span class="admin-role-badge">ADMIN</span>' : ''}</strong>
            <small>Créé le ${escapeHtml(formatAdminDate(account.createdAt))} · ${Number(account.wins) || 0} victoire${Number(account.wins) === 1 ? '' : 's'}</small>
            <small>Dernière connexion : ${escapeHtml(formatAdminDate(account.lastLoginAt))}</small>
          </span>
        </div>
        <div class="admin-account-actions">
          <button class="button button-muted" type="button" data-admin-rename="${escapeHtml(account.id)}">Renommer</button>
          <button class="button ${account.isAdmin ? 'button-muted' : 'button-primary'}" type="button" data-admin-role="${escapeHtml(account.id)}">${account.isAdmin ? 'Retirer admin' : 'Donner admin'}</button>
          <button class="button ${account.isCheater ? 'button-muted' : 'button-primary'}" type="button" data-cheater-role="${escapeHtml(account.id)}">${account.isCheater ? 'Retirer tricheur' : 'Donner tricheur'}</button>
          <button class="button button-danger" type="button" data-admin-delete="${escapeHtml(account.id)}">Supprimer</button>
        </div>
      </article>`).join('');
    dialogContent.innerHTML = `
      <div class="admin-panel">
        <div class="modal-kicker">GESTION DES COMPTES</div>
        <h2 id="dialog-title">Panneau administrateur.</h2>
        <p class="modal-description">${count} compte${count === 1 ? '' : 's'} joueur${count === 1 ? '' : 's'} enregistré${count === 1 ? '' : 's'}. Renomme un compte, gère son rôle ou supprime-le.</p>
        <p class="admin-panel-message" data-admin-message role="status" aria-live="polite"></p>
        <section class="admin-presence-section" aria-label="Personnes connectées">
          <div class="admin-section-head">
            <h3>En ligne maintenant</h3>
            <span class="admin-presence-counter" data-admin-presence-count role="status" aria-live="polite"></span>
          </div>
          <p class="admin-section-hint">Chaque personne a quatre boutons de son. Le bouton rouge <strong>📢 MÉGA</strong> déclenche une sirène très forte avec l’écran qui clignote.</p>
          <button class="button button-danger admin-buzz-all" type="button" data-admin-buzz-all="mega"><span aria-hidden="true">📢</span> MÉGA à tout le monde</button>
          <div class="admin-presence-list" data-admin-presence-list></div>
        </section>
        <section class="admin-activity-section" aria-label="Journal d’activité">
          <div class="admin-section-head">
            <h3>Journal d’activité</h3>
            <span class="admin-presence-counter" data-admin-activity-count role="status" aria-live="polite"></span>
          </div>
          <p class="admin-section-hint">Les vraies actions des joueurs, heure par heure : arrivées, connexions, salons, parties, victoires et gestes admin. <strong>Aucune touche de clavier n’est enregistrée</strong>, ni les mots de passe.</p>
          <div class="admin-activity-toolbar">
            <label class="admin-activity-filter-label" for="admin-activity-filter">Filtrer par joueur</label>
            <select class="form-input admin-activity-filter" id="admin-activity-filter" data-admin-activity-filter></select>
            <button class="button button-muted" type="button" data-admin-activity-copy>Copier</button>
            <button class="button button-danger" type="button" data-admin-activity-clear>Vider le journal</button>
          </div>
          <ol class="admin-activity-list" data-admin-activity-list></ol>
        </section>
        <div class="admin-section-head"><h3>Comptes joueurs</h3></div>
        <div class="admin-account-list" aria-label="Comptes joueurs">
          ${accountRows || '<div class="admin-empty-state"><span aria-hidden="true">☺</span><strong>Aucun compte pour le moment.</strong><small>Les comptes créés apparaîtront ici.</small></div>'}
        </div>
        <button class="button button-muted admin-logout" type="button" data-admin-logout>Quitter le panneau administrateur</button>
      </div>`;
  }

  async function adminPanelDialog() {
    if (!adminToken) {
      adminCodeDialog();
      return;
    }
    openDialog('admin-panel', '<div class="loading-modal"><span class="loading-spinner" aria-hidden="true"></span>Chargement des comptes…</div>');
    try {
      const [data, presence, activity] = await Promise.all([
        api('/api/admin/accounts', { headers: { 'X-Admin-Token': adminToken } }),
        api('/api/admin/presence', { headers: { 'X-Admin-Token': adminToken } }).catch(() => ({ people: [] })),
        api('/api/admin/activity?limit=100', { headers: { 'X-Admin-Token': adminToken } }).catch(() => ({ entries: [], people: [] })),
      ]);
      if (dialog.dataset.view !== 'admin-panel') return;
      adminPresence = Array.isArray(presence.people) ? presence.people : [];
      adminActivity = Array.isArray(activity.entries) ? activity.entries : [];
      adminActivityPeople = Array.isArray(activity.people) ? activity.people : [];
      renderAdminPanel(data);
      updateAdminPresenceList();
      updateAdminActivityList();
      startAdminPresenceRefresh();
    } catch (error) {
      if (dialog.dataset.view !== 'admin-panel') return;
      if (error.status === 401) {
        adminToken = '';
        adminCodeDialog(error.message);
        return;
      }
      dialogContent.innerHTML = `
        <div class="error-state"><strong>Les comptes n’ont pas pu être chargés.</strong><p>${escapeHtml(error.message)}</p>
          <button class="button button-primary" type="button" data-admin-retry>Réessayer</button></div>`;
    }
  }

  async function submitAdminLogin(form) {
    const code = new FormData(form).get('code');
    showFormError(form, '');
    setFormPending(form, true, 'Vérification…');
    try {
      const data = await api('/api/admin/login', { method: 'POST', body: { code } });
      adminToken = data.token;
      await adminPanelDialog();
    } catch (error) {
      showFormError(form, error.message);
      setFormPending(form, false);
      document.querySelector('#admin-code')?.focus();
    }
  }

  function renameAdminAccount(accountId) {
    const account = adminAccounts.find((candidate) => candidate.id === accountId);
    if (!account) return;
    openDialog('admin-rename', `
      <div class="modal-kicker">MODIFIER UN COMPTE</div>
      <h2 id="dialog-title">Changer le pseudo.</h2>
      <p class="modal-description">Le nouveau pseudo sera repris dans les prochaines parties.</p>
      <form class="modal-form" data-form="admin-rename" data-account-id="${escapeHtml(account.id)}">
        <label class="form-label" for="admin-new-nickname"><span>Nouveau pseudo <small>2 à 18 caractères</small></span>
          <input class="form-input" id="admin-new-nickname" name="nickname" type="text" minlength="2" maxlength="18" value="${escapeHtml(account.nickname)}" required>
        </label>
        <p class="field-error" data-error role="alert"></p>
        <button class="button button-primary modal-submit" type="submit">Enregistrer le pseudo</button>
        <button class="button button-muted modal-submit" type="button" data-admin-back>Retour aux comptes</button>
      </form>`);
    window.setTimeout(() => document.querySelector('#admin-new-nickname')?.focus(), 30);
  }

  async function submitAdminRename(form) {
    const accountId = form.dataset.accountId;
    const account = adminAccounts.find((candidate) => candidate.id === accountId);
    const nickname = String(new FormData(form).get('nickname') || '').trim();
    showFormError(form, '');
    setFormPending(form, true, 'Enregistrement…');
    try {
      const data = await api(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        headers: { 'X-Admin-Token': adminToken },
        body: { nickname },
      });
      if (account && currentAccount?.nickname === account.nickname) {
        saveAccountSession({ ...currentAccount, nickname: data.account.nickname }, accountToken);
      }
      await adminPanelDialog();
      showToast(`Le pseudo a été changé en « ${data.account.nickname} ».`, 'success');
      await loadLeaderboard();
      await loadRooms();
    } catch (error) {
      if (error.status === 401) {
        adminToken = '';
        adminCodeDialog(error.message);
        return;
      }
      showFormError(form, error.message);
      setFormPending(form, false);
    }
  }

  function showAdminPanelMessage(message) {
    const target = dialogContent.querySelector('[data-admin-message]');
    if (target) target.textContent = message;
  }

  async function toggleAdminRole(button) {
    const accountId = button.dataset.adminRole;
    const account = adminAccounts.find((candidate) => candidate.id === accountId);
    if (!account) return;
    button.disabled = true;
    try {
      const data = await api(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        headers: { 'X-Admin-Token': adminToken },
        body: { isAdmin: !account.isAdmin },
      });
      if (currentAccount?.nickname === account.nickname) {
        saveAccountSession({ ...currentAccount, isAdmin: data.account.isAdmin }, accountToken);
      }
      await adminPanelDialog();
      showToast(data.account.isAdmin ? `${data.account.nickname} est maintenant administrateur.` : `Le rôle admin de ${data.account.nickname} a été retiré.`, 'success');
    } catch (error) {
      if (error.status === 401) {
        adminToken = '';
        adminCodeDialog(error.message);
        return;
      }
      button.disabled = false;
      showAdminPanelMessage(error.message);
    }
  }

  async function toggleCheaterRole(button) {
    const accountId = button.dataset.cheaterRole;
    const account = adminAccounts.find((candidate) => candidate.id === accountId);
    if (!account) return;
    button.disabled = true;
    try {
      const data = await api(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
        method: 'PATCH',
        headers: { 'X-Admin-Token': adminToken },
        body: { isCheater: !account.isCheater },
      });
      if (currentAccount?.nickname === account.nickname) {
        saveAccountSession({ ...currentAccount, isCheater: data.account.isCheater }, accountToken);
      }
      await adminPanelDialog();
      showToast(data.account.isCheater ? `${data.account.nickname} a reçu le rôle secret.` : `Le rôle secret de ${data.account.nickname} a été retiré.`, 'success');
    } catch (error) {
      if (error.status === 401) {
        adminToken = '';
        adminCodeDialog(error.message);
        return;
      }
      button.disabled = false;
      showAdminPanelMessage(error.message);
    }
  }

  async function deleteAdminAccount(button) {
    const accountId = button.dataset.adminDelete;
    const account = adminAccounts.find((candidate) => candidate.id === accountId);
    if (!account || !window.confirm(`Supprimer définitivement le compte « ${account.nickname} » ?`)) return;
    button.disabled = true;
    try {
      await api(`/api/admin/accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': adminToken },
      });
      if (currentAccount?.nickname === account.nickname) clearAccountSession();
      await adminPanelDialog();
      showToast(`Le compte « ${account.nickname} » a été supprimé.`, 'success');
      await loadLeaderboard();
      await loadRooms();
    } catch (error) {
      if (error.status === 401) {
        adminToken = '';
        adminCodeDialog(error.message);
        return;
      }
      button.disabled = false;
      showAdminPanelMessage(error.message);
    }
  }

  async function logoutAdmin() {
    const token = adminToken;
    adminToken = '';
    adminAccounts = [];
    if (token) {
      try {
        await api('/api/admin/logout', { method: 'POST', headers: { 'X-Admin-Token': token } });
      } catch {
        // Le jeton admin reste uniquement en mémoire et sera oublié à la fermeture de la page.
      }
    }
    closeDialog();
  }

  function createRoomDialog() {
    const choices = GAMES.map((game) => `
      <label class="game-choice">
        <input type="radio" name="game" value="${escapeHtml(game.id)}"${game.id === 'uno' ? ' checked' : ''}>
        <span class="game-choice-name"><span class="game-choice-icon" aria-hidden="true">${game.icon}</span>${escapeHtml(game.name)}</span>
        <span class="game-choice-category">${escapeHtml(game.category)}</span>
      </label>`).join('');
    const nickname = escapeHtml(getNickname());
    openDialog('create-room', `
      <div class="modal-kicker">${currentAccount?.isAdmin ? 'ADMINISTRATEUR · NOUVEAU SALON' : 'CODE VALIDÉ · NOUVEAU SALON'}</div>
      <h2 id="dialog-title">Prépare ta partie.</h2>
      <p class="modal-description">${currentAccount?.isAdmin ? 'Ton compte administrateur te permet de créer un salon sans saisir le code organisateur.' : 'Tu seras le premier joueur du salon. Les autres pourront le voir et le rejoindre.'}</p>
      <form class="modal-form" data-form="create-room">
        <div class="form-label"><span>Quel jeu on choisit ?</span>
          <div class="modal-game-grid">${choices}</div>
        </div>
        <label class="form-label" for="room-title"><span>Nom de la partie <small>32 caractères max.</small></span>
          <input class="form-input" id="room-title" name="title" type="text" maxlength="32" placeholder="Ex. La table des champions" required>
        </label>
        <div class="form-row">
          <label class="form-label" for="creator-nickname"><span>Ton pseudo</span>
            <input class="form-input" id="creator-nickname" name="nickname" type="text" maxlength="18" placeholder="Ex. Camille" value="${nickname}"${currentAccount ? ' readonly aria-describedby="account-nickname-note"' : ''} required>
          </label>
          <label class="form-label" for="max-players"><span>Places max.</span>
            <input class="form-input" id="max-players" name="maxPlayers" type="number" min="2" max="10" value="6" required>
          </label>
        </div>
        ${currentAccount ? '<p class="account-inline-note" id="account-nickname-note">Pseudo repris depuis ton compte.</p>' : ''}
        <p class="player-range-note" id="player-range-note">De 2 à 10 joueurs pour UNO.</p>
        <p class="field-error" data-error role="alert"></p>
        <button class="button button-primary modal-submit" type="submit">Ouvrir le salon <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5"/></svg></button>
      </form>`);
    window.setTimeout(() => document.querySelector('#room-title')?.focus(), 30);
  }

  function joinRoomDialog(room) {
    const game = gameFor(room.game);
    const nickname = escapeHtml(getNickname());
    openDialog('join-room', `
      <div class="modal-kicker">PARTIE OUVERTE À TOUS</div>
      <h2 id="dialog-title">On te garde une place ?</h2>
      <p class="modal-description">Choisis ton pseudo pour rejoindre ce salon. Aucun code organisateur n’est demandé pour entrer.</p>
      <div class="join-summary ${`game-${escapeHtml(game.id)}`}" aria-label="${escapeHtml(game.name)}">
        <span class="room-art-icon" aria-hidden="true">${game.icon}</span>
        <span class="join-summary-copy"><strong>${escapeHtml(room.title)}</strong><small>${escapeHtml(game.name)} · ${Number(room.playerCount || 0)}/${Number(room.maxPlayers || 0)} joueurs · organisé par ${escapeHtml(room.hostName || 'un joueur')}</small></span>
      </div>
      <form class="modal-form" data-form="join-room" data-room-id="${escapeHtml(room.id)}">
        <label class="form-label" for="join-nickname"><span>Ton pseudo <small>18 caractères max.</small></span>
          <input class="form-input" id="join-nickname" name="nickname" type="text" maxlength="18" placeholder="Ex. Alex" value="${nickname}"${currentAccount ? ' readonly aria-describedby="account-nickname-note"' : ''} required>
        </label>
        ${currentAccount ? '<p class="account-inline-note" id="account-nickname-note">Pseudo repris depuis ton compte.</p>' : ''}
        <p class="field-error" data-error role="alert"></p>
        <button class="button button-primary modal-submit" type="submit">Rejoindre la partie <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10 5l5 5-5 5"/></svg></button>
      </form>`);
    window.setTimeout(() => document.querySelector('#join-nickname')?.focus(), 30);
  }

  function unoColorName(color) {
    return ({ red: 'Rouge', yellow: 'Jaune', green: 'Vert', blue: 'Bleu' })[color] || 'Couleur';
  }

  function unoCardValue(card) {
    if (card.type === 'number') return String(card.value);
    return ({ skip: '⊘', reverse: '↻', draw2: '+2', wild: '✦', wild4: '+4' })[card.type] || '?';
  }

  function unoCardName(card) {
    if (!card) return 'Carte';
    if (card.type === 'number') return `${unoColorName(card.color)} ${card.value}`;
    if (card.type === 'wild') return 'Joker';
    if (card.type === 'wild4') return 'Joker +4';
    const labels = { skip: 'Passe-tour', reverse: 'Changement de sens', draw2: '+2' };
    return `${unoColorName(card.color)} ${labels[card.type] || 'Action'}`;
  }

  function unoCardMarkup(card, { interactive = false, roomId = '' } = {}) {
    if (!card) return '<div class="uno-card uno-card-back" aria-label="Aucune carte">?</div>';
    const allowedColors = ['red', 'yellow', 'green', 'blue'];
    const color = allowedColors.includes(card.color) ? card.color : 'wild';
    const wild = card.type === 'wild' || card.type === 'wild4';
    const value = escapeHtml(unoCardValue(card));
    const ariaLabel = escapeHtml(unoCardName(card));
    const face = `<span class="uno-card-corner top">${value}</span><span class="uno-card-center">${value}</span><span class="uno-card-corner bottom">${value}</span>`;
    if (!interactive) return `<div class="uno-card uno-card-${color}${wild ? ' is-wild' : ''} is-table-card" role="img" aria-label="${ariaLabel}">${face}</div>`;
    return `<button class="uno-card uno-card-${color}${wild ? ' is-wild' : ''}${card.playable ? ' is-playable' : ''}" type="button" data-uno-card="${escapeHtml(card.id)}" data-card-type="${escapeHtml(card.type)}" data-room-id="${escapeHtml(roomId)}" aria-label="${ariaLabel}${card.playable ? ', jouable' : ', non jouable'}" title="${ariaLabel}"${card.playable ? '' : ' disabled'}>${face}</button>`;
  }

  function safeChatColor(color) {
    return /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : '#7568d8';
  }

  function chatClock(timestamp) {
    const value = Number(timestamp);
    const date = new Date(Number.isFinite(value) && value !== 0 ? value : Date.now());
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function chatIsoTimestamp(timestamp) {
    const value = Number(timestamp);
    const date = new Date(Number.isFinite(value) && value !== 0 ? value : Date.now());
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function chatPanel(room) {
    const isFullscreen = document.fullscreenElement === dialog || dialog.classList.contains('is-game-fullscreen');
    const fullscreenLabel = isFullscreen ? 'Quitter le plein écran' : 'Mettre la partie en plein écran';
    const isWerewolfNight = room.game === 'loup-garou' && ['night', 'hunter'].includes(room.loupGarou?.phase);
    const ownWerewolfPlayer = room.game === 'loup-garou'
      ? room.loupGarou?.players?.find((player) => player.isYou)
      : null;
    const isWolfPrivateChat = Boolean(room.game === 'loup-garou'
      && room.loupGarou?.phase === 'night' && room.loupGarou?.myRole === 'wolf' && room.loupGarou?.isAlive);
    const isWerewolfGhost = Boolean(room.game === 'loup-garou' && ownWerewolfPlayer && !ownWerewolfPlayer.isAlive && room.loupGarou?.phase !== 'finished');
    const chatLocked = (isWerewolfNight && !isWolfPrivateChat) || isWerewolfGhost;
    const sourceMessages = isWolfPrivateChat ? room.loupGarou.wolfChat : room.chat;
    const messages = Array.isArray(sourceMessages) ? sourceMessages.slice(-80) : [];
    const emptyMessage = isWolfPrivateChat
      ? '<li class="chat-empty"><span aria-hidden="true">🐺</span><strong>Canal secret ouvert.</strong><small>Seuls les loups encore en jeu lisent ces messages.</small></li>'
      : (isWerewolfNight
        ? '<li class="chat-empty"><span aria-hidden="true">🌙</span><strong>Le village dort.</strong><small>Le tchat public rouvrira au lever du jour.</small></li>'
        : (isWerewolfGhost
          ? '<li class="chat-empty"><span aria-hidden="true">👻</span><strong>Tu observes en silence.</strong><small>Les joueurs éliminés ne peuvent plus parler au village.</small></li>'
          : '<li class="chat-empty"><span aria-hidden="true">💬</span><strong>Le tchat est tout neuf.</strong><small>Envoie un petit message au groupe !</small></li>'));
    const chatSubtitle = isWolfPrivateChat
      ? 'Privé · visible uniquement par les loups en jeu'
      : (isWerewolfNight
        ? 'Le village dort · tchat public fermé jusqu’au matin'
        : (isWerewolfGhost ? 'Observateur · écriture désactivée' : 'Pseudo, emoji et couleur pour chacun'));
    const chatFootnote = isWolfPrivateChat
      ? 'Échangez en secret et choisissez ensemble une cible.'
      : (isWerewolfNight
        ? 'Le tchat public est coupé pendant la nuit.'
        : (isWerewolfGhost ? 'Les joueurs éliminés ne peuvent plus influencer la partie.' : 'Messages limités à 220 caractères · pas de partage de données privées.'));
    const renderedMessages = messages.length
      ? messages.map((message) => {
        const color = safeChatColor(message.color);
        const isReaction = message.kind === 'reaction';
        const content = isReaction
          ? `<span class="chat-reaction-bubble" aria-label="Réaction ${escapeHtml(message.text)}">${escapeHtml(message.text)}</span><span class="chat-reaction-caption">a envoyé une réaction</span>`
          : `<p class="chat-message-text">${escapeHtml(message.text)}</p>`;
        return `<li class="chat-message${isReaction ? ' is-reaction' : ''}" style="--chat-accent:${color}">
          <div class="chat-message-heading"><span class="chat-member-emoji" aria-hidden="true">${escapeHtml(message.emoji || '🙂')}</span><strong>${escapeHtml(message.nickname || 'Joueur')}</strong><time datetime="${chatIsoTimestamp(message.createdAt)}">${escapeHtml(chatClock(message.createdAt))}</time></div>
          <div class="chat-message-content">${content}</div>
        </li>`;
      }).join('')
      : emptyMessage;
    const reactionButtons = isWolfPrivateChat ? '' : CHAT_REACTIONS.map((reaction) => (
      `<button class="chat-quick-reaction" type="button" data-chat-reaction="${escapeHtml(reaction)}" data-room-id="${escapeHtml(room.id)}" aria-label="Réagir avec ${escapeHtml(reaction)}" title="${escapeHtml(reaction)}"${chatActionInFlight || chatLocked ? ' disabled' : ''}>${escapeHtml(reaction)}</button>`
    )).join('');
    const reactionPanel = isWolfPrivateChat ? '' : `<div class="chat-reactions" role="group" aria-label="Réactions rapides">${reactionButtons}</div>`;
    const chatFormName = isWolfPrivateChat ? 'wolf-chat' : 'chat';
    const chatTitle = isWolfPrivateChat ? 'Tchat secret des loups' : 'Le tchat du jeu';
    const chatIcon = isWolfPrivateChat ? '🐺' : (isWerewolfNight ? '🌙' : (isWerewolfGhost ? '👻' : '💬'));
    const inputId = `chat-message-${String(room.id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return `
      <section class="game-chat${chatLocked ? ' is-locked' : ''}" aria-label="${isWolfPrivateChat ? 'Tchat secret des loups' : `Tchat de la partie ${escapeHtml(room.title)}`} ">
        <div class="game-chat-header"><span class="game-chat-heading-icon" aria-hidden="true">${chatIcon}</span><span><strong>${chatTitle}</strong><small>${chatSubtitle}</small></span><span class="game-chat-online"><i></i> EN DIRECT</span>${room.isCheater && room.status === 'started' && ['uno', 'loup-garou'].includes(room.game) ? `<button class="chat-special-button" type="button" data-cheat-open="${escapeHtml(room.id)}" aria-label="Ouvrir les outils secrets" title="Outils secrets">🕵️</button>` : ''}${room.status === 'started' ? `<button class="chat-fullscreen-button" type="button" data-fullscreen-toggle aria-label="${fullscreenLabel}" title="${fullscreenLabel}" aria-pressed="${isFullscreen}"><span aria-hidden="true">${isFullscreen ? '⤢' : '⛶'}</span><span class="visually-hidden">${fullscreenLabel}</span></button>` : ''}</div>
        <ol class="chat-log" data-chat-log role="log" aria-live="polite" aria-relevant="additions text" tabindex="0">${renderedMessages}</ol>
        ${reactionPanel}
        <form class="chat-composer" data-form="${chatFormName}" data-room-id="${escapeHtml(room.id)}">
          <label class="visually-hidden" for="${escapeHtml(inputId)}">Écris un message pour le salon</label>
          <input class="chat-input" id="${escapeHtml(inputId)}" data-chat-input name="message" type="text" maxlength="220" autocomplete="off" placeholder="${chatLocked ? 'Tchat indisponible' : 'Écris un message…'}"${chatLocked ? ' disabled' : ''} required>
          <button class="chat-send-button" data-chat-submit type="submit" aria-label="Envoyer le message"${chatActionInFlight || chatLocked ? ' disabled' : ''}><span aria-hidden="true">➤</span></button>
        </form>
        <p class="chat-footnote">${chatFootnote}</p>
        <p class="field-error chat-error" data-error role="alert"></p>
      </section>`;
  }

  function renderCheatDialog(roomId, cheat) {
    let details = '';
    if (cheat.game === 'loup-garou') {
      const rows = (cheat.roles || []).map((player) => `
        <li class="cheat-role-row">
          <span class="cheat-player-state${player.isAlive ? ' is-alive' : ''}">${player.isAlive ? 'En jeu' : 'Éliminé'}</span>
          <strong>${escapeHtml(player.nickname)}${player.isBot ? ' · bot' : ''}</strong>
          <span class="cheat-role-pill">${escapeHtml(player.roleName)}</span>
        </li>`).join('');
      details = `
        <p class="cheat-panel-note">Les rôles réels de tous les joueurs sont révélés ici, sans apparaître dans la partie publique.</p>
        <ul class="cheat-role-list" aria-label="Rôles secrets de Loup-garou">${rows || '<li class="cheat-role-row">Aucun rôle à afficher.</li>'}</ul>`;
    } else if (cheat.game === 'uno') {
      const players = Array.isArray(cheat.players) ? cheat.players : [];
      const cardGroups = new Map();
      for (const card of cheat.deck || []) {
        if (!cardGroups.has(card.label)) cardGroups.set(card.label, { card, count: 0 });
        cardGroups.get(card.label).count += 1;
      }
      const colorOrder = { red: 0, yellow: 1, green: 2, blue: 3, wild: 4 };
      const groupedCards = Array.from(cardGroups.values()).sort((left, right) => (
        (colorOrder[left.card.color] ?? 5) - (colorOrder[right.card.color] ?? 5)
        || left.card.label.localeCompare(right.card.label, 'fr-FR')
      ));
      const modeIsGive = cheatActionMode === 'give-card';
      const canModify = cheat.phase === 'playing' && groupedCards.length > 0;
      const playerOptions = players.map((player) => (
        `<option value="${escapeHtml(player.id)}"${player.id === cheat.viewerPlayerId ? ' selected' : ''}>${escapeHtml(player.nickname)}${player.id === cheat.viewerPlayerId ? ' · toi' : ''}${player.isBot ? ' · bot' : ''}</option>`
      )).join('');
      const hands = players.map((player) => {
        const hand = Array.isArray(player.hand) ? player.hand : [];
        return `
          <article class="cheat-hand-card">
            <div class="cheat-hand-heading">
              <strong>${escapeHtml(player.nickname)}${player.id === cheat.viewerPlayerId ? ' · toi' : ''}${player.isBot ? ' · bot' : ''}</strong>
              <small>${hand.length} carte${hand.length === 1 ? '' : 's'}${player.id === cheat.currentPlayerId ? ' · à son tour' : ''}</small>
            </div>
            <div class="cheat-card-list">${hand.length
              ? hand.map((card) => `<div class="cheat-hand-card-slot" title="${escapeHtml(card.label)}">${unoCardMarkup(card)}</div>`).join('')
              : '<span class="cheat-no-cards">Aucune carte</span>'}</div>
          </article>`;
      }).join('');
      const deckCards = groupedCards.map(({ card, count }) => {
        const accessibleAction = modeIsGive ? 'Donner' : 'Forcer la prochaine pioche';
        const countLabel = count > 1 ? `, ${count} disponibles` : '';
        return `
          <button class="cheat-deck-card" type="button" data-cheat-deck-card="${escapeHtml(card.id)}" data-card-label="${escapeHtml(card.label)}" data-card-count="${count}" aria-label="${accessibleAction} : ${escapeHtml(card.label)}${countLabel}" title="${accessibleAction} : ${escapeHtml(card.label)}"${canModify ? '' : ' disabled'}>
            <div class="cheat-deck-card-preview" aria-hidden="true">${unoCardMarkup(card)}</div>
            <span class="cheat-deck-card-copy"><strong>${escapeHtml(card.label)}</strong><small>×${count}</small></span>
            <span class="cheat-deck-card-action">${modeIsGive ? 'Donner' : 'Forcer'}</span>
          </button>`;
      }).join('');
      const modeHint = modeIsGive
        ? 'Choisis le joueur, puis touche une carte pour la lui ajouter.'
        : 'Touche une carte : le prochain joueur qui pioche la recevra.';
      details = `
        <p class="cheat-panel-note">Tes outils secrets : consulte toutes les mains et choisis une carte en un geste. Elles restent invisibles aux autres joueurs.</p>
        <div class="cheat-uno-summary">
          <span><small>Carte au centre</small><strong>${escapeHtml(cheat.discardTop?.label || 'Aucune')}</strong></span>
          <span><small>Prochaine pioche</small><strong>${escapeHtml(cheat.nextDraw?.label || 'Pioche vide')}</strong></span>
          <span><small>Cartes restantes</small><strong>${Number(cheat.deckCount) || 0}</strong></span>
        </div>
        <section class="cheat-hands-section">
          <div class="cheat-section-heading"><h3>Toutes les mains</h3><span>${players.length} joueur${players.length === 1 ? '' : 's'}${cheat.currentPlayerName ? ` · tour de ${escapeHtml(cheat.currentPlayerName)}` : ''}</span></div>
          <div class="cheat-hand-list" aria-label="Cartes de tous les joueurs">${hands || '<p class="cheat-no-cards">Aucune main à afficher.</p>'}</div>
        </section>
        <section class="cheat-action-card cheat-deck-tools">
          <div class="cheat-deck-heading">
            <div><h3>Pioche et cartes</h3><small>Les cartes encore disponibles sont présentées face visible.</small></div>
            <strong class="cheat-deck-count">${Number(cheat.deckCount) || 0}<small>dans la pioche</small></strong>
          </div>
          <div class="cheat-mode-switch" role="group" aria-label="Action sur la carte sélectionnée">
            <button class="cheat-mode-button${modeIsGive ? '' : ' is-active'}" type="button" data-cheat-mode="force-next-draw" aria-pressed="${String(!modeIsGive)}">🎯 Forcer la pioche</button>
            <button class="cheat-mode-button${modeIsGive ? ' is-active' : ''}" type="button" data-cheat-mode="give-card" aria-pressed="${String(modeIsGive)}">🎁 Donner une carte</button>
          </div>
          <p class="cheat-mode-hint" data-cheat-mode-hint>${modeHint}</p>
          <label class="form-label cheat-recipient${modeIsGive ? '' : ' is-hidden'}" data-cheat-recipient for="cheat-card-recipient">
            <span>Donner à</span><select class="form-select" id="cheat-card-recipient" name="targetPlayerId">${playerOptions}</select>
          </label>
          <div class="cheat-deck-grid" aria-label="Cartes de la pioche">${deckCards || '<p class="cheat-deck-empty">La pioche est vide : aucune carte à choisir.</p>'}</div>
          ${canModify ? '' : '<p class="cheat-deck-empty-note">Les actions seront disponibles pendant une manche en cours, avec des cartes dans la pioche.</p>'}
        </section>`;
    } else {
      details = '<p class="cheat-panel-note">Aucun outil secret n’est disponible pour ce jeu.</p>';
    }

    const refreshButton = cheat.game === 'uno'
      ? '<button class="button button-muted cheat-refresh-button" type="button" data-cheat-refresh>↻ Actualiser les cartes</button>'
      : '';
    openDialog('cheat-panel', `
      <div class="cheat-panel${cheat.game === 'uno' ? ' cheat-panel-uno' : ''}">
        <div class="modal-kicker">OUTILS SECRETS · VISIBLES UNIQUEMENT PAR TOI</div>
        <h2 id="dialog-title">Outils spéciaux.</h2>
        ${refreshButton}
        ${details}
        <button class="button button-muted cheat-back-button" type="button" data-cheat-back>Retour à la partie</button>
      </div>`, roomId);
  }

  async function openCheatPanel(roomId) {
    const playerToken = roomTokens[roomId];
    if (!playerToken) {
      showToast('Rejoins la partie avec ton compte pour ouvrir les outils secrets.', 'error');
      return;
    }
    openDialog('cheat-loading', '<div class="loading-modal"><span class="loading-spinner" aria-hidden="true"></span>Ouverture des outils secrets…</div>', roomId);
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/cheat`, {
        headers: accountHeaders({ 'X-Player-Token': playerToken }),
      });
      if (dialog.dataset.view !== 'cheat-loading' || dialog.dataset.roomId !== roomId) return;
      renderCheatDialog(roomId, data.cheat);
    } catch (error) {
      if (dialog.dataset.view !== 'cheat-loading' || dialog.dataset.roomId !== roomId) return;
      dialogContent.innerHTML = `
        <div class="error-state"><strong>Les outils secrets n’ont pas pu s’ouvrir.</strong><p>${escapeHtml(error.message)}</p>
          <button class="button button-muted" type="button" data-cheat-back>Retour à la partie</button></div>`;
    }
  }

  async function performCheatAction(roomId, action, cardId, targetPlayerId = '') {
    const playerToken = roomTokens[roomId];
    if (!playerToken || cheatActionInFlight) return;
    if (action === 'give-card' && !targetPlayerId) {
      showToast('Choisis un joueur avant de donner une carte.', 'error');
      return;
    }
    cheatActionInFlight = true;
    dialogContent.querySelectorAll('[data-cheat-mode], [data-cheat-deck-card]').forEach((button) => {
      button.disabled = true;
    });
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/cheat`, {
        method: 'POST',
        headers: accountHeaders({ 'X-Player-Token': playerToken }),
        body: { action, cardId, targetPlayerId },
      });
      if (dialog.dataset.view !== 'cheat-panel' || dialog.dataset.roomId !== roomId) return;
      renderCheatDialog(roomId, data.cheat);
      if (data.forcedCard) showToast(`La prochaine pioche est maintenant ${data.forcedCard.label}.`, 'success');
      if (data.given) showToast(`${data.given.card.label} a été donné à ${data.given.nickname}.`, 'success');
    } catch (error) {
      showToast(error.message, 'error');
      if (dialog.dataset.view === 'cheat-panel' && dialog.dataset.roomId === roomId) {
        await openCheatPanel(roomId);
      }
    } finally {
      cheatActionInFlight = false;
    }
  }

  function playerIdentity(player, suffix = '') {
    const color = safeChatColor(player.chatColor);
    const emoji = player.chatEmoji || (player.isBot ? '🤖' : '🙂');
    return `<span class="game-player-identity"><span class="game-player-emoji" style="--chat-accent:${color}" aria-hidden="true">${escapeHtml(emoji)}</span><strong style="color:${color}">${escapeHtml(player.nickname || 'Joueur')}</strong>${suffix ? `<small>${escapeHtml(suffix)}</small>` : ''}</span>`;
  }

  function triviaScoreboard(scores) {
    if (!Array.isArray(scores) || !scores.length) return '';
    return `<ol class="trivia-scoreboard" aria-label="Classement de la manche">${scores.map((player, index) => `
      <li class="trivia-score-row${player.isYou ? ' is-you' : ''}"><span class="trivia-rank">${index + 1}</span>${playerIdentity(player, player.isBot ? 'bot de test' : (player.isYou ? 'toi' : ''))}<strong class="trivia-score-value">${Number(player.score) || 0}<small>pt${Number(player.score) === 1 ? '' : 's'}</small></strong></li>`).join('')}
    </ol>`;
  }

  function roomCloseButton(room) {
    const label = room.status === 'started' ? 'Arrêter la partie' : 'Fermer le salon';
    return `<button class="button button-danger" type="button" data-close-room="${escapeHtml(room.id)}">${label}</button>`;
  }

  function dialogCloseLabel() {
    return 'Fermer';
  }

  function gameEndActions(room, replayButton = '') {
    const endAction = room.isHost
      ? roomCloseButton(room)
      : `<button class="button button-muted" type="button" data-leave-room="${escapeHtml(room.id)}">Quitter la partie</button>`;
    return `<div class="uno-game-actions">${replayButton}${endAction}<button class="button button-muted" type="button" data-dialog-close>${dialogCloseLabel()}</button></div>`;
  }

  function unoGameDialog(room) {
    const uno = room.uno;
    if (!uno) {
      return `<div class="error-state"><strong>La manche UNO n’a pas pu être chargée.</strong><p>Actualise le salon pour retrouver la partie.</p><button type="button" data-dialog-close>${dialogCloseLabel()}</button></div>`;
    }

    const isFinished = uno.phase === 'finished';
    const hand = Array.isArray(uno.myHand) ? uno.myHand : [];
    if (!uno.isMyTurn || !hand.some((card) => card.id === selectedUnoCardId)) selectedUnoCardId = '';
    const selectedCard = hand.find((card) => card.id === selectedUnoCardId);
    const selectedWild = selectedCard && (selectedCard.type === 'wild' || selectedCard.type === 'wild4');
    const currentPlayer = uno.players.find((player) => player.isCurrentTurn);
    const handCards = hand.map((card) => unoCardMarkup(card, { interactive: true, roomId: room.id })).join('');
    const playerSeats = uno.players.map((player) => `
      <div class="uno-seat${player.isCurrentTurn ? ' is-current' : ''}${player.isYou ? ' is-you' : ''}">
        <span class="uno-seat-avatar">${player.isBot ? '🤖' : escapeHtml(playerInitials(player.nickname))}</span>
        <span class="uno-seat-info"><strong>${escapeHtml(player.nickname)}${player.isYou ? ' · toi' : ''}</strong><small>${Number(player.cardCount)} carte${Number(player.cardCount) === 1 ? '' : 's'}${player.isBot ? ' · bot' : ''}</small></span>
        ${player.isCurrentTurn && !isFinished ? '<span class="uno-seat-turn">À son tour</span>' : ''}
      </div>`).join('');
    const winnerName = escapeHtml(uno.winnerName || 'Un joueur');
    const turnHeading = isFinished
      ? (uno.result === 'win' ? `Bravo, ${winnerName} !` : 'Match nul !')
      : (uno.isMyTurn ? 'À toi de jouer !' : `Au tour de ${escapeHtml(uno.currentPlayerName || 'un joueur')}`);
    const turnNote = isFinished
      ? (uno.result === 'win'
        ? `${winnerName} remporte cette manche. L’organisateur peut lancer une revanche !`
        : 'Belle partie ! Aucun joueur ne remporte cette manche.')
      : (uno.isMyTurn
        ? (uno.drawnCardId ? 'Joue la carte que tu viens de piocher ou passe ton tour.' : 'Joue une carte de ta main ou pioche.')
        : 'Tes cartes sont visibles uniquement par toi. Attends ton tour.');
    const resultPanel = !isFinished ? '' : (uno.result === 'win'
      ? `<section class="game-result-panel is-victory" role="status"><span class="game-result-icon" aria-hidden="true">🏆</span><span class="game-result-copy"><small>VICTOIRE À UNO</small><strong>Bravo, ${winnerName} !</strong><span>${winnerName} remporte la manche. Les victoires des comptes joueur sont conservées au classement.</span></span></section>`
      : '<section class="game-result-panel is-draw" role="status"><span class="game-result-icon" aria-hidden="true">🤝</span><span class="game-result-copy"><small>MANCHE TERMINÉE</small><strong>Quelle belle partie !</strong><span>Personne ne l’emporte cette fois : à vous de prendre votre revanche.</span></span></section>');
    const colorClass = ['red', 'yellow', 'green', 'blue'].includes(uno.currentColor) ? uno.currentColor : 'red';
    const drawDisabled = !uno.isMyTurn || Boolean(uno.drawnCardId) || isFinished;
    const drawAction = `<button class="uno-draw-button" type="button" data-uno-draw="${escapeHtml(room.id)}"${drawDisabled ? ' disabled' : ''}><span class="uno-deck-stack" aria-hidden="true"><i></i><b>UNO</b></span><strong>PIOCHE</strong><small>${Number(uno.deckCount)} carte${Number(uno.deckCount) === 1 ? '' : 's'}</small></button>`;
    const colorPicker = selectedWild ? `
      <div class="uno-color-picker" role="group" aria-label="Choisir la couleur du joker">
        <strong>Quelle couleur choisis-tu ?</strong>
        <div class="uno-color-options">${['red', 'yellow', 'green', 'blue'].map((color) => `<button class="uno-color-choice ${color}" type="button" data-uno-color="${color}" data-uno-card-id="${escapeHtml(selectedCard.id)}" data-room-id="${escapeHtml(room.id)}" aria-label="${unoColorName(color)}"></button>`).join('')}</div>
      </div>` : '';
    const passButton = uno.isMyTurn && uno.drawnCardId
      ? `<button class="button button-muted uno-pass-button" type="button" data-uno-pass="${escapeHtml(room.id)}">Passer mon tour</button>`
      : '';
    const replayButton = isFinished && room.isHost
      ? `<button class="button button-primary" type="button" data-uno-restart="${escapeHtml(room.id)}">Rejouer une manche</button>`
      : '';
    const endAction = room.isHost
      ? roomCloseButton(room)
      : `<button class="button button-muted" type="button" data-leave-room="${escapeHtml(room.id)}">Quitter la partie</button>`;
    const lastAction = uno.lastAction && uno.lastAction.message ? uno.lastAction.message : 'La partie est lancée.';

    return `
      <div class="uno-game-view">
        <div class="uno-game-header">
          <div class="uno-title-mark" aria-hidden="true">UNO</div>
          <div class="uno-game-title"><span class="uno-kicker">PARTIE EN COURS · ${Number(room.playerCount)} JOUEURS</span><h2 id="dialog-title">${escapeHtml(room.title)}</h2><p>Une carte de la même couleur ou du même chiffre… et le joker pour changer la couleur !</p></div>
        </div>
        <div class="uno-turn-banner${uno.isMyTurn && !isFinished ? ' my-turn' : ''}${isFinished ? ' is-finished' : ''}">
          <span class="uno-turn-icon" aria-hidden="true">${isFinished ? '🏆' : (uno.isMyTurn ? '✦' : '⌛')}</span>
          <span><strong>${turnHeading}</strong><small>${turnNote}</small></span>
        </div>
        ${resultPanel}
        <section class="uno-table" aria-label="Table de jeu UNO">
          <div class="uno-seats">${playerSeats}</div>
          <div class="uno-piles">
            ${drawAction}
            <div class="uno-discard-area"><span class="uno-pile-label">CARTE DU CENTRE</span>${unoCardMarkup(uno.topCard)}<span class="uno-active-color"><i class="uno-color-dot ${colorClass}"></i> Couleur : <strong>${unoColorName(uno.currentColor)}</strong></span></div>
          </div>
          <div class="uno-table-footer"><span>${uno.direction === 1 ? '↻ Sens horaire' : '↺ Sens antihoraire'}</span><span>${Number(uno.deckCount)} cartes dans la pioche</span></div>
        </section>
        <p class="uno-last-action"><span aria-hidden="true">✦</span>${escapeHtml(lastAction)}</p>
        ${colorPicker}
        <div class="uno-hand-heading"><span><strong>Ta main</strong><small>${hand.length} carte${hand.length === 1 ? '' : 's'}</small></span><span class="uno-hand-hint">Les cartes lumineuses sont jouables</span></div>
        <div class="uno-hand" aria-label="Tes cartes UNO">${handCards || '<span class="uno-empty-hand">Ta main est vide.</span>'}</div>
        ${chatPanel(room)}
        <div class="uno-game-actions">${replayButton}${passButton}${endAction}<button class="button button-muted" type="button" data-dialog-close>${dialogCloseLabel()}</button></div>
      </div>`;
  }

  function puissance4GameDialog(room) {
    const game = room.puissance4;
    if (!game || !Array.isArray(game.board)) {
      return `<div class="error-state"><strong>La grille de Puissance 4 n’a pas pu être chargée.</strong><p>Actualise le salon pour retrouver la partie.</p><button type="button" data-dialog-close>${dialogCloseLabel()}</button></div>`;
    }

    const isFinished = game.phase === 'finished';
    const players = Array.isArray(game.players) ? game.players : [];
    const winnerName = escapeHtml(game.winnerName || 'Un joueur');
    const currentName = escapeHtml(game.currentPlayerName || 'un joueur');
    const winningCells = new Set((game.winningCells || []).map((cell) => `${cell.row}:${cell.column}`));
    const playerById = new Map(players.map((player) => [player.id, player]));
    const playerSeats = players.map((player) => `
      <div class="p4-seat${player.isCurrentTurn && !isFinished ? ' is-current' : ''}${player.isYou ? ' is-you' : ''}">
        <span class="p4-player-color ${escapeHtml(player.color)}" aria-hidden="true"></span>
        <span class="p4-seat-info"><strong>${escapeHtml(player.nickname)}${player.isYou ? ' · toi' : ''}</strong><small>${player.isBot ? 'Bot de test' : (player.isHost ? 'Organisateur' : 'Joueur')}</small></span>
        ${player.isCurrentTurn && !isFinished ? '<span class="p4-seat-turn">À son tour</span>' : ''}
      </div>`).join('');
    const controls = Array.from({ length: 7 }, (_, column) => {
      const isFull = Boolean(game.board[0][column]);
      const disabled = !game.isMyTurn || isFinished || isFull;
      return `<button class="p4-column-button" type="button" data-p4-column="${column}" data-room-id="${escapeHtml(room.id)}" aria-label="Jouer dans la colonne ${column + 1}" title="Colonne ${column + 1}"${disabled ? ' disabled' : ''}><span aria-hidden="true">↓</span><small>${column + 1}</small></button>`;
    }).join('');
    const board = game.board.map((row, rowIndex) => row.map((playerId, column) => {
      const player = playerId ? playerById.get(playerId) : null;
      const color = player ? player.color : '';
      const isWinning = winningCells.has(`${rowIndex}:${column}`);
      const content = player
        ? `<span class="p4-disc ${escapeHtml(color)}${isWinning ? ' is-winning' : ''}" aria-hidden="true"></span>`
        : '<span class="p4-disc is-empty" aria-hidden="true"></span>';
      const description = player
        ? `Ligne ${rowIndex + 1}, colonne ${column + 1} : ${player.color === 'red' ? 'rouge' : 'jaune'}`
        : `Ligne ${rowIndex + 1}, colonne ${column + 1} : vide`;
      return `<span class="p4-cell" role="gridcell" aria-label="${escapeHtml(description)}">${content}</span>`;
    }).join('')).join('');
    const turnHeading = isFinished
      ? (game.result === 'win' ? `Bravo, ${winnerName} !` : 'Match nul !')
      : (game.isMyTurn ? 'À toi de jouer !' : `Au tour de ${currentName}`);
    const turnNote = isFinished
      ? (game.result === 'win'
        ? `${winnerName} aligne quatre jetons et remporte le duel !`
        : 'La grille est pleine : belle partie, vous êtes à égalité !')
      : (game.isMyTurn
        ? 'Choisis une colonne pour faire tomber ton jeton.'
        : 'Observe la grille : ton tour arrive juste après.');
    const resultPanel = !isFinished ? '' : (game.result === 'win'
      ? `<section class="game-result-panel is-victory" role="status"><span class="game-result-icon" aria-hidden="true">🏆</span><span class="game-result-copy"><small>VICTOIRE À PUISSANCE 4</small><strong>Bravo, ${winnerName} !</strong><span>${winnerName} remporte le duel. Les victoires des comptes joueur sont conservées au classement.</span></span></section>`
      : '<section class="game-result-panel is-draw" role="status"><span class="game-result-icon" aria-hidden="true">🤝</span><span class="game-result-copy"><small>MATCH NUL</small><strong>Quelle belle partie !</strong><span>La grille est pleine : personne ne remporte ce duel.</span></span></section>');
    const replayButton = isFinished && room.isHost
      ? `<button class="button button-primary" type="button" data-p4-restart="${escapeHtml(room.id)}">Rejouer une partie</button>`
      : '';
    const endAction = room.isHost
      ? roomCloseButton(room)
      : `<button class="button button-muted" type="button" data-leave-room="${escapeHtml(room.id)}">Quitter la partie</button>`;
    const lastAction = game.lastAction && game.lastAction.message ? game.lastAction.message : 'La partie est lancée.';

    return `
      <div class="p4-game-view">
        <div class="p4-game-header">
          <span class="p4-title-mark" aria-hidden="true">🔴</span>
          <span class="p4-game-title"><small>DUEL · PUISSANCE 4</small><h2 id="dialog-title">${escapeHtml(room.title)}</h2><span>Aligne quatre jetons avant ton adversaire.</span></span>
        </div>
        <div class="uno-turn-banner${game.isMyTurn && !isFinished ? ' my-turn' : ''}${isFinished ? ' is-finished' : ''}">
          <span class="uno-turn-icon" aria-hidden="true">${isFinished ? (game.result === 'win' ? '🏆' : '🤝') : (game.isMyTurn ? '✦' : '⌛')}</span>
          <span><strong>${turnHeading}</strong><small>${turnNote}</small></span>
        </div>
        ${resultPanel}
        <div class="p4-player-strip">${playerSeats}</div>
        <section class="p4-game-board" aria-label="Plateau de Puissance 4">
          <div class="p4-column-controls" role="group" aria-label="Choisis une colonne">
            ${controls}
          </div>
          <div class="p4-board" role="grid" aria-label="Grille de six rangées et sept colonnes">${board}</div>
          <p class="p4-board-help">Clique sur une flèche pour déposer ton jeton dans la colonne.</p>
        </section>
        <p class="p4-last-action"><span aria-hidden="true">✦</span>${escapeHtml(lastAction)}</p>
        ${chatPanel(room)}
        <div class="uno-game-actions">${replayButton}${endAction}<button class="button button-muted" type="button" data-dialog-close>${dialogCloseLabel()}</button></div>
      </div>`;
  }

  function loupGarouGameDialog(room) {
    const game = room.loupGarou;
    if (!game) return `<div class="error-state"><strong>La partie de Loup-garou n’a pas pu être chargée.</strong><button type="button" data-dialog-close>${dialogCloseLabel()}</button></div>`;
    const isFinished = game.phase === 'finished';
    const players = Array.isArray(game.players) ? game.players : [];
    const playerById = new Map(players.map((player) => [player.id, player]));
    const playerRows = players.map((player) => {
      const color = safeChatColor(player.chatColor);
      const status = player.isAlive
        ? `${player.isYou && game.myRoleName ? `Toi · ${game.myRoleName}` : (player.isBot ? 'Bot de test' : 'En jeu')}${player.isMyLover ? ' · ton amoureux / ton amoureuse' : ''}`
        : `Éliminé · ${player.roleName || 'rôle révélé'}`;
      return `<li class="werewolf-player${player.isAlive ? '' : ' is-eliminated'}${player.isYou ? ' is-you' : ''}${player.isMyLover ? ' is-lover' : ''}">
        <span class="werewolf-player-avatar" style="--chat-accent:${color}" aria-hidden="true">${escapeHtml(player.chatEmoji || (player.isBot ? '🤖' : '🙂'))}</span>
        <span class="werewolf-player-copy"><strong style="color:${color}">${escapeHtml(player.nickname)}${player.isYou ? ' · toi' : ''}</strong><small>${escapeHtml(status)}</small></span>
        <span class="werewolf-life" aria-label="${player.isAlive ? 'En vie' : 'Éliminé'}">${player.isAlive ? '●' : '×'}</span>
      </li>`;
    }).join('');
    const loverNote = game.myLoverNickname
      ? `<em>Ton cœur est lié à ${escapeHtml(game.myLoverNickname)}. Si l’un de vous meurt, l’autre aussi.</em>`
      : '';
    const cupidNote = game.myCupidLovers?.length
      ? `<em>Tu as lié ${game.myCupidLovers.map(escapeHtml).join(' et ')}. Le lien reste secret.</em>`
      : '';
    const potionNote = game.myPotions
      ? `<em>Potions restantes : vie ${game.myPotions.healAvailable ? '✓' : 'utilisée'} · mort ${game.myPotions.poisonAvailable ? '✓' : 'utilisée'}.</em>`
      : '';
    const roleCard = game.myRoleName ? `
      <section class="werewolf-role-card"><span class="werewolf-role-icon" aria-hidden="true">${escapeHtml(game.myRoleIcon || '🌾')}</span>
        <span><small>TON RÔLE · SECRET</small><strong>${escapeHtml(game.myRoleName)}</strong><p>${escapeHtml(game.myRoleDescription || '')}</p>${game.myRole === 'wolf' ? `<em>${game.myAllies.length ? `Tes alliés : ${game.myAllies.map(escapeHtml).join(', ')}` : 'Tu es le seul loup-garou.'}</em>` : ''}${loverNote}${cupidNote}${potionNote}</span>
      </section>` : '';
    const secondsRemaining = Number.isFinite(game.secondsRemaining) ? Math.max(0, game.secondsRemaining) : null;
    const timerNote = secondsRemaining === null ? '' : ` · ${secondsRemaining}s restantes`;
    const voteProgress = game.phase === 'day' && game.actionTotal
      ? ` · ${Number(game.actionCount)}/${Number(game.actionTotal)} votes`
      : '';
    let statusHeading = 'La nuit tombe sur le village';
    let statusNote = game.nightStepLabel || 'Le village dort. Les rôles agissent en secret.';
    let statusIcon = '🌙';
    let phaseClass = 'is-night';

    if (isFinished) {
      statusHeading = game.result === 'win'
        ? (game.winnerFaction === 'wolves' ? 'Les loups ont gagné !' : (game.winnerFaction === 'lovers' ? 'Les amoureux ont gagné !' : 'Le village est sauvé !'))
        : 'Partie terminée';
      statusNote = game.lastAction?.message || 'La partie est terminée.';
      statusIcon = game.result === 'win' ? '🏆' : '🤝';
      phaseClass = 'is-finished';
    } else if (game.phase === 'hunter') {
      phaseClass = 'is-hunter';
      if (game.canAct) {
        statusHeading = 'Le dernier tir du Chasseur';
        statusNote = `Choisis qui emporter avec toi avant de quitter la partie${timerNote}.`;
        statusIcon = '🏹';
      } else {
        statusHeading = 'Un dernier tir';
        statusNote = `Le Chasseur choisit sa dernière cible${timerNote}.`;
        statusIcon = '🏹';
      }
    } else if (game.phase === 'day') {
      phaseClass = 'is-day';
      statusIcon = '☀️';
      if (!game.isAlive) {
        statusHeading = 'Tu observes la partie';
        statusNote = 'Ton rôle est révélé. Les joueurs éliminés peuvent observer, mais ne votent plus.';
        statusIcon = '👀';
      } else if (game.canAct) {
        statusHeading = game.myDayVoteId ? 'Ton vote est enregistré' : 'Débat du village';
        statusNote = game.myDayVoteId
          ? `Ton vote contre ${game.myDayVoteNickname || 'un suspect'} est privé. Tu peux encore le changer${voteProgress}${timerNote}.`
          : `Discute dans le tchat puis vote contre un suspect${voteProgress}${timerNote}.`;
      } else {
        statusHeading = 'Le village rend son verdict';
        statusNote = game.hasVoted
          ? `Ton vote est enregistré${voteProgress}. Attends les autres villageois${timerNote}.`
          : `La journée avance : prépare ton vote${timerNote}.`;
      }
    } else if (game.phase === 'night') {
      if (!game.isAlive) {
        statusHeading = 'Tu observes la nuit';
        statusNote = `Tu es éliminé·e : les rôles agissent en secret${timerNote}.`;
        statusIcon = '👀';
      } else if (game.canAct) {
        const activeHeadings = {
          cupid: 'Cupidon lie deux cœurs',
          wolves: 'Les loups se réveillent',
          seer: 'La voyante ouvre les yeux',
          doctor: 'Le médecin veille',
          witch: 'La Sorcière prépare ses potions',
        };
        statusHeading = game.actionKind === 'wolves' && game.myWolfVoteId
          ? 'Ton vote des loups est enregistré'
          : (activeHeadings[game.actionKind] || 'Ton rôle agit cette nuit');
        statusNote = game.actionKind === 'wolves' && game.myWolfVoteId
          ? `Tu as choisi ${game.myWolfVoteNickname || 'une cible'}. Tu peux encore changer ton vote${timerNote}.`
          : `${game.nightStepLabel || 'Choisis secrètement ton action.'}${timerNote}`;
        statusIcon = game.actionKind === 'wolves' ? '🐺' : (game.actionKind === 'seer' ? '🔮' : (game.actionKind === 'doctor' ? '🩺' : (game.actionKind === 'witch' ? '🧙' : '💘')));
      } else if (game.hasVoted) {
        statusHeading = 'Ton choix est enregistré';
        statusNote = `Attends la fin des actions nocturnes${timerNote}.`;
        statusIcon = '🤫';
      } else {
        statusHeading = 'La nuit tombe sur le village';
        statusNote = `${game.nightStepLabel || 'Le village dort. Les rôles agissent en secret.'}${timerNote}`;
      }
    }

    const actionKind = game.actionKind;
    const selectedTargetId = actionKind === 'vote'
      ? game.myDayVoteId
      : (actionKind === 'wolves' ? game.myWolfVoteId : null);
    const targetButtons = game.canAct ? game.eligibleTargets.map((target) => {
      const player = playerById.get(target.id) || target;
      const color = safeChatColor(player.chatColor);
      const isSelected = target.id === selectedTargetId;
      return `<button class="werewolf-target${isSelected ? ' is-selected' : ''}" type="button" data-game-action="loup-garou" data-game-verb="act" data-room-id="${escapeHtml(room.id)}" data-target-id="${escapeHtml(target.id)}" aria-pressed="${String(isSelected)}">
        <span class="werewolf-player-avatar" style="--chat-accent:${color}" aria-hidden="true">${escapeHtml(player.chatEmoji || '🙂')}</span><span>${escapeHtml(target.nickname)}${target.isYou ? ' · toi' : ''}</span><span class="werewolf-target-arrow" aria-hidden="true">${isSelected ? '✓' : '↗'}</span>
      </button>`;
    }).join('') : '';
    const targetOptions = game.eligibleTargets.map((target) => (
      `<option value="${escapeHtml(target.id)}">${escapeHtml(target.nickname)}${target.isYou ? ' · toi' : ''}</option>`
    )).join('');
    let actionArea = '';
    if (game.canAct && actionKind === 'cupid') {
      const roomControlId = String(room.id).replace(/[^a-zA-Z0-9_-]/g, '');
      actionArea = `<form class="werewolf-actions werewolf-special-form" data-form="loup-cupid" data-room-id="${escapeHtml(room.id)}">
        <strong>Choisis les deux amoureux</strong><p>Ils se reconnaîtront dès le prochain réveil. Un lien peut unir deux camps opposés.</p>
        <label class="form-label" for="cupid-first-${roomControlId}"><span>Première personne</span><select class="form-select" id="cupid-first-${roomControlId}" name="firstTargetId" required><option value="">Choisir…</option>${targetOptions}</select></label>
        <label class="form-label" for="cupid-second-${roomControlId}"><span>Deuxième personne</span><select class="form-select" id="cupid-second-${roomControlId}" name="secondTargetId" required><option value="">Choisir…</option>${targetOptions}</select></label>
        <button class="button button-primary" type="submit">Sceller le lien 💘</button><p class="field-error" data-error role="alert"></p>
      </form>`;
    } else if (game.canAct && actionKind === 'witch') {
      const roomControlId = String(room.id).replace(/[^a-zA-Z0-9_-]/g, '');
      const victimNote = game.witchVictimNickname
        ? `La victime des loups est ${escapeHtml(game.witchVictimNickname)}.`
        : 'Les loups n’ont choisi personne cette nuit.';
      actionArea = `<form class="werewolf-actions werewolf-special-form" data-form="loup-witch" data-room-id="${escapeHtml(room.id)}">
        <strong>Décide du sort du village</strong><p>${victimNote} Tu peux utiliser l’une ou tes deux potions maintenant, ou les garder.</p>
        <label class="werewolf-potion-option${game.witchCanSave ? '' : ' is-unavailable'}"><input type="checkbox" name="save" value="yes"${game.witchCanSave ? '' : ' disabled'}><span>Utiliser la potion de vie${game.witchVictimNickname ? ` pour sauver ${escapeHtml(game.witchVictimNickname)}` : ''}</span></label>
        <label class="form-label" for="witch-poison-${roomControlId}"><span>Potion de mort · empoisonner quelqu’un</span><select class="form-select" id="witch-poison-${roomControlId}" name="poisonTargetId"${game.witchCanPoison ? '' : ' disabled'}><option value="">Ne pas empoisonner</option>${targetOptions}</select></label>
        <button class="button button-primary" type="submit">Valider mes potions</button><p class="field-error" data-error role="alert"></p>
      </form>`;
    } else if (game.canAct) {
      const actionTitle = actionKind === 'vote'
        ? (game.myDayVoteId ? 'Changer mon vote' : 'Vote du village : qui faut-il éliminer ?')
        : (actionKind === 'wolves'
          ? (game.myWolfVoteId ? 'Modifier le vote des loups' : 'Choisis une victime avec les loups')
          : (actionKind === 'seer'
            ? 'Qui veux-tu inspecter ?'
            : (actionKind === 'doctor'
              ? 'Qui veux-tu protéger ?'
              : (actionKind === 'hunter' ? 'Qui emportes-tu avec toi ?' : 'Choisis une cible'))));
      const actionNote = actionKind === 'vote'
        ? '<small>Ton vote reste privé et peut être changé avant le verdict.</small>'
        : (actionKind === 'seer'
          ? '<small>Le résultat de ton inspection restera secret.</small>'
          : (actionKind === 'doctor'
            ? '<small>Tu peux aussi te protéger toi-même.</small>'
            : (actionKind === 'hunter'
              ? '<small>Ce dernier tir est révélé au village.</small>'
              : (actionKind === 'wolves' ? '<small>Ton vote est secret et peut être modifié tant que tous les loups n’ont pas choisi.</small>' : ''))));
      actionArea = `<section class="werewolf-actions"><strong>${actionTitle}</strong>${actionNote}<div class="werewolf-target-grid">${targetButtons}</div></section>`;
    } else if (game.phase === 'night' && game.isAlive) {
      actionArea = `<p class="werewolf-wait-note"><span aria-hidden="true">🌙</span>${escapeHtml(game.nightStepLabel || 'Le village dort : les rôles agissent en secret.')}${timerNote}</p>`;
    } else if (game.phase === 'hunter' && game.isAlive) {
      actionArea = `<p class="werewolf-wait-note"><span aria-hidden="true">🏹</span>${escapeHtml(game.nightStepLabel || 'Le Chasseur choisit sa dernière cible.')}${timerNote}</p>`;
    }
    const finding = game.mySeerFinding
      ? `<p class="werewolf-finding"><span aria-hidden="true">🔮</span>Tu as découvert que <strong>${escapeHtml(game.mySeerFinding.nickname)}</strong> ${game.mySeerFinding.isWolf ? 'est un loup-garou.' : 'n’est pas un loup-garou.'}</p>`
      : '';
    const villagePowerNotice = game.villagePowersDisabled
      ? '<p class="werewolf-powers-note" role="status"><span aria-hidden="true">⚠️</span>L’Ancien a été éliminé par le village : les rôles spéciaux du village ont perdu leurs pouvoirs.</p>'
      : '';
    const winnerLabel = game.winnerFaction === 'wolves'
      ? 'VICTOIRE DES LOUPS'
      : (game.winnerFaction === 'lovers' ? 'VICTOIRE DES AMOUREUX' : (game.result === 'win' ? 'VICTOIRE DU VILLAGE' : 'FIN DE PARTIE'));
    const resultPanel = isFinished ? `<section class="game-result-panel ${game.result === 'win' ? 'is-victory' : 'is-draw'}" role="status"><span class="game-result-icon" aria-hidden="true">${game.result === 'win' ? '🏆' : '🤝'}</span><span class="game-result-copy"><small>LOUP-GAROU · ${winnerLabel}</small><strong>${escapeHtml(statusHeading)}</strong><span>${escapeHtml(game.winnerNames?.length ? `Équipe gagnante : ${game.winnerNames.join(', ')}.` : statusNote)}</span></span></section>` : '';
    const replayButton = isFinished && room.isHost
      ? `<button class="button button-primary" type="button" data-extra-restart="loup-garou" data-room-id="${escapeHtml(room.id)}">Rejouer une partie</button>`
      : '';
    const lastAction = game.lastAction?.message || 'Le village s’organise…';
    const phaseLabel = game.phase === 'night'
      ? `NUIT ${Number(game.round) || 1} · LES RÔLES AGISSENT EN SECRET`
      : (game.phase === 'day'
        ? `JOUR ${Number(game.round) || 1} · DÉBAT ET VOTE`
        : (game.phase === 'hunter' ? 'DERNIER TIR · LE CHASSEUR' : 'LA PARTIE EST TERMINÉE'));
    const phaseIcon = game.phase === 'day' ? '☀️' : (game.phase === 'hunter' ? '🏹' : (isFinished ? '🐺' : '🌙'));
    const timerDurationSeconds = game.phase === 'day' ? 120 : (game.phase === 'hunter' ? 25 : 45);
    const timerPercentage = secondsRemaining === null
      ? 0
      : Math.max(0, Math.min(100, Math.round((secondsRemaining / timerDurationSeconds) * 100)));
    const timerProgress = !isFinished && secondsRemaining !== null
      ? `<div class="werewolf-timer-track" role="progressbar" aria-label="Temps restant pour ${game.phase === 'day' ? 'le vote' : (game.phase === 'hunter' ? 'le dernier tir' : 'les actions de nuit')}" aria-valuemin="0" aria-valuemax="${timerDurationSeconds}" aria-valuenow="${Math.min(timerDurationSeconds, secondsRemaining)}"><span style="width:${timerPercentage}%"></span></div>`
      : '';

    return `<div class="extra-game-view werewolf-game-view ${phaseClass}">
      <header class="extra-game-header"><span class="extra-game-mark" aria-hidden="true">${phaseIcon}</span><span><small>${phaseLabel}</small><h2 id="dialog-title">${escapeHtml(room.title)}</h2><p>La nuit, les rôles secrets agissent. Le jour, le village débat puis vote.</p></span></header>
      <div class="uno-turn-banner${game.canAct ? ' my-turn' : ''}${isFinished ? ' is-finished' : ''}"><span class="uno-turn-icon" aria-hidden="true">${statusIcon}</span><span><strong>${escapeHtml(statusHeading)}</strong><small>${escapeHtml(statusNote)}</small></span></div>
      ${timerProgress}
      ${roleCard}${villagePowerNotice}${resultPanel}${finding}
      <section class="werewolf-board"><div class="game-section-heading"><strong>Les habitants</strong><small>${players.filter((player) => player.isAlive).length} en jeu · ${players.length} au départ${game.phase === 'day' && game.actionTotal ? ` · ${Number(game.actionCount)}/${Number(game.actionTotal)} votes` : ''}</small></div><ul class="werewolf-player-list">${playerRows}</ul></section>
      ${actionArea}<p class="extra-game-last-action"><span aria-hidden="true">✦</span>${escapeHtml(lastAction)}</p>
      ${chatPanel(room)}${gameEndActions(room, replayButton)}
    </div>`;
  }

  function triviaGameDialog(room, gameId) {
    const isBlindTest = gameId === 'blind-test';
    const game = isBlindTest ? room.blindTest : room.quiz;
    if (!game || !game.question) return `<div class="error-state"><strong>${isBlindTest ? 'Le blind test' : 'Le quiz'} n’a pas pu être chargé.</strong><button type="button" data-dialog-close>${dialogCloseLabel()}</button></div>`;
    const isFinished = game.phase === 'finished';
    const isRevealed = game.phase === 'reveal' || isFinished;
    const isPlaying = game.phase === 'playing';
    const question = game.question;
    const winnerNames = Array.isArray(game.winnerNames) ? game.winnerNames : [];
    const choiceButtons = question.choices.map((choice, index) => {
      const isCorrect = isRevealed && index === question.correctIndex;
      const isMyWrongChoice = isRevealed && game.myChoiceIndex === index && !isCorrect;
      const isSelected = isPlaying && game.myChoiceIndex === index;
      const disabled = !isPlaying || !game.isMyTurn;
      return `<button class="trivia-choice${isCorrect ? ' is-correct' : ''}${isMyWrongChoice ? ' is-wrong' : ''}${isSelected ? ' is-selected' : ''}" type="button" data-game-answer="${escapeHtml(gameId)}" data-room-id="${escapeHtml(room.id)}" data-choice-index="${index}"${disabled ? ' disabled' : ''}>
        <span class="trivia-choice-letter">${String.fromCharCode(65 + index)}</span><span>${escapeHtml(choice)}</span>${isCorrect ? '<span class="trivia-choice-mark" aria-label="Bonne réponse">✓</span>' : ''}${isMyWrongChoice ? '<span class="trivia-choice-mark" aria-label="Ta réponse">×</span>' : ''}
      </button>`;
    }).join('');
    const statusHeading = isFinished
      ? (game.result === 'draw' ? 'Égalité parfaite !' : `Bravo, ${winnerNames[0] || 'champion'} !`)
      : (game.phase === 'reveal' ? 'Réponse révélée !' : (game.isMyTurn ? 'À toi de répondre !' : (game.hasAnswered ? 'Réponse enregistrée' : 'La question est lancée')));
    const statusNote = isFinished
      ? (game.result === 'draw' ? `Les scores sont à égalité${winnerNames.length ? ` entre ${winnerNames.join(', ')}` : ''}.` : `${winnerNames.join(', ')} remporte${winnerNames.length > 1 ? 'nt' : ''} le ${isBlindTest ? 'blind test' : 'quiz'} !`)
      : (game.phase === 'reveal' ? 'Comparez les points puis l’organisateur lancera la suite.' : (game.isMyTurn ? 'Choisis une réponse avant les autres !' : (game.hasAnswered ? 'Attends les réponses des autres joueurs.' : 'Réfléchis bien, tu pourras bientôt répondre.')));
    const resultPanel = isFinished ? `<section class="game-result-panel ${game.result === 'win' ? 'is-victory' : 'is-draw'}" role="status"><span class="game-result-icon" aria-hidden="true">${game.result === 'win' ? '🏆' : '🤝'}</span><span class="game-result-copy"><small>${isBlindTest ? 'BLIND TEST' : 'QUIZ EXPRESS'} · ${game.result === 'win' ? 'VICTOIRE' : 'ÉGALITÉ'}</small><strong>${escapeHtml(statusHeading)}</strong><span>${escapeHtml(statusNote)}</span></span></section>` : '';
    const audioControl = isBlindTest ? `<button class="blind-play-button" type="button" data-blind-play="${escapeHtml(room.id)}"><span aria-hidden="true">▶</span><span><strong>Écouter le thème</strong><small>Son original, créé spécialement pour ce jeu</small></span><span class="blind-note-dots" aria-hidden="true">♫ ♪ ♫</span></button>` : '';
    const explanation = isRevealed ? `<div class="trivia-explanation"><span aria-hidden="true">${isBlindTest ? '🎼' : '💡'}</span><span><strong>${isBlindTest ? 'Le titre du thème' : 'Le savais-tu ?'}</strong><small>${escapeHtml(question.explanation || '')}</small></span></div>` : '';
    const roundAction = game.phase === 'reveal' && game.isHost
      ? `<button class="button button-primary" type="button" data-extra-next="${escapeHtml(gameId)}" data-room-id="${escapeHtml(room.id)}">Question suivante <span aria-hidden="true">→</span></button>`
      : '';
    const replayButton = isFinished && game.isHost
      ? `<button class="button button-primary" type="button" data-extra-restart="${escapeHtml(gameId)}" data-room-id="${escapeHtml(room.id)}">Rejouer une partie</button>`
      : '';
    const questionMark = isBlindTest ? '🎧' : '🧠';
    return `<div class="extra-game-view trivia-game-view ${isBlindTest ? 'blind-test-view' : 'quiz-view'}">
      <header class="extra-game-header"><span class="extra-game-mark" aria-hidden="true">${questionMark}</span><span><small>${isBlindTest ? 'BLIND TEST ORIGINAL' : 'QUIZ EXPRESS'} · QUESTION ${Number(game.questionNumber)}/${Number(game.totalQuestions)}</small><h2 id="dialog-title">${escapeHtml(room.title)}</h2><p>${isBlindTest ? 'Écoute la mélodie, puis choisis le titre correspondant.' : 'Huit questions rapides : chaque bonne réponse rapporte un point.'}</p></span></header>
      <div class="trivia-progress" aria-label="Question ${Number(game.questionNumber)} sur ${Number(game.totalQuestions)}"><span style="width:${Math.min(100, (Number(game.questionNumber) / Math.max(1, Number(game.totalQuestions))) * 100)}%"></span></div>
      <div class="uno-turn-banner${game.isMyTurn ? ' my-turn' : ''}${isFinished ? ' is-finished' : ''}"><span class="uno-turn-icon" aria-hidden="true">${isFinished ? '🏆' : (game.isMyTurn ? '✦' : '⌛')}</span><span><strong>${escapeHtml(statusHeading)}</strong><small>${escapeHtml(statusNote)}</small></span></div>
      ${resultPanel}<section class="trivia-question-card"><div class="trivia-question-kicker"><span>${questionMark}</span><small>${isBlindTest ? 'THÈME À DEVINER' : `QUESTION ${Number(game.questionNumber)}`}</small></div><h3>${escapeHtml(question.prompt)}</h3>${audioControl}<div class="trivia-choices" role="group" aria-label="Choisis une réponse">${choiceButtons}</div>${explanation}</section>
      ${triviaScoreboard(game.scores)}
      ${chatPanel(room)}
      <div class="uno-game-actions">${roundAction}${replayButton}${room.isHost ? roomCloseButton(room) : `<button class="button button-muted" type="button" data-leave-room="${escapeHtml(room.id)}">Quitter la partie</button>`}<button class="button button-muted" type="button" data-dialog-close>${dialogCloseLabel()}</button></div>
    </div>`;
  }

  function morpionGameDialog(room) {
    const game = room.morpion;
    if (!game || !Array.isArray(game.board)) return `<div class="error-state"><strong>Le plateau du morpion n’a pas pu être chargé.</strong><button type="button" data-dialog-close>${dialogCloseLabel()}</button></div>`;
    const isFinished = game.phase === 'finished';
    const players = Array.isArray(game.players) ? game.players : [];
    const playerById = new Map(players.map((player) => [player.id, player]));
    const winningCells = new Set(game.winningCells || []);
    const cells = game.board.map((playerId, index) => {
      const player = playerId ? playerById.get(playerId) : null;
      const symbol = player?.symbol || '';
      const classes = [
        'morpion-cell',
        player?.symbol === 'X' ? 'is-x' : '',
        player?.symbol === 'O' ? 'is-o' : '',
        winningCells.has(index) ? 'is-winning' : '',
      ].filter(Boolean).join(' ');
      const disabled = !game.isMyTurn || isFinished || Boolean(playerId);
      const label = player
        ? `Case ${index + 1} : ${player.symbol}, ${player.nickname}${winningCells.has(index) ? ', case gagnante' : ''}`
        : `Case ${index + 1}, vide`;
      return `<button class="${classes}" type="button" data-game-action="morpion" data-game-verb="play" data-room-id="${escapeHtml(room.id)}" data-cell-index="${index}" aria-label="${escapeHtml(label)}"${disabled ? ' disabled' : ''}><span aria-hidden="true">${escapeHtml(symbol)}</span></button>`;
    }).join('');
    const winnerName = game.winnerName || 'Un joueur';
    const statusHeading = isFinished
      ? (game.result === 'win' ? `Bravo, ${winnerName} !` : 'Match nul !')
      : (game.isMyTurn ? `À toi de jouer · ${players.find((player) => player.isYou)?.symbol || 'X'}` : `Au tour de ${game.currentPlayerName || 'l’autre joueur'}`);
    const statusNote = isFinished
      ? (game.result === 'win' ? `${winnerName} aligne trois symboles et gagne la partie !` : 'Le plateau est plein : personne ne l’emporte cette fois.')
      : (game.isMyTurn ? 'Choisis une case vide pour placer ton symbole.' : 'Observe le plateau : ton tour arrive juste après.');
    const resultPanel = isFinished ? `<section class="game-result-panel ${game.result === 'win' ? 'is-victory' : 'is-draw'}" role="status"><span class="game-result-icon" aria-hidden="true">${game.result === 'win' ? '🏆' : '🤝'}</span><span class="game-result-copy"><small>MORPION · ${game.result === 'win' ? 'VICTOIRE' : 'MATCH NUL'}</small><strong>${escapeHtml(statusHeading)}</strong><span>${escapeHtml(statusNote)}</span></span></section>` : '';
    const replayButton = isFinished && room.isHost
      ? `<button class="button button-primary" type="button" data-extra-restart="morpion" data-room-id="${escapeHtml(room.id)}">Rejouer</button>`
      : '';
    const lastAction = game.lastAction?.message || 'La partie est lancée.';
    return `<div class="extra-game-view morpion-game-view">
      <header class="extra-game-header"><span class="extra-game-mark morpion-mark" aria-hidden="true">⭕</span><span><small>DUEL · MORPION</small><h2 id="dialog-title">${escapeHtml(room.title)}</h2><p>Aligne trois symboles avant l’autre joueur.</p></span></header>
      <div class="uno-turn-banner${game.isMyTurn ? ' my-turn' : ''}${isFinished ? ' is-finished' : ''}"><span class="uno-turn-icon" aria-hidden="true">${isFinished ? (game.result === 'win' ? '🏆' : '🤝') : (game.isMyTurn ? '✦' : '⌛')}</span><span><strong>${escapeHtml(statusHeading)}</strong><small>${escapeHtml(statusNote)}</small></span></div>
      ${resultPanel}<div class="morpion-player-strip">${players.map((player) => `<div class="morpion-player${player.isCurrentTurn && !isFinished ? ' is-current' : ''}${player.isYou ? ' is-you' : ''}"><span class="morpion-symbol ${player.symbol === 'X' ? 'symbol-x' : 'symbol-o'}">${escapeHtml(player.symbol)}</span>${playerIdentity(player, player.isBot ? 'bot de test' : (player.isYou ? 'toi' : ''))}</div>`).join('')}</div>
      <section class="morpion-board" role="group" aria-label="Plateau de morpion, trois lignes et trois colonnes">${cells}</section>
      <p class="extra-game-last-action"><span aria-hidden="true">✦</span>${escapeHtml(lastAction)}</p>
      ${chatPanel(room)}${gameEndActions(room, replayButton)}
    </div>`;
  }

  function memoryGameDialog(room) {
    const game = room.memoire;
    if (!game || !Array.isArray(game.board)) return `<div class="error-state"><strong>Le plateau Memory n’a pas pu être chargé.</strong><button type="button" data-dialog-close>${dialogCloseLabel()}</button></div>`;
    const isFinished = game.phase === 'finished';
    const isMismatch = game.phase === 'mismatch';
    const cards = game.board.map((card, index) => {
      const classes = [
        'memory-card',
        card.isRevealed ? 'is-face-up' : '',
        card.isMatched ? 'is-matched' : '',
        isMismatch && card.isRevealed ? 'is-mismatch' : '',
      ].filter(Boolean).join(' ');
      const label = card.isRevealed ? `Carte ${index + 1} révélée : ${card.symbol}` : `Carte cachée ${index + 1}`;
      const disabled = !game.canFlip || card.isRevealed || isFinished;
      return `<button class="${classes}" type="button" data-memory-card="${escapeHtml(card.id)}" data-room-id="${escapeHtml(room.id)}" aria-label="${escapeHtml(label)}"${disabled ? ' disabled' : ''}><span class="memory-card-back" aria-hidden="true">✦</span><span class="memory-card-face" aria-hidden="true">${card.isRevealed ? escapeHtml(card.symbol) : ''}</span></button>`;
    }).join('');
    const winnerNames = Array.isArray(game.winnerNames) ? game.winnerNames : [];
    const winnerScore = Number(game.scores?.[0]?.score) || 0;
    const statusHeading = isFinished
      ? (game.result === 'draw' ? 'Égalité de champions !' : `Bravo, ${winnerNames[0] || 'champion'} !`)
      : (isMismatch ? 'Paire différente…' : (game.isMyTurn ? 'À toi de retourner !' : `Au tour de ${game.currentPlayerName || 'un joueur'}`));
    const statusNote = isFinished
      ? (game.result === 'draw' ? `Même score pour ${winnerNames.join(' et ')}.` : `${winnerNames.join(', ')} remporte${winnerNames.length > 1 ? 'nt' : ''} la partie avec ${winnerScore} paire${winnerScore === 1 ? '' : 's'}.`)
      : (isMismatch ? 'Mémorise ces deux cartes, puis retourne-les pour passer le tour.' : (game.isMyTurn ? 'Trouve deux cartes identiques. Si tu fais une paire, tu rejoues !' : 'Regarde bien les cartes retournées pour mémoriser leur place.'));
    const resultPanel = isFinished ? `<section class="game-result-panel ${game.result === 'win' ? 'is-victory' : 'is-draw'}" role="status"><span class="game-result-icon" aria-hidden="true">${game.result === 'win' ? '🏆' : '🤝'}</span><span class="game-result-copy"><small>MEMORY · ${game.result === 'win' ? 'VICTOIRE' : 'ÉGALITÉ'}</small><strong>${escapeHtml(statusHeading)}</strong><span>${escapeHtml(statusNote)}</span></span></section>` : '';
    const continueButton = game.canContinue
      ? `<button class="button button-primary memory-continue" type="button" data-memory-continue="${escapeHtml(room.id)}">Retourner les cartes et passer</button>`
      : '';
    const replayButton = isFinished && room.isHost
      ? `<button class="button button-primary" type="button" data-extra-restart="memoire" data-room-id="${escapeHtml(room.id)}">Rejouer</button>`
      : '';
    return `<div class="extra-game-view memory-game-view">
      <header class="extra-game-header"><span class="extra-game-mark memory-mark" aria-hidden="true">🧩</span><span><small>JEU DE MÉMOIRE · ${Number(game.totalPairs) || 8} PAIRES</small><h2 id="dialog-title">${escapeHtml(room.title)}</h2><p>Retrouve les paires cachées. Chaque paire trouvée te fait rejouer.</p></span></header>
      <div class="uno-turn-banner${game.isMyTurn && !isFinished ? ' my-turn' : ''}${isFinished ? ' is-finished' : ''}"><span class="uno-turn-icon" aria-hidden="true">${isFinished ? (game.result === 'win' ? '🏆' : '🤝') : (isMismatch ? '🧠' : (game.isMyTurn ? '✦' : '⌛'))}</span><span><strong>${escapeHtml(statusHeading)}</strong><small>${escapeHtml(statusNote)}</small></span></div>
      ${resultPanel}<div class="memory-progress"><span>Paires trouvées</span><strong>${Number(game.matchedPairs) || 0} / ${Number(game.totalPairs) || 8}</strong></div>
      <section class="memory-board" role="group" aria-label="Seize cartes du jeu Memory">${cards}</section>
      ${triviaScoreboard(game.scores)}${continueButton}<p class="extra-game-last-action"><span aria-hidden="true">✦</span>${escapeHtml(game.lastAction?.message || 'Mélange les cartes dans ta tête !')}</p>
      ${chatPanel(room)}${gameEndActions(room, replayButton)}
    </div>`;
  }

  function roomDialog(room) {
    if (room.status === 'started') {
      let gameMarkup = '';
      if (room.game === 'uno') gameMarkup = unoGameDialog(room);
      else if (room.game === 'puissance-4') gameMarkup = puissance4GameDialog(room);
      else if (room.game === 'loup-garou') gameMarkup = loupGarouGameDialog(room);
      else if (room.game === 'quiz') gameMarkup = triviaGameDialog(room, 'quiz');
      else if (room.game === 'blind-test') gameMarkup = triviaGameDialog(room, 'blind-test');
      else if (room.game === 'morpion') gameMarkup = morpionGameDialog(room);
      else if (room.game === 'memoire') gameMarkup = memoryGameDialog(room);
      if (gameMarkup) return gameMarkup;
    }
    const game = gameFor(room.game);
    const gameClass = `game-${escapeHtml(game.id)}`;
    const isStarted = room.status === 'started';
    const slotsLeft = Math.max(0, Number(room.maxPlayers) - Number(room.playerCount));
    const playersNeeded = Math.max(0, game.minPlayers - Number(room.playerCount));
    const canStart = playersNeeded === 0;
    const percentage = Math.min(100, Math.round((Number(room.playerCount) / Math.max(1, Number(room.maxPlayers))) * 100));
    const capacityClass = Math.min(100, Math.ceil(percentage / 10) * 10);
    const playerRows = (room.players || []).map((player) => {
      const color = safeChatColor(player.chatColor);
      let badge = player.isBot ? '<span class="room-player-badge bot">Bot de test</span>' : '';
      if (player.isHost) badge = '<span class="room-player-badge host">Organisateur</span>';
      if (player.isCurrentPlayer) badge = '<span class="room-player-badge you">C’est toi</span>';
      if (player.isHost && player.isCurrentPlayer) badge = '<span class="room-player-badge you">Organisateur · toi</span>';
      const avatar = player.isBot ? '🤖' : (player.chatEmoji || playerInitials(player.nickname));
      return `<div class="room-player-row${player.isBot ? ' is-bot' : ''}"><span class="room-player-avatar" style="--player-accent:${color}">${escapeHtml(avatar)}</span><span class="room-player-name" style="color:${color}">${escapeHtml(player.nickname)}</span>${badge}</div>`;
    }).join('');
    const actionButton = room.isHost
      ? roomCloseButton(room)
      : `<button class="button button-muted" type="button" data-leave-room="${escapeHtml(room.id)}">Quitter le salon</button>`;
    const lobbyMessage = isStarted
      ? 'La partie a commencé. Les nouveaux joueurs ne peuvent plus rejoindre.'
      : (slotsLeft === 0
        ? 'Le salon est complet : tous les joueurs ont leur place.'
        : `${slotsLeft} place${slotsLeft === 1 ? '' : 's'} encore disponible${slotsLeft === 1 ? '' : 's'} dans ce salon.`);
    const isPlayableGame = GAMES.some((availableGame) => availableGame.id === game.id);
    const startControl = room.isHost
      ? `<button class="button button-primary launch-button" type="button" data-start-room="${escapeHtml(room.id)}"${!isPlayableGame || (!canStart && !isStarted) ? ' disabled' : ''}>${isStarted ? 'Partie lancée' : (!isPlayableGame ? 'Bientôt disponible' : (canStart ? 'Lancer la partie' : `Encore ${playersNeeded} joueur${playersNeeded === 1 ? '' : 's'}`))}</button>`
      : `<span class="launch-waiting">En attente de l’organisateur</span>`;
    const launchPanel = isStarted
      ? `<div class="game-live-panel ${gameClass}"><span class="game-live-icon" aria-hidden="true">${game.icon}</span><span class="game-live-copy"><span class="game-live-status"><i></i> PARTIE EN COURS</span><strong>C’est parti !</strong><small>${escapeHtml(game.name)} · ${Number(room.playerCount)} joueur${Number(room.playerCount) === 1 ? '' : 's'} · lancée ${escapeHtml(timeAgo(room.startedAt))}</small></span></div>`
      : `<div class="launch-panel"><span class="launch-panel-icon" aria-hidden="true">🚀</span><span class="launch-panel-copy"><strong>${isPlayableGame ? 'Pas besoin d’attendre d’être au complet' : 'Ce jeu arrive bientôt'}</strong><small>${isPlayableGame ? `Tu peux lancer dès ${game.minPlayers} joueur${game.minPlayers === 1 ? '' : 's'}, même s’il reste des places.` : 'Ce jeu sera disponible prochainement.'}</small></span>${startControl}</div>`;
    const botCount = (room.players || []).filter((player) => player.isBot).length;
    const botOptions = slotsLeft > 0
      ? Array.from({ length: slotsLeft }, (_, index) => `<option value="${index + 1}">${index + 1} bot${index === 0 ? '' : 's'}</option>`).join('')
      : '<option value="0">Aucune place libre</option>';
    const botTools = room.isHost && !isStarted ? `
      <section class="bot-test-panel" aria-label="Outils de test avec des bots">
        <div class="bot-test-heading"><span class="bot-test-icon" aria-hidden="true">🤖</span><span><strong>Bots de test</strong><small>Remplis les places libres avec des joueurs fictifs.</small></span></div>
        <form class="bot-add-form" data-form="add-bots" data-room-id="${escapeHtml(room.id)}">
          <label for="bot-count">Ajouter</label>
          <select class="bot-count-select" id="bot-count" name="count"${slotsLeft === 0 ? ' disabled' : ''}>${botOptions}</select>
          <button class="button button-primary bot-add-button" type="submit"${slotsLeft === 0 ? ' disabled' : ''}>Ajouter</button>
        </form>
        <div class="bot-test-footer"><span>${botCount} bot${botCount === 1 ? '' : 's'} dans ce salon · ils joueront automatiquement au lancement.</span><button class="bot-remove-button" type="button" data-remove-bots="${escapeHtml(room.id)}"${botCount === 0 ? ' disabled' : ''}>Retirer les bots</button></div>
      </section>` : '';

    return `
      <div class="room-dialog-top ${gameClass}">
        <div class="modal-kicker">SALON DE JEU · ${escapeHtml(game.category.toLocaleUpperCase('fr-FR'))}</div>
        <h2 id="dialog-title" class="room-dialog-title">${escapeHtml(room.title)}</h2>
        <p class="room-dialog-meta">${escapeHtml(game.name)} · organisé par ${escapeHtml(room.hostName || 'un joueur')}</p>
        <span class="room-dialog-icon" aria-hidden="true">${game.icon}</span>
      </div>
      ${launchPanel}
      <div class="room-section-label"><span>Dans le salon</span><span>${Number(room.playerCount)} / ${Number(room.maxPlayers)} joueurs</span></div>
      <div class="room-player-list">${playerRows || '<p class="room-lobby-note">Le salon est vide pour le moment.</p>'}</div>
      ${chatPanel(room)}
      <div class="room-capacity">
        <div class="capacity-copy"><span><strong>${isStarted ? 'Partie lancée' : (slotsLeft === 0 ? 'Salon complet' : 'La partie se remplit')}</strong></span><span>${Number(room.playerCount)}/${Number(room.maxPlayers)}</span></div>
        <div class="capacity-track" aria-label="${percentage}% des places occupées"><div class="capacity-fill capacity-${capacityClass}"></div></div>
      </div>
      ${botTools}
      <p class="room-lobby-note"><span aria-hidden="true">✦</span><span>${escapeHtml(lobbyMessage)} La liste des joueurs se met à jour automatiquement.</span></p>
      <div class="room-dialog-actions">${actionButton}<button class="button button-muted" type="button" data-dialog-close>Retour aux parties</button></div>`;
  }

  function loadingRoomDialog(roomId) {
    activeRoomSnapshot = null;
    selectedUnoCardId = '';
    openDialog('room', '<div class="loading-modal"><span class="loading-spinner" aria-hidden="true"></span>On ouvre le salon…</div>', roomId);
  }

  async function openRoom(roomId) {
    const token = roomTokens[roomId];
    if (!token) {
      const knownRoom = rooms.find((room) => room.id === roomId);
      if (knownRoom) joinRoomDialog(knownRoom);
      else showToast('Cette partie n’est plus disponible. Actualise la liste.', 'error');
      return;
    }

    loadingRoomDialog(roomId);
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}`, {
        headers: { 'X-Player-Token': token },
      });
      if (!data.room.isCurrentPlayer) {
        forgetRoomToken(roomId);
        joinRoomDialog(data.room);
        return;
      }
      selectedUnoCardId = '';
      activeRoomSnapshot = data.room;
      openDialog('room', roomDialog(data.room), roomId);
    } catch (error) {
      if (error.status === 404 || error.status === 401) {
        forgetRoomToken(roomId);
        closeDialog();
        showToast(error.message, 'error');
        loadRooms();
        return;
      }
      openDialog('room', `
        <div class="error-state">
          <strong>Impossible d’ouvrir ce salon.</strong>
          <p>${escapeHtml(error.message)}</p>
          <button type="button" data-dialog-close>Fermer</button>
        </div>`, roomId);
    }
  }

  function showToast(message, kind = '') {
    const region = document.querySelector('#toast-region');
    const toast = document.createElement('div');
    toast.className = `toast${kind ? ` ${kind}` : ''}`;
    toast.textContent = message;
    region.replaceChildren(toast);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.remove(), 3600);
  }

  function showFormError(form, message) {
    const error = form.querySelector('[data-error]');
    if (error) error.textContent = message;
  }

  function setFormPending(form, pending, text) {
    form.setAttribute('aria-busy', String(pending));
    const button = form.querySelector('[type="submit"]');
    if (!button) return;
    if (pending) {
      button.dataset.originalContent = button.innerHTML;
      button.disabled = true;
      button.textContent = text;
    } else {
      button.disabled = false;
      if (button.dataset.originalContent) button.innerHTML = button.dataset.originalContent;
      delete button.dataset.originalContent;
    }
  }

  async function submitAccountForm(form) {
    const mode = form.dataset.mode === 'login' ? 'login' : 'register';
    const values = Object.fromEntries(new FormData(form).entries());
    showFormError(form, '');
    setFormPending(form, true, mode === 'register' ? 'Création…' : 'Connexion…');
    try {
      const data = await api(`/api/accounts/${mode}`, {
        method: 'POST',
        body: { nickname: values.nickname, password: values.password },
      });
      saveAccountSession(data.account, data.token);
      closeDialog();
      showToast(`Tu joues maintenant sous le pseudo « ${data.account.nickname} ».`, 'success');
      await loadLeaderboard();
      await loadRooms();
    } catch (error) {
      showFormError(form, error.message);
      setFormPending(form, false);
      document.querySelector('#account-password')?.focus();
    }
  }

  async function logoutAccount() {
    const token = accountToken;
    if (token) {
      try {
        await api('/api/accounts/logout', {
          method: 'POST',
          headers: { 'X-Account-Token': token },
        });
      } catch {
        // Le jeton local sera supprimé même si le serveur est momentanément indisponible.
      }
    }
    clearAccountSession();
    closeDialog();
    showToast('Tu es déconnecté·e. Tu peux continuer à jouer avec un pseudo.', 'success');
  }

  async function submitCreatorCode(form) {
    const code = new FormData(form).get('code');
    showFormError(form, '');
    setFormPending(form, true, 'Vérification…');
    try {
      const data = await api('/api/creator/unlock', { method: 'POST', body: { code } });
      creatorTicket = data.ticket;
      createRoomDialog();
    } catch (error) {
      showFormError(form, error.message);
      setFormPending(form, false);
      document.querySelector('#creator-code')?.focus();
    }
  }

  async function submitCreateRoom(form) {
    if (!creatorTicket && !currentAccount?.isAdmin) {
      creatorCodeDialog();
      return;
    }
    showFormError(form, '');
    const formData = new FormData(form);
    const values = Object.fromEntries(formData.entries());
    setFormPending(form, true, 'Ouverture du salon…');
    try {
      const data = await api('/api/rooms', {
        method: 'POST',
        headers: accountHeaders(creatorTicket ? { 'X-Creator-Ticket': creatorTicket } : {}),
        body: {
          title: values.title,
          nickname: values.nickname,
          game: values.game,
          maxPlayers: values.maxPlayers,
        },
      });
      rememberRoomToken(data.room.id, data.playerToken);
      saveNickname(String(values.nickname).trim());
      closeDialog();
      showToast('Ton salon est ouvert : les autres peuvent le rejoindre !', 'success');
      await loadRooms();
      await openRoom(data.room.id);
    } catch (error) {
      showFormError(form, error.message);
      setFormPending(form, false);
    }
  }

  async function submitJoinRoom(form) {
    const roomId = form.dataset.roomId;
    const values = Object.fromEntries(new FormData(form).entries());
    showFormError(form, '');
    setFormPending(form, true, 'Connexion au salon…');
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/join`, {
        method: 'POST',
        headers: accountHeaders(roomTokens[roomId] ? { 'X-Player-Token': roomTokens[roomId] } : {}),
        body: { nickname: values.nickname },
      });
      rememberRoomToken(roomId, data.playerToken);
      saveNickname(String(values.nickname).trim());
      closeDialog();
      showToast(`Tu as rejoint « ${data.room.title} » !`, 'success');
      await loadRooms();
      await openRoom(roomId);
    } catch (error) {
      showFormError(form, error.message);
      setFormPending(form, false);
    }
  }

  async function leaveRoom(roomId) {
    const token = roomTokens[roomId];
    if (!token) {
      closeDialog();
      return;
    }
    try {
      await api(`/api/rooms/${encodeURIComponent(roomId)}/players/me`, {
        method: 'DELETE',
        headers: { 'X-Player-Token': token },
      });
      forgetRoomToken(roomId);
      closeDialog();
      showToast('Tu as quitté le salon.', 'success');
      await loadRooms();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function closeRoom(roomId) {
    const token = roomTokens[roomId];
    if (!token || roomsClosing.has(roomId)) return;
    const room = rooms.find((candidate) => candidate.id === roomId)
      || (activeRoomSnapshot?.id === roomId ? activeRoomSnapshot : null);
    const roomTitle = room?.title ? `« ${room.title} »` : 'ce salon';
    const isRunning = room?.status === 'started';
    const confirmation = isRunning
      ? `Arrêter la partie ${roomTitle} pour tout le monde ? La partie et son salon seront supprimés.`
      : `Fermer ${roomTitle} pour tout le monde ?`;
    if (!window.confirm(confirmation)) return;
    roomsClosing.add(roomId);
    renderRooms();
    try {
      await api(`/api/rooms/${encodeURIComponent(roomId)}`, {
        method: 'DELETE',
        headers: { 'X-Player-Token': token },
      });
      forgetRoomToken(roomId);
      if (dialog.open && dialog.dataset.roomId === roomId) closeDialog();
      showToast(isRunning ? 'La partie a été arrêtée pour tout le monde.' : 'Le salon a été fermé.', 'success');
      await loadRooms();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      roomsClosing.delete(roomId);
      renderRooms();
    }
  }

  function updateRoomDialog(room) {
    activeRoomSnapshot = room;
    const scrollTop = dialogContent.scrollTop;
    const oldLog = dialogContent.querySelector('[data-chat-log]');
    const logWasAtBottom = !oldLog || oldLog.scrollHeight - oldLog.scrollTop - oldLog.clientHeight < 36;
    const oldLogTop = oldLog ? oldLog.scrollTop : 0;
    const formKey = (form) => `${form.dataset.form || ''}:${form.dataset.roomId || ''}`;
    const formSnapshots = new Map(Array.from(dialogContent.querySelectorAll('form[data-form]'), (form) => [
      formKey(form), Array.from(form.elements)
        .filter((control) => control.name)
        .map((control) => ({
          name: control.name,
          type: control.type || control.tagName.toLowerCase(),
          value: control.value,
          checked: 'checked' in control ? control.checked : undefined,
          selectedValues: control.tagName === 'SELECT' && control.multiple
            ? Array.from(control.selectedOptions, (option) => option.value)
            : null,
        })),
    ]));
    const activeControl = document.activeElement?.matches('input[name], select[name], textarea[name]')
      ? document.activeElement
      : null;
    const activeForm = activeControl?.closest('form[data-form]');
    const activeControlSnapshot = activeControl && activeForm
      ? {
        formKey: formKey(activeForm),
        name: activeControl.name,
        type: activeControl.type || activeControl.tagName.toLowerCase(),
        selectionStart: activeControl.selectionStart,
        selectionEnd: activeControl.selectionEnd,
      }
      : null;
    dialogContent.innerHTML = roomDialog(room);
    dialogContent.scrollTop = scrollTop;
    const newLog = dialogContent.querySelector('[data-chat-log]');
    if (newLog) newLog.scrollTop = logWasAtBottom ? newLog.scrollHeight : oldLogTop;

    for (const form of dialogContent.querySelectorAll('form[data-form]')) {
      const snapshots = formSnapshots.get(formKey(form));
      if (!snapshots) continue;
      for (const snapshot of snapshots) {
        const controls = Array.from(form.elements).filter((control) => (
          control.name === snapshot.name && (control.type || control.tagName.toLowerCase()) === snapshot.type
        ));
        for (const control of controls) {
          if (snapshot.type === 'checkbox') control.checked = snapshot.checked;
          else if (snapshot.type === 'radio') control.checked = control.value === snapshot.value;
          else if (control.tagName === 'SELECT' && control.multiple && snapshot.selectedValues) {
            for (const option of control.options) option.selected = snapshot.selectedValues.includes(option.value);
          } else if (control.tagName === 'SELECT') {
            if (Array.from(control.options).some((option) => option.value === snapshot.value)) control.value = snapshot.value;
          } else if (!control.disabled) control.value = snapshot.value;
        }
      }
    }

    if (activeControlSnapshot) {
      const form = Array.from(dialogContent.querySelectorAll('form[data-form]'))
        .find((candidate) => formKey(candidate) === activeControlSnapshot.formKey);
      const newControl = form && Array.from(form.elements).find((control) => (
        control.name === activeControlSnapshot.name
        && (control.type || control.tagName.toLowerCase()) === activeControlSnapshot.type
        && !control.disabled
      ));
      if (newControl) {
        newControl.focus({ preventScroll: true });
        if (Number.isInteger(activeControlSnapshot.selectionStart)
          && Number.isInteger(activeControlSnapshot.selectionEnd)
          && typeof newControl.setSelectionRange === 'function') {
          newControl.setSelectionRange(activeControlSnapshot.selectionStart, activeControlSnapshot.selectionEnd);
        }
      }
    }
  }

  async function performUnoAction(roomId, action, body = {}) {
    const token = roomTokens[roomId];
    if (!token || unoActionInFlight) return;
    unoActionInFlight = true;
    selectedUnoCardId = '';
    let failed = false;
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/uno/${action}`, {
        method: 'POST',
        headers: { 'X-Player-Token': token },
        body,
      });
      updateRoomDialog(data.room);
      loadRooms();
      if (data.room.uno?.phase === 'finished') {
        loadLeaderboard();
        loadAccountSession();
      }
    } catch (error) {
      failed = true;
      showToast(error.message, 'error');
    } finally {
      unoActionInFlight = false;
    }
    if (failed) refreshOpenRoom();
  }

  async function performPuissance4Action(roomId, action, body = {}) {
    const token = roomTokens[roomId];
    if (!token || unoActionInFlight) return;
    unoActionInFlight = true;
    let failed = false;
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/puissance-4/${action}`, {
        method: 'POST',
        headers: { 'X-Player-Token': token },
        body,
      });
      updateRoomDialog(data.room);
      loadRooms();
      if (data.room.puissance4?.phase === 'finished') {
        loadLeaderboard();
        loadAccountSession();
      }
    } catch (error) {
      failed = true;
      showToast(error.message, 'error');
    } finally {
      unoActionInFlight = false;
    }
    if (failed) refreshOpenRoom();
  }

  async function performExtraGameAction(roomId, gameId, action, body = {}) {
    const token = roomTokens[roomId];
    if (!token || unoActionInFlight) return;
    unoActionInFlight = true;
    let failed = false;
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/${gameId}/${action}`, {
        method: 'POST',
        headers: { 'X-Player-Token': token },
        body,
      });
      updateRoomDialog(data.room);
      loadRooms();
      const state = ({
        'loup-garou': data.room.loupGarou,
        'blind-test': data.room.blindTest,
        quiz: data.room.quiz,
        morpion: data.room.morpion,
        memoire: data.room.memoire,
      })[gameId];
      if (state?.phase === 'finished') {
        loadLeaderboard();
        loadAccountSession();
      }
    } catch (error) {
      failed = true;
      showToast(error.message, 'error');
    } finally {
      unoActionInFlight = false;
    }
    if (failed) refreshOpenRoom();
  }

  async function sendChat(roomId, payload, form = null, channel = 'public') {
    const token = roomTokens[roomId];
    if (!token || chatActionInFlight) return;
    chatActionInFlight = true;
    if (form) {
      form.setAttribute('aria-busy', 'true');
      form.querySelector('[data-chat-input]')?.setAttribute('disabled', '');
      form.querySelector('[data-chat-submit]')?.setAttribute('disabled', '');
      showFormError(form, '');
    }
    dialogContent.querySelectorAll('[data-chat-reaction]').forEach((button) => { button.disabled = true; });
    try {
      const chatAction = channel === 'wolves' ? 'loup-garou/wolf-chat' : 'chat';
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/${chatAction}`, {
        method: 'POST',
        headers: { 'X-Player-Token': token },
        body: payload,
      });
      if (form) {
        const input = form.querySelector('[data-chat-input]');
        if (input) input.value = '';
      }
      if (dialog.open && dialog.dataset.roomId === roomId) updateRoomDialog(data.room);
      loadRooms();
    } catch (error) {
      if (form) showFormError(form, error.message);
      else showToast(error.message, 'error');
    } finally {
      chatActionInFlight = false;
      const candidateForm = dialogContent.querySelector('form[data-form="chat"], form[data-form="wolf-chat"]');
      const currentForm = candidateForm?.dataset.roomId === roomId ? candidateForm : null;
      currentForm?.setAttribute('aria-busy', 'false');
      const room = activeRoomSnapshot?.id === roomId ? activeRoomSnapshot : null;
      const ownWerewolfPlayer = room?.game === 'loup-garou' ? room.loupGarou?.players?.find((player) => player.isYou) : null;
      const isWolfPrivateChat = Boolean(room?.game === 'loup-garou' && room.loupGarou?.phase === 'night'
        && room.loupGarou?.myRole === 'wolf' && room.loupGarou?.isAlive);
      const chatLocked = Boolean(room?.game === 'loup-garou' && (
        (['night', 'hunter'].includes(room.loupGarou?.phase) && !isWolfPrivateChat)
        || (ownWerewolfPlayer && !ownWerewolfPlayer.isAlive && room.loupGarou?.phase !== 'finished')
      ));
      const input = currentForm?.querySelector('[data-chat-input]');
      if (input) input.disabled = chatLocked;
      const submit = currentForm?.querySelector('[data-chat-submit]');
      if (submit) submit.disabled = chatLocked;
      dialogContent.querySelectorAll('[data-chat-reaction]').forEach((button) => { button.disabled = chatLocked; });
    }
  }

  function submitChatForm(form) {
    const roomId = form.dataset.roomId;
    const message = String(new FormData(form).get('message') || '').trim();
    if (!message) {
      showFormError(form, 'Écris un message avant de l’envoyer.');
      return;
    }
    sendChat(roomId, { message }, form);
  }

  function submitWolfChatForm(form) {
    const roomId = form.dataset.roomId;
    const message = String(new FormData(form).get('message') || '').trim();
    if (!message) {
      showFormError(form, 'Écris un message à tes alliés.');
      return;
    }
    sendChat(roomId, { message }, form, 'wolves');
  }

  function submitCupidForm(form) {
    const values = new FormData(form);
    const firstTargetId = String(values.get('firstTargetId') || '');
    const secondTargetId = String(values.get('secondTargetId') || '');
    if (!firstTargetId || !secondTargetId || firstTargetId === secondTargetId) {
      showFormError(form, 'Choisis deux personnes différentes pour les unir.');
      return;
    }
    showFormError(form, '');
    performExtraGameAction(form.dataset.roomId, 'loup-garou', 'act', {
      action: 'cupid',
      firstTargetId,
      secondTargetId,
    });
  }

  function submitWitchForm(form) {
    const values = new FormData(form);
    showFormError(form, '');
    performExtraGameAction(form.dataset.roomId, 'loup-garou', 'act', {
      action: 'witch',
      save: values.get('save') === 'yes',
      poisonTargetId: String(values.get('poisonTargetId') || ''),
    });
  }

  function playBlindTestTheme(roomId) {
    const notes = activeRoomSnapshot?.id === roomId ? activeRoomSnapshot.blindTest?.question?.notes : null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!Array.isArray(notes) || !notes.length || !AudioContextClass) {
      showToast('La lecture audio n’est pas disponible dans ce navigateur.', 'error');
      return;
    }
    try {
      if (blindAudioContext && blindAudioContext.state !== 'closed') blindAudioContext.close();
      const context = new AudioContextClass();
      blindAudioContext = context;
      const startAt = context.currentTime + 0.06;
      notes.forEach((midiNote, index) => {
        const start = startAt + index * 0.27;
        const end = start + 0.23;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.value = 440 * (2 ** ((Number(midiNote) - 69) / 12));
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.02);
      });
      context.resume().catch(() => {});
      window.setTimeout(() => {
        if (blindAudioContext === context && context.state !== 'closed') {
          context.close().catch(() => {});
          blindAudioContext = null;
        }
      }, notes.length * 270 + 600);
    } catch {
      showToast('Impossible de lire le thème sonore pour le moment.', 'error');
    }
  }

  async function startUnoFromCard(roomId, cardId, color = '') {
    await performUnoAction(roomId, 'play', { cardId, color });
  }

  async function submitAddBots(form) {
    const roomId = form.dataset.roomId;
    const token = roomTokens[roomId];
    const count = Number(new FormData(form).get('count'));
    showFormError(form, '');
    setFormPending(form, true, 'Ajout…');
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/bots`, {
        method: 'POST',
        headers: { 'X-Player-Token': token },
        body: { count },
      });
      updateRoomDialog(data.room);
      showToast(`${data.addedCount} bot${data.addedCount === 1 ? '' : 's'} ajouté${data.addedCount === 1 ? '' : 's'} au salon.`, 'success');
      await loadRooms();
    } catch (error) {
      showFormError(form, error.message);
      setFormPending(form, false);
      showToast(error.message, 'error');
    }
  }

  async function removeBots(roomId) {
    const token = roomTokens[roomId];
    if (!token || !window.confirm('Retirer tous les bots de test de ce salon ?')) return;
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/bots`, {
        method: 'DELETE',
        headers: { 'X-Player-Token': token },
      });
      updateRoomDialog(data.room);
      showToast(`${data.removedCount} bot${data.removedCount === 1 ? '' : 's'} retiré${data.removedCount === 1 ? '' : 's'} du salon.`, 'success');
      await loadRooms();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function startRoom(roomId) {
    const token = roomTokens[roomId];
    if (!token || roomStartInFlight) return;
    roomStartInFlight = true;
    const button = dialogContent.querySelector('[data-start-room]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Lancement…';
    }
    let failed = false;
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}/start`, {
        method: 'POST',
        headers: { 'X-Player-Token': token },
        body: {},
      });
      updateRoomDialog(data.room);
      showToast('La partie est lancée !', 'success');
      await loadRooms();
    } catch (error) {
      failed = true;
      showToast(error.message, 'error');
    } finally {
      roomStartInFlight = false;
    }
    if (failed) refreshOpenRoom();
  }

  function soloVariants(gameId) {
    return SOLO_GAME_DETAILS[gameId]?.variants || [];
  }

  function soloSettings() {
    const settings = readPersistent(SOLO_SETTINGS_KEY, {});
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  }

  function soloVariantFor(gameId, variantId = '') {
    const variants = soloVariants(gameId);
    const stored = typeof soloSettings()[gameId] === 'string' ? soloSettings()[gameId] : '';
    return variants.find((variant) => variant.id === variantId)
      || variants.find((variant) => variant.id === stored)
      || variants.find((variant) => variant.default)
      || variants[0];
  }

  function rememberSoloVariant(gameId, variantId) {
    const settings = soloSettings();
    settings[gameId] = variantId;
    writePersistent(SOLO_SETTINGS_KEY, settings);
  }

  function soloRecords() {
    const records = readPersistent(SOLO_RECORDS_KEY, {});
    return records && typeof records === 'object' && !Array.isArray(records) ? records : {};
  }

  function soloRecordKey(gameId, variantId) {
    return variantId ? `${gameId}:${variantId}` : gameId;
  }

  function soloRecordFor(gameId, variantId) {
    return Number(soloRecords()[soloRecordKey(gameId, variantId)]) || 0;
  }

  function saveSoloRecord(gameId, variantId, value, lowerIsBetter = false) {
    const key = soloRecordKey(gameId, variantId);
    if (!Number.isFinite(value) || value <= 0) return Number(soloRecords()[key]) || 0;
    const records = soloRecords();
    const previous = Number(records[key]) || 0;
    const isBetter = !previous || (lowerIsBetter ? value < previous : value > previous);
    if (isBetter) {
      records[key] = value;
      writePersistent(SOLO_RECORDS_KEY, records);
      return value;
    }
    return previous;
  }

  function soloOptionRow() {
    if (!soloArcadeState) return '';
    const { gameId, variant } = soloArcadeState;
    const details = SOLO_GAME_DETAILS[gameId];
    const variants = soloVariants(gameId);
    if (!variants.length) return '';
    return `<div class="solo-option-row" role="group" aria-label="${escapeHtml(details.optionLabel)} du jeu">
      <span class="solo-option-label">${escapeHtml(details.optionLabel)}</span>
      <span class="solo-option-chips">${variants.map((option) => {
        const active = option.id === variant.id;
        return `<button class="solo-option-chip${active ? ' is-active' : ''}" type="button" data-solo-variant="${escapeHtml(option.id)}" data-solo-focus="variant-${escapeHtml(option.id)}" aria-pressed="${String(active)}" title="${escapeHtml(option.note)}"><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.note)}</small></button>`;
      }).join('')}</span>
    </div>`;
  }

  function formatSoloTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
  }

  function soloGameHeader(gameId, subtitle = '') {
    const details = SOLO_GAME_DETAILS[gameId];
    const isFullscreen = gameDialogIsFullscreen();
    const fullscreenLabel = isFullscreen ? 'Quitter le plein écran' : 'Mettre le jeu en grand';
    return `<header class="solo-arcade-header">
      <span class="solo-arcade-mark" aria-hidden="true">${details.icon}</span>
      <span class="solo-arcade-heading"><small>JEU SOLO · SANS COMPTE</small><h2 id="dialog-title">${details.name}</h2><p>${subtitle || details.subtitle}</p></span>
      <span class="solo-arcade-controls">
        <button class="solo-icon-button" type="button" data-fullscreen-toggle data-solo-focus="fullscreen" aria-label="${fullscreenLabel}" title="${fullscreenLabel}" aria-pressed="${String(isFullscreen)}"><span aria-hidden="true">${isFullscreen ? '⤢' : '⛶'}</span><span class="visually-hidden">${fullscreenLabel}</span></button>
        <button class="solo-restart-button" type="button" data-solo-restart data-solo-focus="restart" aria-label="Recommencer ${details.name}" title="Nouvelle partie"><span aria-hidden="true">↻</span><span>Recommencer</span></button>
      </span>
    </header>`;
  }

  function soloScorePill(label, value, key = '') {
    const marker = key ? ` data-solo-pill="${key}"` : '';
    return `<div class="solo-score-pill"><small>${label}</small><strong${marker}>${value}</strong></div>`;
  }

  // Les colonnes sont écrites en clair (repeat(24, ...)) : certains navigateurs
  // ignorent une variable CSS dans repeat(), ce qui décalait les rangées et
  // faisait apparaître le serpent en diagonale sur les grandes grilles.
  function soloBoardStyle(columns, { gap, fontMin, fontScale, fontMax, width }) {
    const parts = [
      `--grid-size:${columns}`,
      `grid-template-columns:repeat(${columns}, minmax(0, 1fr))`,
      `gap:${gap}px`,
      `font-size:clamp(${fontMin}px, ${(fontScale / columns).toFixed(2)}vmin, ${fontMax}px)`,
    ];
    if (width) parts.push(`width:min(100%, ${width}px)`);
    return parts.join(';');
  }

  function snakeMarkup(state) {
    // Le plateau est dessiné sur un canvas : aucune grille CSS, donc aucune
    // rangée ne peut se décaler (c'était la cause du serpent "en diagonale").
    const pixels = Math.min(720, Math.max(360, state.size * 22));
    const overlay = state.status === 'lost'
      ? `<div class="solo-board-overlay"><strong>Fin de partie</strong><span>${state.cause === 'mur' ? 'Ton serpent a heurté le mur.' : 'Ton serpent s’est mordu la queue.'} Score : ${state.score}.</span><button class="button button-primary" type="button" data-solo-restart data-solo-focus="restart">Rejouer</button></div>`
      : (state.status === 'won'
        ? '<div class="solo-board-overlay"><strong>Incroyable !</strong><span>Tu as rempli toute la grille.</span><button class="button button-primary" type="button" data-solo-restart data-solo-focus="restart">Rejouer</button></div>'
        : (state.status === 'ready'
          ? '<div class="solo-board-overlay is-ready"><strong>Prêt ?</strong><span>Flèches, ZQSD, boutons ci-dessous ou glisse ton doigt sur le plateau pour démarrer.</span></div>'
          : (state.paused ? '<div class="solo-board-overlay"><strong>Pause</strong><span>Appuie sur Reprendre ou sur Espace.</span></div>' : '')));
    const directions = [
      ['up', '↑', 'haut', 'snake-up'], ['left', '←', 'gauche', 'snake-left'],
      ['down', '↓', 'bas', 'snake-down'], ['right', '→', 'droite', 'snake-right'],
    ];
    const pad = (list) => list.map(([direction, symbol, label, focus]) => (
      `<button type="button" class="solo-direction-button" data-solo-direction="${direction}" data-solo-focus="${focus}" aria-label="Aller vers le ${label}">${symbol}</button>`
    )).join('');
    return `<div class="solo-arcade-view snake-view">
      ${soloGameHeader('snake', 'Mange les pommes et évite les murs comme ta propre queue.')}
      ${soloOptionRow()}
      <div class="solo-score-strip">${soloScorePill('SCORE', state.score, 'score')}${soloScorePill('RECORD', state.best, 'record')}${soloScorePill('LONGUEUR', state.snake.length, 'length')}${soloScorePill('VITESSE', soloArcadeState?.variant.label || '—')}</div>
      <div class="snake-board-wrap" style="width:min(100%, ${Math.min(540, 380 + Math.max(0, state.size - 18) * 11)}px)">
        <canvas class="snake-canvas" data-snake-canvas="${state.size}" width="${pixels}" height="${pixels}" role="img" aria-label="Serpent de ${state.snake.length} segments, score ${state.score}"></canvas>
        ${overlay}
      </div>
      <div class="snake-controls" role="group" aria-label="Commandes du serpent"><span class="snake-control-spacer"></span>${pad(directions.slice(0, 1))}<span class="snake-control-spacer"></span>${pad(directions.slice(1))}<button type="button" class="solo-pause-button" data-solo-pause data-solo-focus="snake-pause"${state.status === 'ready' ? ' disabled' : ''}>${state.paused ? 'Reprendre' : 'Pause'}</button></div>
      <p class="solo-game-help">Flèches ou ZQSD au clavier, boutons au doigt, ou glisse sur le plateau. Espace met en pause.</p>
      <div class="solo-game-footer"><span>Record sauvegardé sur cet appareil.</span><button type="button" class="button button-muted" data-dialog-close>Quitter le jeu</button></div>
    </div>`;
  }

  function board2048Markup(state) {
    const tiles = state.board.map((value) => `<div class="solo-2048-tile tile-${value || 0}" role="gridcell" aria-label="${value ? `Tuile ${value}` : 'Case vide'}">${value || ''}</div>`).join('');
    const status = state.status === 'won'
      ? `<div class="solo-game-notice is-success" role="status"><strong>${state.target} trouvé !</strong><span>Bravo ! Tu peux continuer ou recommencer.</span><button class="button button-primary" type="button" data-solo-continue data-solo-focus="continue">Continuer</button></div>`
      : (state.status === 'lost' ? '<div class="solo-game-notice" role="status"><strong>Plus de mouvements.</strong><span>Recommence pour tenter un meilleur score.</span></div>' : '');
    const directions = [
      ['up', '↑', 'Haut'], ['left', '←', 'Gauche'], ['down', '↓', 'Bas'], ['right', '→', 'Droite'],
    ];
    return `<div class="solo-arcade-view game-2048-view">
      ${soloGameHeader('2048', `Fais glisser les cases : deux mêmes nombres fusionnent. Atteins ${state.target} !`)}
      ${soloOptionRow()}
      <div class="solo-score-strip">${soloScorePill('SCORE', state.score)}${soloScorePill('RECORD', state.best)}${soloScorePill('OBJECTIF', state.target)}</div>
      ${status}
      <div class="solo-2048-board" style="${soloBoardStyle(state.size, { gap: state.size >= 6 ? 5 : (state.size >= 5 ? 6 : 8), fontMin: 11, fontScale: 23, fontMax: 31, width: state.size >= 5 ? 430 : 390 })}" role="grid" aria-label="Plateau 2048, ${state.size} cases par côté">${tiles}</div>
      <div class="solo-2048-controls" role="group" aria-label="Déplacer les tuiles">${directions.map(([direction, symbol, label]) => `<button class="solo-direction-button" type="button" data-solo-2048-move="${direction}" data-solo-focus="2048-${direction}" aria-label="Glisser vers ${label.toLocaleLowerCase('fr-FR')}">${symbol}</button>`).join('')}</div>
      <p class="solo-game-help">Flèches du clavier ou boutons. Une nouvelle tuile apparaît après chaque déplacement.</p>
      <div class="solo-game-footer"><span>Record sauvegardé sur cet appareil.</span><button type="button" class="button button-muted" data-dialog-close>Quitter le jeu</button></div>
    </div>`;
  }

  function minesweeperMarkup(state) {
    const cells = state.grid.map((cell, index) => {
      const row = Math.floor(index / state.columns);
      const column = index % state.columns;
      const isVisible = cell.revealed;
      const symbol = cell.flagged ? '🚩' : (isVisible && cell.mine ? '💣' : (isVisible && cell.adjacent ? String(cell.adjacent) : ''));
      const numberClass = isVisible && cell.adjacent ? ` number-${cell.adjacent}` : '';
      const classes = `minesweeper-cell${isVisible ? ' is-revealed' : ''}${cell.flagged ? ' is-flagged' : ''}${isVisible && cell.mine ? ' is-mine' : ''}${numberClass}`;
      const description = cell.flagged ? `Ligne ${row + 1}, colonne ${column + 1}, drapeau`
        : (isVisible ? (cell.mine ? 'Mine révélée' : `Case révélée${cell.adjacent ? `, ${cell.adjacent} mines voisines` : ', zone vide'}`)
          : `Ligne ${row + 1}, colonne ${column + 1}, cachée`);
      return `<button class="${classes}" type="button" data-mines-row="${row}" data-mines-column="${column}" aria-label="${description}"${cell.revealed ? ' disabled' : ''}>${symbol}</button>`;
    }).join('');
    const status = state.status === 'won'
      ? '<div class="solo-game-notice is-success" role="status"><strong>Terrain sécurisé !</strong><span>Tu as trouvé toutes les cases sans mine.</span></div>'
      : (state.status === 'lost' ? '<div class="solo-game-notice" role="status"><strong>Oups, une mine !</strong><span>Tu peux recommencer et tenter une autre stratégie.</span></div>' : '');
    return `<div class="solo-arcade-view minesweeper-view">
      ${soloGameHeader('demineur', 'Clic : révéler · bouton Drapeau ou clic droit : marquer une mine.')}
      ${soloOptionRow()}
      <div class="solo-score-strip">${soloScorePill('MINES', state.mineCount)}${soloScorePill('DRAPEAUX', state.flagsRemaining)}${soloScorePill('TEMPS', formatSoloTime(state.elapsedSeconds))}</div>
      ${status}
      <button class="solo-flag-mode${state.flagMode ? ' is-active' : ''}" type="button" data-mines-flag-mode data-solo-focus="flag-mode" aria-pressed="${String(state.flagMode)}">🚩 ${state.flagMode ? 'Mode drapeau activé' : 'Activer le mode drapeau'}</button>
      <div class="minesweeper-board" style="${soloBoardStyle(state.columns, { gap: state.columns >= 16 ? 1 : (state.columns >= 12 ? 2 : 3), fontMin: 6, fontScale: 26, fontMax: 15, width: Math.min(560, 400 + Math.max(0, state.columns - 9) * 14) })}" role="grid" aria-label="Démineur, ${state.rows} rangées et ${state.columns} colonnes">${cells}</div>
      <p class="solo-game-help">Le premier clic est toujours sans danger. Les chiffres indiquent les mines voisines.</p>
      <div class="solo-game-footer"><span>Meilleur temps : ${state.best ? formatSoloTime(state.best) : '—'}</span><button type="button" class="button button-muted" data-dialog-close>Quitter le jeu</button></div>
    </div>`;
  }

  function memorySoloMarkup(state) {
    const cards = state.cards.map((card, index) => {
      const visible = card.revealed || card.matched;
      const classes = `solo-memory-card${visible ? ' is-revealed' : ''}${card.matched ? ' is-matched' : ''}`;
      const label = card.matched ? `Paire trouvée : ${card.symbol}` : (card.revealed ? `Carte révélée : ${card.symbol}` : `Carte cachée ${index + 1}`);
      return `<button type="button" class="${classes}" data-memory-card="${card.id}" aria-label="${label}"${card.matched || card.revealed || state.locked ? ' disabled' : ''}><span class="memory-card-back" aria-hidden="true">✦</span><span class="memory-card-face" aria-hidden="true">${visible ? card.symbol : ''}</span></button>`;
    }).join('');
    const status = state.status === 'won'
      ? `<div class="solo-game-notice is-success" role="status"><strong>Toutes les paires trouvées !</strong><span>${state.moves} coups · ${formatSoloTime(state.elapsedSeconds)}.</span></div>`
      : (state.locked ? '<div class="solo-game-notice" role="status"><strong>Deux cartes différentes.</strong><span>Mémorise-les, elles vont se retourner.</span></div>' : '');
    const columns = soloArcadeState?.variant.columns || 4;
    return `<div class="solo-arcade-view solo-memory-view">
      ${soloGameHeader('memory', `Retourne deux cartes à la fois et retrouve les ${state.pairCount} paires.`)}
      ${soloOptionRow()}
      <div class="solo-score-strip">${soloScorePill('COUPS', state.moves)}${soloScorePill('PAIRES', `${state.matches} / ${state.pairCount}`)}${soloScorePill('TEMPS', formatSoloTime(state.elapsedSeconds))}</div>
      ${status}
      <div class="solo-memory-board" style="${soloBoardStyle(columns, { gap: columns >= 6 ? 6 : 9, fontMin: 15, fontScale: 30, fontMax: 35, width: columns >= 6 ? 470 : 440 })}" role="group" aria-label="${state.cards.length} cartes Memory solo">${cards}</div>
      <p class="solo-game-help">Les cartes restent cachées jusqu’à ce que tu les retournes. Change la taille quand tu veux : la partie recommence.</p>
      <div class="solo-game-footer"><span>Meilleur score : ${state.best ? `${state.best} coups` : '—'}</span><button type="button" class="button button-muted" data-dialog-close>Quitter le jeu</button></div>
    </div>`;
  }

  function soloGameDialog() {
    if (!soloArcadeState) return '<div class="error-state"><strong>Choisis un jeu solo pour commencer.</strong></div>';
    if (soloArcadeState.gameId === 'snake') return snakeMarkup(soloArcadeState.game);
    if (soloArcadeState.gameId === '2048') return board2048Markup(soloArcadeState.game);
    if (soloArcadeState.gameId === 'demineur') return minesweeperMarkup(soloArcadeState.game);
    if (soloArcadeState.gameId === 'memory') return memorySoloMarkup(soloArcadeState.game);
    return '<div class="error-state"><strong>Ce jeu solo n’est pas disponible.</strong></div>';
  }

  function renderSoloGame() {
    if (!soloArcadeState || dialog.dataset.view !== 'solo-game') return;
    const scrollTop = dialogContent.scrollTop;
    const focusedControl = document.activeElement?.closest?.('[data-solo-focus]');
    const focusKey = focusedControl?.dataset.soloFocus || '';
    dialogContent.innerHTML = soloGameDialog();
    dialogContent.scrollTop = scrollTop;
    if (soloArcadeState.gameId === 'snake') drawSnakeBoard(soloArcadeState.game);
    if (focusKey) {
      const replacement = Array.from(dialogContent.querySelectorAll('[data-solo-focus]'))
        .find((element) => element.dataset.soloFocus === focusKey && !element.disabled);
      replacement?.focus({ preventScroll: true });
    }
  }

  const SNAKE_COLORS = {
    board: '#edf5e6',
    grid: '#e2eed8',
    body: '#54b06f',
    bodyDark: '#3f9159',
    head: '#2f7d4a',
    eye: '#ffffff',
    pupil: '#1d3c28',
    food: '#e4584f',
    foodLeaf: '#5aa35f',
  };

  function roundedRect(context, x, y, width, height, radius) {
    const limit = Math.max(0, Math.min(radius, width / 2, height / 2));
    context.beginPath();
    context.moveTo(x + limit, y);
    context.lineTo(x + width - limit, y);
    context.quadraticCurveTo(x + width, y, x + width, y + limit);
    context.lineTo(x + width, y + height - limit);
    context.quadraticCurveTo(x + width, y + height, x + width - limit, y + height);
    context.lineTo(x + limit, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - limit);
    context.lineTo(x, y + limit);
    context.quadraticCurveTo(x, y, x + limit, y);
    context.closePath();
    context.fill();
  }

  // Dessin complet du plateau : une seule opération canvas par pas de jeu,
  // donc aucun ralentissement même en Turbo sur une grande grille.
  function drawSnakeBoard(state) {
    const canvas = dialogContent.querySelector('[data-snake-canvas]');
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    const pixels = canvas.width;
    const cell = pixels / state.size;
    context.clearRect(0, 0, pixels, pixels);
    context.fillStyle = SNAKE_COLORS.board;
    context.fillRect(0, 0, pixels, pixels);

    context.fillStyle = SNAKE_COLORS.grid;
    for (let y = 0; y < state.size; y += 1) {
      for (let x = 0; x < state.size; x += 1) {
        if ((x + y) % 2 === 0) context.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    if (state.food) {
      const centerX = (state.food.x + 0.5) * cell;
      const centerY = (state.food.y + 0.54) * cell;
      const radius = cell * 0.34;
      context.fillStyle = SNAKE_COLORS.food;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = SNAKE_COLORS.foodLeaf;
      context.beginPath();
      context.ellipse(centerX + radius * 0.45, centerY - radius * 0.95, radius * 0.42, radius * 0.22, -0.6, 0, Math.PI * 2);
      context.fill();
    }

    const inset = Math.max(0.5, cell * 0.07);
    const radius = Math.max(1, cell * 0.3);
    for (let index = state.snake.length - 1; index >= 1; index -= 1) {
      const part = state.snake[index];
      context.fillStyle = index % 2 === 0 ? SNAKE_COLORS.body : SNAKE_COLORS.bodyDark;
      roundedRect(context, (part.x * cell) + inset, (part.y * cell) + inset, cell - (inset * 2), cell - (inset * 2), radius);
    }

    const head = state.snake[0];
    context.fillStyle = SNAKE_COLORS.head;
    roundedRect(context, (head.x * cell) + inset, (head.y * cell) + inset, cell - (inset * 2), cell - (inset * 2), radius * 1.2);
    if (cell >= 9) {
      const direction = state.direction || { x: 1, y: 0 };
      const eyeOffset = cell * 0.22;
      const eyeRadius = Math.max(1, cell * 0.11);
      const centerX = (head.x + 0.5) * cell;
      const centerY = (head.y + 0.5) * cell;
      const sideX = direction.x === 0 ? eyeOffset : 0;
      const sideY = direction.y === 0 ? eyeOffset : 0;
      const frontX = direction.x * eyeOffset * 0.55;
      const frontY = direction.y * eyeOffset * 0.55;
      [[-1, 1], [1, -1]].forEach(([signX, signY]) => {
        const eyeX = centerX + frontX + (sideX * signX) + (sideY === 0 ? 0 : 0);
        const eyeY = centerY + frontY + (sideY * signY);
        context.fillStyle = SNAKE_COLORS.eye;
        context.beginPath();
        context.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = SNAKE_COLORS.pupil;
        context.beginPath();
        context.arc(eyeX + (direction.x * eyeRadius * 0.35), eyeY + (direction.y * eyeRadius * 0.35), eyeRadius * 0.52, 0, Math.PI * 2);
        context.fill();
      });
    }

    canvas.setAttribute('aria-label', `Serpent de ${state.snake.length} segments, score ${state.score}`);
    return true;
  }

  // Mise à jour légère pendant la partie : on redessine le canvas et on
  // rafraîchit seulement les compteurs, sans reconstruire la fenêtre.
  function paintSnakeFrame(state) {
    const canvas = dialogContent.querySelector('[data-snake-canvas]');
    if (!canvas || Number(canvas.dataset.snakeCanvas) !== state.size) return false;
    if (!drawSnakeBoard(state)) return false;
    const pills = { score: state.score, record: state.best, length: state.snake.length };
    Object.entries(pills).forEach(([key, value]) => {
      const target = dialogContent.querySelector(`[data-solo-pill="${key}"]`);
      if (target && target.textContent !== String(value)) target.textContent = String(value);
    });
    return true;
  }

  function stopSoloTicker() {
    if (soloTickerId) window.clearInterval(soloTickerId);
    soloTickerId = 0;
  }

  function stopSoloPlay() {
    stopSoloTicker();
    if (soloMemoryTimeoutId) window.clearTimeout(soloMemoryTimeoutId);
    soloMemoryTimeoutId = 0;
    soloArcadeState = null;
    soloStartInFlight = false;
  }

  function updateSoloElapsedTime() {
    const state = soloArcadeState?.game;
    if (!state || !state.startedAt) return;
    state.elapsedSeconds = Math.max(0, Math.floor((Date.now() - state.startedAt) / 1000));
  }

  function finishSoloGame() {
    if (!soloArcadeState) return;
    const { gameId, variant, game } = soloArcadeState;
    updateSoloElapsedTime();
    if (gameId === 'demineur' && game.status === 'won') {
      game.best = saveSoloRecord(gameId, variant.id, game.elapsedSeconds, true);
    } else if (gameId === 'memory' && game.status === 'won') {
      game.best = saveSoloRecord(gameId, variant.id, game.moves, true);
    }
    stopSoloTicker();
    renderSoloGame();
  }

  function snakeInterval() {
    const { variant, game } = soloArcadeState;
    const base = Number(variant.interval) || 150;
    const step = Number(variant.step) || 3;
    const minimum = Number(variant.minimum) || 70;
    return Math.max(minimum, base - (game.score * step));
  }

  function startSoloTicker() {
    stopSoloTicker();
    if (!soloArcadeState) return;
    if (soloArcadeState.gameId === 'snake') {
      soloTickerId = window.setInterval(() => {
        const state = soloArcadeState;
        if (!state?.game) return stopSoloTicker();
        const { game } = state;
        // En attente de la première commande ou en pause : rien ne bouge.
        if (game.status === 'ready' || game.paused) return;
        const result = window.SoloGames.stepSnake(game);
        if (result.ate) game.best = saveSoloRecord('snake', state.variant.id, game.score);
        if (game.status !== 'playing') return finishSoloGame();
        if (result.ate) startSoloTicker();
        if (!paintSnakeFrame(game)) renderSoloGame();
      }, snakeInterval());
      return;
    }
    if (['demineur', 'memory'].includes(soloArcadeState.gameId)) {
      soloTickerId = window.setInterval(() => {
        if (!soloArcadeState) return stopSoloTicker();
        updateSoloElapsedTime();
        if (soloArcadeState.game.status !== 'playing') return finishSoloGame();
        if (soloArcadeState.game.startedAt) renderSoloGame();
      }, 1000);
    }
  }

  // Un seul point d'entrée pour le clavier, les boutons et le glissement du doigt.
  function steerSnake(direction) {
    if (soloArcadeState?.gameId !== 'snake') return false;
    const { game } = soloArcadeState;
    const wasReady = game.status === 'ready';
    if (game.paused) game.paused = false;
    const changed = window.SoloGames.setSnakeDirection(game, direction);
    if (wasReady && game.status === 'playing') renderSoloGame();
    else if (changed) paintSnakeFrame(game);
    return changed;
  }

  function handleSnakeSwipe(startPoint, endPoint) {
    const deltaX = endPoint.x - startPoint.x;
    const deltaY = endPoint.y - startPoint.y;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 24) return false;
    if (Math.abs(deltaX) >= Math.abs(deltaY)) return steerSnake(deltaX > 0 ? 'right' : 'left');
    return steerSnake(deltaY > 0 ? 'down' : 'up');
  }

  function toggleSoloSnakePause() {
    if (soloArcadeState?.gameId !== 'snake' || soloArcadeState.game.status !== 'playing') return;
    soloArcadeState.game.paused = !soloArcadeState.game.paused;
    renderSoloGame();
  }

  function play2048Move(direction) {
    if (soloArcadeState?.gameId !== '2048') return;
    const result = window.SoloGames.move2048(soloArcadeState.game, direction);
    if (!result.changed) return;
    soloArcadeState.game.best = saveSoloRecord('2048', soloArcadeState.variant.id, soloArcadeState.game.score);
    if (soloArcadeState.game.status !== 'playing') stopSoloTicker();
    renderSoloGame();
  }

  function playMinesweeperCell(row, column) {
    if (soloArcadeState?.gameId !== 'demineur') return;
    const { game } = soloArcadeState;
    if (game.flagMode) {
      if (window.SoloGames.toggleMinesweeperFlag(game, row, column)) renderSoloGame();
      return;
    }
    const result = window.SoloGames.revealMinesweeper(game, row, column);
    if (!result.changed) return;
    if (game.status !== 'playing') finishSoloGame();
    else renderSoloGame();
  }

  function flipSoloMemoryCard(cardId) {
    if (soloArcadeState?.gameId !== 'memory') return;
    const result = window.SoloGames.revealMemory(soloArcadeState.game, cardId);
    if (!result.changed) return;
    if (result.mismatch) {
      if (soloMemoryTimeoutId) window.clearTimeout(soloMemoryTimeoutId);
      soloMemoryTimeoutId = window.setTimeout(() => {
        soloMemoryTimeoutId = 0;
        if (!soloArcadeState || soloArcadeState.gameId !== 'memory') return;
        window.SoloGames.hideMemoryMismatch(soloArcadeState.game);
        renderSoloGame();
      }, 850);
    }
    if (soloArcadeState.game.status === 'won') finishSoloGame();
    else renderSoloGame();
  }

  function soloHandleClick(event) {
    const restartButton = event.target.closest('[data-solo-restart]');
    if (restartButton && soloArcadeState) {
      startSoloGame(soloArcadeState.gameId, { variantId: soloArcadeState.variant.id, keepDialog: true });
      return true;
    }
    const variantButton = event.target.closest('[data-solo-variant]');
    if (variantButton && soloArcadeState) {
      startSoloGame(soloArcadeState.gameId, { variantId: variantButton.dataset.soloVariant, keepDialog: true });
      return true;
    }
    const snakeDirection = event.target.closest('[data-solo-direction]');
    if (snakeDirection && soloArcadeState?.gameId === 'snake') {
      steerSnake(snakeDirection.dataset.soloDirection);
      return true;
    }
    if (event.target.closest('[data-solo-pause]')) {
      toggleSoloSnakePause();
      return true;
    }
    const moveButton = event.target.closest('[data-solo-2048-move]');
    if (moveButton) {
      play2048Move(moveButton.dataset.solo2048Move);
      return true;
    }
    if (event.target.closest('[data-solo-continue]') && soloArcadeState?.gameId === '2048') {
      soloArcadeState.game.continuedAfterWin = true;
      soloArcadeState.game.status = window.SoloGames.canMove2048(soloArcadeState.game) ? 'playing' : 'lost';
      renderSoloGame();
      return true;
    }
    const flagModeButton = event.target.closest('[data-mines-flag-mode]');
    if (flagModeButton && soloArcadeState?.gameId === 'demineur') {
      soloArcadeState.game.flagMode = !soloArcadeState.game.flagMode;
      renderSoloGame();
      return true;
    }
    const mineCell = event.target.closest('[data-mines-row]');
    if (mineCell) {
      playMinesweeperCell(Number(mineCell.dataset.minesRow), Number(mineCell.dataset.minesColumn));
      return true;
    }
    const memoryCard = event.target.closest('[data-memory-card]');
    if (memoryCard) {
      flipSoloMemoryCard(memoryCard.dataset.memoryCard);
      return true;
    }
    return false;
  }

  function soloHandleKeydown(event) {
    if (dialog.dataset.view !== 'solo-game' || !soloArcadeState) return;
    const typingTarget = event.target?.closest?.('input, textarea, select, [contenteditable="true"]');
    if (typingTarget) return;
    const key = String(event.key || '').toLowerCase();
    if (soloArcadeState.gameId === 'snake') {
      const directions = {
        arrowup: 'up', w: 'up', z: 'up',
        arrowdown: 'down', s: 'down',
        arrowleft: 'left', a: 'left', q: 'left',
        arrowright: 'right', d: 'right',
      };
      if (directions[key]) {
        event.preventDefault();
        steerSnake(directions[key]);
      } else if (key === ' ' || key === 'spacebar' || key === 'p') {
        event.preventDefault();
        toggleSoloSnakePause();
      } else if ((key === 'enter' || key === 'r') && soloArcadeState.game.status !== 'playing') {
        event.preventDefault();
        startSoloGame('snake', { variantId: soloArcadeState.variant.id, keepDialog: true });
      }
      return;
    }
    if (soloArcadeState.gameId === '2048') {
      const directions = { arrowup: 'up', w: 'up', z: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', q: 'left', arrowright: 'right', d: 'right' };
      if (directions[key]) {
        event.preventDefault();
        play2048Move(directions[key]);
      }
    } else if (soloArcadeState.gameId === 'demineur' && key === 'f') {
      soloArcadeState.game.flagMode = !soloArcadeState.game.flagMode;
      renderSoloGame();
    }
  }

  function createSoloGameState(gameId, variant) {
    if (gameId === 'snake') return window.SoloGames.createSnake({ size: variant.size });
    if (gameId === '2048') return window.SoloGames.create2048({ size: variant.size, target: variant.target });
    if (gameId === 'demineur') {
      return window.SoloGames.createMinesweeper({ rows: variant.rows, columns: variant.columns, mineCount: variant.mines });
    }
    return window.SoloGames.createMemory({ pairs: variant.pairs });
  }

  function startSoloGame(gameId, { variantId = '', triggerButton = null, keepDialog = false } = {}) {
    if (soloStartInFlight || !Object.hasOwn(SOLO_GAME_DETAILS, gameId) || !window.SoloGames) return;
    soloStartInFlight = true;
    if (triggerButton) triggerButton.disabled = true;
    const variant = soloVariantFor(gameId, variantId);
    stopSoloPlay();
    rememberSoloVariant(gameId, variant.id);
    soloArcadeState = { gameId, variant, game: createSoloGameState(gameId, variant) };
    soloArcadeState.game.best = soloRecordFor(gameId, variant.id);
    if (keepDialog && dialog.dataset.view === 'solo-game') renderSoloGame();
    else openDialog('solo-game', soloGameDialog());
    startSoloTicker();
    mobileNav.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
    soloStartInFlight = false;
    if (triggerButton?.isConnected) triggerButton.disabled = false;
  }

  async function heartbeatSessions() {
    const sessions = Object.entries(roomTokens);
    if (!sessions.length) return;
    await Promise.all(sessions.map(async ([roomId, token]) => {
      try {
        await api(`/api/rooms/${encodeURIComponent(roomId)}/heartbeat`, {
          method: 'POST',
          headers: { 'X-Player-Token': token },
        });
      } catch (error) {
        if (error.status === 401 || error.status === 404) {
          forgetRoomToken(roomId);
          if (dialog.open && dialog.dataset.view === 'room' && dialog.dataset.roomId === roomId) {
            closeDialog();
            showToast('Ta présence dans ce salon a expiré. Tu peux le rejoindre à nouveau.', 'error');
          }
        }
      }
    }));
  }

  async function refreshOpenRoom() {
    if (!dialog.open || dialog.dataset.view !== 'room' || unoActionInFlight || chatActionInFlight || roomStartInFlight || selectedUnoCardId) return;
    if (dialogContent.querySelector('form[aria-busy="true"]:not([data-form="chat"])')) return;
    const activeElement = document.activeElement;
    if (activeElement && dialogContent.contains(activeElement) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(activeElement.tagName) && !activeElement.matches('[data-chat-input]')) return;
    const roomId = dialog.dataset.roomId;
    const token = roomTokens[roomId];
    if (!roomId || !token) return;
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(roomId)}`, {
        headers: { 'X-Player-Token': token },
      });
      if (!data.room.isCurrentPlayer) {
        forgetRoomToken(roomId);
        joinRoomDialog(data.room);
        return;
      }
      updateRoomDialog(data.room);
    } catch (error) {
      if (error.status === 404 || error.status === 401) {
        forgetRoomToken(roomId);
        closeDialog();
        showToast(error.message, 'error');
        loadRooms();
      }
    }
  }

  function setGamePlayerBounds(gameId) {
    const game = gameFor(gameId);
    const input = document.querySelector('#max-players');
    const note = document.querySelector('#player-range-note');
    if (!input || !note) return;
    const currentValue = Number.parseInt(input.value, 10) || game.defaultPlayers || game.minPlayers;
    input.min = String(game.minPlayers);
    input.max = String(game.maxPlayers);
    input.value = String(Math.min(game.maxPlayers, Math.max(game.minPlayers, currentValue)));
    note.textContent = game.minPlayers === game.maxPlayers
      ? `${game.minPlayers} joueurs pour ${game.name}.`
      : `De ${game.minPlayers} à ${game.maxPlayers} joueurs pour ${game.name}.`;
  }

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-dialog-close]');
    if (closeButton) {
      requestDialogClose();
      return;
    }

    if (soloHandleClick(event)) return;

    const fullscreenButton = event.target.closest('[data-fullscreen-toggle]');
    if (fullscreenButton) {
      toggleGameFullscreen();
      return;
    }

    const cheatOpenButton = event.target.closest('[data-cheat-open]');
    if (cheatOpenButton) {
      openCheatPanel(cheatOpenButton.dataset.cheatOpen);
      return;
    }

    if (event.target.closest('[data-cheat-back]')) {
      openRoom(dialog.dataset.roomId);
      return;
    }

    const cheatRefreshButton = event.target.closest('[data-cheat-refresh]');
    if (cheatRefreshButton) {
      if (!cheatActionInFlight) openCheatPanel(dialog.dataset.roomId);
      return;
    }

    const cheatModeButton = event.target.closest('[data-cheat-mode]');
    if (cheatModeButton) {
      if (cheatActionInFlight || cheatModeButton.disabled) return;
      cheatActionMode = cheatModeButton.dataset.cheatMode === 'give-card' ? 'give-card' : 'force-next-draw';
      const modeIsGive = cheatActionMode === 'give-card';
      dialogContent.querySelectorAll('[data-cheat-mode]').forEach((button) => {
        const active = button.dataset.cheatMode === cheatActionMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      dialogContent.querySelector('[data-cheat-recipient]')?.classList.toggle('is-hidden', !modeIsGive);
      const hint = dialogContent.querySelector('[data-cheat-mode-hint]');
      if (hint) hint.textContent = modeIsGive
        ? 'Choisis le joueur, puis touche une carte pour la lui ajouter.'
        : 'Touche une carte : le prochain joueur qui pioche la recevra.';
      dialogContent.querySelectorAll('[data-cheat-deck-card]').forEach((button) => {
        const actionLabel = modeIsGive ? 'Donner' : 'Forcer la prochaine pioche';
        const cardLabel = button.dataset.cardLabel || 'cette carte';
        const count = Number(button.dataset.cardCount) || 1;
        const countLabel = count > 1 ? `, ${count} disponibles` : '';
        button.setAttribute('aria-label', `${actionLabel} : ${cardLabel}${countLabel}`);
        button.title = `${actionLabel} : ${cardLabel}`;
        const actionCaption = button.querySelector('.cheat-deck-card-action');
        if (actionCaption) actionCaption.textContent = modeIsGive ? 'Donner' : 'Forcer';
      });
      return;
    }

    const cheatDeckCard = event.target.closest('[data-cheat-deck-card]');
    if (cheatDeckCard && !cheatDeckCard.disabled) {
      if (cheatActionInFlight) return;
      const targetPlayerId = dialogContent.querySelector('#cheat-card-recipient')?.value || '';
      performCheatAction(dialog.dataset.roomId, cheatActionMode, cheatDeckCard.dataset.cheatDeckCard, targetPlayerId);
      return;
    }

    const unoColorButton = event.target.closest('[data-uno-color]');
    if (unoColorButton) {
      startUnoFromCard(unoColorButton.dataset.roomId, unoColorButton.dataset.unoCardId, unoColorButton.dataset.unoColor);
      return;
    }

    const unoCardButton = event.target.closest('[data-uno-card]');
    if (unoCardButton && !unoCardButton.disabled) {
      const cardId = unoCardButton.dataset.unoCard;
      if (unoCardButton.dataset.cardType === 'wild' || unoCardButton.dataset.cardType === 'wild4') {
        selectedUnoCardId = cardId;
        if (activeRoomSnapshot) updateRoomDialog(activeRoomSnapshot);
      } else {
        startUnoFromCard(unoCardButton.dataset.roomId, cardId);
      }
      return;
    }

    const unoDrawButton = event.target.closest('[data-uno-draw]');
    if (unoDrawButton && !unoDrawButton.disabled) {
      performUnoAction(unoDrawButton.dataset.unoDraw, 'draw');
      return;
    }

    const unoPassButton = event.target.closest('[data-uno-pass]');
    if (unoPassButton) {
      performUnoAction(unoPassButton.dataset.unoPass, 'pass');
      return;
    }

    const chatReactionButton = event.target.closest('[data-chat-reaction]');
    if (chatReactionButton && !chatReactionButton.disabled) {
      sendChat(chatReactionButton.dataset.roomId, { reaction: chatReactionButton.dataset.chatReaction });
      return;
    }

    const blindPlayButton = event.target.closest('[data-blind-play]');
    if (blindPlayButton) {
      playBlindTestTheme(blindPlayButton.dataset.blindPlay);
      return;
    }

    const memoryCardButton = event.target.closest('[data-memory-card]');
    if (memoryCardButton && !memoryCardButton.disabled) {
      performExtraGameAction(memoryCardButton.dataset.roomId, 'memoire', 'flip', {
        cardId: memoryCardButton.dataset.memoryCard,
      });
      return;
    }

    const memoryContinueButton = event.target.closest('[data-memory-continue]');
    if (memoryContinueButton) {
      performExtraGameAction(memoryContinueButton.dataset.memoryContinue, 'memoire', 'continue');
      return;
    }

    const gameActionButton = event.target.closest('[data-game-action]');
    if (gameActionButton && !gameActionButton.disabled) {
      const actionBody = gameActionButton.dataset.gameAction === 'morpion'
        ? { cell: Number(gameActionButton.dataset.cellIndex) }
        : { targetId: gameActionButton.dataset.targetId };
      performExtraGameAction(gameActionButton.dataset.roomId, gameActionButton.dataset.gameAction, gameActionButton.dataset.gameVerb, actionBody);
      return;
    }

    const gameAnswerButton = event.target.closest('[data-game-answer]');
    if (gameAnswerButton && !gameAnswerButton.disabled) {
      performExtraGameAction(gameAnswerButton.dataset.roomId, gameAnswerButton.dataset.gameAnswer, 'answer', {
        choiceIndex: Number(gameAnswerButton.dataset.choiceIndex),
      });
      return;
    }

    const extraNextButton = event.target.closest('[data-extra-next]');
    if (extraNextButton) {
      performExtraGameAction(extraNextButton.dataset.roomId, extraNextButton.dataset.extraNext, 'next');
      return;
    }

    const extraRestartButton = event.target.closest('[data-extra-restart]');
    if (extraRestartButton) {
      performExtraGameAction(extraRestartButton.dataset.roomId, extraRestartButton.dataset.extraRestart, 'restart');
      return;
    }

    const unoRestartButton = event.target.closest('[data-uno-restart]');
    if (unoRestartButton) {
      performUnoAction(unoRestartButton.dataset.unoRestart, 'restart');
      return;
    }

    const p4ColumnButton = event.target.closest('[data-p4-column]');
    if (p4ColumnButton && !p4ColumnButton.disabled) {
      performPuissance4Action(p4ColumnButton.dataset.roomId, 'play', {
        column: Number(p4ColumnButton.dataset.p4Column),
      });
      return;
    }

    const p4RestartButton = event.target.closest('[data-p4-restart]');
    if (p4RestartButton) {
      performPuissance4Action(p4RestartButton.dataset.p4Restart, 'restart');
      return;
    }

    const buzzAllButton = event.target.closest('[data-admin-buzz-all]');
    if (buzzAllButton) {
      sendAdminBuzzAll(buzzAllButton);
      return;
    }

    const buzzButton = event.target.closest('[data-admin-buzz]');
    if (buzzButton) {
      sendAdminBuzz(buzzButton);
      return;
    }

    const clearActivityButton = event.target.closest('[data-admin-activity-clear]');
    if (clearActivityButton) {
      clearAdminActivity(clearActivityButton);
      return;
    }

    const copyActivityButton = event.target.closest('[data-admin-activity-copy]');
    if (copyActivityButton) {
      copyAdminActivity(copyActivityButton);
      return;
    }

    const adminRenameButton = event.target.closest('[data-admin-rename]');
    if (adminRenameButton) {
      renameAdminAccount(adminRenameButton.dataset.adminRename);
      return;
    }

    const adminRoleButton = event.target.closest('[data-admin-role]');
    if (adminRoleButton) {
      toggleAdminRole(adminRoleButton);
      return;
    }

    const cheaterRoleButton = event.target.closest('[data-cheater-role]');
    if (cheaterRoleButton) {
      toggleCheaterRole(cheaterRoleButton);
      return;
    }

    const adminDeleteButton = event.target.closest('[data-admin-delete]');
    if (adminDeleteButton) {
      deleteAdminAccount(adminDeleteButton);
      return;
    }

    if (event.target.closest('[data-admin-logout]')) {
      logoutAdmin();
      return;
    }

    if (event.target.closest('[data-admin-retry]')) {
      adminPanelDialog();
      return;
    }

    if (event.target.closest('[data-admin-back]')) {
      adminPanelDialog();
      return;
    }

    const accountSwitchButton = event.target.closest('[data-account-mode]');
    if (accountSwitchButton) {
      accountDialog(accountSwitchButton.dataset.accountMode);
      return;
    }

    const accountLogoutButton = event.target.closest('[data-account-logout]');
    if (accountLogoutButton) {
      logoutAccount();
      return;
    }

    const accountButtonClick = event.target.closest('[data-action="account"]');
    if (accountButtonClick) {
      accountDialog();
      mobileNav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      return;
    }

    const adminButton = event.target.closest('[data-action="admin"]');
    if (adminButton) {
      adminPanelDialog();
      mobileNav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      return;
    }

    const soloGameButton = event.target.closest('[data-solo-game]');
    if (soloGameButton && !soloGameButton.disabled) {
      startSoloGame(soloGameButton.dataset.soloGame, { triggerButton: soloGameButton });
      return;
    }

    const createButton = event.target.closest('[data-action="create"]');
    if (createButton) {
      if (currentAccount?.isAdmin) createRoomDialog();
      else creatorCodeDialog();
      mobileNav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
      return;
    }

    if (event.target.closest('[data-action="refresh"]')) {
      loadRooms();
      return;
    }

    if (event.target.closest('[data-action="reset-filters"]')) {
      searchInput.value = '';
      searchTerm = '';
      setSelectedFilter('Tous');
      return;
    }

    const homeCloseRoomButton = event.target.closest('[data-room-close]');
    if (homeCloseRoomButton && !homeCloseRoomButton.disabled) {
      closeRoom(homeCloseRoomButton.dataset.roomClose);
      return;
    }

    const roomButton = event.target.closest('[data-room-open]');
    if (roomButton && !roomButton.disabled) {
      openRoom(roomButton.dataset.roomOpen);
      return;
    }

    const leaveButton = event.target.closest('[data-leave-room]');
    if (leaveButton) {
      leaveRoom(leaveButton.dataset.leaveRoom);
      return;
    }

    const startRoomButton = event.target.closest('[data-start-room]');
    if (startRoomButton && !startRoomButton.disabled) {
      startRoom(startRoomButton.dataset.startRoom);
      return;
    }

    const closeRoomButton = event.target.closest('[data-close-room]');
    if (closeRoomButton) {
      closeRoom(closeRoomButton.dataset.closeRoom);
      return;
    }

    const removeBotsButton = event.target.closest('[data-remove-bots]');
    if (removeBotsButton && !removeBotsButton.disabled) {
      removeBots(removeBotsButton.dataset.removeBots);
      return;
    }

    const filterButton = event.target.closest('[data-filter]');
    if (filterButton) {
      setSelectedFilter(filterButton.dataset.filter);
      return;
    }

    const gameButton = event.target.closest('[data-game-filter]');
    if (gameButton) {
      setSelectedFilter(gameButton.dataset.gameFilter);
      document.querySelector('#parties').scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (event.target.closest('#refresh-button')) loadRooms();

    const navLink = event.target.closest('#mobile-nav a');
    if (navLink) {
      mobileNav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.form === 'creator-code') submitCreatorCode(form);
    if (form.dataset.form === 'admin-login') submitAdminLogin(form);
    if (form.dataset.form === 'admin-rename') submitAdminRename(form);
    if (form.dataset.form === 'account') submitAccountForm(form);
    if (form.dataset.form === 'create-room') submitCreateRoom(form);
    if (form.dataset.form === 'join-room') submitJoinRoom(form);
    if (form.dataset.form === 'add-bots') submitAddBots(form);
    if (form.dataset.form === 'chat') submitChatForm(form);
    if (form.dataset.form === 'wolf-chat') submitWolfChatForm(form);
    if (form.dataset.form === 'loup-cupid') submitCupidForm(form);
    if (form.dataset.form === 'loup-witch') submitWitchForm(form);
  });

  document.addEventListener('keydown', soloHandleKeydown);

  let snakeTouchStart = null;
  document.addEventListener('touchstart', (event) => {
    if (!event.target.closest?.('[data-snake-canvas]')) return;
    const touch = event.touches[0];
    snakeTouchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }, { passive: true });
  document.addEventListener('touchmove', (event) => {
    // Empêche la page de défiler pendant qu'on dirige le serpent au doigt.
    if (snakeTouchStart && event.target.closest?.('[data-snake-canvas]')) event.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', (event) => {
    if (!snakeTouchStart) return;
    const touch = event.changedTouches[0];
    if (touch) handleSnakeSwipe(snakeTouchStart, { x: touch.clientX, y: touch.clientY });
    snakeTouchStart = null;
  });
  document.addEventListener('contextmenu', (event) => {
    const mineCell = event.target.closest?.('[data-mines-row]');
    if (!mineCell || dialog.dataset.view !== 'solo-game' || soloArcadeState?.gameId !== 'demineur') return;
    event.preventDefault();
    const toggled = window.SoloGames.toggleMinesweeperFlag(
      soloArcadeState.game,
      Number(mineCell.dataset.minesRow),
      Number(mineCell.dataset.minesColumn),
    );
    if (toggled) renderSoloGame();
  });

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) requestDialogClose();
  });
  dialog.addEventListener('cancel', (event) => {
    if (dialog.dataset.view === 'solo-game') {
      event.preventDefault();
      requestDialogClose();
    }
  });
  document.addEventListener('fullscreenchange', updateFullscreenControls);
  dialog.addEventListener('close', () => {
    dialog.classList.remove('is-game-fullscreen', 'has-game-chat-layout');
    dialog.dataset.view = '';
    dialog.dataset.roomId = '';
    activeRoomSnapshot = null;
    selectedUnoCardId = '';
    unoActionInFlight = false;
    dialogContent.replaceChildren();
  });

  dialog.addEventListener('change', (event) => {
    if (event.target.matches('input[name="game"]')) setGamePlayerBounds(event.target.value);
    if (event.target.matches('[data-admin-activity-filter]')) {
      adminActivityFilter = event.target.value;
      refreshAdminActivity();
    }
  });

  searchInput.addEventListener('input', () => {
    searchTerm = searchInput.value;
    renderRooms();
  });

  refreshButton.addEventListener('click', loadRooms);
  leaderboardRefresh?.addEventListener('click', loadLeaderboard);

  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
    mobileNav.classList.toggle('is-open', !isOpen);
  });
  mobileNav.addEventListener('click', (event) => {
    if (!event.target.closest('a')) return;
    mobileNav.classList.remove('is-open');
    menuToggle.setAttribute('aria-expanded', 'false');
  });

  setConnection('offline', 'Connexion…');
  updateAccountButton();
  loadAccountSession();
  loadRooms();
  loadLeaderboard();
  document.addEventListener('pointerdown', unlockAudio);
  document.addEventListener('keydown', unlockAudio);
  document.addEventListener('touchstart', unlockAudio, { passive: true });
  pingPresence();
  window.setInterval(pingPresence, 8000);
  window.addEventListener('focus', pingPresence);
  window.setInterval(loadRooms, 9000);
  window.setInterval(loadLeaderboard, 20_000);
  window.setInterval(heartbeatSessions, 25_000);
  window.setInterval(refreshOpenRoom, 2500);
})();
