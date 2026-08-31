const SITE_ORIGIN = 'https://www.yuqi.site';
const ROUTES = Object.freeze({
  portfolio: '/',
  admin: '/admin',
  visitorRules: '/admin/visitors',
  mcpOperations: '/admin/operate',
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_ACTIVE_CONTEXT') {
    activePageContext().then(sendResponse);
    return true;
  }

  if (message?.type === 'OPEN_ROUTE') {
    openFirstPartyRoute(message.route)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function activePageContext() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { available: false, reason: 'No active tab' };

  const base = {
    available: false,
    title: tab.title || 'Untitled page',
    url: tab.url || '',
  };

  if (!isFirstPartyUrl(tab.url)) {
    return { ...base, reason: 'Page context is limited to yuqi.site' };
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        title: document.title,
        url: window.location.href,
        description: document.querySelector('meta[name="description"]')?.content || '',
        selection: window.getSelection()?.toString().trim().slice(0, 1200) || '',
      }),
    });
    return { available: true, ...result };
  } catch {
    return { ...base, reason: 'Refresh the page and try again' };
  }
}

async function openFirstPartyRoute(routeName) {
  const path = ROUTES[routeName];
  if (!path) throw new Error('Unsupported route');
  await chrome.tabs.create({ url: new URL(path, SITE_ORIGIN).toString() });
}

function isFirstPartyUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === SITE_ORIGIN;
  } catch {
    return false;
  }
}
