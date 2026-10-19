const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { io } = require('socket.io-client');

const BACKEND_URL = 'https://wm-26-projekt-2-wm26-projekt2.2.rahtiapp.fi';
const tokenFile = () => path.join(app.getPath('userData'), 'tokens.json');

let mainWindow;
let socket;
let tokens;
let refreshTimer;
let refreshPromise;

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

async function readTokens() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure token storage is unavailable on this device.');
  }

  let contents;
  try {
    contents = await fs.readFile(tokenFile(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  const { encrypted } = JSON.parse(contents);
  return JSON.parse(
    safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  );
}

async function saveTokens(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure token storage is unavailable on this device.');
  }

  const encrypted = safeStorage
    .encryptString(JSON.stringify(value))
    .toString('base64');

  await fs.writeFile(tokenFile(), JSON.stringify({ encrypted }), 'utf8');
  tokens = value;
}

async function postJson(url, body, refreshToken) {
  const headers = { 'Content-Type': 'application/json' };

  if (refreshToken) {
    headers.Authorization = `Bearer ${refreshToken}`;
  }

  const options = {
    method: 'POST',
    headers
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || `Server request failed (${response.status}).`);
  }

  return result;
}

function clearRefreshTimer() {
  clearTimeout(refreshTimer);
}

function scheduleRefresh(accessToken) {
  clearRefreshTimer();

  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64url').toString('utf8')
    );

    if (typeof payload.exp !== 'number') return;

    const delay = Math.max(0, payload.exp * 1000 - Date.now() - 60_000);
    refreshTimer = setTimeout(() => {
      refreshAccessAndReconnect().catch((error) => {
        sendToRenderer('auth:error', error.message);
        sendToRenderer('chat:status', 'Could not refresh session');
      });
    }, delay);
  } catch {
    sendToRenderer('auth:error', 'Could not read the access token expiry.');
  }
}

async function refreshAccessAndReconnect() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    if (!tokens) tokens = await readTokens();
    if (!tokens?.refreshToken) {
      throw new Error('Please log in again.');
    }

    sendToRenderer('chat:status', 'Refreshing session…');

    const result = await postJson(
      `${BACKEND_URL}/users/refresh`,
      null,
      tokens.refreshToken
    );

    if (!result.jwt) {
      throw new Error('The server did not return a new access token.');
    }

    await saveTokens({
      accessToken: result.jwt,
      refreshToken: result.refresh_jwt || tokens.refreshToken
    });

    connectWithToken(tokens.accessToken);
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = undefined;
  }
}

function connectWithToken(accessToken) {
  clearRefreshTimer();

  if (socket) {
    const oldSocket = socket;
    socket = undefined;
    oldSocket.disconnect();
  }

  sendToRenderer('chat:status', 'Connecting…');

  const currentSocket = io(BACKEND_URL, {
    autoConnect: false,
    reconnection: false,
    extraHeaders: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  socket = currentSocket;

  currentSocket.on('connect', () => {
    if (socket !== currentSocket) return;
    sendToRenderer('chat:status', 'Connected');
    scheduleRefresh(accessToken);
  });

  currentSocket.on('disconnect', () => {
    if (socket === currentSocket) {
      clearRefreshTimer();
      sendToRenderer('chat:status', 'Disconnected');
    }
  });

  currentSocket.on('connect_error', (error) => {
    if (socket !== currentSocket) return;

    sendToRenderer('chat:status', 'Connection failed');

    if (error.message === 'Authentication failed') {
      refreshAccessAndReconnect().catch((refreshError) => {
        sendToRenderer('auth:error', refreshError.message);
      });
    }
  });

  currentSocket.on('chat message', (message) => {
    sendToRenderer('chat:message', message);
  });

  currentSocket.connect();
}

ipcMain.handle('auth:login', async (_event, credentials) => {
  if (!credentials?.email || !credentials?.password) {
    throw new Error('Email and password are required.');
  }

  const result = await postJson(`${BACKEND_URL}/users/login`, {
    email: credentials.email,
    password: credentials.password
  });

  if (!result.jwt || !result.refresh_jwt) {
    throw new Error('The server did not return both tokens.');
  }

  await saveTokens({
    accessToken: result.jwt,
    refreshToken: result.refresh_jwt
  });

  connectWithToken(tokens.accessToken);
});

ipcMain.handle('auth:reconnect', async () => {
  if (!tokens) tokens = await readTokens();

  if (tokens?.accessToken) {
    connectWithToken(tokens.accessToken);
  } else if (tokens?.refreshToken) {
    await refreshAccessAndReconnect();
  } else {
    throw new Error('Please log in to connect.');
  }
});

ipcMain.handle('chat:send', (_event, message) => {
  if (typeof message !== 'string' || !message.trim()) return;
  if (!socket?.connected) throw new Error('Chat is not connected.');

  socket.emit('chat message', message);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  clearRefreshTimer();
  socket?.disconnect();

  if (process.platform !== 'darwin') app.quit();
});