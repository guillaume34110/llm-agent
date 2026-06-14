import React from 'react';
import WhatsAppPanel from './integrations/WhatsAppPanel';

export default function ChatbotsView() {
  return (
    <div className="flex-1 overflow-auto flex flex-col relative isolate">
      <div className="px-[20px] py-[18px] border-b border-[var(--border)] bg-[var(--bg2)] relative z-10">
        <div className="text-[18px] font-black text-[var(--text)]">Chatbots</div>
        <div className="mt-1 text-[12px] text-[var(--text-dim)]">Connect bots and messaging integrations</div>
      </div>
      <div className="p-5 grid grid-cols-1 gap-[18px] max-w-[860px] w-full box-border relative z-10">
        <section className="w-full box-border min-w-0 border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] overflow-hidden">
          <WhatsAppPanel />
        </section>
      </div>
    </div>
  );
}
