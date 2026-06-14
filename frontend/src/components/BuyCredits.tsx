import React, { useState } from 'react';
import axios from 'axios';
import { ArrowRight } from 'lucide-react';
import { Dialog, Chip } from '../ui';

const PACKS = [
  { credits: 500,   label: '5,00 €',  sub: 'Top-up rapide' },
  { credits: 1000,  label: '10,00 €', sub: 'Top-up standard' },
  { credits: 2000,  label: '20,00 €', sub: 'Populaire', highlight: true },
  { credits: 5000,  label: '50,00 €', sub: 'Meilleure valeur' },
];

export default function BuyCredits({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const buy = async (credits: number) => {
    setLoading(credits); setErr(null);
    try {
      const res = await axios.post('/api/billing/checkout-session', { credits }, { withCredentials: true });
      if (res.data.url) window.location.href = res.data.url;
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'Erreur lors de la création du paiement.');
      setLoading(null);
    }
  };

  return (
    <Dialog open onClose={onClose} title="Recharger des crédits" width={360}>
      <div className="flex flex-col gap-2.5">
        {PACKS.map(pack => {
          const isLoading = loading === pack.credits;
          const isDisabled = loading !== null;
          return (
            <button
              key={pack.credits}
              onClick={() => buy(pack.credits)}
              disabled={isDisabled}
              className={`group flex items-center justify-between rounded-[10px] border px-4 py-3 text-left transition-colors ${
                isLoading
                  ? 'bg-[var(--bg4)] border-[var(--green)]'
                  : 'bg-[var(--bg3)] border-[var(--border)] hover:border-[var(--green)]'
              } ${isDisabled && !isLoading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-bold text-[var(--text)]">{pack.label}</span>
                  {pack.highlight && <Chip tone="success">Populaire</Chip>}
                </div>
                <span className="text-[12px] text-[var(--text-muted)] mt-0.5">{pack.sub}</span>
              </div>
              {isLoading
                ? <span className="text-[13px] text-[var(--text-dim)]">Chargement…</span>
                : <span className="inline-flex items-center gap-1 text-[13px] text-[var(--green)] font-bold">
                    Acheter <ArrowRight size={14} />
                  </span>}
            </button>
          );
        })}

        {err && (
          <div className="text-[13px] font-semibold" style={{ color: 'oklch(70% 0.16 25)' }}>{err}</div>
        )}

        <p className="text-[11.5px] text-[var(--text-dim)] text-center mt-1">
          Paiement en Monero (XMR) via BTCPay self-hosted
        </p>
      </div>
    </Dialog>
  );
}
