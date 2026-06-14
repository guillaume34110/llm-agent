import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationAccountsState } from '../../integrations/app-accounts-service';
import Dropdown from '../Dropdown';
import {
  createShortcutStory,
  formatShortcutStories,
  listShortcutWorkflows,
  openShortcutPage,
  searchShortcutStories,
  type ShortcutStorySummary,
  type ShortcutWorkflowSummary,
} from '../../integrations/shortcut-service';

interface Props {
  accounts: IntegrationAccountsState;
  onUpdate: (patch: Partial<IntegrationAccountsState>) => void;
}

const STORY_TYPES = ['feature', 'bug', 'chore'] as const;

export default function ShortcutPanel({ accounts, onUpdate }: Props) {
  const { t } = useTranslation();
  const [workflows, setWorkflows] = useState<ShortcutWorkflowSummary[]>([]);
  const [stories, setStories] = useState<ShortcutStorySummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [storyDescription, setStoryDescription] = useState('');
  const [storyType, setStoryType] = useState<(typeof STORY_TYPES)[number]>('feature');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const configuredDefaultStateId = useMemo(
    () => Number.parseInt(accounts.shortcut.defaultWorkflowStateId, 10),
    [accounts.shortcut.defaultWorkflowStateId],
  );

  const loadWorkflows = async () => {
    if (!accounts.shortcut.token.trim()) return;
    setLoading(true);
    setStatus('');
    try {
      const nextWorkflows = await listShortcutWorkflows();
      setWorkflows(nextWorkflows);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkflows();
  }, [accounts.shortcut.token]);

  const runSearch = async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    setStatus('');
    try {
      const result = await searchShortcutStories(searchQuery, 8);
      setStories(result);
      setStatus(formatShortcutStories(result));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const createStory = async () => {
    if (!storyTitle.trim()) return;
    setLoading(true);
    setStatus('');
    try {
      const story = await createShortcutStory({
        title: storyTitle,
        description: storyDescription,
        storyType,
      });
      setStoryTitle('');
      setStoryDescription('');
      setStories(prev => [story, ...prev].slice(0, 8));
      setStatus(t('integrations.shortcut.storyCreatedSuccess', { url: story.app_url }));
      await openShortcutPage(story.app_url);
      if (!accounts.shortcut.defaultWorkflowStateId.trim()) {
        await loadWorkflows();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const selectDefaultState = (stateId: number) => {
    onUpdate({ shortcut: { defaultWorkflowStateId: String(stateId) } as IntegrationAccountsState['shortcut'] });
  };

  return (
    <section className="border border-[var(--border)] rounded-[var(--rm)] bg-[var(--bg3)] p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex-1">
          <div className="text-[13.5px] font-black text-[var(--text)]">Shortcut</div>
          <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">
            {t('integrations.shortcut.description')}
          </div>
        </div>
        <button
          onClick={() => void openShortcutPage()}
          className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-2.5 py-2 cursor-pointer font-bold"
        >
          {t('integrations.shortcut.openShortcut')}
        </button>
        <button
          onClick={() => void loadWorkflows()}
          disabled={loading || !accounts.shortcut.token.trim()}
          className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-2.5 py-2 cursor-pointer font-bold"
        >
          {t('common.refresh')}
        </button>
      </div>

      {!accounts.shortcut.token.trim() && <div className="mt-3 text-[12px] text-[var(--text-dim)]">{t('integrations.shortcut.addTokenHint')}</div>}

      {accounts.shortcut.token.trim() && (
        <div className="mt-3.5 grid gap-4">
          <div className="grid gap-2">
            <div className="text-[11px] text-[var(--text-dim)] font-extrabold uppercase tracking-[0.06em]">
              Workflows
            </div>
            <div className="grid gap-2.5">
              {workflows.map(workflow => (
                <div key={workflow.id} className="border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] p-3">
                  <div className="text-[12.5px] text-[var(--text)] font-extrabold">{workflow.name}</div>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {[...workflow.states].sort((a, b) => a.position - b.position).map(state => {
                      const selected = configuredDefaultStateId === state.id;
                      const workflowDefault = workflow.default_state_id === state.id;
                      return (
                        <button
                          key={state.id}
                          onClick={() => selectDefaultState(state.id)}
                          className="rounded-full text-[11.5px] font-bold px-2.5 py-1.5 cursor-pointer"
                          style={{
                            border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                            background: selected ? 'var(--accent-soft)' : 'transparent',
                            color: selected ? 'var(--accent)' : 'var(--text-muted)',
                          }}
                        >
                          {state.name} #{state.id}{workflowDefault ? ' · default' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="text-[11px] text-[var(--text-dim)] font-extrabold uppercase tracking-[0.06em]">
              Recherche
            </div>
            <div className="flex gap-2.5">
              <input
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder={t('integrations.shortcut.searchStoriesPlaceholder')}
                className="flex-1 rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]"
              />
              <button onClick={() => void runSearch()} disabled={loading || !searchQuery.trim()} className="border border-[var(--border)] bg-transparent text-[var(--text-muted)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-bold">
                {t('common.search')}
              </button>
            </div>
            {stories.length > 0 && (
              <div className="grid gap-2">
                {stories.map(story => (
                  <button key={story.id} onClick={() => void openShortcutPage(story.app_url)} className="text-left border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] p-3 cursor-pointer">
                    <div className="text-[12.5px] text-[var(--text)] font-extrabold">#{story.id} · {story.name}</div>
                    <div className="mt-1 text-[11.5px] text-[var(--text-dim)]">{story.story_type || 'story'}{story.deadline ? ` · ${story.deadline}` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-[var(--border)] pt-3.5 grid gap-2.5">
            <div className="text-[12.5px] text-[var(--text)] font-extrabold">{t('integrations.shortcut.createStory')}</div>
            <input
              value={storyTitle}
              onChange={event => setStoryTitle(event.target.value)}
              placeholder={t('integrations.shortcut.storyTitlePlaceholder')}
              className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito]"
            />
            <Dropdown
              value={storyType}
              onChange={v => setStoryType(v as (typeof STORY_TYPES)[number])}
              options={STORY_TYPES.map(type => ({ value: type, label: type }))}
              fontSize={13}
              buttonPadding="10px 12px"
            />
            <textarea
              value={storyDescription}
              onChange={event => setStoryDescription(event.target.value)}
              rows={4}
              placeholder={t('integrations.shortcut.storyDescriptionPlaceholder', { state: accounts.shortcut.defaultWorkflowStateId || t('integrations.shortcut.autoDetected') })}
              className="rounded-[var(--r)] border border-[var(--border)] bg-[var(--bg2)] text-[var(--text)] px-3 py-2.5 font-[Nunito] resize-y"
            />
            <button
              onClick={() => void createStory()}
              disabled={loading || !storyTitle.trim()}
              className="border border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] rounded-[var(--r)] px-3 py-2.5 cursor-pointer font-extrabold font-[Nunito]"
            >
              {t('integrations.shortcut.createInShortcut')}
            </button>
          </div>

          {status && (
            <pre className="m-0 whitespace-pre-wrap border border-[var(--border)] rounded-[var(--r)] bg-[var(--bg2)] text-[11.5px] leading-relaxed px-3.5 py-3" style={{ color: status.startsWith('OK:') ? 'var(--accent)' : 'var(--text)' }}>
              {status}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
