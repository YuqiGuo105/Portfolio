const titleElement = document.querySelector('#page-title');
const urlElement = document.querySelector('#page-url');
const descriptionElement = document.querySelector('#page-description');
const selectionBlock = document.querySelector('#selection-block');
const selectionElement = document.querySelector('#page-selection');
const toast = document.querySelector('#toast');

document.querySelector('#refresh-context').addEventListener('click', loadContext);
document.querySelectorAll('[data-route]').forEach((button) => {
  button.addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'OPEN_ROUTE',
      route: button.dataset.route,
    });
    if (!response?.ok) showToast(response?.error || 'Unable to open this workspace');
  });
});

loadContext();

async function loadContext() {
  setLoading(true);
  try {
    const context = await chrome.runtime.sendMessage({ type: 'GET_ACTIVE_CONTEXT' });
    titleElement.textContent = context?.title || 'No page context';
    urlElement.textContent = compactUrl(context?.url || '');
    descriptionElement.textContent = context?.available
      ? context.description || 'First-party page context is ready.'
      : context?.reason || 'Page context is unavailable.';

    if (context?.selection) {
      selectionElement.textContent = context.selection;
      selectionBlock.hidden = false;
    } else {
      selectionElement.textContent = '';
      selectionBlock.hidden = true;
    }
  } catch {
    titleElement.textContent = 'Context unavailable';
    descriptionElement.textContent = 'Refresh the active page and try again.';
  } finally {
    setLoading(false);
  }
}

function compactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}

function setLoading(loading) {
  document.querySelector('#refresh-context').disabled = loading;
  document.body.classList.toggle('is-loading', loading);
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}
