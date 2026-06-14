import React, { useEffect, useState } from 'react';
import {
  fetchCatalog,
  getSelectedSkin,
  setSelectedSkin,
  getSelectedFrame,
  setSelectedFrame,
  type Cosmetic,
} from '../cosmetics/cosmetics-client';

export default function CosmeticsPanel() {
  const [catalog, setCatalog] = useState<Cosmetic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skin, setSkin] = useState<string | null>(getSelectedSkin());
  const [frame, setFrame] = useState<string | null>(getSelectedFrame());

  const reload = async () => {
    setLoading(true);
    try {
      const cat = await fetchCatalog();
      setCatalog(cat);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const selectSkin = (id: string | null) => { setSkin(id); setSelectedSkin(id); };
  const selectFrame = (id: string | null) => { setFrame(id); setSelectedFrame(id); };

  if (loading) return <div className="settings-panel">Loading cosmetics…</div>;

  const skins = catalog.filter(c => c.kind === 'skin');
  const frames = catalog.filter(c => c.kind === 'profile_frame');

  const renderRow = (c: Cosmetic, selected: boolean, onSelect: () => void) => (
    <div
      key={c.id}
      onClick={onSelect}
      className="rounded-[var(--r)] p-3 font-[Nunito] grid gap-1 border border-[var(--border)] bg-[var(--bg2)] cursor-pointer"
      style={{ boxShadow: selected ? '0 0 0 2px var(--accent)' : 'none' }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-black text-[13px] text-[var(--text)]">{c.name}</span>
        {selected && (
          <span className="text-[11px] font-bold text-[var(--accent)]">Active</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="settings-panel">
      <h3>Cosmetics</h3>
      <p className="settings-help">
        Skins recolour the app. Profile frames decorate your public profile avatar.
      </p>

      <div style={{ marginTop: 12 }}>
        <div className="text-[12px] font-black text-[var(--text)] mb-2">Skins</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <div
            className="rounded-[var(--r)] p-3 border border-[var(--border)] bg-[var(--bg2)] cursor-pointer"
            style={{ boxShadow: skin === null ? '0 0 0 2px var(--accent)' : 'none' }}
            onClick={() => selectSkin(null)}
          >
            <span className="font-black text-[13px] text-[var(--text)]">Default</span>
          </div>
          {skins.map(c => renderRow(c, skin === c.id, () => selectSkin(c.id)))}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="text-[12px] font-black text-[var(--text)] mb-2">Profile frames</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <div
            className="rounded-[var(--r)] p-3 border border-[var(--border)] bg-[var(--bg2)] cursor-pointer"
            style={{ boxShadow: frame === null ? '0 0 0 2px var(--accent)' : 'none' }}
            onClick={() => selectFrame(null)}
          >
            <span className="font-black text-[13px] text-[var(--text)]">None</span>
          </div>
          {frames.map(c => renderRow(c, frame === c.id, () => selectFrame(c.id)))}
        </div>
      </div>

      {error && <div className="settings-error" style={{ marginTop: 12 }}>{error}</div>}
    </div>
  );
}
