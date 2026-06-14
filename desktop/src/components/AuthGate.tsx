import React from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { isGuestMode, exitGuestMode } from '../auth/guest-mode';
import { signalUnauthorized } from '../auth/auth-events';

// Wraps account-backed features. In guest mode it replaces the children with
// a "sign in to access this feature" placeholder; otherwise it renders them
// untouched. The CTA leaves guest mode then reuses the existing unauthorized
// event so App.tsx routes back to the login screen.
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  if (!isGuestMode()) return <>{children}</>;

  const goToLogin = () => {
    exitGuestMode();
    signalUnauthorized();
  };

  return (
    <div className="flex flex-col items-center justify-center text-center gap-3 px-6 py-12">
      <div className="w-10 h-10 rounded-full bg-[var(--bg3)] border border-[var(--border)] flex items-center justify-center text-[var(--text-dim)]">
        <Lock size={16} strokeWidth={2.2} />
      </div>
      <div className="text-[13px] font-bold text-[var(--text-muted)] max-w-[320px] leading-relaxed">
        {t('guest.requiresAuth', 'Connectez-vous pour accéder à cette fonctionnalité')}
      </div>
      <button
        type="button"
        onClick={goToLogin}
        className="px-4 h-[32px] rounded-full text-[12px] font-black bg-[var(--accent)] text-white border-none cursor-pointer hover:opacity-90 transition-opacity"
      >
        {t('guest.loginCta', 'Se connecter')}
      </button>
    </div>
  );
}
