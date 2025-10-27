// src/components/LogInDialog.js
'use client';

import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

export default function LogInDialog({
                                      open,
                                      title = 'Log In Required',
                                      onClose,
                                      onConfirm,
                                      children,
                                    }) {
  const ref = useRef(null);

  // sync open -> <dialog>
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // ESC / native close → onClose
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onClose && onClose();
    el.addEventListener('close', handler);
    return () => el.removeEventListener('close', handler);
  }, [onClose]);

  const onBackdropClick = (e) => {
    if (e.target === ref.current) onClose && onClose();
  };

  return (
    <dialog
      ref={ref}
      onClick={onBackdropClick}
      className="w-[min(92vw,520px)] p-0 rounded-2xl backdrop:bg-black/60"
    >
      <div className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm border"
          >
            ×
          </button>
        </div>

        <div className="text-sm text-gray-700">
          {children ?? 'Please log in to continue.'}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 border">
            Cancel
          </button>
          <button
            onClick={() => {
              if (onConfirm) onConfirm();
              if (onClose) onClose();
            }}
            className="rounded-lg px-3 py-1.5 border bg-black text-white"
          >
            Go to Login
          </button>
        </div>
      </div>
    </dialog>
  );
}

LogInDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  title: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func,
  children: PropTypes.node,
};
