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
    if (details.initiator !== 'http://localhost:3000') return;
    console.log(`[${details.type}] ${details.method} ${details.url}`);
  },
  { urls: ['<all_urls>'] },
);

const REPLAY_URL_RE = /^http:\/\/localhost:5051\/replay\/(\d+)\/(.+)$/;
const MENU_ID = 'open-list-versions';
const MENU_ID_WAYBACK = 'open-wayback-official';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'List versions',
    contexts: ['page'],
    documentUrlPatterns: ['http://localhost:5051/replay/*/*'],
  });
  chrome.contextMenus.create({
    id: MENU_ID_WAYBACK,
    title: 'Open in Wayback Machine',
    contexts: ['page'],
    documentUrlPatterns: ['http://localhost:5051/replay/*/*'],
  });

  chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2, 3, 4],
    addRules: [
      {
        // Priority 2: already going to the replay route — let it through
        id: 1,
        priority: 2,
        condition: {
          regexFilter: 'http://localhost:(3000|5050|5051)/.*',
          initiatorDomains: ['localhost'],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
        action: { type: 'allow' },
      },
      {
        // Priority 2: allow requests to external CDN domains
        id: 3,
        priority: 2,
        condition: {
          regexFilter:
            'https?://(cdn\\.jsdelivr\\.net|cdnjs\\.cloudflare\\.com|fonts\\.googleapis\\.com)/.*',
          initiatorDomains: ['localhost'],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
        action: { type: 'allow' },
      },
      {
        // Priority 2: allow requests to social/tracking domains
        id: 4,
        priority: 2,
        condition: {
          regexFilter:
            'https?://(s7\\.addthis\\.com|connect\\.facebook\\.net|.*\\.facebook\\.com)/.*',
          initiatorDomains: ['localhost'],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
        action: { type: 'allow' },
      },
      {
        // Priority 1: anything else — redirect to replay/from_referer/<url>
        id: 2,
        priority: 1,
        condition: {
          regexFilter: '.*',
          initiatorDomains: ['localhost'],
          resourceTypes: ALL_RESOURCE_TYPES,
        },
        action: {
          type: 'redirect',
          redirect: {
            regexSubstitution: 'http://localhost:5051/replay/from_referer/\\0',
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
  const timestamp = match[1];
  const url = match[2];

  if (info.menuItemId === MENU_ID) {
    chrome.tabs.create({
      url: `http://localhost:3000/list_versions?url=${encodeURIComponent(url)}`,
    });
  } else if (info.menuItemId === MENU_ID_WAYBACK) {
    chrome.tabs.create({
      url: `https://web.archive.org/web/${timestamp}/${url}`,
    });
  }
});