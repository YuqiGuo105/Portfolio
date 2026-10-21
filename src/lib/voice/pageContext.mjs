import { cleanPageContext, isPublicVoicePath } from './protocol.mjs';

const EXCLUDED = 'script,style,nav,header,footer,form,input,textarea,select,button,[contenteditable],.bot-container,#__chat_widget_root,[data-private],[data-no-voice],.comments-section';

export function readVoicePage(doc = document, loc = window.location) {
  if (!isPublicVoicePath(loc.pathname)) return null;
  const root = doc.querySelector('[data-voice-public-content], main, article, .content');
  if (!root) return cleanPageContext({ path: loc.pathname, title: doc.title });
  const chunks = [];
  let length = 0;
  let visited = 0;
  const walker = doc.createTreeWalker(root, 4);
  let node;
  while ((node = walker.nextNode()) && visited++ < 1200 && length < 6000) {
    const parent = node.parentElement;
    if (!parent || parent.closest(EXCLUDED) || !parent.getClientRects().length) continue;
    const style = doc.defaultView.getComputedStyle(parent);
    if (style.visibility !== 'visible' || style.display === 'none') continue;
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    chunks.push(text);
    length += text.length;
  }
  const selection = doc.getSelection();
  let selected = '';
  if (selection?.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const publicEndpoint = node => {
      const element = node.nodeType === 1 ? node : node.parentElement;
      return element && root.contains(element) && !element.closest(EXCLUDED);
    };
    // A selection can start in public text and cross a private/form subtree.
    if (publicEndpoint(range.startContainer) && publicEndpoint(range.endContainer)
      && !range.cloneContents().querySelector(EXCLUDED)) selected = selection.toString().slice(0, 1200);
  }
  return cleanPageContext({ path: loc.pathname, title: doc.title, text: chunks.join('\n'), selection: selected });
}
