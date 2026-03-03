const { app, BrowserWindow, ipcMain, Notification, safeStorage, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const { ImapFlow } = require('imapflow');
const { google } = require('googleapis');

const MAIL_CONFIG_FILE = 'mail-config.json';
const GCAL_CONFIG_FILE = 'gcal-config.json';
const BLOCK_SUBJECT_KEYWORDS = ['(광고)', '광고'];
const MAIL_LOOKBACK_DAYS = 7;
const GCAL_REDIRECT_PORT = 42813;
const GCAL_REDIRECT_URI = `http://127.0.0.1:${GCAL_REDIRECT_PORT}/oauth2callback`;
const appIconCache = new Map();
let mainWindow = null;
let overlayWindow = null;
let overlayHotspotTimer = null;

function stopOverlayHotspotLoop() {
  if (overlayHotspotTimer) {
    clearInterval(overlayHotspotTimer);
    overlayHotspotTimer = null;
  }
}

function startOverlayHotspotLoop() {
  stopOverlayHotspotLoop();
  overlayHotspotTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) {
      return;
    }
    if (overlayWindow._mycalClickThrough !== true) {
      return;
    }

    const bounds = overlayWindow.getBounds();
    const point = screen.getCursorScreenPoint();
    const inside =
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height;
    const inDragZone = inside && point.y <= bounds.y + 220;
    const shouldIgnore = !inDragZone;

    if (overlayWindow._mycalIgnoreApplied === shouldIgnore) {
      return;
    }

    overlayWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    overlayWindow._mycalIgnoreApplied = shouldIgnore;
  }, 60);
}

function getConfigPath() {
  return path.join(app.getPath('userData'), MAIL_CONFIG_FILE);
}

function getGCalConfigPath() {
  return path.join(app.getPath('userData'), GCAL_CONFIG_FILE);
}

function fallbackEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function fallbackDecode(value) {
  return Buffer.from(value, 'base64').toString('utf8');
}

function encryptSecret(value) {
  if (!value) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64');
  }
  return fallbackEncode(value);
}

function decryptSecret(value) {
  if (!value) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    }
    return fallbackDecode(value);
  } catch {
    return '';
  }
}

function defaultMailConfig() {
  return {
    pollSeconds: 45,
    ignoredSenders: [],
    accounts: []
  };
}

function sanitizeConfig(input) {
  const base = defaultMailConfig();
  if (!input || typeof input !== 'object') return base;

  const poll = Number(input.pollSeconds);
  base.pollSeconds = Number.isFinite(poll) ? Math.min(300, Math.max(15, Math.floor(poll))) : 45;

  const ignored = Array.isArray(input.ignoredSenders) ? input.ignoredSenders : [];
  base.ignoredSenders = ignored
    .map((v) => String(v).trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 200);

  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  base.accounts = accounts.slice(0, 10).map((acc, idx) => ({
    id: String(acc.id || `acc-${idx}`),
    name: String(acc.name || `Account ${idx + 1}`),
    host: String(acc.host || ''),
    port: Number(acc.port) || 993,
    secure: acc.secure !== false,
    username: String(acc.username || ''),
    enabled: acc.enabled !== false,
    passwordEnc: String(acc.passwordEnc || ''),
    password: String(acc.password || '')
  }));

  return base;
}

function readStoredConfigRaw() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaultMailConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return sanitizeConfig(JSON.parse(raw));
  } catch {
    return defaultMailConfig();
  }
}

function readStoredConfigForRenderer() {
  const config = readStoredConfigRaw();
  return {
    ...config,
    accounts: config.accounts.map((acc) => ({
      ...acc,
      password: decryptSecret(acc.passwordEnc),
      passwordEnc: undefined
    }))
  };
}

function writeStoredConfig(input) {
  const next = sanitizeConfig(input);
  const prev = readStoredConfigRaw();
  const prevMap = new Map(prev.accounts.map((acc) => [acc.id, acc]));

  const withEncrypted = {
    pollSeconds: next.pollSeconds,
    ignoredSenders: next.ignoredSenders,
    accounts: next.accounts.map((acc) => {
      let passwordEnc = '';
      if (acc.password) {
        passwordEnc = encryptSecret(acc.password);
      } else if (acc.passwordEnc) {
        passwordEnc = acc.passwordEnc;
      } else {
        const prevAcc = prevMap.get(acc.id);
        passwordEnc = prevAcc?.passwordEnc || '';
      }

      return {
        id: acc.id,
        name: acc.name,
        host: acc.host,
        port: acc.port,
        secure: acc.secure,
        username: acc.username,
        enabled: acc.enabled,
        passwordEnc
      };
    })
  };

  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(withEncrypted, null, 2), 'utf8');

  return readStoredConfigForRenderer();
}

function defaultGCalConfig() {
  return {
    clientId: '',
    clientSecretEnc: '',
    clientSecret: '',
    refreshTokenEnc: '',
    calendarId: 'primary',
    connected: false
  };
}

function sanitizeGCalConfig(input) {
  const base = defaultGCalConfig();
  if (!input || typeof input !== 'object') return base;

  return {
    clientId: String(input.clientId || ''),
    clientSecretEnc: String(input.clientSecretEnc || ''),
    clientSecret: String(input.clientSecret || ''),
    refreshTokenEnc: String(input.refreshTokenEnc || ''),
    calendarId: String(input.calendarId || 'primary') || 'primary',
    connected: Boolean(input.connected)
  };
}

function readGCalConfigRaw() {
  const configPath = getGCalConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaultGCalConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return sanitizeGCalConfig(JSON.parse(raw));
  } catch {
    return defaultGCalConfig();
  }
}

function readGCalConfigForRenderer() {
  const config = readGCalConfigRaw();
  const refreshToken = decryptSecret(config.refreshTokenEnc);
  return {
    clientId: config.clientId,
    clientSecret: decryptSecret(config.clientSecretEnc),
    calendarId: config.calendarId,
    connected: Boolean(refreshToken)
  };
}

function writeGCalConfig(input) {
  const next = sanitizeGCalConfig(input);
  const prev = readGCalConfigRaw();
  const looksLikeClientSecret = typeof next.calendarId === 'string' && next.calendarId.startsWith('GOCSPX-');

  const resolvedClientSecret = next.clientSecret || (looksLikeClientSecret ? next.calendarId : '');
  const resolvedCalendarId = looksLikeClientSecret ? 'primary' : next.calendarId;

  const result = {
    clientId: next.clientId,
    clientSecretEnc: resolvedClientSecret ? encryptSecret(resolvedClientSecret) : prev.clientSecretEnc || '',
    refreshTokenEnc: prev.refreshTokenEnc || '',
    calendarId: resolvedCalendarId || 'primary'
  };

  fs.mkdirSync(path.dirname(getGCalConfigPath()), { recursive: true });
  fs.writeFileSync(getGCalConfigPath(), JSON.stringify(result, null, 2), 'utf8');

  return readGCalConfigForRenderer();
}

function writeGCalTokens(patch) {
  const prev = readGCalConfigRaw();
  const next = {
    clientId: prev.clientId,
    clientSecretEnc: prev.clientSecretEnc,
    refreshTokenEnc: patch.refreshToken ? encryptSecret(patch.refreshToken) : patch.clearRefresh ? '' : prev.refreshTokenEnc,
    calendarId: prev.calendarId || 'primary'
  };

  fs.mkdirSync(path.dirname(getGCalConfigPath()), { recursive: true });
  fs.writeFileSync(getGCalConfigPath(), JSON.stringify(next, null, 2), 'utf8');

  return readGCalConfigForRenderer();
}

function getGoogleOAuthClient() {
  const cfg = readGCalConfigRaw();
  const clientSecret = decryptSecret(cfg.clientSecretEnc);
  if (!cfg.clientId || !clientSecret) {
    throw new Error('Google clientId/clientSecret required');
  }

  const oauth2 = new google.auth.OAuth2(cfg.clientId, clientSecret, GCAL_REDIRECT_URI);
  const refreshToken = decryptSecret(cfg.refreshTokenEnc);
  if (refreshToken) {
    oauth2.setCredentials({ refresh_token: refreshToken });
  }

  return oauth2;
}

async function connectGoogleCalendar() {
  const oauth2 = getGoogleOAuthClient();

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar']
  });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${GCAL_REDIRECT_PORT}`);
        if (reqUrl.pathname !== '/oauth2callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const incomingCode = reqUrl.searchParams.get('code');
        if (!incomingCode) {
          res.statusCode = 400;
          res.end('Missing code');
          reject(new Error('Missing auth code'));
          server.close();
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<h3>Google Calendar connected. You can close this window.</h3>');
        resolve(incomingCode);
        server.close();
      } catch (error) {
        reject(error);
        server.close();
      }
    });

    server.on('error', (error) => reject(error));

    server.listen(GCAL_REDIRECT_PORT, '127.0.0.1', () => {
      shell.openExternal(authUrl).catch(() => {
        // no-op
      });
    });

    setTimeout(() => {
      reject(new Error('Google auth timeout'));
      server.close();
    }, 180000);
  });

  const tokenResp = await oauth2.getToken(String(code));
  const refreshToken = tokenResp.tokens.refresh_token;
  if (!refreshToken) {
    const existing = decryptSecret(readGCalConfigRaw().refreshTokenEnc);
    if (!existing) {
      throw new Error('No refresh token returned. Retry with consent.');
    }
    return readGCalConfigForRenderer();
  }

  writeGCalTokens({ refreshToken });
  return readGCalConfigForRenderer();
}

function getCalendarClientOrThrow() {
  const oauth2 = getGoogleOAuthClient();
  const refreshToken = oauth2.credentials.refresh_token;
  if (!refreshToken) {
    throw new Error('Google calendar is not connected');
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2 });
  const cfg = readGCalConfigRaw();
  return {
    calendar,
    calendarId: cfg.calendarId || 'primary'
  };
}

function normalizeDateValue(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildEventFromTask(task) {
  const dueDate = normalizeDateValue(task.dueDate);
  if (!dueDate) {
    return null;
  }

  const nextDateObj = new Date(dueDate);
  nextDateObj.setDate(nextDateObj.getDate() + 1);
  const y = nextDateObj.getFullYear();
  const m = String(nextDateObj.getMonth() + 1).padStart(2, '0');
  const d = String(nextDateObj.getDate()).padStart(2, '0');
  const nextDate = `${y}-${m}-${d}`;

  return {
    summary: `[MYCAL] ${String(task.title || '').trim()}`,
    description: `mycalendarTaskId:${String(task.id || '')}\nstatus:${String(task.status || 'todo')}`,
    start: { date: dueDate },
    end: { date: nextDate },
    extendedProperties: {
      private: {
        mycalendarTaskId: String(task.id || ''),
        mycalendarStatus: String(task.status || 'todo')
      }
    }
  };
}

async function syncPushGoogleTasks(tasksInput) {
  const { calendar, calendarId } = getCalendarClientOrThrow();
  const tasks = Array.isArray(tasksInput) ? tasksInput : [];
  const mappings = [];

  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    const eventPayload = buildEventFromTask(task);
    if (!eventPayload) continue;

    try {
      const eventId = String(task.googleEventId || '').trim();
      if (eventId) {
        try {
          await calendar.events.patch({
            calendarId,
            eventId,
            requestBody: eventPayload
          });
          mappings.push({ taskId: String(task.id || ''), eventId });
        } catch (error) {
          const code = Number(error?.code || error?.status || 0);
          if (code === 404 || code === 410) {
            // Remote event was removed; recreate and remap.
            const recreated = await calendar.events.insert({
              calendarId,
              requestBody: eventPayload
            });
            if (recreated.data.id) {
              mappings.push({ taskId: String(task.id || ''), eventId: String(recreated.data.id) });
            }
          } else {
            throw error;
          }
        }
      } else {
        const created = await calendar.events.insert({
          calendarId,
          requestBody: eventPayload
        });
        if (created.data.id) {
          mappings.push({ taskId: String(task.id || ''), eventId: String(created.data.id) });
        }
      }
    } catch {
      // keep syncing others
    }
  }

  return {
    ok: true,
    mappings
  };
}

function parseTaskFromGoogleEvent(event) {
  if (!event || !event.id || !event.summary) return null;

  const startDate = normalizeDateValue(event.start?.date || event.start?.dateTime);
  if (!startDate) return null;

  const title = String(event.summary || '').replace(/^\[MYCAL\]\s*/i, '').trim();
  if (!title) return null;

  const taskId =
    String(event.extendedProperties?.private?.mycalendarTaskId || '').trim() || `gcal-${String(event.id)}`;

  return {
    id: taskId,
    title,
    dueDate: startDate,
    status: event.extendedProperties?.private?.mycalendarStatus === 'done' ? 'done' : 'todo',
    priority: 'medium',
    estimateMin: 25,
    source: 'google',
    googleEventId: String(event.id)
  };
}

async function syncPullGoogleTasks() {
  const { calendar, calendarId } = getCalendarClientOrThrow();

  const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  const result = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    maxResults: 500,
    orderBy: 'startTime'
  });

  const events = Array.isArray(result.data.items) ? result.data.items : [];
  const tasks = events
    .filter((event) => event.status !== 'cancelled')
    .map((event) => parseTaskFromGoogleEvent(event))
    .filter(Boolean);

  return {
    ok: true,
    tasks
  };
}

async function deleteGoogleEvent(eventIdInput) {
  const eventId = String(eventIdInput || '').trim();
  if (!eventId) {
    throw new Error('Missing Google eventId');
  }

  const { calendar, calendarId } = getCalendarClientOrThrow();
  try {
    await calendar.events.delete({
      calendarId,
      eventId
    });
    return { ok: true };
  } catch (error) {
    // If already deleted, treat as success to keep local and remote consistent.
    const code = Number(error?.code || error?.status || 0);
    if (code === 404 || code === 410) {
      return { ok: true };
    }
    throw error;
  }
}

function formatSender(addressObj) {
  if (!addressObj) {
    return { display: '(unknown)', address: '' };
  }
  const address = String(addressObj.address || '').toLowerCase();
  const name = String(addressObj.name || '').trim();
  return {
    display: name ? `${name} <${address}>` : address,
    address
  };
}

async function fetchUnreadFromAccount(account, ignoredSet) {
  const password = decryptSecret(account.passwordEnc);
  if (!account.enabled || !account.host || !account.username || !password) {
    return [];
  }

  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.username,
      pass: password
    },
    logger: false
  });

  const items = [];
  const cutoffTime = Date.now() - MAIL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });

    let unseenUids = await client.search({ seen: false });
    if (!Array.isArray(unseenUids) || unseenUids.length === 0) {
      return [];
    }

    unseenUids = unseenUids.slice(-50);

    for await (const msg of client.fetch(unseenUids, { uid: true, envelope: true, internalDate: true })) {
      const from = msg.envelope?.from?.[0];
      const sender = formatSender(from);
      if (!sender.address || ignoredSet.has(sender.address)) {
        continue;
      }

      const subject = String(msg.envelope?.subject || '(no subject)').trim();
      const lowerSubject = subject.toLowerCase();
      if (BLOCK_SUBJECT_KEYWORDS.some((keyword) => lowerSubject.includes(keyword.toLowerCase()))) {
        continue;
      }
      const dateValue = msg.internalDate || msg.envelope?.date || new Date();
      const mailTime = new Date(dateValue).getTime();
      if (!Number.isFinite(mailTime) || mailTime < cutoffTime) {
        continue;
      }
      items.push({
        id: `${account.id}:${msg.uid}`,
        uid: msg.uid,
        accountId: account.id,
        accountName: account.name,
        sender: sender.display,
        senderAddress: sender.address,
        subject,
        date: new Date(dateValue).toISOString()
      });
    }

    return items;
  } finally {
    try {
      await client.logout();
    } catch {
      // noop
    }
  }
}

async function markMailAsRead(accountId, uid) {
  const stored = readStoredConfigRaw();
  const account = stored.accounts.find((acc) => acc.id === String(accountId));
  if (!account || !account.enabled) {
    throw new Error('Account not found or disabled');
  }

  const password = decryptSecret(account.passwordEnc);
  if (!account.host || !account.username || !password) {
    throw new Error('Account credential is missing');
  }

  const parsedUid = Number(uid);
  if (!Number.isFinite(parsedUid) || parsedUid <= 0) {
    throw new Error('Invalid UID');
  }

  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.username,
      pass: password
    },
    logger: false
  });

  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: false });
    await client.messageFlagsAdd(parsedUid, ['\\Seen'], { uid: true });
    return true;
  } finally {
    try {
      await client.logout();
    } catch {
      // noop
    }
  }
}

async function fetchUnreadMails() {
  const stored = readStoredConfigRaw();
  const ignoredSet = new Set(stored.ignoredSenders);
  const all = [];
  const errors = [];

  for (const account of stored.accounts) {
    if (!account.enabled) continue;
    try {
      const rows = await fetchUnreadFromAccount(account, ignoredSet);
      all.push(...rows);
    } catch (error) {
      const detail = formatMailError(error);
      errors.push(`${account.name}: ${detail}`);
    }
  }

  all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    emails: all,
    errors,
    polledAt: new Date().toISOString()
  };
}

function formatMailError(error) {
  if (!error) return 'Unknown error';

  const parts = [];
  if (error.message) parts.push(String(error.message));
  if (error.code) parts.push(`code=${String(error.code)}`);
  if (error.response) parts.push(String(error.response));
  if (error.responseText) parts.push(String(error.responseText));

  const merged = parts.filter(Boolean).join(' | ');
  return merged || 'Unknown error';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    title: '',
    width: 340,
    height: 190,
    x: 30,
    y: 30,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    thickFrame: false,
    minWidth: 160,
    minHeight: 110,
    movable: true,
    focusable: true,
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  overlayWindow.setOpacity(1);
  overlayWindow._mycalClickThrough = true;
  overlayWindow._mycalIgnoreApplied = true;

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    overlayWindow.loadURL(`${devServerUrl}?overlay=1`);
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../dist/index.html'), {
      query: { overlay: '1' }
    });
  }

  overlayWindow.on('closed', () => {
    stopOverlayHotspotLoop();
    overlayWindow = null;
  });

  return overlayWindow;
}

function setOverlayVisible(visible) {
  const win = createOverlayWindow();
  if (visible) {
    win._mycalClickThrough = true;
    win.setIgnoreMouseEvents(true, { forward: true });
    win._mycalIgnoreApplied = true;
    startOverlayHotspotLoop();
    win.showInactive();
  } else {
    stopOverlayHotspotLoop();
    win.hide();
  }
}

function getOverlayState() {
  const exists = overlayWindow && !overlayWindow.isDestroyed();
  if (!exists) {
    return { visible: false };
  }
  return {
    visible: overlayWindow.isVisible()
  };
}

async function getFileIconDataUrl(filePath) {
  const key = String(filePath || '').trim().toLowerCase();
  if (!key) return '';
  if (appIconCache.has(key)) {
    return appIconCache.get(key);
  }

  try {
    const icon = await app.getFileIcon(filePath, { size: 'small' });
    if (icon && !icon.isEmpty()) {
      const dataUrl = icon.toDataURL();
      appIconCache.set(key, dataUrl);
      return dataUrl;
    }
  } catch {
    // noop
  }

  appIconCache.set(key, '');
  return '';
}

async function getActiveAppSample() {
  try {
    const mod = await import('active-win');
    const activeWin = mod.default;
    const info = await activeWin();
    if (!info) {
      return { app: 'Unknown', owner: '', title: '', exePath: '', iconDataUrl: '' };
    }
    const exePath = String(info.owner?.path || '');
    const iconDataUrl = await getFileIconDataUrl(exePath);
    return {
      app: String(info.owner?.name || info.owner?.bundleId || 'Unknown'),
      owner: String(info.owner?.name || ''),
      title: String(info.title || ''),
      exePath,
      iconDataUrl
    };
  } catch {
    return { app: 'Unavailable', owner: '', title: '', exePath: '', iconDataUrl: '' };
  }
}

ipcMain.handle('mail:get-config', async () => readStoredConfigForRenderer());
ipcMain.handle('mail:save-config', async (_event, config) => writeStoredConfig(config));
ipcMain.handle('mail:fetch-unread', async () => fetchUnreadMails());
ipcMain.handle('mail:mark-read', async (_event, payload) => {
  const accountId = String(payload?.accountId || '');
  const uid = Number(payload?.uid);
  return markMailAsRead(accountId, uid);
});
ipcMain.handle('mail:notify', async (_event, payload) => {
  if (!Notification.isSupported()) {
    return false;
  }

  const title = String(payload?.title || 'New mail');
  const body = String(payload?.body || '');
  const notification = new Notification({ title, body, silent: false });
  notification.show();
  return true;
});
ipcMain.handle('usage:get-active-app', async () => getActiveAppSample());
ipcMain.handle('overlay:show', async () => {
  setOverlayVisible(true);
  return getOverlayState();
});
ipcMain.handle('overlay:hide', async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.hide();
  }
  return getOverlayState();
});
ipcMain.handle('overlay:toggle', async () => {
  const state = getOverlayState();
  setOverlayVisible(!state.visible);
  return getOverlayState();
});
ipcMain.handle('overlay:resize', async (_event, payload) => {
  const win = createOverlayWindow();
  const rawW = Number(payload?.width);
  const rawH = Number(payload?.height);
  const width = Number.isFinite(rawW) ? Math.max(160, Math.min(1400, Math.floor(rawW))) : 340;
  const height = Number.isFinite(rawH) ? Math.max(110, Math.min(1000, Math.floor(rawH))) : 190;
  win.setSize(width, height, true);
  return { ok: true, width, height };
});
ipcMain.handle('overlay:get-state', async () => getOverlayState());

ipcMain.handle('gcal:get-config', async () => readGCalConfigForRenderer());
ipcMain.handle('gcal:save-config', async (_event, config) => writeGCalConfig(config));
ipcMain.handle('gcal:connect', async () => connectGoogleCalendar());
ipcMain.handle('gcal:disconnect', async () => writeGCalTokens({ clearRefresh: true }));
ipcMain.handle('gcal:sync-push', async (_event, payload) => syncPushGoogleTasks(payload?.tasks));
ipcMain.handle('gcal:sync-pull', async () => syncPullGoogleTasks());
ipcMain.handle('gcal:delete-event', async (_event, payload) => deleteGoogleEvent(payload?.eventId));

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible())) {
    app.quit();
  }
});
