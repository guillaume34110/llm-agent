import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface UsageData {
  tokensThisMonth: number;
  creditsSpentThisMonth: number;
  creditsBalance: number;
  billedCostCentsThisMonth?: number;
  creditsAddedThisMonth?: number;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function fmtEuros(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

export default function UsageWidget() {
  const [data, setData] = useState<UsageData | null>(null);

  useEffect(() => {
    axios.get('/api/credits/usage', { withCredentials: true })
      .then(r => setData(r.data))
      .catch(() => {});
    const timer = setInterval(() => {
      axios.get('/api/credits/usage', { withCredentials: true })
        .then(r => setData(r.data))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!data) return null;

  const now = new Date();
  const monthName = now.toLocaleString('fr-FR', { month: 'long' });

  return (
    <div style={{
      padding: '10px 14px',
      borderTop: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
        Consommation — {monthName}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 8px' }}>
        <StatCard
          label="Tokens"
          value={fmtTokens(data.tokensThisMonth)}
          sub="ce mois"
        />
        <StatCard
          label="Solde"
          value={fmtEuros(data.creditsBalance)}
          sub={data.creditsSpentThisMonth > 0 ? `−${fmtEuros(data.creditsSpentThisMonth)} utilisés` : 'aucun utilisé'}
          highlight={data.creditsBalance < 500}
        />
      </div>
      <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-dim)' }}>
        {typeof data.creditsAddedThisMonth === 'number' && data.creditsAddedThisMonth > 0 ? `${fmtEuros(data.creditsAddedThisMonth)} crédités` : 'Aucune recharge'}
        {typeof data.billedCostCentsThisMonth === 'number' ? ` · ${fmtEuros(data.billedCostCentsThisMonth)} facturés` : ''}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub: string; highlight?: boolean }) {
  return (
    <div style={{
      background: 'var(--bg3)',
      borderRadius: 6,
      padding: '6px 8px',
      border: `1px solid ${highlight ? 'oklch(62% 0.19 25 / 0.4)' : 'var(--border)'}`,
    }}>
      <div style={{ fontSize: 9.5, color: 'var(--text-dim)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: highlight ? 'oklch(70% 0.16 25)' : 'var(--text)', marginTop: 2, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>{sub}</div>
    </div>
  );
}
