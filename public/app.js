// STATE & GLOBAL VARIABLES
let state = null;
let socket = null;
let reconnectTimer = null;
let localTimerInterval = null;
let visualRemainingSeconds = 0;
let lastLevelIndex = -1;

// Web Audio API Context
let audioCtx = null;

// Standard blind values list for interpolation (same as server)
const STANDARD_BLINDS = [
  10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000,
  1200, 1600, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 
  12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 
  80000, 100000, 120000, 150000, 200000, 250000, 300000, 
  400000, 500000, 600000, 800000, 1000000
];

// Payout distribution tables (default percentages for 1 to 10 places paid)
const PAYOUT_PRESETS = {
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [45, 25, 18, 12],
  5: [40, 25, 18, 11, 6],
  6: [35, 22, 16, 12, 9, 6],
  7: [33, 21, 15, 11, 8, 7, 5],
  8: [30, 20, 14, 10, 8, 7, 6, 5],
  9: [28, 18, 12, 10, 9, 8, 7, 5, 3],
  10: [26, 17, 12, 10, 9, 8, 7, 5, 4, 2]
};

// INITIALIZATION
window.addEventListener('DOMContentLoaded', () => {
  initWS();
  setupRouting();
  setupEventListeners();
});

// ROUTING & VIEW SWITCHING
function setupRouting() {
  const hash = window.location.hash;
  if (hash === '#tv') {
    showScreen('tv-screen');
    initAudio();
  } else if (hash === '#admin') {
    showScreen('admin-screen');
    initAudio();
  } else {
    showScreen('welcome-screen');
  }

  // Handle hash changes
  window.addEventListener('hashchange', () => {
    const newHash = window.location.hash;
    if (newHash === '#tv') {
      showScreen('tv-screen');
      initAudio();
    } else if (newHash === '#admin') {
      showScreen('admin-screen');
      initAudio();
    } else {
      showScreen('welcome-screen');
    }
  });

  // Welcome page buttons
  document.getElementById('btn-select-tv').addEventListener('click', () => {
    window.location.hash = 'tv';
  });
  document.getElementById('btn-select-admin').addEventListener('click', () => {
    window.location.hash = 'admin';
  });
  document.getElementById('btn-admin-home').addEventListener('click', () => {
    window.location.hash = '';
  });
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  
  if (screenId === 'tv-screen') {
    document.body.style.overflow = 'hidden';
  } else {
    document.body.style.overflow = 'auto';
  }
}

// AUDIO SYNTHESIZER (Web Audio API)
function initAudio() {
  if (audioCtx) return;
  // Initialize context on user interaction
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    audioCtx = new AudioContext();
    console.log('Web Audio API Context initialized.');
  }
}

function playLevelChangeSound() {
  if (!audioCtx) return;
  
  // Resume context if suspended
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;

  // Synthesis of a poker chime: A three-tone rising chord + bell ring
  const playTone = (freq, startTime, duration, type = 'sine') => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    
    // Smooth envelope
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start(startTime);
    osc.stop(startTime + duration);
  };

  // Rising chime tones (C5, E5, G5)
  playTone(523.25, now, 0.4);       // C5
  playTone(659.25, now + 0.15, 0.4);  // E5
  playTone(783.99, now + 0.3, 0.6);   // G5

  // Deep resonant "alarm" gong/bell ring (E4)
  setTimeout(() => {
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(329.63, audioCtx.currentTime); // E4
    
    gainNode.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2.0);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 2.0);
  }, 450);
}

// WEBSOCKETS COMMUNICATIONS
function initWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  console.log(`Connecting to WebSocket: ${wsUrl}`);
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('WebSocket connection established.');
    document.getElementById('ws-status-badge').className = 'connection-status badge connected';
    document.getElementById('ws-status-badge').innerText = 'Connected';
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    
    if (message.type === 'SYNC') {
      state = message.state;
      
      // Update pairing info on welcome screen
      updateWelcomeScreen(message.qrCode, message.localIPs, message.port);
      
      // Handle timer variables
      visualRemainingSeconds = state.timer.remainingSeconds;
      
      // Level change audio alert check
      if (lastLevelIndex !== -1 && lastLevelIndex !== state.currentLevelIndex) {
        playLevelChangeSound();
        triggerFlashAlert();
      }
      lastLevelIndex = state.currentLevelIndex;

      // Render respective screen
      renderActiveScreen();
      
      // Sync clock timers
      syncTimerTicker();
    } 
    else if (message.type === 'TIMER_TICK') {
      state.timer = message.timer;
      state.currentLevelIndex = message.currentLevelIndex;
      visualRemainingSeconds = state.timer.remainingSeconds;
      
      // Just update clocks to preserve UI scroll positions and input focus
      updateClockDisplays();
    }
  };

  socket.onclose = () => {
    console.warn('WebSocket connection closed. Retrying...');
    document.getElementById('ws-status-badge').className = 'connection-status badge disconnected';
    document.getElementById('ws-status-badge').innerText = 'Disconnected';
    
    // Stop local ticker
    if (localTimerInterval) {
      clearInterval(localTimerInterval);
      localTimerInterval = null;
    }

    // Attempt reconnection
    if (!reconnectTimer) {
      reconnectTimer = setInterval(initWS, 3000);
    }
  };

  socket.onerror = (err) => {
    console.error('WebSocket encountered an error:', err);
  };
}

function sendAction(type, data = {}) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, ...data }));
  } else {
    console.error('Cannot send action. WS is closed.', type);
  }
}

// LOCAL TIMER SYNC & EXTRAPOLATION
function syncTimerTicker() {
  if (localTimerInterval) {
    clearInterval(localTimerInterval);
    localTimerInterval = null;
  }

  if (state && state.timer.isRunning) {
    localTimerInterval = setInterval(() => {
      if (visualRemainingSeconds > 0) {
        visualRemainingSeconds--;
        updateClockDisplays();
      }
    }, 1000);
  }
  updateClockDisplays();
}

function updateClockDisplays() {
  const formattedTime = formatTime(visualRemainingSeconds);
  
  // Update TV
  const tvTimer = document.getElementById('tv-timer-display');
  if (tvTimer) {
    tvTimer.innerText = formattedTime;
    
    // Change warning color if time is low (< 30s) and not a break
    const currentLvl = state.levels[state.currentLevelIndex];
    const isBreak = currentLvl && currentLvl.type === 'break';
    
    if (visualRemainingSeconds <= 30 && !isBreak) {
      tvTimer.classList.add('warning');
      document.getElementById('tv-timer-progress').classList.add('warning');
    } else {
      tvTimer.classList.remove('warning');
      document.getElementById('tv-timer-progress').classList.remove('warning');
    }

    if (isBreak) {
      tvTimer.classList.add('break');
      document.getElementById('tv-timer-progress').classList.add('break');
    } else {
      tvTimer.classList.remove('break');
      document.getElementById('tv-timer-progress').classList.remove('break');
    }

    // Progress bar width
    if (currentLvl) {
      const pct = (visualRemainingSeconds / currentLvl.duration) * 100;
      document.getElementById('tv-timer-progress').style.width = `${pct}%`;
    }
  }

  // Update Admin
  const adminTimer = document.getElementById('admin-timer-display');
  if (adminTimer) {
    adminTimer.innerText = formattedTime;
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// FLASH TV SCREEN ON LEVEL ADVANCE
function triggerFlashAlert() {
  const tvScreen = document.getElementById('tv-screen');
  if (tvScreen) {
    tvScreen.style.backgroundColor = '#10b981';
    setTimeout(() => {
      tvScreen.style.backgroundColor = '';
    }, 200);
    setTimeout(() => {
      tvScreen.style.backgroundColor = '#10b981';
    }, 400);
    setTimeout(() => {
      tvScreen.style.backgroundColor = '';
    }, 600);
  }
}

// WELCOME SCREEN RENDER
function updateWelcomeScreen(qrCode, localIPs, port) {
  const qrImg = document.getElementById('pairing-qr');
  const qrLoading = document.getElementById('qr-loading');
  const lanList = document.getElementById('lan-url-list');
  
  if (qrCode) {
    qrImg.src = qrCode;
    qrImg.style.display = 'block';
    qrLoading.style.display = 'none';
  }

  if (localIPs && lanList) {
    lanList.innerHTML = '';
    // Always list localhost
    const localLi = document.createElement('li');
    localLi.innerText = `http://localhost:${port}`;
    lanList.appendChild(localLi);
    
    localIPs.forEach(ip => {
      const li = document.createElement('li');
      li.innerText = `http://${ip}:${port}`;
      lanList.appendChild(li);
    });
  }
}

// MAIN RENDER SWITCH
function renderActiveScreen() {
  if (!state) return;

  const hash = window.location.hash;
  if (hash === '#tv') {
    renderTVScreen();
  } else if (hash === '#admin') {
    renderAdminScreen();
  }
}

// TV VIEW RENDERER
function renderTVScreen() {
  const currentLvl = state.levels[state.currentLevelIndex];
  if (!currentLvl) return;

  // Level title & type
  const labelEl = document.getElementById('tv-level-label');
  labelEl.innerText = currentLvl.label;
  
  // Timer Status
  const statusEl = document.getElementById('tv-timer-status');
  if (state.timer.isRunning) {
    statusEl.innerText = currentLvl.type === 'break' ? 'BREAK ACTIVE' : 'Blinds Running';
  } else {
    statusEl.innerText = 'CLOCK PAUSED';
  }

  // Blinds Displays
  const curBlindsEl = document.getElementById('tv-current-blinds');
  const curAnteEl = document.getElementById('tv-current-ante');
  
  if (currentLvl.type === 'break') {
    curBlindsEl.innerText = 'BREAK TIME';
    curAnteEl.innerText = 'Chill & Stretch';
  } else {
    curBlindsEl.innerText = `${currentLvl.sb} / ${currentLvl.bb}`;
    curAnteEl.innerText = currentLvl.ante > 0 ? `Ante: ${currentLvl.ante}` : 'No Ante';
  }

  // Next level blinds display
  const nextBlindsEl = document.getElementById('tv-next-blinds');
  const nextAnteEl = document.getElementById('tv-next-ante');
  
  let nextIdx = state.currentLevelIndex + 1;
  // If next is a break, show the level after the break
  while (nextIdx < state.levels.length && state.levels[nextIdx].type === 'break') {
    nextIdx++;
  }
  
  if (nextIdx < state.levels.length) {
    const nextLvl = state.levels[nextIdx];
    nextBlindsEl.innerText = `${nextLvl.sb} / ${nextLvl.bb}`;
    nextAnteEl.innerText = nextLvl.ante > 0 ? `Ante: ${nextLvl.ante}` : 'No Ante';
  } else {
    nextBlindsEl.innerText = 'FINAL LEVEL';
    nextAnteEl.innerText = '-';
  }

  // Player Stats
  const activePlayers = state.players.filter(p => p.status === 'active').length;
  const totalPlayers = state.players.length;
  document.getElementById('tv-stat-players').innerText = `${activePlayers} / ${totalPlayers}`;

  // Rebuys & Prize Pool Math
  const totalPrizePool = calculatePrizePool();
  document.getElementById('tv-stat-prize-pool').innerText = `$${totalPrizePool}`;

  // Average Stack
  const avgStack = calculateAverageStack(activePlayers);

  // Chip Denominations
  const chipsList = document.getElementById('tv-chip-colors-list');
  chipsList.innerHTML = '';
  
  const activeChips = state.settings.activeChips || [];
  const inventory = state.settings.chipInventory || [];
  if (activeChips.length > 0) {
    activeChips.forEach(chip => {
      // Find matching chip in chipInventory to get current color and hex dynamically
      const invChip = inventory.find(item => item.value === chip.value);
      const displayHex = invChip ? invChip.hex : chip.hex;
      const displayColor = invChip ? invChip.color : chip.color;

      const row = document.createElement('div');
      row.className = 'chip-row';
      row.style.borderLeftColor = displayHex;
      row.innerHTML = `
        <div class="chip-name-wrapper">
          <div class="chip-pill" style="background-color: ${displayHex}; color: ${displayHex}"></div>
          <span class="chip-name">${displayColor}</span>
        </div>
        <div class="chip-val">${chip.value.toLocaleString()}</div>
      `;
      chipsList.appendChild(row);
    });
  } else {
    inventory.forEach(chip => {
      const row = document.createElement('div');
      row.className = 'chip-row';
      row.style.borderLeftColor = chip.hex;
      row.innerHTML = `
        <div class="chip-name-wrapper">
          <div class="chip-pill" style="background-color: ${chip.hex}; color: ${chip.hex}"></div>
          <span class="chip-name">${chip.color}</span>
        </div>
        <div class="chip-val">${chip.value.toLocaleString()}</div>
      `;
      chipsList.appendChild(row);
    });
  }

  // Payout Table
  const payoutsList = document.getElementById('tv-payouts-list');
  payoutsList.innerHTML = '';
  const calculatedPayouts = calculatePayoutDistribution(totalPrizePool);
  
  if (calculatedPayouts.length === 0) {
    payoutsList.innerHTML = `<div class="payout-row" style="color: var(--text-muted);">No entries yet</div>`;
  } else {
    calculatedPayouts.forEach(p => {
      const row = document.createElement('div');
      row.className = 'payout-row';
      row.innerHTML = `
        <span class="payout-rank">${p.rank}</span>
        <div class="payout-val-group">
          <span class="payout-pct">${p.percent}%</span>
          <span class="payout-amt">$${p.amount}</span>
        </div>
      `;
      payoutsList.appendChild(row);
    });
  }

  // Scrolling ticker messages
  const tickerEl = document.getElementById('tv-ticker-message');
  let rebuysText = '';
  const rebuyCount = state.players.reduce((sum, p) => sum + p.rebuys, 0);
  if (rebuyCount > 0) {
    rebuysText = ` | Total Rebuys: ${rebuyCount}`;
  }

  // Calculate playing levels for rebuy cutoff
  let currentPlayingLevelNum = 0;
  for (let i = 0; i <= state.currentLevelIndex; i++) {
    if (state.levels[i].type === 'level') {
      currentPlayingLevelNum++;
    }
  }

  let rebuyStatusText = '';
  const cutoff = state.settings.rebuyCutoffLevel || 4;
  if (currentPlayingLevelNum < cutoff) {
    const levelsLeft = cutoff - currentPlayingLevelNum + 1;
    rebuyStatusText = `Rebuys: ${levelsLeft} levels left until no rebuys allowed`;
  } else if (currentPlayingLevelNum === cutoff) {
    if (currentLvl.type === 'break') {
      rebuyStatusText = `Rebuys: LAST CHANCE (rebuys close at the end of this break!)`;
    } else {
      rebuyStatusText = `Rebuys: 1 level left (last level for rebuys!)`;
    }
  } else {
    rebuyStatusText = `<span style="color: var(--danger); font-weight: bold; text-shadow: 0 0 5px rgba(239, 68, 68, 0.4);">NO MORE REBUYS</span>`;
  }

  tickerEl.innerHTML = `${rebuyStatusText} | Entries: ${totalPlayers} | Remaining: ${activePlayers}${rebuysText} | Prize Pool: $${totalPrizePool} | Avg Stack: ${avgStack.toLocaleString()} | Please contact Admin to register rebuys!`;
}

// ADMIN VIEW RENDERER
function renderAdminScreen() {
  const currentLvl = state.levels[state.currentLevelIndex];
  if (!currentLvl) return;

  // Header and play/pause clock state
  document.getElementById('admin-current-level-label').innerText = currentLvl.label;
  if (currentLvl.type === 'break') {
    document.getElementById('admin-current-blinds').innerText = 'BREAK';
    document.getElementById('admin-current-ante').innerText = `(${currentLvl.label})`;
  } else {
    document.getElementById('admin-current-blinds').innerText = `${currentLvl.sb} / ${currentLvl.bb}`;
    document.getElementById('admin-current-ante').innerText = currentLvl.ante > 0 ? `(Ante: ${currentLvl.ante})` : '(No Ante)';
  }

  const playBtn = document.getElementById('btn-admin-play');
  const pauseBtn = document.getElementById('btn-admin-pause');
  if (state.timer.isRunning) {
    playBtn.style.display = 'none';
    pauseBtn.style.display = 'inline-flex';
  } else {
    playBtn.style.display = 'inline-flex';
    pauseBtn.style.display = 'none';
  }

  // Render tabs
  document.getElementById('admin-players-count').innerText = state.players.length;
  
  // Render Tab: Players
  renderAdminPlayersTab();

  // Render Tab: Blinds
  renderAdminBlindsTab();

  // Render Tab: Payouts
  renderAdminPayoutsTab();

  // Render Tab: Settings
  renderAdminSettingsTab();
}

function renderAdminPlayersTab() {
  const activePlayers = state.players.filter(p => p.status === 'active').length;
  const totalPlayers = state.players.length;
  const prizePool = calculatePrizePool();
  const avgStack = calculateAverageStack(activePlayers);

  document.getElementById('admin-qs-remaining').innerText = `${activePlayers} / ${totalPlayers}`;
  document.getElementById('admin-qs-prize').innerText = `$${prizePool}`;
  document.getElementById('admin-qs-avg').innerText = avgStack.toLocaleString();

  const itemsContainer = document.getElementById('player-list-items');
  itemsContainer.innerHTML = '';

  if (state.players.length === 0) {
    itemsContainer.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--text-secondary)">No players registered yet. Add names above!</div>`;
    return;
  }

  // Sort: Active first, then by elimination rank descending (highest rank / last out first), then name
  const sortedPlayers = [...state.players].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1;
    }
    if (a.status === 'eliminated') {
      return (a.rank || 0) - (b.rank || 0); // lower rank number means went out later, so sort ascending
    }
    return a.name.localeCompare(b.name);
  });

  sortedPlayers.forEach(p => {
    const item = document.createElement('div');
    item.className = `player-item ${p.status === 'eliminated' ? 'eliminated' : ''}`;
    
    // Details text
    let detailsText = `Stack: ${state.settings.startingStack.toLocaleString()}`;
    if (p.rebuys > 0) detailsText += ` | R:${p.rebuys}`;
    if (p.addons > 0) detailsText += ` | A:${p.addons}`;
    
    let leftSideHtml = `
      <div class="player-info">
        <span class="player-name">${p.name}</span>
        <span class="player-stats-micro">${detailsText}</span>
      </div>
    `;

    if (p.status === 'eliminated') {
      leftSideHtml = `
        <div class="player-info">
          <span class="player-name">${p.name}</span>
          <span class="player-rank">Out (#${p.rank})</span>
        </div>
      `;
    }

    // Action buttons
    let actionBtnHtml = '';
    if (p.status === 'active') {
      actionBtnHtml = `
        <div class="player-actions">
          <div class="buy-counter" title="Rebuys">
            <button class="btn-rebuy-dec" data-id="${p.id}">-</button>
            <span class="text-success">R: ${p.rebuys}</span>
            <button class="btn-rebuy-inc" data-id="${p.id}">+</button>
          </div>
          <div class="buy-counter" title="Add-ons">
            <button class="btn-addon-dec" data-id="${p.id}">-</button>
            <span>A: ${p.addons}</span>
            <button class="btn-addon-inc" data-id="${p.id}">+</button>
          </div>
          <button class="btn btn-xs btn-danger btn-eliminate" data-id="${p.id}">Bust</button>
        </div>
      `;
    } else {
      actionBtnHtml = `
        <div class="player-actions">
          <div class="buy-counter" title="Rebuys">
            <button class="btn-rebuy-inc" data-id="${p.id}">Rebuy & Revive</button>
          </div>
          <button class="btn btn-xs btn-outline btn-reinstate" data-id="${p.id}">Undo Bust</button>
          <button class="btn btn-xs btn-icon btn-outline btn-remove-player" data-id="${p.id}" title="Remove Player">🗑</button>
        </div>
      `;
    }

    item.innerHTML = leftSideHtml + actionBtnHtml;
    itemsContainer.appendChild(item);
  });
}

function renderAdminBlindsTab() {
  const levelsContainer = document.getElementById('admin-levels-list');
  levelsContainer.innerHTML = '';

  state.levels.forEach((lvl, idx) => {
    const tr = document.createElement('tr');
    tr.className = (idx === state.currentLevelIndex) ? 'active' : '';
    if (lvl.type === 'break') tr.classList.add('break-row');

    const durationMin = Math.round(lvl.duration / 60);

    let rowHtml = `
      <td>${idx + 1}</td>
      <td>
        <select class="cell-level-type" data-index="${idx}">
          <option value="level" ${lvl.type === 'level' ? 'selected' : ''}>Blinds</option>
          <option value="break" ${lvl.type === 'break' ? 'selected' : ''}>Break</option>
        </select>
      </td>
    `;

    if (lvl.type === 'break') {
      rowHtml += `
        <td colspan="3"><input type="text" class="cell-break-label" data-index="${idx}" value="${lvl.label}" style="width: 100%;"></td>
        <td><input type="number" class="cell-duration" data-index="${idx}" value="${durationMin}"> m</td>
      `;
    } else {
      rowHtml += `
        <td><input type="number" class="cell-sb" data-index="${idx}" value="${lvl.sb}"></td>
        <td><input type="number" class="cell-bb" data-index="${idx}" value="${lvl.bb}"></td>
        <td><input type="number" class="cell-ante" data-index="${idx}" value="${lvl.ante}"></td>
        <td><input type="number" class="cell-duration" data-index="${idx}" value="${durationMin}"> m</td>
      `;
    }

    rowHtml += `
      <td>
        <button class="btn btn-xs btn-outline btn-level-jump" data-index="${idx}">Jump</button>
        <button class="btn btn-xs btn-outline btn-level-delete text-danger" data-index="${idx}">×</button>
      </td>
    `;

    tr.innerHTML = rowHtml;
    levelsContainer.appendChild(tr);
  });
}

function renderAdminPayoutsTab() {
  // Places paid input
  document.getElementById('payout-places-paid').value = state.settings.payoutCount;

  // Calculate sum of percentages
  const sum = state.settings.payoutPercentages.reduce((a, b) => a + b, 0);
  const badge = document.getElementById('payout-sum-badge');
  badge.innerText = `Sum: ${sum}%`;
  
  if (sum === 100) {
    badge.className = 'badge bg-success';
  } else {
    badge.className = 'badge bg-danger';
  }

  // Populate editor
  const editor = document.getElementById('payout-editor-list');
  editor.innerHTML = '';

  for (let i = 0; i < state.settings.payoutCount; i++) {
    const pct = state.settings.payoutPercentages[i] || 0;
    const row = document.createElement('div');
    row.className = 'payout-edit-row';
    row.innerHTML = `
      <div class="payout-row-header">
        <span>Place ${i + 1}</span>
        <span>${pct}%</span>
      </div>
      <div class="payout-slider-wrapper">
        <input type="range" class="payout-slider" data-index="${i}" min="0" max="100" value="${pct}">
        <input type="number" class="payout-pct-input" data-index="${i}" min="0" max="100" value="${pct}">%
      </div>
    `;
    editor.appendChild(row);
  }

  // Populate actual dollar values
  const totalPrize = calculatePrizePool();
  const dollarList = document.getElementById('admin-payout-values');
  dollarList.innerHTML = '';
  
  const distributions = calculatePayoutDistribution(totalPrize);
  if (distributions.length === 0) {
    dollarList.innerHTML = `<div style="text-align: center; color: var(--text-secondary)">No prizes calculated. Add players to raise prize pool!</div>`;
  } else {
    distributions.forEach(d => {
      const div = document.createElement('div');
      div.className = 'payout-val-row';
      div.innerHTML = `
        <span class="payout-val-rank">${d.rank} Place</span>
        <span class="payout-val-amount">$${d.amount}</span>
      `;
      dollarList.appendChild(div);
    });
  }
}

function renderAdminSettingsTab() {
  document.getElementById('settings-starting-stack').value = state.settings.startingStack;
  document.getElementById('settings-buyin').value = state.settings.buyIn;
  document.getElementById('settings-rebuy').value = state.settings.rebuyAmount;
  document.getElementById('settings-addon').value = state.settings.addonAmount;
  document.getElementById('settings-bba-start').value = state.settings.bbaStartLevel;
  document.getElementById('settings-auto-advance').value = state.settings.autoAdvance.toString();
  document.getElementById('settings-rebuy-cutoff').value = state.settings.rebuyCutoffLevel || 4;

  // Populate chip color editors
  const list = document.getElementById('chip-settings-list');
  list.innerHTML = '';

  const inventory = state.settings.chipInventory || [];
  inventory.forEach((chip, idx) => {
    const div = document.createElement('div');
    div.className = 'chip-setting-item';
    div.innerHTML = `
      <div class="chip-pill" style="background-color: ${chip.hex};"></div>
      <input type="text" class="chip-edit-color" data-index="${idx}" value="${chip.color}" style="width: 120px;" title="Color Name">
      <input type="number" class="chip-edit-value" data-index="${idx}" value="${chip.value}" style="width: 70px;" title="Denomination Value">
      <input type="number" class="chip-edit-qty" data-index="${idx}" value="${chip.qty}" style="width: 70px;" title="Quantity Owned"> Qty
      <input type="color" class="chip-edit-hex" data-index="${idx}" value="${chip.hex}">
    `;
    list.appendChild(div);
  });
}

// CALCULATION LOGIC
function calculatePrizePool() {
  if (!state) return 0;
  const initialPlayers = state.players.length;
  const rebuys = state.players.reduce((sum, p) => sum + p.rebuys, 0);
  const addons = state.players.reduce((sum, p) => sum + p.addons, 0);
  
  return (initialPlayers * state.settings.buyIn) + 
         (rebuys * state.settings.rebuyAmount) + 
         (addons * state.settings.addonAmount);
}

function calculateAverageStack(activeCount) {
  if (!state || activeCount <= 0) return 0;
  const initialPlayers = state.players.length;
  const rebuys = state.players.reduce((sum, p) => sum + p.rebuys, 0);
  const addons = state.players.reduce((sum, p) => sum + p.addons, 0);
  
  // Total stack chips in play = (entries + rebuys) * startingStack.
  // Wait, add-on stack can be the same size or different. For simplification of a home game,
  // we assume each rebuy/add-on receives 1 full starting stack size, which is very typical!
  const totalChips = (initialPlayers + rebuys + addons) * state.settings.startingStack;
  return Math.round(totalChips / activeCount);
}

function calculatePayoutDistribution(totalPrize) {
  if (!state) return [];
  const pctTable = state.settings.payoutPercentages;
  const count = state.settings.payoutCount;
  
  const results = [];
  for (let i = 0; i < count; i++) {
    const pct = pctTable[i] || 0;
    const amt = Math.round((pct / 100) * totalPrize);
    
    // Suffix rank representation
    let suffix = 'th';
    if (i === 0) suffix = 'st';
    else if (i === 1) suffix = 'nd';
    else if (i === 2) suffix = 'rd';

    results.push({
      rank: `${i + 1}${suffix}`,
      percent: pct,
      amount: amt
    });
  }
  return results;
}

// SETUP INTERACTIVE HANDLERS
function setupEventListeners() {
  // ADMIN TAB CLICK HANDLERS
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      
      e.target.classList.add('active');
      const tabId = e.target.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });

  // TIMER BUTTON EVENTS (ADMIN)
  document.getElementById('btn-admin-play').addEventListener('click', () => sendAction('PLAY'));
  document.getElementById('btn-admin-pause').addEventListener('click', () => sendAction('PAUSE'));
  document.getElementById('btn-admin-reset').addEventListener('click', () => {
    if (confirm('Reset timer to this level\'s starting duration?')) {
      sendAction('RESET_LEVEL');
    }
  });
  document.getElementById('btn-admin-prev').addEventListener('click', () => sendAction('PREV_LEVEL'));
  document.getElementById('btn-admin-next').addEventListener('click', () => sendAction('NEXT_LEVEL'));
  
  // Timer Quick Adjust Buttons
  document.getElementById('btn-adjust-minus-1').addEventListener('click', () => {
    if (state) {
      const newTime = Math.max(0, visualRemainingSeconds - 60);
      sendAction('SET_TIME', { seconds: newTime });
    }
  });
  document.getElementById('btn-adjust-plus-1').addEventListener('click', () => {
    if (state) {
      const newTime = visualRemainingSeconds + 60;
      sendAction('SET_TIME', { seconds: newTime });
    }
  });

  // FULLSCREEN API (TV)
  document.getElementById('btn-tv-fullscreen').addEventListener('click', () => {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
      elem.requestFullscreen().catch(err => {
        console.error(`Error enabling full-screen mode: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  });

  // PLAYER REGISTRATION FORM
  document.getElementById('add-player-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('input-player-name');
    const name = input.value.trim();
    if (name) {
      sendAction('ADD_PLAYER', { name });
      input.value = '';
    }
  });

  // DELEGATED CLICKS FOR PLAYER LIST (ADMIN)
  document.getElementById('player-list-items').addEventListener('click', (e) => {
    const target = e.target;
    const id = target.getAttribute('data-id');
    if (!id) return;

    if (target.classList.contains('btn-eliminate')) {
      sendAction('ELIMINATE_PLAYER', { id });
    } 
    else if (target.classList.contains('btn-reinstate')) {
      sendAction('UNDO_ELIMINATION', { id });
    }
    else if (target.classList.contains('btn-rebuy-inc')) {
      sendAction('REBUY_PLAYER', { id });
    }
    else if (target.classList.contains('btn-rebuy-dec')) {
      sendAction('REDUCE_REBUY', { id });
    }
    else if (target.classList.contains('btn-addon-inc')) {
      sendAction('ADDON_PLAYER', { id });
    }
    else if (target.classList.contains('btn-addon-dec')) {
      sendAction('REDUCE_ADDON', { id });
    }
    else if (target.classList.contains('btn-remove-player')) {
      if (confirm('Delete player from tournament entirely?')) {
        sendAction('REMOVE_PLAYER', { id });
      }
    }
  });

  // DELEGATED BLIND LIST UPDATES & ACTION BUTTONS (ADMIN)
  const listEl = document.getElementById('admin-levels-list');
  
  // Jump/Delete level buttons
  listEl.addEventListener('click', (e) => {
    const target = e.target;
    const idx = parseInt(target.getAttribute('data-index'), 10);
    if (isNaN(idx)) return;

    if (target.classList.contains('btn-level-jump')) {
      sendAction('SET_LEVEL_INDEX', { index: idx });
    } else if (target.classList.contains('btn-level-delete')) {
      const updatedLevels = [...state.levels];
      updatedLevels.splice(idx, 1);
      sendAction('APPLY_CALCULATED_STRUCTURE', { levels: updatedLevels });
    }
  });

  // Blind Table Field Changes (Blur)
  listEl.addEventListener('blur', (e) => {
    const target = e.target;
    const idx = parseInt(target.getAttribute('data-index'), 10);
    if (isNaN(idx)) return;

    const updatedLevels = [...state.levels];
    
    if (target.classList.contains('cell-level-type')) {
      updatedLevels[idx].type = target.value;
      if (target.value === 'break') {
        updatedLevels[idx].label = `Break ${idx + 1}`;
        delete updatedLevels[idx].sb;
        delete updatedLevels[idx].bb;
        delete updatedLevels[idx].ante;
      } else {
        updatedLevels[idx].label = `Level ${idx + 1}`;
        updatedLevels[idx].sb = 25;
        updatedLevels[idx].bb = 50;
        updatedLevels[idx].ante = 0;
      }
    } 
    else if (target.classList.contains('cell-sb')) {
      updatedLevels[idx].sb = Math.max(0, parseInt(target.value, 10) || 0);
    } 
    else if (target.classList.contains('cell-bb')) {
      updatedLevels[idx].bb = Math.max(0, parseInt(target.value, 10) || 0);
    } 
    else if (target.classList.contains('cell-ante')) {
      updatedLevels[idx].ante = Math.max(0, parseInt(target.value, 10) || 0);
    } 
    else if (target.classList.contains('cell-duration')) {
      const mins = Math.max(1, parseInt(target.value, 10) || 1);
      updatedLevels[idx].duration = mins * 60;
    }
    else if (target.classList.contains('cell-break-label')) {
      updatedLevels[idx].label = target.value.trim() || `Break`;
    }

    sendAction('APPLY_CALCULATED_STRUCTURE', { levels: updatedLevels });
  }, true); // Use capture phase for delegated blur events

  // Add Manual Blind Row
  document.getElementById('btn-add-level-row').addEventListener('click', () => {
    const lastLvl = state.levels[state.levels.length - 1];
    let newLvl = { type: 'level', label: `Level ${state.levels.length + 1}`, sb: 25, bb: 50, ante: 0, duration: 900 };
    
    if (lastLvl && lastLvl.type === 'level') {
      // Scale slightly based on the last one
      const index = STANDARD_BLINDS.indexOf(lastLvl.bb);
      const nextIndex = index !== -1 ? Math.min(STANDARD_BLINDS.length - 1, index + 1) : 0;
      const nextBB = STANDARD_BLINDS[nextIndex] || (lastLvl.bb * 1.5);
      newLvl.sb = Math.round(nextBB / 2);
      newLvl.bb = nextBB;
      newLvl.ante = (state.levels.length >= state.settings.bbaStartLevel) ? nextBB : 0;
      newLvl.duration = lastLvl.duration;
    }
    
    const updatedLevels = [...state.levels, newLvl];
    sendAction('APPLY_CALCULATED_STRUCTURE', { levels: updatedLevels });
  });

  // Regenerate Default Blinds Button
  document.getElementById('btn-regen-default-blinds').addEventListener('click', () => {
    if (confirm('Regenerate and replace the current blinds structure with standard defaults?')) {
      sendAction('REGEN_DEFAULT_STRUCTURE');
    }
  });

  // BLINDS CALCULATOR EVENT
  document.getElementById('calc-add-breaks').addEventListener('change', (e) => {
    const opts = document.getElementById('calc-break-options');
    opts.style.display = e.target.checked ? 'grid' : 'none';
  });

  document.getElementById('btn-calc-generate').addEventListener('click', () => {
    runBlindsCalculator();
  });

  // PAYOUT EDITOR EVENTS
  document.getElementById('payout-places-paid').addEventListener('change', (e) => {
    let count = Math.max(1, parseInt(e.target.value, 10) || 1);
    count = Math.min(10, count); // Cap at 10 for simplicity
    e.target.value = count;
    
    // Generate new percentages array based on preset
    const preset = PAYOUT_PRESETS[count] || [100];
    
    sendAction('UPDATE_SETTINGS', {
      settings: {
        payoutCount: count,
        payoutPercentages: [...preset]
      }
    });
  });

  // Delegated payout percentages edits
  const payoutListEl = document.getElementById('payout-editor-list');
  const updatePayoutPercent = (idx, val) => {
    const updatedPercentages = [...state.settings.payoutPercentages];
    updatedPercentages[idx] = Math.max(0, Math.min(100, val));
    sendAction('UPDATE_SETTINGS', {
      settings: { payoutPercentages: updatedPercentages }
    });
  };

  payoutListEl.addEventListener('input', (e) => {
    const target = e.target;
    const idx = parseInt(target.getAttribute('data-index'), 10);
    if (isNaN(idx)) return;
    
    if (target.classList.contains('payout-slider')) {
      // Sync numerical text input immediately
      target.nextElementSibling.value = target.value;
    }
  });

  payoutListEl.addEventListener('change', (e) => {
    const target = e.target;
    const idx = parseInt(target.getAttribute('data-index'), 10);
    if (isNaN(idx)) return;
    
    const val = parseInt(target.value, 10) || 0;
    updatePayoutPercent(idx, val);
  });

  // Payout Auto-Balance
  document.getElementById('btn-payout-autobalance').addEventListener('click', () => {
    const count = state.settings.payoutCount;
    const preset = PAYOUT_PRESETS[count] || [100];
    sendAction('UPDATE_SETTINGS', {
      settings: { payoutPercentages: [...preset] }
    });
  });

  // GENERAL TOURNAMENT SETTINGS SAVE
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const startingStack = Math.max(1, parseInt(document.getElementById('settings-starting-stack').value, 10) || 10000);
    const buyIn = Math.max(0, parseInt(document.getElementById('settings-buyin').value, 10) || 0);
    const rebuyAmount = Math.max(0, parseInt(document.getElementById('settings-rebuy').value, 10) || 0);
    const addonAmount = Math.max(0, parseInt(document.getElementById('settings-addon').value, 10) || 0);
    const bbaStartLevel = Math.max(1, parseInt(document.getElementById('settings-bba-start').value, 10) || 1);
    const rebuyCutoffLevel = Math.max(1, parseInt(document.getElementById('settings-rebuy-cutoff').value, 10) || 4);
    const autoAdvance = document.getElementById('settings-auto-advance').value === 'true';

    sendAction('UPDATE_SETTINGS', {
      settings: {
        startingStack,
        buyIn,
        rebuyAmount,
        addonAmount,
        bbaStartLevel,
        rebuyCutoffLevel,
        autoAdvance
      }
    });
    alert('Settings updated and synced!');
  });

  // CHIP COLORS SAVE (INVENTORY)
  const chipListEl = document.getElementById('chip-settings-list');
  
  // Auto-calculate checkbox change handler
  const autoChipsCheck = document.getElementById('calc-auto-chips');
  if (autoChipsCheck) {
    const toggleInputs = () => {
      const displayMode = autoChipsCheck.checked ? 'none' : 'flex';
      document.getElementById('group-calc-starting-stack').style.display = displayMode;
      document.getElementById('group-calc-smallest-chip').style.display = displayMode;
    };
    autoChipsCheck.addEventListener('change', toggleInputs);
    // Initial call
    setTimeout(toggleInputs, 200);
  }

  document.getElementById('btn-save-chip-colors').addEventListener('click', () => {
    const chipInventory = [];
    chipListEl.querySelectorAll('.chip-setting-item').forEach((item, idx) => {
      const color = item.querySelector('.chip-edit-color').value.trim() || `Chip ${idx + 1}`;
      const value = Math.max(1, parseInt(item.querySelector('.chip-edit-value').value, 10) || 1);
      const qty = Math.max(0, parseInt(item.querySelector('.chip-edit-qty').value, 10) || 0);
      const hex = item.querySelector('.chip-edit-hex').value;
      chipInventory.push({ color, value, qty, hex });
    });
    // Sort inventory by value
    chipInventory.sort((a, b) => a.value - b.value);
    sendAction('UPDATE_SETTINGS', { settings: { chipInventory } });
    alert('Chip inventory saved and updated!');
  });

  // Automatically sync color picker and settings pill if color name matches standard colors
  chipListEl.addEventListener('input', (e) => {
    const target = e.target;
    if (target.classList.contains('chip-edit-color')) {
      const name = target.value.trim().toLowerCase();
      const COLOR_MAP = {
        'white': '#ffffff',
        'blue': '#3b82f6',
        'red': '#ef4444',
        'green': '#10b981',
        'black': '#1f2937',
        'purple': '#a855f7',
        'orange': '#f97316',
        'yellow': '#eab308',
        'pink': '#ec4899',
        'lavender': '#d8b4fe',
        'brown': '#78350f',
        'gray': '#64748b',
        'grey': '#64748b',
        'cyan': '#06b6d4',
        'white/blue': '#ffffff'
      };
      const hex = COLOR_MAP[name];
      if (hex) {
        const hexInput = target.parentElement.querySelector('.chip-edit-hex');
        const pill = target.parentElement.querySelector('.chip-pill');
        if (hexInput) hexInput.value = hex;
        if (pill) pill.style.backgroundColor = hex;
      }
    }
    else if (target.classList.contains('chip-edit-hex')) {
      const pill = target.parentElement.querySelector('.chip-pill');
      if (pill) pill.style.backgroundColor = target.value;
    }
  });

  // RESET TOURNAMENT
  document.getElementById('btn-reset-tournament').addEventListener('click', () => {
    if (confirm('CRITICAL WARNING: This will completely wipe all player registrations, rebuys, and restore the default blinds structure. Are you absolutely sure?')) {
      sendAction('RESET_TOURNAMENT');
    }
  });
}

// CHIP BREAKOUT COMBINATORIAL SOLVER (SMART OPTIMIZER)
function calculateChipBreakout(numPlayers, expectedRebuys) {
  if (!state || !state.settings.chipInventory || state.settings.chipInventory.length === 0) {
    return { success: false, error: 'No chip inventory defined.' };
  }

  // Get active sorted inventory (only items with qty > 0)
  const inv = state.settings.chipInventory.filter(item => item.qty > 0).sort((a, b) => a.value - b.value);
  if (inv.length < 3) {
    return { success: false, error: 'Need at least 3 unique chip colors with quantities in inventory.' };
  }

  const numP = numPlayers;
  const reb = expectedRebuys;
  
  let bestCandidate = null;
  let bestScore = -Infinity;

  // Helper to check if a stack value is a clean multiple
  const isCleanValue = (val) => {
    if (val >= 1000) return val % 500 === 0 || val % 200 === 0;
    if (val >= 100) return val % 50 === 0 || val % 100 === 0;
    if (val >= 10) return val % 5 === 0;
    return true;
  };

  // 1. Try combinations of 3 denominations
  for (let i = 0; i < inv.length; i++) {
    for (let j = i + 1; j < inv.length; j++) {
      for (let k = j + 1; k < inv.length; k++) {
        const denoms = [inv[i], inv[j], inv[k]];
        
        // Iterate over chip quantities per player
        // q1: 4 to 12
        // q2: 4 to 10
        // q3: 1 to 6
        for (let q1 = 4; q1 <= 12; q1++) {
          for (let q2 = 4; q2 <= 10; q2++) {
            for (let q3 = 1; q3 <= 6; q3++) {
              
              // Check quantities fit within inventory
              if (numP * q1 > denoms[0].qty) continue;
              if (numP * q2 > denoms[1].qty) continue;
              if (numP * q3 > denoms[2].qty) continue;

              const stackValue = q1 * denoms[0].value + q2 * denoms[1].value + q3 * denoms[2].value;
              if (!isCleanValue(stackValue)) continue;

              // Check if remaining total value in bank is enough for expected rebuys
              const remVal = (denoms[0].qty - numP * q1) * denoms[0].value +
                             (denoms[1].qty - numP * q2) * denoms[1].value +
                             (denoms[2].qty - numP * q3) * denoms[2].value;
              const totalRebuyValueNeeded = numP * reb * stackValue;
              if (remVal < totalRebuyValueNeeded) continue;

              // Calculate metrics for scoring
              const depth = stackValue / (denoms[0].value * 2);
              const totalChips = q1 + q2 + q3;

              // Score calculation
              let score = 0;

              // Depth score (prefer 50 - 100 BBs)
              if (depth >= 50 && depth <= 120) {
                score += 150;
              } else if (depth >= 40 && depth < 50) {
                score += 80;
              } else if (depth >= 30 && depth < 40) {
                score += 40;
              } else if (depth > 120) {
                score += 30; 
              } else {
                score -= 100;
              }

              // Chip count score (ideal 12 - 18 chips per player)
              if (totalChips >= 12 && totalChips <= 18) {
                score += 100;
              } else {
                score -= Math.abs(totalChips - 15) * 15;
              }

              // Smallest chip reserve in bank (prefer leaving >= 15% in the bank for change)
              const smallReserve = (denoms[0].qty - numP * q1) / denoms[0].qty;
              if (smallReserve >= 0.15) {
                score += 30;
              } else if (smallReserve < 0.05) {
                score -= 40;
              }

              // Value clean factor
              if (stackValue % 1000 === 0) score += 30;
              else if (stackValue % 500 === 0) score += 20;
              else if (stackValue % 100 === 0) score += 10;

              if (score > bestScore) {
                bestScore = score;
                bestCandidate = {
                  denoms,
                  qtys: [q1, q2, q3],
                  stackValue
                };
              }
            }
          }
        }
      }
    }
  }

  // 2. Try combinations of 4 denominations
  for (let i = 0; i < inv.length; i++) {
    for (let j = i + 1; j < inv.length; j++) {
      for (let k = j + 1; k < inv.length; k++) {
        for (let l = k + 1; l < inv.length; l++) {
          const denoms = [inv[i], inv[j], inv[k], inv[l]];
          
          // q1: 4 to 10
          // q2: 4 to 8
          // q3: 2 to 6
          // q4: 1 to 3
          for (let q1 = 4; q1 <= 10; q1++) {
            for (let q2 = 4; q2 <= 8; q2++) {
              for (let q3 = 2; q3 <= 6; q3++) {
                for (let q4 = 1; q4 <= 3; q4++) {
                  
                  // Check quantities fit
                  if (numP * q1 > denoms[0].qty) continue;
                  if (numP * q2 > denoms[1].qty) continue;
                  if (numP * q3 > denoms[2].qty) continue;
                  if (numP * q4 > denoms[3].qty) continue;

                  const stackValue = q1 * denoms[0].value + q2 * denoms[1].value + q3 * denoms[2].value + q4 * denoms[3].value;
                  if (!isCleanValue(stackValue)) continue;

                  const remVal = (denoms[0].qty - numP * q1) * denoms[0].value +
                                 (denoms[1].qty - numP * q2) * denoms[1].value +
                                 (denoms[2].qty - numP * q3) * denoms[2].value +
                                 (denoms[3].qty - numP * q4) * denoms[3].value;
                  const totalRebuyValueNeeded = numP * reb * stackValue;
                  if (remVal < totalRebuyValueNeeded) continue;

                  const depth = stackValue / (denoms[0].value * 2);
                  const totalChips = q1 + q2 + q3 + q4;

                  let score = 0;

                  // BB depth score
                  if (depth >= 50 && depth <= 120) {
                    score += 150;
                  } else if (depth >= 40 && depth < 50) {
                    score += 80;
                  } else if (depth >= 30 && depth < 40) {
                    score += 40;
                  } else {
                    score -= 100;
                  }

                  // Chip count score (ideal 14 - 22 chips)
                  if (totalChips >= 14 && totalChips <= 22) {
                    score += 100;
                  } else {
                    score -= Math.abs(totalChips - 18) * 15;
                  }

                  // Smallest chip reserve
                  const smallReserve = (denoms[0].qty - numP * q1) / denoms[0].qty;
                  if (smallReserve >= 0.15) {
                    score += 30;
                  } else if (smallReserve < 0.05) {
                    score -= 40;
                  }

                  // Value clean factor
                  if (stackValue % 1000 === 0) score += 30;
                  else if (stackValue % 500 === 0) score += 20;
                  else if (stackValue % 100 === 0) score += 10;

                  if (stackValue >= 1000) score += 20; // 4 denoms is great for >= 1000 stacks

                  if (score > bestScore) {
                    bestScore = score;
                    bestCandidate = {
                      denoms,
                      qtys: [q1, q2, q3, q4],
                      stackValue
                    };
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return { 
      success: false, 
      error: `No valid chip breakout found for ${numP} players and ${reb} rebuys. Try reducing players/rebuys in your settings.` 
    };
  }

  // Format active chips
  const activeChips = bestCandidate.denoms.map((denom, idx) => ({
    value: denom.value,
    qtyPerPlayer: bestCandidate.qtys[idx],
    color: denom.color,
    hex: denom.hex
  }));

  return {
    success: true,
    startingStack: bestCandidate.stackValue,
    activeChips,
    smallestChipValue: bestCandidate.denoms[0].value
  };
}

// THE LEVEL CALCULATOR MATH ENGINE
function runBlindsCalculator() {
  const playtime = Math.max(30, parseInt(document.getElementById('calc-playtime').value, 10) || 180);
  const lvlDur = Math.max(5, parseInt(document.getElementById('calc-level-dur').value, 10) || 15);
  const avgRebuys = Math.max(0, parseFloat(document.getElementById('calc-expected-rebuys').value) || 0);
  const finalBBPct = (parseFloat(document.getElementById('calc-end-bb-pct').value) || 6) / 100;
  
  const addBreaks = document.getElementById('calc-add-breaks').checked;
  const breakInterval = Math.max(1, parseInt(document.getElementById('calc-break-interval').value, 10) || 4);
  const breakDur = Math.max(5, parseInt(document.getElementById('calc-break-dur').value, 10) || 10);

  const estPlayers = Math.max(6, state.players.length || 8);
  const autoChips = document.getElementById('calc-auto-chips').checked;

  let startingStack = 10000;
  let smallestChip = 25;
  let calculatedActiveChips = null;

  if (autoChips) {
    const breakout = calculateChipBreakout(estPlayers, avgRebuys);
    if (!breakout.success) {
      alert(breakout.error);
      return;
    }
    startingStack = breakout.startingStack;
    smallestChip = breakout.smallestChipValue;
    calculatedActiveChips = breakout.activeChips;
    
    // Sync recommended breakout UI
    renderBreakoutSummary(breakout, estPlayers, avgRebuys);
  } else {
    startingStack = Math.max(100, parseInt(document.getElementById('calc-starting-stack').value, 10) || 10000);
    smallestChip = parseInt(document.getElementById('calc-smallest-chip').value, 10) || 25;
    document.getElementById('calc-breakout-card').style.display = 'none';
  }

  // 1. Estimate total chips in play
  const totalEntries = estPlayers + (estPlayers * avgRebuys);
  const totalChips = totalEntries * startingStack;

  // 2. Final target big blind (approx. 5%-7% of total chips)
  const targetFinalBB = totalChips * finalBBPct;

  // 3. Starting big blind
  const targetStartBB = smallestChip * 2;

  // 4. Calculate actual playing time and number of levels
  let numLevels = Math.ceil(playtime / lvlDur);
  let numBreaks = 0;
  
  if (addBreaks) {
    let currentTotalTime = 0;
    let levelsCount = 0;
    while (currentTotalTime < playtime) {
      levelsCount++;
      currentTotalTime += lvlDur;
      if (levelsCount % breakInterval === 0) {
        currentTotalTime += breakDur;
      }
    }
    numLevels = levelsCount;
    numBreaks = Math.floor((numLevels - 1) / breakInterval);
  }

  // 5. Interpolate blind levels from STANDARD_BLINDS list
  let startIndex = findClosestIndex(targetStartBB);
  let endIndex = findClosestIndex(targetFinalBB);

  if (endIndex <= startIndex) {
    endIndex = Math.min(STANDARD_BLINDS.length - 1, startIndex + numLevels);
  }

  const generatedLevels = [];
  let levelCounter = 1;
  const levelDurationSec = lvlDur * 60;
  const breakDurationSec = breakDur * 60;

  for (let i = 0; i < numLevels; i++) {
    const fraction = numLevels > 1 ? i / (numLevels - 1) : 0;
    const interpolatedIndex = Math.round(startIndex + (endIndex - startIndex) * fraction);
    const bb = STANDARD_BLINDS[Math.min(STANDARD_BLINDS.length - 1, interpolatedIndex)];
    const sb = Math.round(bb / 2);
    
    const isBBA = (levelCounter >= state.settings.bbaStartLevel);
    const ante = isBBA ? bb : 0;

    generatedLevels.push({
      type: 'level',
      label: `Level ${levelCounter}`,
      sb: sb,
      bb: bb,
      ante: ante,
      duration: levelDurationSec
    });

    if (addBreaks && levelCounter % breakInterval === 0 && i < numLevels - 1) {
      generatedLevels.push({
        type: 'break',
        label: `Break ${Math.floor(levelCounter / breakInterval)}`,
        duration: breakDurationSec
      });
    }

    levelCounter++;
  }

  // Send action to server
  sendAction('APPLY_CALCULATED_STRUCTURE', { levels: generatedLevels });
  
  // Intelligently calculate recommended rebuy cutoff level:
  // Usually rebuys stop at the end of the first break (which is immediately after the breakInterval level)
  let recommendedRebuyCutoff = 4;
  if (addBreaks && breakInterval > 0) {
    recommendedRebuyCutoff = breakInterval;
  } else {
    // Fallback: 1/3 of total playing levels
    const totalPlayingLevels = generatedLevels.filter(l => l.type === 'level').length;
    recommendedRebuyCutoff = Math.max(1, Math.round(totalPlayingLevels / 3));
  }

  // Synchronize settings (including startingStack and activeChips)
  const settingsUpdate = {
    levelDuration: lvlDur,
    breakDuration: breakDur,
    breakInterval: breakInterval,
    startingStack: startingStack,
    rebuyCutoffLevel: recommendedRebuyCutoff
  };
  
  if (calculatedActiveChips) {
    settingsUpdate.activeChips = calculatedActiveChips;
    settingsUpdate.autoCalculateChips = true;
  } else {
    settingsUpdate.autoCalculateChips = false;
  }
  
  sendAction('UPDATE_SETTINGS', { settings: settingsUpdate });

  alert(`Structure generated!\nStarting Stack: ${startingStack.toLocaleString()}\nLevels: ${levelCounter - 1}, Breaks: ${numBreaks}`);
}

function renderBreakoutSummary(breakout, numP, expectedRebuys) {
  const card = document.getElementById('calc-breakout-card');
  const details = document.getElementById('calc-breakout-details');
  if (!card || !details) return;

  card.style.display = 'block';
  
  let html = `
    <div style="font-size: 1.15rem; font-weight: 800; color: var(--accent-green); margin-bottom: 10px;">
      Stack Size: ${breakout.startingStack.toLocaleString()} Chips
    </div>
    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 5px; font-weight: 600;">PER PLAYER:</div>
    <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 15px;">
  `;

  breakout.activeChips.forEach(chip => {
    const totalUsed = numP * chip.qtyPerPlayer;
    html += `
      <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 6px; border-left: 4px solid ${chip.hex};">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 12px; height: 12px; border-radius: 50%; background-color: ${chip.hex}"></div>
          <span>${chip.color} (${chip.value})</span>
        </div>
        <div style="font-weight: 700; color: var(--text-primary);">
          ${chip.qtyPerPlayer} chips <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(uses ${totalUsed})</span>
        </div>
      </div>
    `;
  });

  html += `
    </div>
    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 5px; font-weight: 600;">BANK RESERVE (Rebuys & Change):</div>
    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
  `;

  // Calculate remaining bank reserve for ALL chips in inventory
  state.settings.chipInventory.forEach(invItem => {
    const activeMatch = breakout.activeChips.find(ac => ac.value === invItem.value);
    const qtyUsed = activeMatch ? (numP * activeMatch.qtyPerPlayer) : 0;
    const qtyLeft = invItem.qty - qtyUsed;
    
    html += `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; display: flex; align-items: center; gap: 6px;">
        <div style="width: 8px; height: 8px; border-radius: 50%; background-color: ${invItem.hex}"></div>
        <span>${invItem.color} (${invItem.value}): <strong>${qtyLeft} left</strong></span>
      </div>
    `;
  });

  html += `</div>`;
  details.innerHTML = html;
}

function findClosestIndex(targetValue) {
  let closestIndex = 0;
  let minDiff = Infinity;
  for (let i = 0; i < STANDARD_BLINDS.length; i++) {
    const diff = Math.abs(STANDARD_BLINDS[i] - targetValue);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
}
