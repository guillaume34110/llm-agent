import { useEffect, useState } from 'react';
import { fetchMyProfile, upsertMyProfile, deleteMyProfile, type PublicProfile } from '../social/social-client';

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]{1,30}[a-z0-9])?$/;

export default function ProfilePanel() {
  const [loading, setLoading] = useState(true);
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    fetchMyProfile()
      .then((p: PublicProfile) => {
        if (p.handle) {
          setHandle(p.handle);
          setBio(p.bio || '');
          setHasProfile(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleValid = HANDLE_RE.test(handle);
  const bioValid = bio.length <= 280;

  const save = async () => {
    setError(null);
    setSaved(false);
    if (!handleValid) {
      setError('Handle: 3-32 chars, lowercase letters / digits / _ / -, must start and end alphanumeric.');
      return;
    }
    if (!bioValid) {
      setError('Bio max 280 chars.');
      return;
    }
    setSaving(true);
    try {
      await upsertMyProfile({ handle, bio });
      setHasProfile(true);
      setSaved(true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete public profile? Your handle will be freed.')) return;
    setSaving(true);
    try {
      await deleteMyProfile();
      setHandle('');
      setBio('');
      setHasProfile(false);
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-[18px]">
        <div className="text-[13.5px] font-black text-[var(--text)]">Public profile</div>
        <div className="mt-2 text-[12px] text-[var(--text-dim)]">Loading…</div>
      </div>
    );
  }

  const inputCls = "w-full px-3 py-2 rounded-[var(--rm)] bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] text-[12.5px] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50";

  return (
    <div className="p-[18px]">
      <div className="text-[13.5px] font-black text-[var(--text)]">Public profile</div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
        Optional. Lets other users find you by handle and view your shared conversations.
        Stored server-side. Delete to opt out at any time.
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="block text-[11.5px] font-bold text-[var(--text-muted)] mb-1.5">Handle</span>
          <input
            type="text"
            value={handle}
            onChange={e => setHandle(e.target.value.toLowerCase().trim())}
            placeholder="e.g. alice_42"
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            className={inputCls}
          />
          {handle && !handleValid && (
            <div className="mt-1 text-[11px]" style={{ color: '#e07070' }}>Invalid handle</div>
          )}
        </label>

        <label className="block">
          <span className="block text-[11.5px] font-bold text-[var(--text-muted)] mb-1.5">
            Bio <span className="text-[var(--text-dim)] font-normal">({bio.length}/280)</span>
          </span>
          <textarea
            value={bio}
            onChange={e => setBio(e.target.value)}
            rows={3}
            maxLength={280}
            className={inputCls + ' leading-relaxed resize-none'}
          />
        </label>

        {error && (
          <div className="text-[11.5px]" style={{ color: '#e07070' }}>{error}</div>
        )}
        {saved && (
          <div className="text-[11.5px] text-[var(--accent)]">✓ Saved.</div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={save}
            disabled={saving || !handle}
            className="px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : hasProfile ? 'Update' : 'Publish'}
          </button>
          {hasProfile && (
            <button
              type="button"
              onClick={remove}
              disabled={saving}
              className="px-3 py-2 rounded-[var(--rm)] text-[12px] font-semibold bg-transparent text-[var(--red)] border border-[var(--border)] hover:bg-[var(--red-soft)] disabled:opacity-40"
            >
              Delete profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
