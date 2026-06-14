import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMBEDDING_MODELS, type EmbeddingModel } from '../memory/embedding-catalog';
import { knowledgeService } from '../memory/knowledge.service';
import Dropdown from './Dropdown';

interface Status {
  model: EmbeddingModel;
  isConfigured: boolean;
  totalChunks: number;
  vectorizedChunks: number;
  isActive: boolean;
}

function multilangStars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function ModelCard({ m, selected }: { m: EmbeddingModel; selected: boolean }) {
  return (
    <div
      className={`px-[12px] py-[10px] grid gap-1 border-l-[3px] ${selected ? 'border-l-[var(--accent)]' : 'border-l-transparent'}`}
    >
      <div className="flex items-center gap-2">
        <div className="font-[800] text-[13px] text-[var(--text)]">{m.label}</div>
        <div className="text-[10px] text-[var(--text-dim)]">{m.id}</div>
      </div>
      <div className="flex gap-3 text-[11px] text-[var(--text-dim)] flex-wrap">
        <span>{m.provider === 'local' ? 'local · free' : `$${m.pricePerMillion.toFixed(3)}/M tok`}</span>
        <span>MTEB {m.mteb}</span>
        <span>dim {m.dim}</span>
        <span>ctx {m.ctx.toLocaleString()}</span>
        <span title="Multilingual rating">{multilangStars(m.multilang)}</span>
      </div>
      <div className="text-[11px] text-[var(--text-dim)]">{m.note}</div>
    </div>
  );
}

export default function KbSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [pendingId, setPendingId] = useState<string>('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string>('');
  const [showDetails, setShowDetails] = useState(false);
  const [unindexed, setUnindexed] = useState(0);
  const [purging, setPurging] = useState(false);

  const refresh = async () => {
    try {
      const s = await knowledgeService.getStatus();
      setStatus(s);
      setPendingId(s.model.id);
      try {
        setUnindexed(await knowledgeService.countUnindexed());
      } catch {
        setUnindexed(0);
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  const handlePurgeUnindexed = async () => {
    if (!unindexed) return;
    if (!confirm(t('kb.confirmPurge', { count: unindexed }))) return;
    setPurging(true);
    setError('');
    try {
      await knowledgeService.purgeUnindexed();
      await refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setPurging(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  if (!status) {
    return <div className="p-3 text-[var(--text-dim)] text-[12px]">{t('common.loading')}</div>;
  }

  const stateLabel = !status.isConfigured
    ? t('kb.stateNotConfigured')
    : status.isActive
    ? t('kb.stateActive')
    : status.totalChunks === 0
    ? t('kb.stateEmpty')
    : t('kb.stateInactiveRevectorization');
  const stateColor = status.isActive
    ? 'var(--accent)'
    : !status.isConfigured || status.totalChunks > 0
    ? '#e67e22'
    : 'var(--text-dim)';

  const onPick = (id: string) => {
    setPendingId(id);
    setError('');
    if (!status.isConfigured) {
      // first-time setup: apply directly
      applyModel(id, /* destroy */ false);
    } else if (id !== status.model.id) {
      setConfirming(true);
    }
  };

  const applyModel = async (id: string, destroy: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (destroy) {
        await knowledgeService.changeModel(id);
      } else {
        // first config: just set model, no chunks to drop
        await knowledgeService.changeModel(id);
      }
      const s0 = await knowledgeService.getStatus();
      setStatus(s0);
      if (s0.totalChunks === 0 && !destroy) {
        setBusy(false);
        setConfirming(false);
        return;
      }
      setProgress({ done: 0, total: s0.totalChunks });
      const res = await knowledgeService.reEmbedAll((done, total) => {
        setProgress({ done, total });
      });
      setProgress({ done: res.documents, total: res.documents });
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
      setConfirming(false);
      await refresh();
      setTimeout(() => setProgress(null), 1500);
    }
  };

  return (
    <div className="p-[14px] border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg3)] grid gap-3">
      <div className="flex items-center gap-[10px] flex-wrap">
        <div className="text-[13px] font-[900] text-[var(--text)]">{t('kb.title')}</div>
        <span className="text-[11px] font-[700] px-2 py-[2px] rounded-full" style={{ color: stateColor, border: `1px solid ${stateColor}` }}>
          {stateLabel}
        </span>
        <div className="flex-1" />
        <div className="text-[11px] text-[var(--text-dim)]">
          {t('kb.chunkStatus', { vectorized: status.vectorizedChunks, total: status.totalChunks })}
        </div>
      </div>

      <Dropdown
        value={pendingId}
        disabled={busy}
        onChange={onPick}
        width="100%"
        fontSize={13}
        buttonPadding="8px 10px"
        options={EMBEDDING_MODELS.map(m => ({
          value: m.id,
          label: m.label,
          hint: `${m.provider === 'local' ? 'local · free' : `$${m.pricePerMillion.toFixed(3)}/M`} · MTEB ${m.mteb} · dim ${m.dim} · ${multilangStars(m.multilang)}`,
        }))}
      />

      <button
        onClick={() => setShowDetails(s => !s)}
        className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-[10px] py-[6px] cursor-pointer text-[11px] font-[700] text-left flex items-center gap-1.5"
      >
        <span className="inline-block" style={{ transform: showDetails ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▶</span>
        {t('kb.buttonDetails', { count: EMBEDDING_MODELS.length })}
      </button>
      {showDetails && (
        <div className="border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] overflow-hidden">
          {EMBEDDING_MODELS.map(m => (
            <ModelCard key={m.id} m={m} selected={m.id === pendingId} />
          ))}
        </div>
      )}

      {confirming && (
        <div className="p-3 border border-[#e67e22] rounded-[var(--r)] bg-[rgba(230,126,34,0.08)] grid gap-2">
          <div className="text-[12px] text-[var(--text)] font-[700]">
            {t('kb.confirmChangeModel', { chunks: status.totalChunks, modelId: pendingId })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => applyModel(pendingId, true)}
              disabled={busy}
              className="flex-1 border border-[#e67e22] bg-[#e67e22] text-[#fff] rounded-[var(--r)] px-[10px] py-2 cursor-pointer font-[700]"
            >
              {t('kb.buttonDestroyRevectorize')}
            </button>
            <button
              onClick={() => { setConfirming(false); setPendingId(status.model.id); }}
              disabled={busy}
              className="flex-1 border border-[var(--border)] bg-[var(--bg3)] text-[var(--text)] rounded-[var(--r)] px-[10px] py-2 cursor-pointer"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {progress && (
        <div className="text-[11px] text-[var(--text-dim)]">
          {t('kb.revectorizing', { done: progress.done, total: progress.total })}
        </div>
      )}

      {error && <div className="text-[11px] text-[#e74c3c]">{error}</div>}

      {status.isConfigured && !status.isActive && status.totalChunks > 0 && (
        <button
          onClick={() => applyModel(status.model.id, false)}
          disabled={busy}
          className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-[10px] py-2 cursor-pointer font-[700]"
        >
          {t('kb.buttonRevectorizeNow')}
        </button>
      )}

      {unindexed > 0 && (
        <button
          onClick={handlePurgeUnindexed}
          disabled={purging || busy}
          className="border border-[var(--red)] bg-transparent text-[var(--red)] rounded-[var(--r)] px-[10px] py-2 font-[700]"
          style={{ cursor: purging ? 'default' : 'pointer' }}
          title={t('kb.hintPurgeUnindexed')}
        >
          {purging ? t('kb.purging') : t('kb.buttonPurgeUnindexed', { count: unindexed })}
        </button>
      )}
    </div>
  );
}
