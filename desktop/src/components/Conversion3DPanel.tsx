// Background > 2D -> 3D. Lists the on-device image-to-3D models (TripoSplat),
// installs/uninstalls them via the sidecar /local-models endpoints, and runs a
// conversion: pick an image -> POST /image-to-3d -> show the resulting .ply.
// Client-side only: the image and the 3D output never leave the machine.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Box } from 'lucide-react';
import {
  listLocalModels,
  downloadLocalModel,
  uninstallLocalModel,
  list3DAssets,
  getConversion3D,
  subscribeConversion3D,
  setConversion3DImage,
  startConversion3D,
  type LocalModel,
  type DownloadEvent,
  type Asset3D,
} from '../local-models/local-models.service';

function fmtSize(mb: number): string {
  if (!Number.isFinite(mb)) return '?';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

interface RowState {
  busy?: boolean;
  progress?: { percent: number; bytes: number; total: number };
  error?: string;
  abort?: AbortController;
}

export default function Conversion3DPanel() {
  const [models, setModels] = useState<LocalModel[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);

  // converter state lives in a module-level store so an in-flight conversion
  // survives tab switches (this panel unmounts, the fetch keeps running there)
  const conv = useSyncExternalStore(subscribeConversion3D, getConversion3D);
  const [assets, setAssets] = useState<Asset3D[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const list = await listLocalModels();
      setModels(list.filter(m => m.task === 'image_to_3d'));
    } catch (e) {
      console.error('list image_to_3d models failed', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  // generated assets list: load on mount, reload when a conversion completes
  useEffect(() => {
    let alive = true;
    list3DAssets().then(list => { if (alive) setAssets(list); });
    return () => { alive = false; };
  }, [conv.result]);

  function patchRow(id: string, patch: RowState) {
    setRowState(s => ({ ...s, [id]: { ...s[id], ...patch } }));
  }

  async function handleInstall(m: LocalModel) {
    const ctrl = new AbortController();
    patchRow(m.id, { busy: true, error: undefined, progress: { percent: 0, bytes: 0, total: 0 }, abort: ctrl });
    try {
      await downloadLocalModel(m.id, (ev: DownloadEvent) => {
        if (ev.event === 'progress') {
          patchRow(m.id, { progress: { percent: ev.percent ?? 0, bytes: ev.bytes ?? 0, total: ev.total ?? 0 } });
        } else if (ev.event === 'done') {
          patchRow(m.id, { busy: false, progress: undefined, abort: undefined });
          refresh();
        } else if (ev.event === 'error') {
          patchRow(m.id, { busy: false, error: ev.message || 'download failed', progress: undefined, abort: undefined });
        }
      }, ctrl.signal);
    } catch (e: any) {
      const aborted = e?.name === 'AbortError' || ctrl.signal.aborted;
      patchRow(m.id, { busy: false, error: aborted ? undefined : String(e?.message || e), progress: undefined, abort: undefined });
      if (aborted) { try { await uninstallLocalModel(m.id); } catch {} refresh(); }
    }
  }

  function handleCancel(m: LocalModel) {
    rowState[m.id]?.abort?.abort();
  }

  async function handleUninstall(m: LocalModel) {
    if (!confirm(`Remove ${m.label}? (${fmtSize(m.size_mb)})`)) return;
    patchRow(m.id, { busy: true });
    await uninstallLocalModel(m.id);
    patchRow(m.id, { busy: false });
    refresh();
  }

  function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const b64 = dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
      setConversion3DImage(file.name, dataUrl, b64);
    };
    reader.readAsDataURL(file);
  }

  const anyInstalled = models.some(m => m.installed);

  return (
    <div className="p-[18px] grid gap-[16px]">
      <div className="flex items-center gap-[10px]">
        <Box size={18} strokeWidth={2.2} className="text-[var(--accent)]" />
        <div>
          <div className="text-[13.5px] font-[900] text-[var(--text)]">2D &rarr; 3D conversion</div>
          <div className="mt-[2px] text-[11.5px] text-[var(--text-dim)] leading-[1.5]">
            Turn a single image into a 3D object (Gaussian splats) on-device. The image and the result never leave your machine.
          </div>
        </div>
      </div>

      {loading && <div className="text-[12px] text-[var(--text-dim)]">Loading…</div>}

      {!loading && models.length === 0 && (
        <div className="text-[12px] text-[var(--text-dim)]">No 2D&rarr;3D model in the catalog.</div>
      )}

      {/* Model catalog (install / remove) */}
      <div className="grid gap-[8px]">
        {models.map(m => {
          const rs = rowState[m.id] || {};
          const installed = m.installed;
          return (
            <div key={m.id} className="border border-[var(--border)] rounded-[var(--r)] p-[10px_12px] bg-[var(--bg2)] grid gap-[6px]">
              <div className="flex items-center gap-[10px] flex-wrap">
                <div className="font-[800] text-[13px] text-[var(--text)]">{m.label}</div>
                <div className="text-[10px] text-[var(--text-dim)]">{m.id}</div>
                {installed && (
                  <span className="text-[10px] font-[700] text-[#10b981] border border-[#10b981] rounded-[4px] px-[6px] py-[1px]">installed</span>
                )}
                <div className="ml-auto flex gap-[6px]">
                  {!installed && !rs.busy && (
                    <button onClick={() => handleInstall(m)} className="border border-[var(--border)] bg-[var(--accent)] text-[var(--accent-fg,white)] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px]">
                      Install ({fmtSize(m.size_mb)})
                    </button>
                  )}
                  {!installed && rs.busy && (
                    <button onClick={() => handleCancel(m)} className="border border-[#ef4444] bg-transparent text-[#ef4444] rounded-[var(--r)] px-[10px] py-[5px] cursor-pointer font-[700] text-[11.5px]">
                      Cancel
                    </button>
                  )}
                  {installed && (
                    <button disabled={rs.busy} onClick={() => handleUninstall(m)} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[10px] py-[5px] font-[700] text-[11.5px]" style={{ cursor: rs.busy ? 'wait' : 'pointer' }}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="text-[11.5px] text-[var(--text-muted)] leading-[1.5]">{m.description}</div>
              <div className="flex gap-[10px] text-[10.5px] text-[var(--text-dim)] flex-wrap">
                <span>{m.license}</span>
                <span>{m.runtime}</span>
                <span>tool: <code>{m.tool_name}</code></span>
              </div>
              {rs.progress && (
                <div className="grid gap-[4px]">
                  <div className="h-[6px] bg-[var(--bg3)] rounded-[3px] overflow-hidden">
                    <div style={{ height: '100%', width: `${Math.max(2, rs.progress.percent)}%` }} className="bg-[var(--accent)]" />
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)]">
                    {rs.progress.percent.toFixed(0)}%{rs.progress.total ? ` (${(rs.progress.bytes / 1e6).toFixed(1)} / ${(rs.progress.total / 1e6).toFixed(1)} MB)` : ''}
                  </div>
                </div>
              )}
              {rs.error && <div className="text-[11px] text-[#ef4444]">{rs.error}</div>}
            </div>
          );
        })}
      </div>

      {/* Converter */}
      <div className="border border-[var(--border)] rounded-[var(--r)] p-[12px] bg-[var(--bg2)] grid gap-[10px]">
        <div className="text-[11px] font-[800] text-[var(--text-muted)] uppercase tracking-[0.5px]">Convert an image</div>
        {!anyInstalled && (
          <div className="text-[11.5px] text-[var(--text-dim)]">Install a model above to enable conversion.</div>
        )}
        <div className="flex items-center gap-[10px] flex-wrap">
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} className="hidden" />
          <button
            disabled={!anyInstalled || conv.converting}
            onClick={() => fileRef.current?.click()}
            className="border border-[var(--border)] bg-transparent text-[var(--text)] rounded-[var(--r)] px-[12px] py-[6px] font-[700] text-[11.5px]"
            style={{ cursor: !anyInstalled || conv.converting ? 'not-allowed' : 'pointer', opacity: !anyInstalled ? 0.5 : 1 }}
          >
            {conv.imageName ? 'Change image' : 'Choose image'}
          </button>
          {conv.imageName && <span className="text-[11px] text-[var(--text-dim)]">{conv.imageName}</span>}
          <button
            disabled={!conv.imageB64 || conv.converting || !anyInstalled}
            onClick={() => startConversion3D()}
            className="ml-auto border border-[var(--border)] bg-[var(--accent)] text-[var(--accent-fg,white)] rounded-[var(--r)] px-[14px] py-[6px] font-[800] text-[11.5px]"
            style={{ cursor: !conv.imageB64 || conv.converting ? 'not-allowed' : 'pointer', opacity: !conv.imageB64 || !anyInstalled ? 0.5 : 1 }}
          >
            {conv.converting ? `Converting… ${Math.floor(conv.elapsed / 60)}m${String(conv.elapsed % 60).padStart(2, '0')}s` : 'Convert to 3D'}
          </button>
        </div>
        {conv.preview && (
          <img src={conv.preview} alt="input" className="max-h-[180px] w-auto rounded-[var(--r)] border border-[var(--border)] object-contain" />
        )}
        {conv.error && <div className="text-[11px] text-[#ef4444] leading-[1.5]">{conv.error}</div>}
        {conv.result && (
          <div className="text-[11.5px] text-[var(--text)] grid gap-[3px]">
            <div className="font-[800] text-[#10b981]">3D object ready ({conv.result.format.toUpperCase()})</div>
            <div className="text-[var(--text-muted)]">{(conv.result.bytes / 1e6).toFixed(2)} MB{conv.result.gaussians ? ` · ${conv.result.gaussians} gaussians` : ''}</div>
            <code className="text-[10.5px] text-[var(--text-dim)] break-all">{conv.result.output_path}</code>
            <div className="text-[10.5px] text-[var(--text-dim)]">Open the .ply in a Gaussian-splat viewer (SuperSplat, SparkJS).</div>
          </div>
        )}
      </div>

      {/* Generated assets (~/.monkey/3d) */}
      <div className="border border-[var(--border)] rounded-[var(--r)] p-[12px] bg-[var(--bg2)] grid gap-[10px]">
        <div className="flex items-center gap-[8px]">
          <div className="text-[11px] font-[800] text-[var(--text-muted)] uppercase tracking-[0.5px]">Generated assets</div>
          <button
            onClick={() => list3DAssets().then(setAssets)}
            className="ml-auto border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[8px] py-[3px] cursor-pointer font-[700] text-[10.5px]"
          >
            Refresh
          </button>
        </div>
        {assets.length === 0 && (
          <div className="text-[11.5px] text-[var(--text-dim)]">No 3D asset yet. Convert an image above.</div>
        )}
        {assets.map(a => (
          <div key={a.path} className="border border-[var(--border)] rounded-[var(--r)] p-[8px_10px] bg-[var(--bg3)] grid gap-[2px]">
            <div className="flex items-center gap-[8px] flex-wrap">
              <span className="font-[700] text-[12px] text-[var(--text)]">{a.name}</span>
              <span className="text-[10.5px] text-[var(--text-dim)]">{(a.bytes / 1e6).toFixed(2)} MB</span>
              <span className="ml-auto text-[10.5px] text-[var(--text-dim)]">{new Date(a.mtime * 1000).toLocaleString()}</span>
            </div>
            <code className="text-[10px] text-[var(--text-dim)] break-all">{a.path}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
