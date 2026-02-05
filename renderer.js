'use strict';

/* ---------------------------------------------------------------------------
   Ibrahim Samad Browser  –  Renderer process
   --------------------------------------------------------------------------- */

const api = window.ISB;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const tabsRow = document.getElementById('tabsRow');
const btnNewTab = document.getElementById('btnNewTab');
const addrBar = document.getElementById('addrBar');
const btnStar = document.getElementById('btnStar');
const btnReader = document.getElementById('btnReader');
const btnBack = document.getElementById('btnBack');
const btnFwd = document.getElementById('btnFwd');
const btnRefresh = document.getElementById('btnRefresh');
const btnBookmarks = document.getElementById('btnBookmarks');
const btnHistory = document.getElementById('btnHistory');
const btnDownloads = document.getElementById('btnDownloads');
const sidePanel = document.getElementById('sidePanel');
const panelTitle = document.getElementById('panelTitle');
const panelBody = document.getElementById('panelBody');
const loadBar = document.getElementById('loadBar');
const bookmarksBar = document.getElementById('bookmarksBar');
const ctxMenu = document.getElementById('ctxMenu');

const btnMin = document.getElementById('btnMin');
const btnMax = document.getElementById('btnMax');
const btnClose = document.getElementById('btnClose');

const btnPanelClose = document.getElementById('btnPanelClose');
const zoomCtrl = document.getElementById('zoomCtrl');
const zoomOut = document.getElementById('zoomOut');
const zoomIn = document.getElementById('zoomIn');
const zoomLabel = document.getElementById('zoomLabel');
const zoomReset = document.getElementById('zoomReset');
const findBar = document.getElementById('findBar');
const findInput = document.getElementById('findInput');
const findCount = document.getElementById('findCount');
const findPrev = document.getElementById('findPrev');
const findNext = document.getElementById('findNext');
const findClose = document.getElementById('findClose');
const dlBadge = document.getElementById('dlBadge');
const dlToast = document.getElementById('dlToast');
const dlToastTitle = document.getElementById('dlToastTitle');
const dlToastFile = document.getElementById('dlToastFile');
const btnMenu = document.getElementById('btnMenu');
const btnAi = document.getElementById('btnAi');
const btnPip = document.getElementById('btnPip');
const btnSplit = document.getElementById('btnSplit');
const splitDivider = document.getElementById('splitDivider');
const btnUser = document.getElementById('btnUser');
const imgUser = document.getElementById('imgUser');
const aiSidebar = document.getElementById('aiSidebar');
// browserMenu removed - using native menu

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let tabs = [];            // { id, title, url, favicon, isLoading, pinned }
let activeId = null;
let openPanel = null;          // 'history' | 'downloads' | 'bookmarks' | null
let isAiOpen = false;
let downloads = [];
let history = [];
let bookmarks = [];
let settings = {
  glassTint: true, animations: true, showBookmarksBar: true,
  searchEngine: 'google', homepage: 'isb://newtab', startupBehavior: 'newtab'
};
let ctxTabId = null;          // tab the right-click context menu targets

const SEARCH_ENGINES = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  yahoo: 'https://search.yahoo.com/search?p='
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function init() {
  const plat = api.platform === 'win32' ? 'win' : api.platform === 'darwin' ? 'mac' : 'linux';
  document.body.classList.add('platform-' + plat);

  settings = await api.getSettings();
  history = await api.getHistory();
  bookmarks = await api.getBookmarks();
  applySettings();
  renderBookmarksBar();

  api.on('tab-url-changed', onUrlChanged);
  api.on('tab-title-changed', onTitleChanged);
  api.on('tab-favicon-changed', onFaviconChanged);
  api.on('tab-load-state', onLoadState);
  api.on('tab-nav-buttons', onNavButtons);
  api.on('tab-switched', onTabSwitched);
  api.on('download-started', onDownloadStarted);
  api.on('download-done', onDownloadDone);
  api.on('tab-created-from-main', onTabCreatedFromMain);
  api.on('settings-updated', onSettingsUpdated);
  api.on('found-in-page', onFoundInPage);
  api.on('fullscreen-entered', onFullscreenEntered);
  api.on('fullscreen-exited', onFullscreenExited);
  api.on('toggle-split-focus', toggleSplitFocus);

  wireDom();

  // Startup behaviour
  if (settings.startupBehavior === 'restore') {
    const saved = await api.getSession();
    if (saved && saved.length > 0) {
      for (const entry of saved) await openNewTab(entry.url);
    } else {
      await openNewTab();
    }
  } else if (settings.startupBehavior === 'homepage') {
    const hp = (settings.homepage || '').trim();
    await openNewTab(hp || 'isb://newtab');
  } else {
    await openNewTab();
  }
}

// ---------------------------------------------------------------------------
// DOM event wiring
// ---------------------------------------------------------------------------
function wireDom() {
  // ── window controls ──
  btnMin.addEventListener('click', () => api.minimize());
  btnMax.addEventListener('click', () => api.maximize());
  btnClose.addEventListener('click', () => api.closeWindow());

  // ── navigation ──
  btnBack.addEventListener('click', () => api.goBack(activeId));
  btnFwd.addEventListener('click', () => api.goForward(activeId));
  btnRefresh.addEventListener('click', () => {
    const t = tabs.find(x => x.id === activeId);
    if (t && t.isLoading) api.stopLoading(activeId);
    else api.refresh(activeId);
  });

  // ── new tab ──
  btnNewTab.addEventListener('click', () => openNewTab());

  // ── pip ──
  btnPip.addEventListener('click', () => api.togglePiP(activeId));

  // ── split ──
  btnSplit.addEventListener('click', async () => {
    const isSplit = await api.toggleSplit(activeId);
    const t = tabs.get(activeId);
    if (t) {
      t.isSplit = isSplit;
      t.activeSide = isSplit ? 'right' : 'left';
    }
    document.body.classList.toggle('split-active', isSplit);
  });

  // Split Divider / Area focus switching (rough estimation via divider or clicks)
  // Since we can't easily catch BrowserView clicks, we'll add a small instruction
  // Or handle it via Palette

  // ── user / account ──
  btnUser.addEventListener('click', () => openNewTab('isb://account'));

  // ── address bar ──
  addrBar.addEventListener('focus', () => addrBar.select());
  addrBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); navigateTo(addrBar.value.trim()); }
  });

  // ── star (bookmark toggle) ──
  btnStar.addEventListener('click', toggleBookmark);

  // ── reader ──
  btnReader.addEventListener('click', () => api.toggleReaderMode(activeId));

  // ── side‑panel toggles ──
  btnBookmarks.addEventListener('click', () => togglePanel('bookmarks'));
  btnHistory.addEventListener('click', () => togglePanel('history'));
  btnDownloads.addEventListener('click', () => togglePanel('downloads'));
  btnPanelClose.addEventListener('click', closePanel);
  btnAi.addEventListener('click', toggleAiSidebar);

  // ── zoom controls (nav bar strip) ──
  zoomOut.addEventListener('click', () => applyZoom(-1));
  zoomIn.addEventListener('click', () => applyZoom(1));
  zoomReset.addEventListener('click', () => applyZoom(0));

  // ── find bar ──
  findInput.addEventListener('input', () => doFind(findInput.value, true));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doFind(findInput.value, !e.shiftKey); }
    if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
  });
  findPrev.addEventListener('click', () => doFind(findInput.value, false));
  findNext.addEventListener('click', () => doFind(findInput.value, true));
  findClose.addEventListener('click', closeFindBar);

  // ── context menu actions ──
  ctxMenu.querySelectorAll('.ctx-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleCtxAction(btn.dataset.action, ctxTabId);
      hideCtxMenu();
    });
  });

  // dismiss context menu on any outside click
  document.addEventListener('click', hideCtxMenu);

  // ── browser menu (three-dot) ──
  btnMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = btnMenu.getBoundingClientRect();
    api.openBrowserMenu(rect.left, rect.bottom + 5);
  });

  // ── global keyboard shortcuts ──
  document.addEventListener('keydown', onKeyDown);
}

// ---------------------------------------------------------------------------
// Tab helpers
// ---------------------------------------------------------------------------
async function openNewTab(url = 'isb://newtab') {
  try {
    const tabId = await api.createTab(url);
    tabs.push({ id: tabId, title: 'New Tab', url, favicon: '', isLoading: true, pinned: false });
    activeId = tabId;
    renderTabs();
    addrBar.value = (url === 'isb://newtab' || url === 'isb://settings') ? '' : url;
    btnBack.disabled = true;
    btnFwd.disabled = true;
    updateStarState();
    applyViewBounds();
  } catch (e) { console.error('[ISB] createTab failed', e); }
}

async function closeTabById(id, force = false) {
  if (id == null) return;
  const tab = tabs.find(t => t.id === id);
  if (tab && tab.pinned && !force) return;   // pinned tabs need force

  try {
    const result = await api.closeTab(id);
    tabs = tabs.filter(t => t.id !== id);
    if (!result) return;   // window closing (last tab)

    if (result.newActiveTabId != null) {
      activeId = result.newActiveTabId;
      const t = tabs.find(x => x.id === activeId);
      if (t) addrBar.value = (t.url === 'isb://newtab' || t.url === 'about:blank') ? '' : t.url;
      btnBack.disabled = !result.canGoBack;
      btnFwd.disabled = !result.canGoForward;
      updateStarState();
    }
    renderTabs();
    applyViewBounds();
  } catch (e) { console.error('[ISB] closeTab failed', e); }
}

// ---------------------------------------------------------------------------
// URL parser
// ---------------------------------------------------------------------------
function navigateTo(raw) {
  if (!raw) return;
  let url = raw;

  if (/^(https?|file):\/\//i.test(url) || /^(about|data|chrome):/i.test(url)) {
    // full URL – use as‑is
  } else if (/^localhost(:\d+)?/i.test(url) || /^127\.0\.0\.1(:\d+)?/.test(url)) {
    url = 'http://' + url;
  } else if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}/i.test(url) && !url.includes(' ')) {
    url = 'https://' + url;
  } else {
    const base = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google;
    url = base + encodeURIComponent(raw);
  }

  api.navigate(activeId, url);
  addrBar.value = url;
}

// ---------------------------------------------------------------------------
// Render tab bar  (pinned tabs first, then unpinned)
// ---------------------------------------------------------------------------
function renderTabs() {
  tabsRow.innerHTML = '';

  const pinned = tabs.filter(t => t.pinned);
  const unpinned = tabs.filter(t => !t.pinned);

  [...pinned, ...unpinned].forEach(t => {
    const pill = document.createElement('div');
    pill.className = 'tab'
      + (t.id === activeId ? ' tab--active' : '')
      + (t.pinned ? ' tab--pinned' : '')
      + (t.incognito ? ' tab--incognito' : '');

    // favicon
    const fav = document.createElement('img');
    fav.className = 'tab-favicon' + (t.favicon ? '' : ' hidden');
    fav.src = t.favicon || '';
    fav.alt = '';
    fav.draggable = false;
    fav.onerror = () => fav.classList.add('hidden');

    // title (hidden for pinned via CSS)
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = t.title || 'New Tab';

    // close × (hidden for pinned via CSS)
    const xBtn = document.createElement('button');
    xBtn.className = 'tab-close';
    xBtn.title = 'Close tab';
    xBtn.textContent = '\u00D7';
    xBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTabById(t.id);
    });

    pill.appendChild(fav);

    // Incognito icon
    if (t.incognito) {
      const spy = document.createElement('span');
      spy.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d2a8ff" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      spy.style.display = 'flex';
      spy.style.marginRight = '4px';
      pill.appendChild(spy);
    }

    pill.appendChild(titleEl);
    pill.appendChild(xBtn);

    // left‑click  → switch
    pill.addEventListener('click', () => {
      if (t.id !== activeId) api.switchTab(t.id);
    });
    // middle‑click → close (unpinned only)
    pill.addEventListener('mousedown', (e) => {
      if (e.button === 1 && !t.pinned) { e.preventDefault(); closeTabById(t.id); }
    });
    // right‑click → context menu
    pill.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showCtxMenu(e, t.id);
    });

    tabsRow.appendChild(pill);
  });
}

// ---------------------------------------------------------------------------
// IPC event handlers  (main → renderer)
// ---------------------------------------------------------------------------
function onUrlChanged({ tabId, url, side }) {
  const t = tabs.find(x => x.id === tabId);
  if (!t) return;

  const isPrimary = !side || side === 'left';
  if (isPrimary) t.url = url;
  else t.secondaryUrl = url;

  const isActiveSide = !side || side === (t.activeSide || 'left');
  if (tabId === activeId && isActiveSide) {
    addrBar.value = (url === 'isb://newtab' || url === 'isb://settings' || url === 'about:blank') ? '' : url;
    updateStarState();
  }
}

function onTitleChanged({ tabId, title }) {
  const t = tabs.find(x => x.id === tabId);
  if (t) { t.title = title; renderTabs(); }
}

function onFaviconChanged({ tabId, favicon }) {
  const t = tabs.find(x => x.id === tabId);
  if (t) { t.favicon = favicon; renderTabs(); }
}

function onLoadState({ tabId, isLoading, side }) {
  const t = tabs.find(x => x.id === tabId);
  if (!t) return;

  const isPrimary = !side || side === 'left';
  if (isPrimary) t.isLoading = isLoading;
  else t.secondaryLoading = isLoading;

  const isActiveSide = !side || side === (t.activeSide || 'left');
  if (tabId === activeId && isActiveSide) {
    btnRefresh.classList.toggle('loading', isLoading);

    if (isLoading) {
      loadBar.style.transition = 'none';
      loadBar.style.width = '0%';
      void loadBar.offsetWidth;
      loadBar.style.transition = 'width 2.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease';
      loadBar.classList.add('active');
      loadBar.style.width = '85%';
    } else {
      loadBar.style.transition = 'width 0.18s ease-out, opacity 0.3s ease';
      loadBar.style.width = '100%';
      setTimeout(() => {
        loadBar.classList.remove('active');
        loadBar.style.width = '0%';
      }, 220);
    }
  }
}

function onNavButtons({ tabId, canGoBack, canGoForward }) {
  if (tabId !== activeId) return;
  btnBack.disabled = !canGoBack;
  btnFwd.disabled = !canGoForward;
}

function onTabSwitched({ tabId, url, title, favicon, canGoBack, canGoForward }) {
  activeId = tabId;
  const t = tabs.find(x => x.id === tabId);
  if (t) {
    t.url = url;
    t.title = title;
    t.favicon = favicon;
    if (typeof arguments[0].incognito !== 'undefined') t.incognito = arguments[0].incognito;
  }

  addrBar.value = (url === 'isb://newtab' || url === 'about:blank') ? '' : url;
  btnBack.disabled = !canGoBack;
  btnFwd.disabled = !canGoForward;
  renderTabs();
  updateStarState();
  refreshZoomLabel();
  applyViewBounds();
}

function onTabCreatedFromMain({ tabId, url, incognito }) {
  if (tabs.find(x => x.id === tabId)) return;
  tabs.push({ id: tabId, title: 'New Tab', url, favicon: '', isLoading: true, pinned: false, incognito: !!incognito });
  activeId = tabId;
  renderTabs();
  addrBar.value = url;
  btnBack.disabled = true;
  btnFwd.disabled = true;
  updateStarState();
  applyViewBounds();
}

function onDownloadStarted(data) {
  data.state = 'active';
  downloads.unshift(data);
  if (openPanel === 'downloads') renderDownloads();
  updateDlBadge();
  showDlToast('Downloading…', data.filename, 'downloading');
}

function onDownloadDone(data) {
  const dl = downloads.find(d => d.id === data.id);
  if (dl) { dl.state = data.state; dl.savePath = data.savePath; }
  if (openPanel === 'downloads') renderDownloads();
  updateDlBadge();
  if (data.state === 'completed') showDlToast('Download complete', dl ? dl.filename : '', 'done');
  else showDlToast('Download failed', dl ? dl.filename : '', 'failed');
}

// ── badge: count of active downloads ──
function updateDlBadge() {
  const active = downloads.filter(d => d.state === 'active').length;
  dlBadge.textContent = active;
  dlBadge.classList.toggle('show', active > 0);
}

// ── toast popup near the downloads icon ──
let toastTimer = null;
function showDlToast(title, file, state) {
  dlToastTitle.textContent = title;
  dlToastTitle.className = 'dl-toast-title ' + state;
  dlToastFile.textContent = file || '';
  dlToast.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dlToast.classList.remove('show'), 3500);
}

// ---------------------------------------------------------------------------
// Bookmarks  –  star toggle + bar + panel
// ---------------------------------------------------------------------------
function updateStarState() {
  const t = tabs.find(x => x.id === activeId);
  const url = t ? t.url : '';
  btnStar.classList.toggle('active', bookmarks.some(b => b.url === url));
}

async function toggleBookmark() {
  const t = tabs.find(x => x.id === activeId);
  if (!t || !t.url || t.url === 'isb://newtab' || t.url === 'isb://settings' || t.url === 'about:blank') return;

  const idx = bookmarks.findIndex(b => b.url === t.url);
  if (idx !== -1) {
    bookmarks.splice(idx, 1);
  } else {
    bookmarks.unshift({ url: t.url, title: t.title || t.url, favicon: t.favicon || '', addedAt: Date.now() });
  }

  await api.saveBookmarks(bookmarks);
  updateStarState();
  renderBookmarksBar();
  if (openPanel === 'bookmarks') renderBookmarksList();
}

function renderBookmarksBar() {
  bookmarksBar.innerHTML = '';

  if (settings.showBookmarksBar === false) {
    bookmarksBar.classList.add('hidden');
    return;
  }
  bookmarksBar.classList.remove('hidden');

  if (bookmarks.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'bm-bar-hint';
    hint.textContent = 'Star pages to see them here';
    bookmarksBar.appendChild(hint);
    return;
  }

  bookmarks.forEach((bm, idx) => {
    const pill = document.createElement('button');
    pill.className = 'bm-pill';
    pill.title = bm.url;

    if (bm.favicon) {
      const img = document.createElement('img');
      img.className = 'bm-favicon';
      img.src = bm.favicon;
      img.alt = '';
      img.onerror = () => img.classList.add('hidden');
      pill.appendChild(img);
    }

    const label = document.createElement('span');
    label.className = 'bm-label';
    label.textContent = bm.title || bm.url;
    pill.appendChild(label);

    pill.addEventListener('click', () => navigateTo(bm.url));

    // right‑click on a bookmark pill → remove it
    pill.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      bookmarks.splice(idx, 1);
      api.saveBookmarks(bookmarks);
      renderBookmarksBar();
      updateStarState();
      if (openPanel === 'bookmarks') renderBookmarksList();
    });

    bookmarksBar.appendChild(pill);
  });
}

// ---------------------------------------------------------------------------
// Side panel  (history / downloads / bookmarks)
// ---------------------------------------------------------------------------
function togglePanel(type) {
  if (isAiOpen) toggleAiSidebar(); // close AI if opening panel

  if (openPanel === type) { closePanel(); return; }

  openPanel = type;
  sidePanel.classList.add('open');

  const titles = { history: 'History', downloads: 'Downloads', bookmarks: 'Bookmarks' };
  panelTitle.textContent = titles[type] || type;

  btnBookmarks.classList.toggle('active', type === 'bookmarks');
  btnHistory.classList.toggle('active', type === 'history');
  btnDownloads.classList.toggle('active', type === 'downloads');

  if (type === 'history') renderHistory();
  else if (type === 'downloads') renderDownloads();
  else if (type === 'bookmarks') renderBookmarksList();

  applyViewBounds();
}

function closePanel() {
  openPanel = null;
  sidePanel.classList.remove('open');
  btnBookmarks.classList.remove('active');
  btnHistory.classList.remove('active');
  btnDownloads.classList.remove('active');
  applyViewBounds();
}

function toggleAiSidebar() {
  if (openPanel) closePanel();

  isAiOpen = !isAiOpen;
  if (isAiOpen) {
    aiSidebar.classList.add('open');
    btnAi.classList.add('active');
  } else {
    aiSidebar.classList.remove('open');
    btnAi.classList.remove('active');
  }
  applyViewBounds();
}

// ── history list ──
function renderHistory() {
  panelBody.innerHTML = '';

  if (history.length === 0) {
    panelBody.innerHTML = '<div class="panel-empty">No history yet</div>';
    return;
  }

  const clearBtn = document.createElement('button');
  clearBtn.className = 'panel-clear';
  clearBtn.textContent = 'Clear All History';
  clearBtn.addEventListener('click', async () => {
    await api.clearHistory();
    history = [];
    renderHistory();
  });
  panelBody.appendChild(clearBtn);

  history.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const icon = document.createElement('div');
    icon.className = 'list-item-icon';
    icon.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 18 18" fill="none">' +
      '<circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="2"/>' +
      '<polyline points="9,5 9,9 12,11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';

    const text = document.createElement('div');
    text.className = 'list-item-text';
    text.innerHTML =
      '<div class="list-item-title">' + escHtml(entry.title || entry.url) + '</div>' +
      '<div class="list-item-sub">' + escHtml(entry.url) + '&nbsp;&nbsp;' + formatTime(entry.timestamp) + '</div>';

    item.appendChild(icon);
    item.appendChild(text);
    item.addEventListener('click', () => { navigateTo(entry.url); closePanel(); });
    panelBody.appendChild(item);
  });
}

// ── downloads list ──
function renderDownloads() {
  panelBody.innerHTML = '';

  if (downloads.length === 0) {
    panelBody.innerHTML = '<div class="panel-empty">No downloads yet</div>';
    return;
  }

  const clearBtn = document.createElement('button');
  clearBtn.className = 'panel-clear';
  clearBtn.textContent = 'Clear Downloads List';
  clearBtn.addEventListener('click', () => {
    downloads = [];
    renderDownloads();
  });
  panelBody.appendChild(clearBtn);

  downloads.forEach(dl => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const icon = document.createElement('div');
    icon.className = 'list-item-icon';
    icon.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 18 18" fill="none">' +
      '<path d="M9 2v9M5 8l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<line x1="3" y1="15" x2="15" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>';

    let statusHtml = '';
    if (dl.state === 'active') {
      statusHtml = '<span class="dl-status dl-status--active">Downloading…</span>';
    } else if (dl.state === 'completed') {
      statusHtml = '<span class="dl-status dl-status--done">Complete</span>' +
        ' <button class="dl-reveal" data-path="' + escHtml(dl.savePath || '') + '">Show in folder</button>';
    } else {
      statusHtml = '<span class="dl-status dl-status--fail">Failed</span>';
    }

    const text = document.createElement('div');
    text.className = 'list-item-text';
    text.innerHTML =
      '<div class="list-item-title">' + escHtml(dl.filename) + '</div>' +
      '<div class="list-item-sub">' + statusHtml + '</div>';

    item.appendChild(icon);
    item.appendChild(text);
    panelBody.appendChild(item);
  });

  panelBody.querySelectorAll('.dl-reveal').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      api.openDownloadFolder(btn.dataset.path);
    });
  });
}

// ── bookmarks list (manager panel) ──
function renderBookmarksList() {
  panelBody.innerHTML = '';

  if (bookmarks.length === 0) {
    panelBody.innerHTML = '<div class="panel-empty">No bookmarks yet.<br>Star a page to add it here.</div>';
    return;
  }

  bookmarks.forEach((bm, idx) => {
    const item = document.createElement('div');
    item.className = 'list-item';

    const icon = document.createElement('div');
    icon.className = 'list-item-icon';
    if (bm.favicon) {
      icon.innerHTML = '<img src="' + escHtml(bm.favicon) + '" style="width:16px;height:16px;object-fit:contain" onerror="this.style.display=\'none\'" />';
    } else {
      icon.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 18 18" fill="none">' +
        '<path d="M9 2L11.5 7 17 7.5 13 11l1 5.5L9 14l-5 2.5 1-5.5-4-3.5 5.5-.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
        '</svg>';
    }

    const text = document.createElement('div');
    text.className = 'list-item-text';
    text.innerHTML =
      '<div class="list-item-title">' + escHtml(bm.title || bm.url) + '</div>' +
      '<div class="list-item-sub">' + escHtml(bm.url) + '</div>';

    // delete button (appears on hover via CSS)
    const delBtn = document.createElement('button');
    delBtn.className = 'bm-del';
    delBtn.title = 'Remove bookmark';
    delBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
      '<line x1="2" y1="2" x2="12" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '<line x1="12" y1="2" x2="2" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bookmarks.splice(idx, 1);
      api.saveBookmarks(bookmarks);
      renderBookmarksList();
      renderBookmarksBar();
      updateStarState();
    });

    item.appendChild(icon);
    item.appendChild(text);
    item.appendChild(delBtn);

    item.addEventListener('click', () => { navigateTo(bm.url); closePanel(); });
    panelBody.appendChild(item);
  });
}

// ---------------------------------------------------------------------------
// Context menu  (tab right‑click)
// ---------------------------------------------------------------------------
function showCtxMenu(e, tabId) {
  ctxTabId = tabId;
  const t = tabs.find(x => x.id === tabId);

  // update "Pin / Unpin" label
  const pinBtn = ctxMenu.querySelector('[data-action="pin"]');
  pinBtn.textContent = (t && t.pinned) ? 'Unpin Tab' : 'Pin Tab';

  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top = e.clientY + 'px';
  ctxMenu.classList.add('open');
}

function hideCtxMenu() {
  ctxMenu.classList.remove('open');
  ctxTabId = null;
}

async function handleCtxAction(action, tabId) {
  if (!tabId) return;
  const tab = tabs.find(t => t.id === tabId);

  switch (action) {
    case 'pin':
      if (tab) { tab.pinned = !tab.pinned; renderTabs(); }
      break;

    case 'duplicate':
      if (tab) await openNewTab(tab.url);
      break;

    case 'close':
      await closeTabById(tabId, true);   // force – works on pinned too
      break;

    case 'close-others': {
      // switch to target first so main.js activeTabId is correct
      if (activeId !== tabId) { await api.switchTab(tabId); activeId = tabId; }
      const others = tabs.filter(t => t.id !== tabId && !t.pinned);
      for (const t of others) await api.closeTab(t.id);
      tabs = tabs.filter(t => t.id === tabId || t.pinned);
      renderTabs();
      applyViewBounds();
      break;
    }

    case 'close-right': {
      // rendered order: pinned … unpinned …
      const ordered = [...tabs.filter(t => t.pinned), ...tabs.filter(t => !t.pinned)];
      const idx = ordered.findIndex(t => t.id === tabId);
      const toClose = ordered.slice(idx + 1).filter(t => !t.pinned);

      for (const t of toClose) await api.closeTab(t.id);
      tabs = tabs.filter(t => !toClose.some(c => c.id === t.id));

      // if active tab was among closed, switch to target
      if (!tabs.find(t => t.id === activeId)) {
        activeId = tabId;
        await api.switchTab(tabId);
      }
      renderTabs();
      applyViewBounds();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Settings apply
// ---------------------------------------------------------------------------
function applySettings() {
  document.body.classList.toggle('no-glass', settings.glassTint === false);
  document.body.classList.toggle('no-anim', settings.animations === false);

  const shell = document.querySelector('.shell');
  if (shell) shell.classList.toggle('vertical-tabs', settings.verticalTabs === true);

  if (settings.user && settings.user.avatar) {
    imgUser.src = settings.user.avatar;
    btnUser.title = `Signed in as ${settings.user.name}`;
  } else {
    imgUser.src = `https://ui-avatars.com/api/?name=User&background=random`;
    btnUser.title = 'Sign in';
  }

  if (settings.accentColor) applyTheme(settings.accentColor);
}

function applyTheme(color) {
  document.documentElement.style.setProperty('--accent-color', color);
}

function onSettingsUpdated(newSettings) {
  settings = newSettings;
  applySettings();
  renderBookmarksBar();
  applyViewBounds();
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------
// Electron zoom levels: 0 = 100%, each step ≈ 20% (1→120%, -1→80%, etc.)
const ZOOM_PERCENTS = { '-5': 49, '-4': 57, '-3': 67, '-2': 80, '-1': 90, '0': 100, '1': 110, '2': 125, '3': 150, '4': 175, '5': 200 };

async function applyZoom(delta) {
  const level = await api.setZoom(activeId, delta);
  updateZoomLabel(level);
}

function updateZoomLabel(level) {
  const pct = ZOOM_PERCENTS[String(Math.round(level))] || 100;
  const txt = pct + '%';
  zoomLabel.textContent = txt;
  zoomCtrl.classList.toggle('visible', level !== 0);
}

async function refreshZoomLabel() {
  const level = await api.getZoom(activeId);
  updateZoomLabel(level);
}

// ---------------------------------------------------------------------------
// Find in page
// ---------------------------------------------------------------------------
function openFindBar() {
  findBar.classList.add('open');
  findInput.value = '';
  findCount.textContent = '';
  findInput.classList.remove('not-found');
  findInput.focus();
}

function closeFindBar() {
  findBar.classList.remove('open');
  api.stopFind(activeId);
  findCount.textContent = '';
  findInput.classList.remove('not-found');
}

function doFind(text, forward) {
  if (!text) { api.stopFind(activeId); findCount.textContent = ''; findInput.classList.remove('not-found'); return; }
  api.findInPage(activeId, text, { forward, highlightAll: true });
}

function onFoundInPage(result) {
  if (result.matches > 0) {
    findCount.textContent = result.activeMatchIndex + ' of ' + result.matches;
    findInput.classList.remove('not-found');
  } else {
    findCount.textContent = 'Phrase not found';
    findInput.classList.add('not-found');
  }
}

// ---------------------------------------------------------------------------
// BrowserView sizing helper
// ---------------------------------------------------------------------------
function getTopOffset() {
  return settings.showBookmarksBar !== false ? 28 : 0;
}

function applyViewBounds() {
  let rightOffset = 0;
  if (openPanel) rightOffset = 300;
  else if (isAiOpen) rightOffset = 320;

  let leftOffset = 0;
  let toolbarHeight = 78;

  if (settings.verticalTabs) {
    leftOffset = 220;
    toolbarHeight = 48;
  }

  api.updateViewBounds({
    rightOffset,
    leftOffset,
    toolbarHeight,
    hidden: false,
    topOffset: getTopOffset()
  });
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------
function onKeyDown(e) {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    api.createTab('isb://newtab', { incognito: true });
    return;
  }

  if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); openNewTab(); return; }
  if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTabById(activeId); return; }
  if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); addrBar.focus(); addrBar.select(); return; }
  if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); api.refresh(activeId); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); toggleBookmark(); return; }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openFindBar(); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(1); return; }
  if (mod && e.key === '-') { e.preventDefault(); applyZoom(-1); return; }
  if (mod && e.key === '0') { e.preventDefault(); applyZoom(0); return; }
  if (e.key === 'F5') { e.preventDefault(); api.refresh(activeId); return; }
  if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); api.goBack(activeId); return; }
  if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); api.goForward(activeId); return; }

  if (e.key === 'Escape') {
    if (findBar.classList.contains('open')) { closeFindBar(); return; }
    if (ctxMenu.classList.contains('open')) { hideCtxMenu(); return; }
    if (openPanel) { closePanel(); return; }
  }
}

// ---------------------------------------------------------------------------
// Fullscreen handlers
// ---------------------------------------------------------------------------
function onFullscreenEntered({ tabId }) {
  if (tabId !== activeId) return;
  // Hide browser chrome for fullscreen video
  document.querySelector('.shell').style.display = 'none';
  document.querySelector('.bookmarks-bar').style.display = 'none';
}

function onFullscreenExited({ tabId }) {
  if (tabId !== activeId) return;
  // Restore browser chrome
  document.querySelector('.shell').style.display = '';
  document.querySelector('.bookmarks-bar').style.display = '';
}

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Split Focus Toggle
// ---------------------------------------------------------------------------
function toggleSplitFocus() {
  const t = tabs.find(x => x.id === activeId);
  if (t && t.isSplit) {
    t.activeSide = (t.activeSide === 'left') ? 'right' : 'left';
    api.setSplitActiveSide(activeId, t.activeSide);
    const url = (t.activeSide === 'right') ? t.secondaryUrl : t.url;
    addrBar.value = (url === 'isb://newtab' || url === 'about:blank') ? '' : url;
    // Notify user of focus change visually
    renderTabs();
  }
}

// ---------------------------------------------------------------------------
// GO
// ---------------------------------------------------------------------------
init();
