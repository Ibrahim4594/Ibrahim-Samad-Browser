'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ---------------------------------------------------------------------------
// Whitelist of channels the renderer is allowed to listen on.
// Any channel NOT in this list is silently ignored.
// ---------------------------------------------------------------------------
const ALLOWED_CHANNELS = [
  'tab-url-changed',
  'tab-title-changed',
  'tab-favicon-changed',
  'tab-load-state',
  'tab-nav-buttons',
  'tab-switched',
  'download-started',
  'download-done',
  'tab-created-from-main',
  'settings-updated',
  'found-in-page',
  'toggle-split-focus'
];

contextBridge.exposeInMainWorld('ISB', {
  // ── platform identifier ──────────────────────────────────────────────────
  platform: process.platform,                       // 'win32' | 'darwin' | 'linux'

  // ── tab management ───────────────────────────────────────────────────────
  createTab: (url, options) => ipcRenderer.invoke('create-tab', { url, options }),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  switchTab: (tabId) => ipcRenderer.invoke('switch-tab', tabId),
  togglePiP: (tabId) => ipcRenderer.invoke('toggle-pip', tabId),
  toggleReaderMode: (tabId) => ipcRenderer.invoke('toggle-reader-mode', tabId),
  toggleSplit: (tabId) => ipcRenderer.invoke('toggle-split', tabId),
  setSplitActiveSide: (tabId, side) => ipcRenderer.invoke('set-split-active-side', { tabId, side }),

  // ── navigation ───────────────────────────────────────────────────────────
  navigate: (tabId, url) => ipcRenderer.invoke('navigate', { tabId, url }),
  goBack: (tabId) => ipcRenderer.invoke('go-back', tabId),
  goForward: (tabId) => ipcRenderer.invoke('go-forward', tabId),
  refresh: (tabId) => ipcRenderer.invoke('refresh', tabId),
  stopLoading: (tabId) => ipcRenderer.invoke('stop-loading', tabId),

  // ── window controls ──────────────────────────────────────────────────────
  minimize: () => ipcRenderer.invoke('minimize'),
  maximize: () => ipcRenderer.invoke('maximize'),
  closeWindow: () => ipcRenderer.invoke('close-window'),

  // ── BrowserView sizing ───────────────────────────────────────────────────
  //   config = { rightOffset: <number>, hidden: <bool> }
  updateViewBounds: (config) => ipcRenderer.invoke('update-view-bounds', config),

  // ── persistence ──────────────────────────────────────────────────────────
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // ── downloads ────────────────────────────────────────────────────────────
  openDownloadFolder: (savePath) => ipcRenderer.invoke('open-download', savePath),

  // ── bookmarks ─────────────────────────────────────────────────────────────
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  saveBookmarks: (bm) => ipcRenderer.invoke('save-bookmarks', bm),

  // ── session ───────────────────────────────────────────────────────────────
  getSession: () => ipcRenderer.invoke('get-session'),

  // ── native menu ───────────────────────────────────────────────────────────
  openBrowserMenu: (x, y) => ipcRenderer.invoke('open-browser-menu', { x, y }),

  // ── find in page ─────────────────────────────────────────────────────────
  findInPage: (tabId, text, options) => ipcRenderer.invoke('find-in-page', { tabId, text, options }),
  stopFind: (tabId) => ipcRenderer.invoke('stop-find', tabId),

  // ── zoom ──────────────────────────────────────────────────────────────────
  setZoom: (tabId, delta) => ipcRenderer.invoke('set-zoom', { tabId, delta }),
  getZoom: (tabId) => ipcRenderer.invoke('get-zoom', tabId),

  // ── privacy ───────────────────────────────────────────────────────────────
  clearCache: () => ipcRenderer.invoke('clear-cache'),

  // ── event bus (main → renderer) ──────────────────────────────────────────
  //   Usage:  ISB.on('tab-url-changed', ({ tabId, url }) => { … });
  on: (channel, cb) => {
    if (ALLOWED_CHANNELS.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => cb(...args));
    }
  }
});
