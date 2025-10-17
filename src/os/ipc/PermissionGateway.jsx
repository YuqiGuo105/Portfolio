'use client';

import { usePermissionStore } from './usePermissionStore';

const descriptions = {
  fs: 'Access your local file system sandbox for reading and writing project data.',
  net: 'Allow network requests to fetch external portfolio data.',
  clipboard: 'Permit the OS to read and write to your clipboard.',
};

export default function PermissionGateway() {
  const prompts = usePermissionStore((state) => state.prompts);
  const resolvePrompt = usePermissionStore((state) => state.resolvePrompt);

  if (prompts.length === 0) return null;

  const current = prompts[0];
  const description = descriptions[current.channel] ?? current.description;

  return (
    <div className="permission-modal" role="dialog" aria-modal="true" aria-labelledby={`${current.id}-title`}>
      <div className="panel">
        <h2 id={`${current.id}-title`} style={{ margin: 0, fontSize: '1.1rem' }}>
          Permission request
        </h2>
        <p style={{ marginTop: '0.75rem', lineHeight: 1.6 }}>
          {description || `Allow ${current.channel} access?`}
        </p>
        <div className="actions">
          <button type="button" onClick={() => resolvePrompt(current.id, 'denied')}>
            Deny
          </button>
          <button
            type="button"
            style={{ background: 'linear-gradient(135deg,#4b6bff,#4bb8ff)', color: '#fff' }}
            onClick={() => resolvePrompt(current.id, 'granted')}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
