'use strict';

const {
  app, BrowserWindow, WebContentsView,
  ipcMain, session, Menu, MenuItem, shell, dialog
} = require('electron');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Platform flags & constants
// ---------------------------------------------------------------------------
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/**
 * TOOLBAR_HEIGHT must equal the combined pixel height rendered in CSS:
 *   .tab-bar  → 36 px
 *   .nav-bar  → 42 px
 *   total     → 78 px
 * The active BrowserView is positioned at y = TOOLBAR_HEIGHT.
 */
const TOOLBAR_HEIGHT = 78;

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------
let mainWindow = null;
const tabs = new Map();   // tabId  →  { view, url, title, favicon }
let activeTabId = null;
let tabIdCounter = 0;

/**
 * Renderer tells us how much horizontal space a side‑panel is using,
 * or whether the whole view should be hidden (modal open).
 */
let viewConfig = { rightOffset: 0, hidden: false };

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
const userDataDir = app.getPath('userData');
const settingsPath = path.join(userDataDir, 'isb_settings.json');
const historyPath = path.join(userDataDir, 'isb_history.json');
const bookmarksPath = path.join(userDataDir, 'isb_bookmarks.json');
const sessionPath = path.join(userDataDir, 'isb_session.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(fp, fallback) {
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_) { /* ignore parse errors */ }
  return fallback;
}

function writeJSON(fp, data) {
  try {
    ensureDir(path.dirname(fp));
    fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) { /* ignore write errors */ }
}

// ---------------------------------------------------------------------------
// Safe IPC sender (avoids crash if window is gone)
// ---------------------------------------------------------------------------
function send(channel, payload) {
  if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------------------------------------------------------------------------
// (Duplicate send function removed)

// ---------------------------------------------------------------------------
// Ad-Blocker Lite
// ---------------------------------------------------------------------------
const AD_PATTERNS = [
  "*://*.doubleclick.net/*",
  "*://*.googleadservices.com/*",
  "*://*.googlesyndication.com/*",
  "*://*.google-analytics.com/*",
  "*://creative.ak.fbcdn.net/*",
  "*://*.adbrite.com/*",
  "*://*.exponential.com/*",
  "*://*.quantserve.com/*",
  "*://*.scorecardresearch.com/*",
  "*://*.zedo.com/*",
  "*://*.taboola.com/*",
  "*://*.outbrain.com/*",
  "*://*.amazon-adsystem.com/*"
];

function enableAdBlocker(enable) {
  const ses = session.defaultSession;
  if (!ses) return;

  const filter = { urls: AD_PATTERNS };

  if (enable) {
    ses.webRequest.onBeforeRequest(filter, (details, callback) => {
      // console.log('[AdBlock] Blocked:', details.url);
      callback({ cancel: true });
    });
  } else {
    ses.webRequest.onBeforeRequest(filter, null);
  }
}
function createWindow() {
  const opts = {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    show: false
  };

  if (isMac) {
    opts.frame = true;
    opts.titleBarStyle = 'hidden';
    opts.trafficLightPosition = { x: 12, y: 22 };
    opts.vibrancy = 'ultra-dark';
    opts.transparent = true;
  } else {
    opts.frame = false;
    opts.transparent = false;
    opts.backgroundColor = '#0f0f1a';
  }

  mainWindow = new BrowserWindow(opts);

  // Remove native menu entirely (we don't use it)
  Menu.setApplicationMenu(null);

  mainWindow.loadFile('index.html');
  mainWindow.webContents.setZoomLevel(0);   // shell always at 100 %

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Keep every BrowserView sized when the OS resizes the window
  mainWindow.on('resize', resizeActiveView);

  // Persist open tab URLs so "Restore Session" can replay them
  mainWindow.on('close', () => {
    const sessionData = [...tabs.values()].map(t => ({ url: t.url }));
    writeJSON(sessionPath, sessionData);
  });

  mainWindow.on('closed', () => {
    tabs.forEach(t => { try { t.view.webContents.close(); } catch (_) { } });
    tabs.clear();
    activeTabId = null;
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Cache and performance optimization
// ---------------------------------------------------------------------------
function setupCacheAndPerformance() {
  // Set custom user agent with browser identifier
  session.defaultSession.setUserAgent(
    session.defaultSession.getUserAgent() + ' ISB/1.0'
  );
  // Note: Electron automatically manages cache storage in userData directory
}

// ---------------------------------------------------------------------------
// Download handler (attached once to the default session at app-ready)
// ---------------------------------------------------------------------------
function setupDownloadHandler() {
  session.defaultSession.on('will-download', (_event, item) => {
    const id = 'dl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    const filename = item.getFilename();
    const dlDir = app.getPath('downloads');
    ensureDir(dlDir);

    const filePath = dialog.showSaveDialogSync(mainWindow, {
      title: 'Save File',
      defaultPath: path.join(dlDir, filename),
      buttonLabel: 'Save'
    });

    if (!filePath) {
      item.cancel();
      return;
    }

    item.setSavePath(filePath);
    send('download-started', { id, filename, url: item.getURL() });

    item.on('done', (_ev, state) => {
      send('download-done', { id, state, savePath: filePath });
    });
  });
}

// ---------------------------------------------------------------------------
// Tab lifecycle
// ---------------------------------------------------------------------------
function createTab(tabUrl, options = {}) {
  if (!mainWindow) return null;

  const tabId = ++tabIdCounter;
  const isIncognito = options.incognito || false;

  const webPrefs = {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webgl: true,
    enableWebSQL: false,
    partition: isIncognito ? 'incognito' : 'persist:main'
  };
  if (tabUrl === 'isb://settings' || tabUrl === 'isb://account') webPrefs.preload = path.join(__dirname, 'preload.js');

  const view = new WebContentsView({ webPreferences: webPrefs });
  view.webContents.setZoomLevel(0);

  tabs.set(tabId, {
    view,
    url: tabUrl,
    title: 'New Tab',
    favicon: '',
    incognito: isIncognito
  });

  setupViewEvents(view, tabId);   // events first …
  showTab(tabId);                  // … attach & resize …

  if (tabUrl === 'isb://newtab') {
    const s = readJSON(settingsPath, {});
    view.webContents.loadFile(path.join(__dirname, 'newtab.html'), {
      search: 'engine=' + (s.searchEngine || 'google')
    });
  } else if (tabUrl === 'isb://settings') {
    view.webContents.loadFile(path.join(__dirname, 'settings.html'));
  } else if (tabUrl === 'isb://account') {
    view.webContents.loadFile(path.join(__dirname, 'account.html'));
  } else {
    try {
      view.webContents.loadURL(tabUrl);
    } catch (_) {
      view.webContents.loadFile(path.join(__dirname, 'newtab.html'));
    }
  }

  return tabId;
}

function closeTab(tabId) {
  if (!tabs.has(tabId) || !mainWindow) return null;

  const tab = tabs.get(tabId);
  mainWindow.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  tabs.delete(tabId);

  // Last tab gone → close the app window
  if (tabs.size === 0) {
    mainWindow.close();
    return null;
  }

  // If the closed tab was the visible one, pick the most‑recent remaining tab
  let newActiveId = null;
  let canGoBack = false;
  let canGoForward = false;

  if (activeTabId === tabId) {
    newActiveId = [...tabs.keys()].pop();
    showTab(newActiveId);
    const v = tabs.get(newActiveId).view;
    canGoBack = v.webContents.canGoBack();
    canGoForward = v.webContents.canGoForward();
  }

  return { newActiveTabId: newActiveId, canGoBack, canGoForward };
}

// ---------------------------------------------------------------------------
// Show / resize the active BrowserView
// ---------------------------------------------------------------------------
function showTab(tabId) {
  if (!mainWindow || !tabs.has(tabId)) return;

  // Remove every view first …
  tabs.forEach(t => {
    try {
      mainWindow.contentView.removeChildView(t.view);
      if (t.secondaryView) mainWindow.contentView.removeChildView(t.secondaryView);
    } catch (_) { }
  });

  activeTabId = tabId;
  const t = tabs.get(tabId);
  mainWindow.contentView.addChildView(t.view);
  if (t.isSplit && t.secondaryView) {
    mainWindow.contentView.addChildView(t.secondaryView);
  }

  resizeActiveView();
}

function resizeActiveView() {
  if (!mainWindow || !activeTabId || !tabs.has(activeTabId)) return;

  const t = tabs.get(activeTabId);
  const [width, height] = mainWindow.getContentSize();

  if (viewConfig.hidden) {
    // Modal is open – collapse the views
    t.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: 0, height: 0 });
    if (t.secondaryView) t.secondaryView.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: 0, height: 0 });
    return;
  }

  const leftOff = viewConfig.leftOffset || 0;
  const topOff = viewConfig.topOffset || 0;
  const baseTop = (typeof viewConfig.toolbarHeight === 'number') ? viewConfig.toolbarHeight : TOOLBAR_HEIGHT;

  const totalWidth = width - leftOff - (viewConfig.rightOffset || 0);
  const totalHeight = height - baseTop - topOff;
  const yPos = baseTop + topOff;

  if (t.isSplit && t.secondaryView) {
    const halfWidth = Math.floor(totalWidth / 2);
    t.view.setBounds({
      x: leftOff,
      y: yPos,
      width: halfWidth - 1,
      height: totalHeight
    });
    t.secondaryView.setBounds({
      x: leftOff + halfWidth + 1,
      y: yPos,
      width: totalWidth - halfWidth - 1,
      height: totalHeight
    });
  } else {
    t.view.setBounds({
      x: leftOff,
      y: yPos,
      width: totalWidth,
      height: totalHeight
    });
    if (t.secondaryView) t.secondaryView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }
}

// ---------------------------------------------------------------------------
// Per‑BrowserView event wiring
// ---------------------------------------------------------------------------
function setupViewEvents(view, tabId) {
  const wc = view.webContents;

  // ── navigation completed ────────────────────────────────────────────────
  wc.on('did-navigate', (_event, navUrl) => {
    const side = (view === tabs.get(tabId)?.secondaryView) ? 'right' : 'left';
    const displayUrl = navUrl.includes('newtab.html') ? 'isb://newtab' : navUrl;

    if (tabs.has(tabId)) {
      if (side === 'left') tabs.get(tabId).url = displayUrl;
    }

    send('tab-url-changed', { tabId, url: displayUrl, side });
    sendNavButtons(tabId);
    if (side === 'left') saveHistoryEntry(tabId);
    setTimeout(() => getFavicon(tabId), 600);
  });

  wc.on('did-navigate-in-page', (_event, navUrl) => {
    const side = (view === tabs.get(tabId)?.secondaryView) ? 'right' : 'left';
    if (tabs.has(tabId) && side === 'left') tabs.get(tabId).url = navUrl;
    send('tab-url-changed', { tabId, url: navUrl, side });
    sendNavButtons(tabId);
  });

  // ── loading lifecycle ────────────────────────────────────────────────────
  wc.on('did-start-loading', () => {
    const side = (view === tabs.get(tabId)?.secondaryView) ? 'right' : 'left';
    send('tab-load-state', { tabId, isLoading: true, side });
  });

  wc.on('did-stop-loading', () => {
    const side = (view === tabs.get(tabId)?.secondaryView) ? 'right' : 'left';
    send('tab-load-state', { tabId, isLoading: false, side });
    sendNavButtons(tabId);
    getFavicon(tabId);

    // Realistic Identity Integration: Detect Google session (only primary)
    const url = wc.getURL();
    if (side === 'left' && (url.includes('google.com') || url.includes('accounts.google.com'))) {
      detectGoogleIdentity(wc);
    }
  });

  wc.on('did-fail-load', () => {
    send('tab-load-state', { tabId, isLoading: false });
  });

  // ── popup / new‑window → open as sibling tab ────────────────────────────
  wc.setWindowOpenHandler(({ url }) => {
    const newTabId = createTab(url);
    if (newTabId) send('tab-created-from-main', { tabId: newTabId, url });
    return { action: 'deny' };
  });

  // ── find‑in‑page results ─────────────────────────────────────────────────
  wc.on('found-in-page', (_event, result) => {
    if (tabId === activeTabId) send('found-in-page', result);
  });

  // ── fullscreen support for HTML5 videos (YouTube, etc.) ──────────────────
  wc.on('enter-html-full-screen', () => {
    if (!mainWindow) return;
    const view = tabs.get(tabId)?.view;
    if (!view) return;

    // Make the BrowserView fill the entire window
    const [width, height] = mainWindow.getContentSize();
    view.setBounds({ x: 0, y: 0, width, height });

    // Notify renderer to hide browser chrome
    send('fullscreen-entered', { tabId });
  });

  wc.on('leave-html-full-screen', () => {
    // Restore normal layout
    resizeActiveView();
    send('fullscreen-exited', { tabId });
  });

  // ── page context menu ────────────────────────────────────────────────────
  wc.on('context-menu', (_event, params) => {
    const items = [];

    if (params.isEditable) {
      items.push({ label: 'Cut', click: () => wc.cut() });
      items.push({ label: 'Copy', click: () => wc.copy() });
      items.push({ label: 'Paste', click: () => wc.paste() });
      items.push({ label: 'Select All', click: () => wc.selectAll() });
    } else if (params.selectionText) {
      items.push({ label: 'Copy', click: () => wc.copy() });
    }

    if (params.linkURL) {
      if (items.length) items.push({ type: 'separator' });
      items.push({
        label: 'Open Link in New Tab',
        click: () => {
          const newTabId = createTab(params.linkURL);
          if (newTabId) send('tab-created-from-main', { tabId: newTabId, url: params.linkURL });
        }
      });
    }

    items.push({ type: 'separator' });
    items.push({ label: 'Inspect Element', click: () => wc.inspectElement(params.x, params.y) });

    const menu = new Menu();
    items.forEach(i => menu.append(new MenuItem(i)));
    menu.popup({ window: mainWindow });
  });

  // ── global shortcut intercepts ──────────────────────────────────────────
  wc.on('before-input-event', (event, input) => {
    // Alt + S -> Split focus toggle
    if (input.alt && input.code === 'KeyS' && input.type === 'keyDown') {
      event.preventDefault();
      send('toggle-split-focus');
    }
  });
}

// ---------------------------------------------------------------------------
// Small helpers used by event handlers
// ---------------------------------------------------------------------------
function sendNavButtons(tabId) {
  if (!tabs.has(tabId)) return;
  const v = tabs.get(tabId).view;
  send('tab-nav-buttons', {
    tabId,
    canGoBack: v.webContents.canGoBack(),
    canGoForward: v.webContents.canGoForward()
  });
}

async function getFavicon(tabId) {
  if (!tabs.has(tabId)) return;

  const wc = tabs.get(tabId).view.webContents;
  const tabUrl = tabs.get(tabId).url;
  let faviconUrl = '';

  try {
    faviconUrl = await wc.executeJavaScript(
      '(() => { const ls = document.querySelectorAll(\'link[rel*="icon"]\');' +
      ' for (const l of ls) { if (l.href) return l.href; } return \"\"; })()'
    );
  } catch (_) { /* page might be gone */ }

  if (!faviconUrl) {
    try { faviconUrl = new URL(tabUrl).origin + '/favicon.ico'; }
    catch (_) { return; }
  }

  if (tabs.has(tabId)) tabs.get(tabId).favicon = faviconUrl;
  send('tab-favicon-changed', { tabId, favicon: faviconUrl });
}

function saveHistoryEntry(tabId) {
  if (!tabs.has(tabId)) return;
  const { url, title } = tabs.get(tabId);
  if (!url || url === 'about:blank' || url.startsWith('chrome://') || url === 'isb://newtab' || url === 'isb://settings') return;

  const history = readJSON(historyPath, []);
  history.unshift({ url, title, timestamp: Date.now() });
  writeJSON(historyPath, history.slice(0, 2000));   // cap at 2 000 entries
}

// ---------------------------------------------------------------------------
// IPC channel registration (called once at app‑ready)
// ---------------------------------------------------------------------------
function setupIPC() {
  // ── tabs ───────────────────────────────────────────────────────────────
  // ── tabs ───────────────────────────────────────────────────────────────
  ipcMain.handle('create-tab', (_ev, opts) => {
    // opts might be just "url" string (legacy or direct main calls) OR { url, options } object
    let url = 'isb://newtab';
    let options = {};

    if (typeof opts === 'string') {
      url = opts;
    } else if (typeof opts === 'object' && opts !== null) {
      if (opts.url) url = opts.url;
      if (opts.options) options = opts.options;
    }

    return createTab(url, options);
  });

  ipcMain.handle('close-tab', (_ev, tabId) => {
    return closeTab(tabId);
  });

  ipcMain.handle('switch-tab', (_ev, tabId) => {
    if (!tabs.has(tabId)) return;
    showTab(tabId);
    const t = tabs.get(tabId);
    send('tab-switched', {
      tabId,
      url: t.url,
      title: t.title,
      favicon: t.favicon,
      incognito: t.incognito || false,
      canGoBack: t.view.webContents.canGoBack(),
      canGoForward: t.view.webContents.canGoForward()
    });
  });

  // ── navigation ─────────────────────────────────────────────────────────
  ipcMain.handle('navigate', (_ev, { tabId, url }) => {
    if (tabs.has(tabId)) {
      const t = tabs.get(tabId);
      const targetWc = (t.activeSide === 'right' && t.secondaryView)
        ? t.secondaryView.webContents
        : t.view.webContents;

      targetWc.loadURL(url);
    }
  });

  ipcMain.handle('go-back', (_ev, id) => { if (tabs.has(id)) tabs.get(id).view.webContents.goBack(); });
  ipcMain.handle('go-forward', (_ev, id) => { if (tabs.has(id)) tabs.get(id).view.webContents.goForward(); });
  ipcMain.handle('refresh', (_ev, id) => { if (tabs.has(id)) tabs.get(id).view.webContents.reload(); });
  ipcMain.handle('stop-loading', (_ev, id) => { if (tabs.has(id)) tabs.get(id).view.webContents.stop(); });

  // ── window controls ────────────────────────────────────────────────────
  ipcMain.handle('minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.handle('maximize', () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();
  });
  ipcMain.handle('close-window', () => { if (mainWindow) mainWindow.close(); });

  // ── BrowserView sizing from renderer ───────────────────────────────────
  ipcMain.handle('update-view-bounds', (_ev, config) => {
    viewConfig = config;
    resizeActiveView();
  });

  // ── persistence ────────────────────────────────────────────────────────
  ipcMain.handle('get-history', () => readJSON(historyPath, []));
  ipcMain.handle('clear-history', () => writeJSON(historyPath, []));
  ipcMain.handle('get-settings', () => readJSON(settingsPath, {
    glassTint: true, animations: true, showBookmarksBar: true,
    searchEngine: 'google', homepage: 'isb://newtab', startupBehavior: 'newtab'
  }));
  ipcMain.handle('save-settings', (_ev, s) => {
    writeJSON(settingsPath, s);
    enableAdBlocker(s.adBlock);
    send('settings-updated', s);   // notify main window so it can re-apply
  });


  // ── downloads ──────────────────────────────────────────────────────────
  ipcMain.handle('open-download', (_ev, sp) => {
    if (sp) shell.showItemInFolder(sp);
  });

  // ── bookmarks ──────────────────────────────────────────────────────────
  ipcMain.handle('get-bookmarks', () => readJSON(bookmarksPath, []));
  ipcMain.handle('save-bookmarks', (_ev, data) => writeJSON(bookmarksPath, data));

  // ── session ────────────────────────────────────────────────────────────
  ipcMain.handle('toggle-reader-mode', (_ev, tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab.view.webContents.executeJavaScript(`
    (function() {
      if (window._isReader) { location.reload(); return; }
      window._isReader = true;

      const title = document.title;
      // Heuristic for content
      const selectors = ['article', 'main', '.post-content', '.article-body', '.content'];
      let body = null;
      for (const s of selectors) {
        let el = document.querySelector(s);
        if (el) { body = el.cloneNode(true); break; }
      }
      if (!body) body = document.body.cloneNode(true);

      // Clean up
      const tagsToHide = ['nav', 'header', 'footer', 'aside', 'script', 'style', 'iframe', 'ads'];
      tagsToHide.forEach(t => body.querySelectorAll(t).forEach(x => x.remove()));

      document.body.innerHTML = \`
        <div id="isb-reader-container" style="
          max-width: 720px; margin: 0 auto; padding: 60px 40px;
          font-family: 'Charter', 'Georgia', serif; font-size: 19px; line-height: 1.7;
          color: #e6edf3; background: #0d1117; min-height: 100vh;
        ">
          <button onclick="location.reload()" style="
            position: fixed; top: 20px; left: 20px; padding: 8px 16px;
            background: #21262d; border: 1px solid #30363d; color: #c9d1d9;
            border-radius: 6px; cursor: pointer; font-family: sans-serif; font-size: 13px;
          ">Exit Reader</button>
          
          <h1 style="font-size: 36px; margin-bottom: 30px; line-height: 1.2;">\${title}</h1>
          <div style="opacity: 0.95;">\${body.innerHTML}</div>
        </div>
      \`;
      document.body.style.background = '#0d1117';
      window.scrollTo(0,0);
    })();
  `);
  });

  ipcMain.handle('toggle-pip', (_ev, tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab.view.webContents.executeJavaScript(`
    (function() {
      const vid = document.querySelector('video');
      if (!vid) return;
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else vid.requestPictureInPicture().catch(console.error);
    })();
  `);
  });

  ipcMain.handle('toggle-split', async (_ev, tabId) => {
    const t = tabs.get(tabId);
    if (!t) return false;

    if (t.isSplit) {
      // close split
      if (t.secondaryView) {
        mainWindow.contentView.removeChildView(t.secondaryView);
        t.secondaryView.webContents.destroy();
        t.secondaryView = null;
      }
      t.isSplit = false;
      t.activeSide = 'left';
    } else {
      // open split
      t.isSplit = true;
      t.activeSide = 'right';

      const webPrefs = {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: t.incognito ? 'incognito' : 'persist:main'
      };

      const sv = new WebContentsView({ webPreferences: webPrefs });
      t.secondaryView = sv;
      setupViewEvents(sv, tabId); // Use same tabId

      mainWindow.contentView.addChildView(sv);
      sv.webContents.loadURL('https://www.google.com');
    }

    resizeActiveView();
    return t.isSplit;
  });

  ipcMain.handle('set-split-active-side', (_ev, { tabId, side }) => {
    const t = tabs.get(tabId);
    if (t) t.activeSide = side;
  });

  ipcMain.handle('get-session', () => readJSON(sessionPath, []));

  // ── find in page ───────────────────────────────────────────────────────
  ipcMain.handle('find-in-page', (_ev, { tabId, text, options }) => {
    if (tabs.has(tabId)) return tabs.get(tabId).view.webContents.findInPage(text, options);
  });
  ipcMain.handle('stop-find', (_ev, tabId) => {
    if (tabs.has(tabId)) tabs.get(tabId).view.webContents.stopFind('clearSelection');
  });

  // ── zoom ────────────────────────────────────────────────────────────────
  ipcMain.handle('set-zoom', (_ev, { tabId, delta }) => {
    if (!tabs.has(tabId)) return 0;
    const wc = tabs.get(tabId).view.webContents;
    const current = wc.getZoomLevel();
    const next = delta === 0 ? 0 : Math.max(-5, Math.min(5, current + delta));
    wc.setZoomLevel(next);
    return next;
  });
  ipcMain.handle('get-zoom', (_ev, tabId) => {
    if (!tabs.has(tabId)) return 0;
    return tabs.get(tabId).view.webContents.getZoomLevel();
  });

  // ── privacy ────────────────────────────────────────────────────────────
  ipcMain.handle('clear-cache', async () => {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData();
  });

  // ── native browser menu ────────────────────────────────────────────────
  ipcMain.handle('open-browser-menu', (_ev, { x, y }) => {
    const menu = new Menu();

    menu.append(new MenuItem({
      label: 'New Tab',
      accelerator: 'CmdOrCtrl+T',
      click: () => { createTab('isb://newtab'); }
    }));

    menu.append(new MenuItem({
      label: 'New Incognito Tab',
      accelerator: 'CmdOrCtrl+Shift+N',
      click: () => { createTab('isb://newtab', { incognito: true }); }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: 'Settings',
      click: () => {
        // Check if settings tab exists
        const existing = [...tabs.values()].find(t => t.url === 'isb://settings');
        if (existing) {
          // Find key for value
          for (const [id, t] of tabs.entries()) {
            if (t === existing) { showTab(id); return; }
          }
        }
        createTab('isb://settings');
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: 'Clear Cache',
      click: async () => {
        await session.defaultSession.clearCache();
        await session.defaultSession.clearStorageData();
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Cache Cleared',
          message: 'All cached data has been cleared.'
        });
      }
    }));

    menu.append(new MenuItem({ type: 'separator' }));

    menu.append(new MenuItem({
      label: 'About',
      click: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'About',
          message: 'Ibrahim Samad Browser v1.0',
          detail: 'A premium desktop web browser built with Electron.\nCreated by Ibrahim Samad'
        });
      }
    }));

    menu.popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) });
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  setupIPC();
  setupCacheAndPerformance();
  setupDownloadHandler();

  // Initialize AdBlocker based on saved settings
  const s = readJSON(settingsPath, {});
  if (s.adBlock) enableAdBlocker(true);

  createWindow();

  // macOS: re‑create window when dock icon is clicked after last window closed
  app.on('activate', () => { if (!mainWindow) createWindow(); });
});

/**
 * Realistic Identity Integration: 
 * Scrapes Google user info if logged in.
 */
async function detectGoogleIdentity(wc) {
  try {
    const result = await wc.executeJavaScript(`
      (function() {
        // Find the account button / avatar
        const img = document.querySelector('img[src*="googleusercontent.com"], img.gb_A, .gb_6a img');
        if (!img) return null;
        
        let name = "Google User";
        let email = "";
        
        const accountBtn = document.querySelector('[aria-label*="Google Account"], [title*="Google Account"]');
        if (accountBtn) {
           const label = accountBtn.getAttribute('aria-label') || accountBtn.getAttribute('title');
           // Regex to extract Name and Email from "Google Account: Name (email)"
           const match = label.match(/Google Account:\\s*(.*?)\\s*\\((.*?)\\)/);
           if (match) {
             name = match[1];
             email = match[2];
           }
        }
        
        return { name, email, avatar: img.src };
      })()
    `);

    if (result && result.avatar) {
      const s = readJSON(settingsPath, {});
      // Only update if identity changed significantly
      if (!s.user || s.user.avatar !== result.avatar || s.user.name !== result.name) {
        s.user = result;
        writeJSON(settingsPath, s);
        send('settings-updated', s);
      }
    }
  } catch (e) {
    // Silently ignore script injection errors
  }
}

// Windows / Linux: quit when every window is closed
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
