import React, { useEffect, useState } from 'react';
import { dismissToast, subscribeToasts, type AppToast } from '../notifications/notification-center';

function colors(tone: AppToast['tone']) {
  switch (tone) {
    case 'success':
      return { border: 'var(--accent)', bg: 'var(--accent-soft)', text: 'var(--accent)' };
    case 'warning':
      return { border: 'var(--amber)', bg: 'oklch(72% 0.16 84 / 0.14)', text: 'var(--amber)' };
    case 'error':
      return { border: 'var(--red)', bg: 'var(--red-soft)', text: 'var(--red)' };
    default:
      return { border: 'var(--blue)', bg: 'oklch(58% 0.16 248 / 0.12)', text: 'var(--blue)' };
  }
}

export default function ToastsHost() {
  const [toasts, setToasts] = useState<AppToast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (!toasts.length) return null;

  return (
    <div className="fixed top-[68px] right-[18px] z-[80] flex flex-col gap-[10px] max-w-[320px]">
      {toasts.map(toast => {
        const palette = colors(toast.tone);
        return (
          <div
            key={toast.id}
            style={{
              border: `1px solid ${palette.border}`,
              background: palette.bg,
              color: palette.text,
            }}
            className="rounded-[var(--rm)] shadow-[0_12px_32px_rgba(0,0,0,0.28)] p-[12px_14px]"
          >
            <div className="flex items-start gap-[10px]">
              <div className="flex-1">
                <div className="text-[12.5px] font-[900]">{toast.title}</div>
                {toast.body && (
                  <div className="mt-[5px] text-[11.5px] leading-[1.5] text-[var(--text)]">
                    {toast.body}
                  </div>
                )}
              </div>
              <button
                onClick={() => dismissToast(toast.id)}
                className="border-none bg-transparent text-[var(--text-dim)] cursor-pointer text-[16px] leading-[1]"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
