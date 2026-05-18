const APP_HOST = 'localhost';
const ADMIN_FRONTEND_ORIGIN = `http://${APP_HOST}:3000`;
const ADMIN_BACKEND_ORIGIN = `http://${APP_HOST}:5050`;
const REPLAY_SERVER_ORIGIN = `http://${APP_HOST}:5051`;
const PYWB_SERVER_ORIGIN = `http://${APP_HOST}:8080`;

const ALL_RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'other',
];

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.initiator !== ADMIN_FRONTEND_ORIGIN) return;
    console.log(`[${details.type}] ${details.method} ${details.url}`);
  },
  { urls: ['<all_urls>'] },
);

const REPLAY_URL_RE = new RegExp(`^${REPLAY_SERVER_ORIGIN}/replay/(\\d+)/(.+)$`);
const MENU_ID = 'open-list-versions';
const MENU_ID_REMOTE_REPLAY = 'open-remote-replay';

/** Maps tabId -> remote live replay URL from x-remote-live-replay-url response header */
const remoteLiveReplayUrlByTab = new Map();

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Clear any previously captured header when a new top-level navigation starts,
    // so a stale value from a previous page isn't reused.
    remoteLiveReplayUrlByTab.delete(details.tabId);
  },
  { urls: [`${REPLAY_SERVER_ORIGIN}/replay/*/*`], types: ['main_frame'] },
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const header = details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === 'x-remote-live-replay-url',
    );
    if (header?.value) {
      remoteLiveReplayUrlByTab.set(details.tabId, header.value);
    }
  },
  { urls: [`${REPLAY_SERVER_ORIGIN}/replay/*/*`], types: ['main_frame'] },
  ['responseHeaders'],
);

chrome.tabs.onRemoved.addListener((tabId) => {
  remoteLiveReplayUrlByTab.delete(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'List versions',
    contexts: ['page'],
    documentUrlPatterns: [`${REPLAY_SERVER_ORIGIN}/replay/*/*`],
  });
  chrome.contextMenus.create({
    id: MENU_ID_REMOTE_REPLAY,
    title: 'Open in Remote Replay',
    contexts: ['page'],
    documentUrlPatterns: [`${REPLAY_SERVER_ORIGIN}/replay/*/*`],
  });

  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2, 3, 4],
    addRules: [
      {
        // Priority 2: already going to one of our servers (admin frontend/backend or replay server) — allow
        id: 1,
        priority: 2,
        condition: {
          regexFilter: `(${ADMIN_FRONTEND_ORIGIN}|${ADMIN_BACKEND_ORIGIN}|${REPLAY_SERVER_ORIGIN}|${PYWB_SERVER_ORIGIN})/.*`,
          initiatorDomains: [APP_HOST],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
        action: { type: 'allow' },
      },
      {
        // Priority 2: allow requests to external CDN domains
        id: 2,
        priority: 2,
        condition: {
          regexFilter:
            'https?://(cdn\\.jsdelivr\\.net|cdnjs\\.cloudflare\\.com|fonts\\.googleapis\\.com)/.*',
          initiatorDomains: [APP_HOST],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
        action: { type: 'allow' },
      },
      {
        // Priority 2: allow requests to social/tracking domains
        id: 3,
        priority: 2,
        condition: {
          regexFilter:
            'https?://(s7\\.addthis\\.com|connect\\.facebook\\.net|.*\\.facebook\\.com)/.*',
          initiatorDomains: [APP_HOST],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
        action: { type: 'allow' },
      },
      {
        // Priority 1: anything else — redirect to replay/from_referer/<url>
        id: 4,
        priority: 1,
        condition: {
          regexFilter: '.*',
          initiatorDomains: [APP_HOST],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
        action: {
          type: 'redirect',
          redirect: {
            regexSubstitution: `${REPLAY_SERVER_ORIGIN}/replay/from_referer/\\0`,
          },
        },
      },
    ],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.url) return;
  const match = tab.url.match(REPLAY_URL_RE);
  if (!match) return;
  const originalUrl = match[2];

  if (info.menuItemId === MENU_ID) {
    chrome.tabs.create({
      url: `${ADMIN_FRONTEND_ORIGIN}/list_versions?originalUrl=${encodeURIComponent(originalUrl)}`,
    });
  } else if (info.menuItemId === MENU_ID_REMOTE_REPLAY) {
    const remoteLiveReplayUrl = remoteLiveReplayUrlByTab.get(tab.id);
    if (!remoteLiveReplayUrl) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => alert('Remote live replay URL is not available: the x-remote-live-replay-url header was not found.'),
      });
      return;
    }
    chrome.tabs.create({
      url: remoteLiveReplayUrl
    });
  }
});