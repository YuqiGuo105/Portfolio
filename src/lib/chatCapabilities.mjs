export const UNAVAILABLE_CHAT_CAPABILITIES = Object.freeze({ deep: false, attachments: false });
export const DEEP_UNAVAILABLE = "Deep research is temporarily unavailable. Please use Fast chat.";
export const ATTACHMENTS_UNAVAILABLE = "Image and PDF understanding is temporarily unavailable. Please send text instead.";

export function normalizeChatCapabilities(value) {
  return { deep: value?.deep === true, attachments: value?.attachments === true };
}
