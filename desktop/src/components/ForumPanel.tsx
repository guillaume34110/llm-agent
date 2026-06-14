import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  postWall,
  listWall,
  replyWall,
  fetchReplies,
  type WallMode,
  type WallPostDecoded,
  type WallReplyRow,
} from '../social/wall-client';
import { AVAILABILITY_TAGS } from '../social/availability-client';

const WALL_MODES: WallMode[] = ['find_collab', 'find_expertise', 'announce_project', 'rfc'];
const MODE_LABELS: Record<WallMode, { fr: string; en: string }> = {
  find_collab: { fr: 'Cherche collab', en: 'Looking for collab' },
  find_expertise: { fr: 'Cherche expertise', en: 'Looking for expertise' },
  announce_project: { fr: 'Annonce projet', en: 'Project announcement' },
  rfc: { fr: 'RFC', en: 'RFC' },
};

function relativeTime(isoStr: string, lang: 'fr' | 'en'): string {
  const d = new Date(isoStr).getTime();
  const now = Date.now();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) return lang === 'fr' ? 'à l\'instant' : 'just now';
  if (diffMin < 60)
    return lang === 'fr' ? `il y a ${diffMin}m` : `${diffMin}m ago`;
  if (diffHr < 24)
    return lang === 'fr' ? `il y a ${diffHr}h` : `${diffHr}h ago`;
  if (diffDay < 7)
    return lang === 'fr' ? `il y a ${diffDay}j` : `${diffDay}d ago`;
  return new Date(d).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US');
}

export default function ForumPanel() {
  const { i18n } = useTranslation();
  const lang: 'fr' | 'en' = (i18n.language || 'en').startsWith('fr') ? 'fr' : 'en';

  const [selectedTag, setSelectedTag] = useState<string>(AVAILABILITY_TAGS[0] || 'rust');
  const [selectedMode, setSelectedMode] = useState<WallMode>('find_collab');

  const [posts, setPosts] = useState<WallPostDecoded[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');

  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [repliesData, setRepliesData] = useState<Record<string, { count?: number; replies?: WallReplyRow[] }>>({});
  const [repliesError, setRepliesError] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyError, setReplyError] = useState('');

  // Load posts on tag change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listWall(selectedTag)
      .then((p) => {
        if (!cancelled) {
          setPosts(p.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedTag]);

  async function handlePost() {
    if (!body.trim() || body.trim().length < 10) {
      setPostError(lang === 'fr' ? 'Le contenu doit faire au moins 10 caractères.' : 'Content must be at least 10 characters.');
      return;
    }
    setPosting(true);
    setPostError('');
    try {
      await postWall({
        tag: selectedTag,
        mode: selectedMode,
        payload: { title: title.trim(), body: body.trim() },
        filters: {},
      });
      setTitle('');
      setBody('');
      // Refresh list
      const updated = await listWall(selectedTag);
      setPosts(updated.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch (e: any) {
      setPostError(String(e?.message || e));
    } finally {
      setPosting(false);
    }
  }

  async function handleToggleReplies(postId: string) {
    if (expandedReplies.has(postId)) {
      setExpandedReplies((s) => {
        const next = new Set(s);
        next.delete(postId);
        return next;
      });
      return;
    }
    try {
      const data = await fetchReplies(postId);
      setRepliesData((prev) => ({ ...prev, [postId]: data }));
      setRepliesError((prev) => { const next = { ...prev }; delete next[postId]; return next; });
      setExpandedReplies((s) => new Set([...s, postId]));
    } catch (e: any) {
      setRepliesError((prev) => ({ ...prev, [postId]: String(e?.message || e) }));
      setExpandedReplies((s) => new Set([...s, postId]));
    }
  }

  async function handleReply(postId: string) {
    if (!replyText.trim()) return;
    setReplyLoading(true);
    setReplyError('');
    try {
      await replyWall(postId, { answer: { text: replyText.trim() } });
      setReplyingTo(null);
      setReplyText('');
      // Refresh replies
      const data = await fetchReplies(postId);
      setRepliesData((prev) => ({ ...prev, [postId]: data }));
    } catch (e: any) {
      setReplyError(String(e?.message || e));
    } finally {
      setReplyLoading(false);
    }
  }

  return (
    <div className="p-[18px]">
      <div className="text-[13.5px] font-black text-[var(--text)]">
        {lang === 'fr' ? 'Forum' : 'Forum'}
      </div>
      <div className="mt-1 text-[11.5px] text-[var(--text-dim)] leading-relaxed">
        {lang === 'fr'
          ? 'Forum public chiffré par tag. Ton agent voit la clé du tag, le serveur voit seulement le ciphertext + pseudo.'
          : 'Public forum encrypted by tag. Your agent sees the tag key, the server only sees ciphertext + pseudonym.'}
      </div>

      {/* Tag picker */}
      <div className="mt-4 text-[12px] font-black text-[var(--text)]">
        {lang === 'fr' ? 'Tag' : 'Tag'}
      </div>
      <div className="mt-2 flex flex-wrap gap-[6px]">
        {AVAILABILITY_TAGS.slice(0, 12).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSelectedTag(t)}
            className={`px-[8px] py-[3px] rounded-full text-[11px] border ${
              selectedTag === t
                ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                : 'bg-[var(--glass-bg)] text-[var(--text-dim)] border-[var(--glass-border)] hover:text-[var(--text)] hover:border-[var(--accent)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Mode picker */}
      <div className="mt-4 text-[12px] font-black text-[var(--text)]">
        {lang === 'fr' ? 'Mode' : 'Mode'}
      </div>
      <div className="mt-2 flex flex-wrap gap-[6px]">
        {WALL_MODES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSelectedMode(m)}
            className={`px-[10px] py-[5px] rounded-full text-[11.5px] border ${
              selectedMode === m
                ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                : 'bg-[var(--glass-bg)] text-[var(--text-dim)] border-[var(--glass-border)] hover:text-[var(--text)] hover:border-[var(--accent)]'
            }`}
          >
            {MODE_LABELS[m][lang]}
          </button>
        ))}
      </div>

      {/* Compose form */}
      <div className="mt-4">
        <label htmlFor="forum-title" className="sr-only">
          {lang === 'fr' ? 'Titre' : 'Title'}
        </label>
        <input
          id="forum-title"
          type="text"
          placeholder={lang === 'fr' ? 'Titre (optionnel)' : 'Title (optional)'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-3 py-2 rounded-[var(--rm)] text-[12px] bg-[var(--glass-bg-strong)] text-[var(--text)] border border-[var(--glass-border)] focus:outline-none focus:border-[var(--accent)]"
          disabled={posting}
        />
        <label htmlFor="forum-body" className="sr-only">
          {lang === 'fr' ? 'Contenu' : 'Content'}
        </label>
        <textarea
          id="forum-body"
          placeholder={lang === 'fr' ? 'Contenu (min 10 caractères)' : 'Content (min 10 chars)'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="w-full mt-2 px-3 py-2 rounded-md text-[12px] bg-[var(--glass-bg-strong)] text-[var(--text)] border border-[var(--glass-border)] focus:outline-none focus:border-[var(--accent)] resize-none"
          disabled={posting}
        />
        {postError && (
          <div className="mt-2 text-[11px]" style={{ color: '#e07070' }}>
            {postError}
          </div>
        )}
        <button
          type="button"
          onClick={handlePost}
          disabled={posting}
          className="mt-3 px-4 h-[28px] rounded-full text-[11.5px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90 disabled:opacity-50"
        >
          {lang === 'fr' ? 'Publier' : 'Post'}
        </button>
      </div>

      {/* Posts list */}
      <div className="mt-6">
        {loading && (
          <div className="text-[12px] text-[var(--text-dim)]">
            {lang === 'fr' ? 'Chargement…' : 'Loading…'}
          </div>
        )}
        {error && (
          <div className="text-[11.5px]" style={{ color: '#e07070' }}>
            {error}
          </div>
        )}
        {!loading && !error && posts.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-10 gap-2">
            <div className="text-4xl opacity-70">💬</div>
            <div className="text-[12.5px] font-bold text-[var(--text-muted)]">
              {lang === 'fr' ? 'Aucun post sur ce tag' : 'No posts on this tag'}
            </div>
            <div className="text-[11.5px] text-[var(--text-dim)] max-w-[320px] leading-relaxed">
              {lang === 'fr' ? 'Sois le premier à lancer la discussion.' : 'Be the first to start the discussion.'}
            </div>
          </div>
        )}
        {posts.map((post) => (
          <div
            key={post.id}
            className="mt-4 p-3.5 rounded-[var(--rm)] bg-[var(--glass-bg)] border border-[var(--glass-border)]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-[var(--text-dim)] font-mono">
                    {post.pseudonym.slice(0, 8)}
                  </span>
                  <span className="px-[6px] py-[2px] rounded-full text-[10px] bg-[var(--accent)] text-[var(--on-accent)]">
                    {MODE_LABELS[post.mode][lang]}
                  </span>
                  <span className="text-[11px] text-[var(--text-dim)]">
                    {relativeTime(post.createdAt, lang)}
                  </span>
                </div>
                {post.payload.title && (
                  <div className="mt-1 text-[12px] font-medium text-[var(--text)]">
                    {post.payload.title}
                  </div>
                )}
                <div className="mt-1 text-[12px] text-[var(--text)] whitespace-pre-wrap break-words">
                  {post.payload.body}
                </div>
              </div>
            </div>

            {/* Replies toggle */}
            <button
              type="button"
              onClick={() => handleToggleReplies(post.id)}
              className="mt-2 text-[11px] text-[var(--accent)] hover:underline"
            >
              {expandedReplies.has(post.id)
                ? lang === 'fr' ? 'Masquer réponses' : 'Hide replies'
                : lang === 'fr' ? 'Voir réponses' : 'View replies'}
            </button>

            {/* Replies list */}
            {expandedReplies.has(post.id) && repliesError[post.id] && (
              <div className="mt-2 pl-3 border-l border-[var(--glass-border)] text-[11px]" style={{ color: '#e07070' }}>
                {repliesError[post.id]}
              </div>
            )}
            {expandedReplies.has(post.id) && repliesData[post.id] && (
              <div className="mt-3 pl-3 border-l border-[var(--glass-border)]">
                {repliesData[post.id].count !== undefined && (
                  <div className="text-[11px] text-[var(--text-dim)]">
                    {lang === 'fr'
                      ? `${repliesData[post.id].count} réponse${repliesData[post.id].count !== 1 ? 's' : ''}`
                      : `${repliesData[post.id].count} ${repliesData[post.id].count === 1 ? 'reply' : 'replies'}`}
                  </div>
                )}
                {repliesData[post.id].replies && repliesData[post.id].replies!.map((reply) => (
                  <div key={reply.id} className="mt-2 text-[11px] text-[var(--text)]">
                    <div className="text-[10px] text-[var(--text-dim)] font-mono">
                      {reply.responderPseudonymForTag.slice(0, 8)}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words">
                      {typeof reply.answer === 'string' ? reply.answer : JSON.stringify(reply.answer)}
                    </div>
                    <div className="mt-1 text-[10px] text-[var(--text-dim)]">
                      {relativeTime(reply.createdAt, lang)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Reply form */}
            {replyingTo === post.id ? (
              <div className="mt-2 pl-3 border-l border-[var(--glass-border)]">
                <textarea
                  placeholder={lang === 'fr' ? 'Votre réponse…' : 'Your reply…'}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={2}
                  className="w-full px-2.5 py-1.5 rounded-[var(--rm)] text-[11.5px] bg-[var(--glass-bg-strong)] text-[var(--text)] border border-[var(--glass-border)] outline-none focus:border-[var(--accent)] resize-none"
                  disabled={replyLoading}
                />
                {replyError && (
                  <div className="mt-1 text-[10px]" style={{ color: '#e07070' }}>
                    {replyError}
                  </div>
                )}
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleReply(post.id)}
                    disabled={replyLoading}
                    className="px-2.5 h-[22px] rounded-full text-[10.5px] font-black bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-90 disabled:opacity-50"
                  >
                    {lang === 'fr' ? 'Envoyer' : 'Send'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyingTo(null);
                      setReplyText('');
                      setReplyError('');
                    }}
                    disabled={replyLoading}
                    className="px-2 py-1 rounded text-[10px] text-[var(--text-dim)] hover:text-[var(--text)]"
                  >
                    {lang === 'fr' ? 'Annuler' : 'Cancel'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setReplyingTo(post.id)}
                className="mt-2 text-[11px] text-[var(--accent)] hover:underline"
              >
                {lang === 'fr' ? 'Répondre' : 'Reply'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
