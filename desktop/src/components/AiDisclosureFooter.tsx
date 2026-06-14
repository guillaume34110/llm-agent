import React from 'react';
import { useTranslation } from 'react-i18next';

// EU AI Act Art. 50(1) — permanent disclosure that user is interacting with AI.
export default function AiDisclosureFooter() {
  const { t } = useTranslation();
  return (
    <div
      role="note"
      aria-label="AI disclosure"
      className="text-center text-[10.5px] text-[var(--text-dim)] px-[8px] py-[4px] pb-[6px] opacity-75 tracking-[0.2px] select-none"
    >
      {t('aiDisclosure.text')}
    </div>
  );
}
