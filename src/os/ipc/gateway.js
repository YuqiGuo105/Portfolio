'use client';

import { usePermissionStore } from './usePermissionStore';

export const ensurePermission = async (channel, description) => {
  const ensure = usePermissionStore.getState().ensurePermission;
  const granted = await ensure(channel, description);
  if (!granted) throw new Error(`${channel} permission denied`);
};

export const permissionedFetch = async (input, init, description = 'Allow network access for this request?') => {
  await ensurePermission('net', description);
  return fetch(input, init);
};

export const writeClipboard = async (text) => {
  if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
  await ensurePermission('clipboard', 'Allow clipboard access?');
  await navigator.clipboard.writeText(text);
  return true;
};
