'use client';

import create from 'zustand';

let promptCounter = 0;

const nextPromptId = () => {
  promptCounter += 1;
  return `prompt-${promptCounter}`;
};

export const usePermissionStore = create((set, get) => ({
  permissions: {},
  prompts: [],

  ensurePermission: async (channel, description) => {
    const state = get();
    const current = state.permissions[channel];
    if (current === 'granted') return true;
    if (current === 'denied') return false;

    return new Promise((resolve) => {
      const id = nextPromptId();
      const prompt = { id, channel, description, resolve };
      set((s) => ({ prompts: [...s.prompts, prompt] }));
    });
  },

  resolvePrompt: (promptId, decision) => {
    set((state) => {
      const prompt = state.prompts.find((item) => item.id === promptId);
      if (!prompt) return state;
      const remaining = state.prompts.filter((item) => item.id !== promptId);
      prompt.resolve(decision === 'granted');
      return {
        prompts: remaining,
        permissions: {
          ...state.permissions,
          [prompt.channel]: decision,
        },
      };
    });
  },
}));
