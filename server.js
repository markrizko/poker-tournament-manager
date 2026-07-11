const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const QRCode = require('qrcode');

let cachedQrCode = '';


const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'state.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, 'public')));

// Standard blind values list for interpolation
const STANDARD_BLINDS = [
  10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 600, 800, 1000,
  1200, 1600, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 
  12000, 15000, 20000, 25000, 30000, 40000, 50000, 60000, 
  80000, 100000, 120000, 150000, 200000, 250000, 300000, 
  400000, 500000, 600000, 800000, 1000000
];

function generateDefaultLevels(settings) {
  const duration = (settings.levelDuration || 15) * 60; // in seconds
  const breakDuration = (settings.breakDuration || 10) * 60;
  const breakInterval = settings.breakInterval || 4;

  const rawLevels = [
    { sb: 25, bb: 50 },
    { sb: 50, bb: 100 },
    { sb: 75, bb: 150 },
    { sb: 100, bb: 200 },
    { sb: 150, bb: 300 },
    { sb: 200, bb: 400 },
    { sb: 300, bb: 600 },
    { sb: 400, bb: 800 },
    { sb: 600, bb: 1200 },
    { sb: 800, bb: 1600 },
    { sb: 1000, bb: 2000 },
    { sb: 1500, bb: 3000 },
    { sb: 2000, bb: 4000 },
    { sb: 3000, bb: 6000 },
    { sb: 4000, bb: 8000 },
    { sb: 5000, bb: 10000 }
  ];

  const levelsList = [];
  let levelCounter = 1;

  for (let i = 0; i < rawLevels.length; i++) {
    const isBBAActive = (levelCounter >= settings.bbaStartLevel);
    levelsList.push({
      type: 'level',
      label: `Level ${levelCounter}`,
      sb: rawLevels[i].sb,
      bb: rawLevels[i].bb,
      ante: isBBAActive ? rawLevels[i].bb : 0,
      duration: duration
    });

    if (levelCounter % breakInterval === 0 && i < rawLevels.length - 1) {
      levelsList.push({
        type: 'break',
        label: `Break ${Math.floor(levelCounter / breakInterval)}`,
        duration: breakDuration
      });
    }
    levelCounter++;
  }

  return levelsList;
}

const defaultSettings = {
  startingBigBlinds: 100,
  startingStack: 500,
  buyIn: 20,
  rebuyAmount: 20,
  addonAmount: 20,
  levelDuration: 15, // minutes
  breakDuration: 10, // minutes
  breakInterval: 4,  // levels
  payoutCount: 3,
  payoutPercentages: [50, 30, 20],
  chipInventory: [
    { value: 5, qty: 75, color: 'White/Blue', hex: '#ffffff' },
    { value: 10, qty: 75, color: 'Red', hex: '#ef4444' },
    { value: 25, qty: 75, color: 'Green', hex: '#10b981' },
    { value: 50, qty: 75, color: 'Black', hex: '#1f2937' },
    { value: 100, qty: 50, color: 'Purple', hex: '#a855f7' },
    { value: 200, qty: 50, color: 'Orange', hex: '#f97316' },
    { value: 500, qty: 50, color: 'Yellow', hex: '#eab308' },
    { value: 1000, qty: 50, color: 'Brown', hex: '#78350f' }
  ],
  activeChips: [
    { value: 5, qtyPerPlayer: 5, color: 'White/Blue', hex: '#ffffff' },
    { value: 25, qtyPerPlayer: 7, color: 'Green', hex: '#10b981' },
    { value: 100, qtyPerPlayer: 3, color: 'Purple', hex: '#a855f7' }
  ],
  autoCalculateChips: true,
  autoAdvance: true,
  bbaStartLevel: 4
};

// Initial state
let state = {
  settings: { ...defaultSettings },
  players: [],
  levels: [],
  currentLevelIndex: 0,
  timer: {
    remainingSeconds: 900,
    isRunning: false,
    lastUpdated: 0
  },
  history: [],
  isStarted: false
};

// Generate default levels on boot
state.levels = generateDefaultLevels(state.settings);
state.timer.remainingSeconds = state.levels[0].duration;

// Load persisted state if exists
if (fs.existsSync(STATE_FILE)) {
  try {
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    const loaded = JSON.parse(data);
    
    // Merge defaultSettings properties that might be missing in loaded state (migration)
    if (loaded.settings) {
      if (!loaded.settings.chipInventory || loaded.settings.chipInventory.length === 0) {
        loaded.settings.chipInventory = [...defaultSettings.chipInventory];
      }
      if (!loaded.settings.activeChips) {
        loaded.settings.activeChips = [...defaultSettings.activeChips];
      }
      if (loaded.settings.autoCalculateChips === undefined) {
        loaded.settings.autoCalculateChips = defaultSettings.autoCalculateChips;
      }
      if (loaded.settings.startingBigBlinds === undefined) {
        loaded.settings.startingBigBlinds = defaultSettings.startingBigBlinds;
      }
    }
    
    if (loaded.isStarted === undefined) {
      loaded.isStarted = (loaded.players && loaded.players.length > 0);
    }
    
    // Merge loaded state into in-memory state
    state = { ...state, ...loaded };
    console.log('State loaded from state.json');
    saveState(); // Persist migrated settings immediately
  } catch (err) {
    console.error('Error loading state file:', err);
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving state file:', err);
  }
}

// Broadcaster to all WebSocket clients
function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastState() {
  broadcast({ 
    type: 'SYNC', 
    state,
    qrCode: cachedQrCode,
    localIPs: getLocalIPs(),
    port: PORT
  });
}

function broadcastTimer() {
  broadcast({
    type: 'TIMER_TICK',
    timer: state.timer,
    currentLevelIndex: state.currentLevelIndex
  });
}

// Central server-side timer loop
let timerInterval = null;
function startTimerLoop() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    if (state.timer.isRunning) {
      const now = Date.now();
      state.timer.remainingSeconds--;
      state.timer.lastUpdated = now;

      if (state.timer.remainingSeconds <= 0) {
        // Transition to next level
        handleNextLevel();
      } else {
        broadcastTimer();
      }
    }
  }, 1000);
}

function stopTimerLoop() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function handleNextLevel() {
  if (state.currentLevelIndex < state.levels.length - 1) {
    state.currentLevelIndex++;
    const nextLevel = state.levels[state.currentLevelIndex];
    state.timer.remainingSeconds = nextLevel.duration;
    state.timer.lastUpdated = Date.now();
    
    // Auto advance behavior
    if (!state.settings.autoAdvance) {
      state.timer.isRunning = false;
    }
    
    broadcastState();
    saveState();
  } else {
    // End of tournament
    state.timer.isRunning = false;
    state.timer.remainingSeconds = 0;
    state.timer.lastUpdated = Date.now();
    broadcastState();
    saveState();
  }
}

function handlePrevLevel() {
  if (state.currentLevelIndex > 0) {
    state.currentLevelIndex--;
    const prevLevel = state.levels[state.currentLevelIndex];
    state.timer.remainingSeconds = prevLevel.duration;
    state.timer.lastUpdated = Date.now();
    broadcastState();
    saveState();
  }
}

// If the server restarted while the clock was running, keep it running
if (state.timer.isRunning) {
  startTimerLoop();
}

// WS message handling
wss.on('connection', (ws) => {
  console.log('Client connected');
  // Send current state to newly connected client
  ws.send(JSON.stringify({ 
    type: 'SYNC', 
    state,
    qrCode: cachedQrCode,
    localIPs: getLocalIPs(),
    port: PORT
  }));

  ws.on('message', (messageStr) => {
    try {
      const action = JSON.parse(messageStr);
      console.log('Received action:', action.type);

      switch (action.type) {
        case 'PLAY':
          state.timer.isRunning = true;
          state.timer.lastUpdated = Date.now();
          startTimerLoop();
          broadcastState();
          saveState();
          break;

        case 'PAUSE':
          state.timer.isRunning = false;
          state.timer.lastUpdated = Date.now();
          broadcastState();
          saveState();
          break;

        case 'RESET_LEVEL':
          const currentLevel = state.levels[state.currentLevelIndex];
          state.timer.remainingSeconds = currentLevel.duration;
          state.timer.lastUpdated = Date.now();
          broadcastState();
          saveState();
          break;

        case 'SET_TIME':
          // Manually override remaining seconds
          state.timer.remainingSeconds = Math.max(0, action.seconds);
          state.timer.lastUpdated = Date.now();
          broadcastState();
          saveState();
          break;

        case 'NEXT_LEVEL':
          handleNextLevel();
          break;

        case 'PREV_LEVEL':
          handlePrevLevel();
          break;

        case 'SET_LEVEL_INDEX':
          if (action.index >= 0 && action.index < state.levels.length) {
            state.currentLevelIndex = action.index;
            state.timer.remainingSeconds = state.levels[state.currentLevelIndex].duration;
            state.timer.lastUpdated = Date.now();
            broadcastState();
            saveState();
          }
          break;

        case 'ADD_PLAYER':
          const newPlayer = {
            id: '_' + Math.random().toString(36).substr(2, 9),
            name: action.name.trim() || `Player ${state.players.length + 1}`,
            status: 'active',
            rebuys: 0,
            addons: 0,
            rank: null
          };
          state.players.push(newPlayer);
          broadcastState();
          saveState();
          break;

        case 'REMOVE_PLAYER':
          state.players = state.players.filter(p => p.id !== action.id);
          broadcastState();
          saveState();
          break;

        case 'ELIMINATE_PLAYER':
          const elimPlayer = state.players.find(p => p.id === action.id);
          if (elimPlayer && elimPlayer.status === 'active') {
            // Count active players to assign finishing rank
            const activeCount = state.players.filter(p => p.status === 'active').length;
            elimPlayer.status = 'eliminated';
            elimPlayer.rank = activeCount;
            elimPlayer.eliminatedAt = Date.now();
            broadcastState();
            saveState();
          }
          break;

        case 'REBUY_PLAYER':
          const rebPlayer = state.players.find(p => p.id === action.id);
          if (rebPlayer) {
            rebPlayer.rebuys++;
            // If they were eliminated, bring them back!
            if (rebPlayer.status === 'eliminated') {
              rebPlayer.status = 'active';
              rebPlayer.rank = null;
              rebPlayer.eliminatedAt = null;
            }
            broadcastState();
            saveState();
          }
          break;

        case 'ADDON_PLAYER':
          const addPlayer = state.players.find(p => p.id === action.id);
          if (addPlayer) {
            addPlayer.addons++;
            broadcastState();
            saveState();
          }
          break;

        case 'UNDO_ELIMINATION':
          const undoPlayer = state.players.find(p => p.id === action.id);
          if (undoPlayer && undoPlayer.status === 'eliminated') {
            undoPlayer.status = 'active';
            undoPlayer.rank = null;
            undoPlayer.eliminatedAt = null;
            broadcastState();
            saveState();
          }
          break;

        case 'REDUCE_REBUY':
          const redRebPlayer = state.players.find(p => p.id === action.id);
          if (redRebPlayer && redRebPlayer.rebuys > 0) {
            redRebPlayer.rebuys--;
            broadcastState();
            saveState();
          }
          break;

        case 'REDUCE_ADDON':
          const redAddPlayer = state.players.find(p => p.id === action.id);
          if (redAddPlayer && redAddPlayer.addons > 0) {
            redAddPlayer.addons--;
            broadcastState();
            saveState();
          }
          break;

        case 'UPDATE_SETTINGS':
          state.settings = { ...state.settings, ...action.settings };
          broadcastState();
          saveState();
          break;

        case 'REGEN_DEFAULT_STRUCTURE':
          state.levels = generateDefaultLevels(state.settings);
          state.currentLevelIndex = 0;
          state.timer.remainingSeconds = state.levels[0].duration;
          state.timer.lastUpdated = Date.now();
          broadcastState();
          saveState();
          break;

        case 'APPLY_CALCULATED_STRUCTURE':
          if (action.levels && action.levels.length > 0) {
            state.levels = action.levels;
            state.currentLevelIndex = 0;
            state.timer.remainingSeconds = state.levels[0].duration;
            state.timer.lastUpdated = Date.now();
            broadcastState();
            saveState();
          }
          break;

        case 'RESET_TOURNAMENT':
          state.players = [];
          state.currentLevelIndex = 0;
          state.timer.isRunning = false;
          state.levels = generateDefaultLevels(state.settings);
          state.timer.remainingSeconds = state.levels[0].duration;
          state.timer.lastUpdated = Date.now();
          state.isStarted = false;
          broadcastState();
          saveState();
          break;

        case 'START_TOURNAMENT':
          state.settings = { ...state.settings, ...action.settings };
          if (action.levels && action.levels.length > 0) {
            state.levels = action.levels;
          } else {
            state.levels = generateDefaultLevels(state.settings);
          }
          state.players = [];
          state.currentLevelIndex = 0;
          state.timer.isRunning = false;
          state.timer.remainingSeconds = state.levels[0].duration;
          state.timer.lastUpdated = Date.now();
          state.isStarted = true;
          broadcastState();
          saveState();
          break;
      }
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Helper to retrieve local network IP addresses
function getLocalIPs() {
  const ips = [];
  
  // 1. If running inside WSL, query the Windows host physical IPs
  if (process.platform === 'linux' && os.release().toLowerCase().includes('microsoft')) {
    try {
      // Run powershell.exe to query host IPs
      const cmd = "powershell.exe -Command \"Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi', 'Ethernet', 'Network' | Select-Object -ExpandProperty IPAddress\"";
      const output = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (output) {
        output.split(/\r?\n/).forEach(line => {
          const ip = line.trim();
          if (ip && ip.match(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/) && !ip.startsWith('169.254')) {
            ips.push(ip);
          }
        });
      }
    } catch (e) {
      // Fallback silently if powershell.exe is not accessible
    }
  }

  // 2. Fetch local network interfaces normally (native Linux, macOS, or Windows Node)
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (!ips.includes(iface.address) && !iface.address.startsWith('169.254')) {
          ips.push(iface.address);
        }
      }
    }
  }

  return ips;
}

// Start HTTP Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`Poker Tournament Manager Server started successfully!`);
  console.log(`Local Access: http://localhost:${PORT}`);
  
  const localIPs = getLocalIPs();
  
  // Get the internal WSL IP for port forwarding message
  let wslIP = '';
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        wslIP = iface.address;
        break;
      }
    }
    if (wslIP) break;
  }

  const isWSL = process.platform === 'linux' && os.release().toLowerCase().includes('microsoft');

  if (localIPs.length > 0) {
    console.log(`Network Access (Use your phone/tablet):`);
    localIPs.forEach(ip => {
      console.log(`  http://${ip}:${PORT}`);
    });

    // Generate pairing QR code for the primary local IP address
    const primaryIP = localIPs[0];
    QRCode.toDataURL(`http://${primaryIP}:${PORT}`, (err, url) => {
      if (!err) {
        cachedQrCode = url;
        console.log(`QR Code generated for pairing at http://${primaryIP}:${PORT}`);
      } else {
        console.error('Error generating pairing QR code:', err);
      }
    });

    if (isWSL && wslIP) {
      console.log(`\nWSL2 User Note:`);
      console.log(`If your phone cannot connect, run this command in Windows PowerShell (Admin):`);
      console.log(`  netsh interface portproxy add v4tov4 listenport=${PORT} listenaddress=0.0.0.0 connectport=${PORT} connectaddress=${wslIP}`);
      console.log(`Alternatively, enable Mirrored Networking in your .wslconfig file.`);
    }
  } else {
    console.log(`No active local network interfaces found for phone sync.`);
  }
  console.log(`=======================================================`);
});
