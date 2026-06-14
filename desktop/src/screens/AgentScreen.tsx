import React, { useState, useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { api, saveSession } from '../api';
import { serializeAttachmentsForPrompt, toMessageAttachments } from '../attachments/attachment-service';
import { getPreferences, subscribePreferences, updatePreferences } from '../preferences/preferences-service';
import { startReminderLoop, stopReminderLoop } from '../notifications/reminder-service';
import { registerDesktopJobRunners } from '../jobs/register-runners';
import { resumePendingJobs } from '../jobs/job-service';
import { speakText, stopSpeaking } from '../voice/speech';
import { recordUsage } from '../observability/usage-log';
import type { Message, ToolCall, AgentPlan, StepStatus, AgentView, ComposerAttachment } from '../types';
import TopBar from '../components/TopBar';
import ChatsRail from '../components/ChatsRail';
import ChatFeed from '../components/ChatFeed';
import ChessConsole from '../components/ChessConsole';
import PokerConsole from '../components/PokerConsole';
import ScrabbleConsole from '../components/ScrabbleConsole';
import RtsConsole from '../components/RtsConsole';
import MakerConsole from '../components/MakerConsole';
import CartConsole from '../components/CartConsole';
import { resolveCartByName } from '../game/engine/storage';
import InputBar from '../components/InputBar';
import AiDisclosureFooter from '../components/AiDisclosureFooter';
import WorkspaceBar from '../components/WorkspaceBar';
import KnowledgeView from '../components/KnowledgeView';
import PeopleView from '../components/PeopleView';
import TasksView from '../components/TasksView';
import SettingsView from '../components/SettingsView';
import LeftRail from '../components/LeftRail';
import InboxView from '../components/InboxView';
import BackgroundView from '../components/BackgroundView';
import ChatbotsView from '../components/ChatbotsView';
import { fetchInboxItems } from '../inbox/inbox-aggregator';
import { isDismissed as isInboxDismissed, subscribeDismissChange } from '../inbox/inbox-dismissed';
import ToastsHost from '../components/ToastsHost';
import CommandPalette from '../components/CommandPalette';
import OnboardingModal from '../components/OnboardingModal';
import ProductTour from '../components/ProductTour';
import AnimalAvatar from '../components/AnimalAvatar';
import LocalRuntimeToggle from '../components/LocalRuntimeToggle';
import { resizeWidgetHeight } from '../widget/widget-mode';
import { classifyAgentError } from '../agent/error-classifier';

let msgId = 0;
const uid = () => String(++msgId);

interface Props {
  onSignOut: () => void;
  compact?: boolean;
}

export default function AgentScreen({ onSignOut, compact = false }: Props) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveTools, setLiveTools] = useState<ToolCall[]>([]);
  const [loadingLabel, setLoadingLabel] = useState('');
  const [sessionTitle, setSessionTitle] = useState('');
  const [suggestionText, setSuggestionText] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsRefreshKey, setSessionsRefreshKey] = useState(0);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [activeCartId, setActiveCartId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<AgentView>('inbox');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [preferences, setPreferences] = useState(getPreferences());
  const [showOnboarding, setShowOnboarding] = useState(!getPreferences().onboardingDismissed);
  const [showTour, setShowTour] = useState(() => {
    const p = getPreferences();
    return p.onboardingDismissed && !p.tourDone;
  });
  const [runtimeStatus, setRuntimeStatus] = useState('');
  const [activeModelId, setActiveModelId] = useState('');
  const [inboxBadge, setInboxBadge] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const items = await fetchInboxItems();
        if (cancelled) return;
        const live = items.filter(it => !isInboxDismissed(it.id));
        setInboxBadge(live.length);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 30_000);
    const unsub = subscribeDismissChange(tick);
    return () => {
      cancelled = true;
      clearInterval(id);
      unsub();
    };
  }, []);
  const [sessionUsage, setSessionUsage] = useState<{ promptTokens: number; completionTokens: number; lastTokPerSec: number }>({ promptTokens: 0, completionTokens: 0, lastTokPerSec: 0 });
  const stopStream = useRef<(() => void) | null>(null);
  const planInjected = useRef(false);
  const sessionId = useRef(crypto.randomUUID());
  const loadingRef = useRef(loading);
  const sessionCreatedAt = useRef(new Date().toISOString());

  useEffect(() => subscribePreferences(next => {
    setPreferences(next);
    setShowOnboarding(!next.onboardingDismissed);
  }), []);

  // Keep loadingRef in sync so the watchdog interval can read live state.
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // Auto-stop idle llama-server after 15 min of no chat activity.
  // Skip while a stream is active — touch is already stamped at stream start.
  useEffect(() => {
    const id = setInterval(() => {
      if (loadingRef.current) return;
      void invoke('llama_runtime_idle_stop', { idleSecs: 15 * 60 }).catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    registerDesktopJobRunners();
    resumePendingJobs();
    startReminderLoop();
    return () => {
      stopReminderLoop();
      stopSpeaking();
    };
  }, []);

  const handleSignOut = async () => {
    stopSpeaking();
    await api.signOut().catch(() => {});
    onSignOut();
  };

  const sendMessage = useCallback((payload: {
    text: string;
    attachments: ComposerAttachment[];
    modelId: string;
    imageModelId: string;
    imageSize: string;
    musicModelId: string;
    videoModelId: string;
    providerMode: 'local' | 'friend';
    providerUserId?: string;
  }) => {
    const baseText = payload.text.trim();
    if ((!baseText && payload.attachments.length === 0) || loading) return;
    const rawContent = `${baseText}${serializeAttachmentsForPrompt(payload.attachments)}`;
    const userMsg: Message = {
      id: uid(),
      role: 'user',
      content: baseText,
      rawContent,
      attachments: toMessageAttachments(payload.attachments),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setLiveTools([]);
    setLoadingLabel(t('agentScreen.thinking.base'));
    setRuntimeStatus('');
    setPlan(null);
    planInjected.current = false;
    if (!sessionTitle) setSessionTitle(baseText.slice(0, 40) || payload.attachments[0]?.name || 'Nouvelle session');
    const history = messages.slice(-10).map(m => ({ role: m.role, content: m.rawContent ?? m.content }));

    const toolsAccum: ToolCall[] = [];
    const turnUsage = { prompt: 0, completion: 0, modelId: '' };

    const stop = api.chatStream(rawContent, history, payload.modelId || undefined, payload.imageModelId, payload.imageSize, payload.musicModelId, payload.videoModelId, {
      preferredFamily: preferences.agentModelFamily || undefined,
      budgetMode: preferences.agentModelBudgetMode,
      allowFamilyFallback: preferences.allowAgentFamilyFallback,
      sessionId: sessionId.current,
      providerMode: payload.providerMode,
      providerUserId: payload.providerUserId,
    }, (evt) => {
      const TOOL_LABELS: Record<string, string> = {
        think: t('agentScreen.tool.think'),
        set_plan: t('agentScreen.tool.setPlan'), define_dod: t('agentScreen.tool.defineDod'), verify_step: t('agentScreen.tool.verifyStep'),
        fetch_page: t('agentScreen.tool.fetchPage'), search_and_read: t('agentScreen.tool.searchAndRead'),
        product_search: t('agentScreen.tool.productSearch'),
        browser_navigate: t('agentScreen.tool.browserNavigate'), browser_get_text: t('agentScreen.tool.browserGetText'),
        browser_get_links: t('agentScreen.tool.browserGetLinks'), browser_click: t('agentScreen.tool.browserClick'),
        browser_fill: t('agentScreen.tool.browserFill'), browser_scroll: t('agentScreen.tool.browserScroll'),
        browser_run_js: t('agentScreen.tool.browserRunJs'), browser_screenshot: t('agentScreen.tool.browserScreenshot'),
        browser_navigate_back: t('agentScreen.tool.browserNavigateBack'), browser_current_url: t('agentScreen.tool.browserCurrentUrl'),
        browser_wait_for: t('agentScreen.tool.browserWaitFor'),
        read_file: t('agentScreen.tool.readFile'), write_file: t('agentScreen.tool.writeFile'),
        list_dir: t('agentScreen.tool.listDir'), list_dir_images: t('toolCall.listDirImages'), grep_files: t('agentScreen.tool.grepFiles'),
        run_command: t('agentScreen.tool.runCommand'),
        create_task: t('agentScreen.tool.createTask'), list_tasks: t('agentScreen.tool.listTasks'),
        update_task: t('agentScreen.tool.updateTask'), delete_task: t('agentScreen.tool.deleteTask'),
        github_list_repos: t('agentScreen.tool.githubListRepos'), github_list_notifications: t('agentScreen.tool.githubListNotifications'),
        github_list_issues: t('agentScreen.tool.githubListIssues'), github_create_issue: t('agentScreen.tool.githubCreateIssue'),
        gmail_compose: t('agentScreen.tool.gmailCompose'), discord_send_message: t('agentScreen.tool.discordSendMessage'),
        whatsapp_compose: t('agentScreen.tool.whatsappCompose'),
        google_calendar_create_event: t('agentScreen.tool.googleCalendarCreateEvent'), google_drive_open: t('agentScreen.tool.googleDriveOpen'),
        slack_send_message: t('agentScreen.tool.slackSendMessage'), telegram_send_message: t('agentScreen.tool.telegramSendMessage'),
        notion_search: t('agentScreen.tool.notionSearch'), notion_create_page: t('agentScreen.tool.notionCreatePage'),
        dropbox_list_files: t('agentScreen.tool.dropboxListFiles'), dropbox_upload_text: t('agentScreen.tool.dropboxUploadText'),
        shortcut_list_workflows: t('agentScreen.tool.shortcutListWorkflows'), shortcut_search_stories: t('agentScreen.tool.shortcutSearchStories'),
        shortcut_create_story: t('agentScreen.tool.shortcutCreateStory'),
        messenger_open: t('agentScreen.tool.messengerOpen'), instagram_open: t('agentScreen.tool.instagramOpen'),
        x_compose_post: t('agentScreen.tool.xComposePost'), linkedin_open_share: t('agentScreen.tool.linkedinOpenShare'),
        zoom_open: t('agentScreen.tool.zoomOpen'),
        remember: t('agentScreen.tool.remember'), search_memory: t('agentScreen.tool.searchMemory'), forget: t('agentScreen.tool.forget'),
        save_to_kb: t('agentScreen.tool.saveToKb'), search_kb: t('agentScreen.tool.searchKb'), list_kb: t('agentScreen.tool.listKb'), forget_kb: t('agentScreen.tool.forgetKb'),
      };
      if (evt.event === 'plan') {
        const steps = evt.steps || [];
        const current = evt.current ?? 0;
        setPlan({
          steps,
          current,
          statuses: steps.map((_: string, i: number) => i < current ? 'done' : i === current ? 'running' : 'pending'),
          results: {},
          skipReasons: {},
          screenshots: [],
          incomplete: false,
          finalAuditStatus: null,
          finalAuditIssues: [],
        });
        // Inject plan as a visible card in the feed (only on first set_plan call)
        if (!planInjected.current && steps.length > 0) {
          planInjected.current = true;
          setMessages(prev => [...prev, {
            id: uid(),
            role: 'assistant',
            content: '',
            planSteps: steps,
          }]);
        } else if (planInjected.current) {
          // Update the injected plan card with new steps if they changed
          setMessages(prev => {
            const idx = [...prev].reverse().findIndex(m => m.planSteps);
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            const updated = [...prev];
            updated[realIdx] = { ...updated[realIdx], planSteps: steps };
            return updated;
          });
        }
      } else if (evt.event === 'plan_update') {
        setPlan(prev => prev ? {
          ...prev,
          current: evt.current ?? prev.current,
          statuses: (evt.statuses as StepStatus[]) ?? prev.statuses,
          ...(evt.stepId && evt.status === 'skipped' && evt.skipReason
            ? { skipReasons: { ...(prev.skipReasons || {}), [evt.stepId]: evt.skipReason } }
            : {}),
        } : null);
      } else if (evt.event === 'step_audit') {
        setPlan(prev => {
          if (!prev) return null;
          const statuses = [...prev.statuses];
          const sid = evt.stepId || '';
          const idx = parseInt(String(sid).replace('step_', ''));
          if (!isNaN(idx) && idx < statuses.length) {
            statuses[idx] = (evt.status as StepStatus);
          }
          return {
            ...prev,
            statuses,
            results: { ...(prev.results || {}), [sid]: (evt.results as any[]) || [] },
          };
        });
      } else if (evt.event === 'audit') {
        if (evt.status === 'checking') setLoadingLabel(t('agentScreen.audit.checking'));
        else if (evt.status === 'failed') setLoadingLabel(t('agentScreen.audit.fixing'));
        else if (evt.status === 'ok') setLoadingLabel(t('agentScreen.audit.verified'));
        if (evt.status === 'ok' || evt.status === 'failed') {
          setPlan(prev => prev ? {
            ...prev,
            finalAuditStatus: evt.status as 'ok' | 'failed',
            finalAuditIssues: evt.issues || [],
          } : null);
        }
      } else if (evt.event === 'thinking') {
        const PHASE_LABELS: Record<string, string> = {
          loading_profile: t('agentScreen.thinking.loadingProfile'),
          scanning_workspace: t('agentScreen.thinking.scanningWorkspace'),
          selecting_skills: t('agentScreen.thinking.selectingSkills'),
          synthesis: t('agentScreen.thinking.synthesis'),
          calling_model: t('agentScreen.thinking.callingModel'),
          waiting_model: t('agentScreen.thinking.waitingModel'),
        };
        const phase = evt.phase || '';
        const base = PHASE_LABELS[phase] || 'Je réfléchis…';
        const parts: string[] = [base];
        if (phase === 'waiting_model' && evt.elapsedMs && evt.elapsedMs >= 1000) {
          parts.push(`${Math.floor(evt.elapsedMs / 1000)}s`);
        }
        if (phase === 'calling_model' && evt.contextTokens && evt.contextTokens > 0) {
          parts.push(`~${Math.round(evt.contextTokens / 100) / 10}k tok`);
        }
        if ((phase === 'calling_model' || phase === 'waiting_model') && evt.iter && evt.iter > 1) {
          parts.push(`iter ${evt.iter}${evt.maxIters ? `/${evt.maxIters}` : ''}`);
        }
        setLoadingLabel(parts.join(' · '));
        if (phase === 'calling_model' && evt.modelId) {
          setRuntimeStatus(evt.modelId);
          setActiveModelId(evt.modelId);
        }
      } else if (evt.event === 'polishing') {
        setLoadingLabel(t('agentScreen.polishing'));
      } else if (evt.event === 'model_route') {
        if (evt.modelId) setActiveModelId(evt.modelId);
        setRuntimeStatus(evt.data || `${evt.family || t('agentScreen.family')} · ${evt.modelId || t('agentScreen.model')}`);
        setLoadingLabel(
          evt.reason === 'initial' || evt.reason === 'primary' || evt.reason === 'override'
            ? t('agentScreen.selectingModel')
            : t('agentScreen.switchingModel'),
        );
      } else if (evt.event === 'usage') {
        const pt = Number(evt.promptTokens || 0);
        const ct = Number(evt.completionTokens || 0);
        const ms = Number(evt.elapsedMs || 0);
        const tps = ms > 0 && ct > 0 ? (ct / (ms / 1000)) : 0;
        setSessionUsage(prev => ({
          promptTokens: prev.promptTokens + pt,
          completionTokens: prev.completionTokens + ct,
          lastTokPerSec: tps || prev.lastTokPerSec,
        }));
        turnUsage.prompt += pt;
        turnUsage.completion += ct;
        if (evt.modelId) {
          turnUsage.modelId = evt.modelId;
          setActiveModelId(evt.modelId);
        }
        recordUsage({
          kind: 'tokens',
          ts: Date.now(),
          model: evt.modelId || payload.modelId || 'unknown',
          promptTokens: pt,
          completionTokens: ct,
          costCents: 0,
        });
      } else if (evt.event === 'tool_start') {
        setLoadingLabel(TOOL_LABELS[evt.name!] || 'En cours…');
        setLiveTools(prev => [...prev, { name: evt.name!, args: evt.args || {} }]);
      } else if (evt.event === 'tool_done') {
        const done: ToolCall = { name: evt.name!, args: evt.args || {}, output: evt.output };
        toolsAccum.push(done);
        setLiveTools([...toolsAccum]);
        recordUsage({
          kind: 'tool',
          ts: Date.now(),
          name: String(evt.name || 'unknown'),
          ok: !String(evt.output ?? '').startsWith('ERREUR:'),
        });
      } else if (evt.event === 'game_launch') {
        // Tool launched a playable game frame — swap the chat for the console.
        if (evt.game === 'cart') {
          const c = evt.cart ? resolveCartByName(evt.cart) : null;
          setActiveCartId(c?.id);
        } else {
          setActiveCartId(undefined);
        }
        setActiveGame(evt.game || 'chess');
        setView('chats');
        setLoading(false);
        setLiveTools([]);
        setLoadingLabel('');
        setRuntimeStatus('');
      } else if (evt.event === 'done') {
        const modelForCost = turnUsage.modelId || payload.modelId || '';
        const costCents = 0;
        const assistantMsg: Message = {
          id: uid(),
          role: 'assistant',
          content: evt.data || '',
          toolCalls: toolsAccum.length > 0 ? [...toolsAccum] : undefined,
          usageTokens: (turnUsage.prompt || turnUsage.completion)
            ? { prompt: turnUsage.prompt, completion: turnUsage.completion }
            : undefined,
          costCents: costCents > 0 ? costCents : undefined,
          modelId: modelForCost || undefined,
        };
        setMessages(prev => {
          const updated = [...prev, assistantMsg];
          saveSession({
            id: sessionId.current,
            name: baseText.slice(0, 50) || payload.attachments[0]?.name || 'Session',
            summary: baseText.slice(0, 80) || payload.attachments[0]?.name || 'Session',
            createdAt: sessionCreatedAt.current,
            updatedAt: new Date().toISOString(),
            messages: updated,
          }).then(() => setSessionsRefreshKey(k => k + 1)).catch(() => {});
          return updated;
        });
        if (preferences.autoSpeakResponses) speakText(evt.data || '', {
          voiceURI: preferences.voiceOutputVoiceURI || undefined,
          lang: preferences.voiceInputLocale,
        });
        setPlan(prev => prev ? {
          ...prev,
          current: prev.steps.length - 1,
          screenshots: evt.screenshots || prev.screenshots || [],
          incomplete: !!evt.incomplete,
        } : null);
        setLoading(false);
        setLiveTools([]);
        setLoadingLabel('');
        setRuntimeStatus('');
      } else if (evt.event === 'error') {
        const raw = String(evt.data || '');
        const { key, vars } = classifyAgentError(raw);
        const friendly = vars ? t(key, vars) : t(key);
        setMessages(prev => [...prev, { id: uid(), role: 'assistant', content: friendly }]);
        setLoading(false);
        setLiveTools([]);
        setLoadingLabel('');
        setRuntimeStatus('');
        setPlan(null);
      }
    });
    stopStream.current = stop;
  }, [
    messages,
    loading,
    preferences.agentModelBudgetMode,
    preferences.agentModelFamily,
    preferences.allowAgentFamilyFallback,
    preferences.autoSpeakResponses,
    preferences.voiceInputLocale,
    preferences.voiceOutputVoiceURI,
    sessionTitle,
  ]);

  const handleStop = useCallback(() => {
    if (!loading) return;
    stopStream.current?.();
    stopStream.current = null;
    stopSpeaking();
    setLoading(false);
    setLiveTools([]);
    setLoadingLabel('');
    setRuntimeStatus('');
    setMessages(prev => [...prev, { id: uid(), role: 'assistant', content: t('agentScreen.interrupted') }]);
  }, [loading, t]);

  const handleNewSession = useCallback(() => {
    setMessages([]);
    setSessionTitle('');
    setActiveSessionId(null);
    setActiveGame(null);
    setView('chats');
    sessionId.current = crypto.randomUUID();
    sessionCreatedAt.current = new Date().toISOString();
    setRuntimeStatus('');
    setSessionUsage({ promptTokens: 0, completionTokens: 0, lastTokPerSec: 0 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'k') { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if (k === 'n') { e.preventDefault(); handleNewSession(); return; }
      if (k === '0') { e.preventDefault(); setView('inbox'); return; }
      if (k === '1') { e.preventDefault(); setView('chats'); return; }
      if (k === '2') { e.preventDefault(); setView('tasks'); return; }
      if (k === '3') { e.preventDefault(); setView('people'); return; }
      if (k === '4') { e.preventDefault(); setView('knowledge'); return; }
      if (k === '5') { e.preventDefault(); setView('background'); return; }
      if (k === '7') { e.preventDefault(); setView('maker'); return; }
      if (k === ',') { e.preventDefault(); setView('settings'); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleNewSession]);

  const handleSelectSession = (session: import('../types').Session) => {
    stopStream.current?.();
    setMessages(session.messages || []);
    setSessionTitle(session.summary || session.name || '');
    setActiveGame(null);
    setView('chats');
    sessionId.current = session.id as ReturnType<typeof crypto.randomUUID>;
    sessionCreatedAt.current = session.createdAt;
    setActiveSessionId(session.id);
    setLoading(false);
    setLiveTools([]);
    setLoadingLabel('');
    setRuntimeStatus('');
    setPlan(null);
    setSessionUsage({ promptTokens: 0, completionTokens: 0, lastTokPerSec: 0 });
  };

  const handleSuggestion = (text: string) => {
    setSuggestionText(text);
    setTimeout(() => setSuggestionText(''), 100);
  };

  if (compact) {
    return (
      <CompactShell>
        <CompactHeader sessionUsage={sessionUsage} />
        {messages.length > 0 && (
          <div className="flex flex-col max-h-[450px] overflow-y-auto">
            <ChatFeed compact messages={messages} loading={loading} liveTools={liveTools} loadingLabel={loadingLabel} onSuggestion={handleSuggestion} plan={plan} />
          </div>
        )}
        <InputBar
          compact
          onSend={sendMessage}
          onStop={handleStop}
          loading={loading}
          defaultText={suggestionText}
          autoSpeak={preferences.autoSpeakResponses}
          onAutoSpeakChange={value => updatePreferences({ autoSpeakResponses: value })}
          voiceInputLocale={preferences.voiceInputLocale}
          voiceInputModel={preferences.voiceInputModel}
          onVoiceInputModelChange={id => updatePreferences({ voiceInputModel: id })}
          imageModelId={preferences.imageModelId}
          imageSize={preferences.imageSize}
          musicModelId={preferences.musicModelId}
          videoModelId={preferences.videoModelId}
          preferredModelId={preferences.primaryAgentModelId}
          preferredModelFamily={preferences.agentModelFamily}
          sessionUsage={sessionUsage}
          activeModelId={activeModelId}
        />
        <AiDisclosureFooter />
        <ToastsHost />
      </CompactShell>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      <TopBar
        title={sessionTitle}
        sidecarReady={true}
        view={view}
        onViewChange={setView}
        onOpenPalette={() => setPaletteOpen(true)}
        onSignOut={handleSignOut}
        runtimeStatus={runtimeStatus}
      />
      <div className="flex flex-1 overflow-hidden">
        <LeftRail view={view} onViewChange={setView} badges={{ inbox: inboxBadge }} />
        {view === 'chats' && (
          <ChatsRail
            onNewSession={handleNewSession}
            onSignOut={handleSignOut}
            onSelectSession={handleSelectSession}
            activeSessionId={activeSessionId}
            sessionsRefreshKey={sessionsRefreshKey}
          />
        )}
        <div className="flex flex-col flex-1 overflow-hidden">
          {view === 'inbox' ? (
            <InboxView onGoto={setView} />
          ) : view === 'chats' && activeGame === 'chess' ? (
            <ChessConsole
              onExit={() => setActiveGame(null)}
              modelId={activeModelId || preferences.primaryAgentModelId || undefined}
              providerMode="local"
            />
          ) : view === 'chats' && activeGame === 'rts' ? (
            <RtsConsole
              onExit={() => setActiveGame(null)}
              modelId={activeModelId || preferences.primaryAgentModelId || undefined}
              providerMode="local"
            />
          ) : view === 'chats' && activeGame === 'poker' ? (
            <PokerConsole
              onExit={() => setActiveGame(null)}
              modelId={activeModelId || preferences.primaryAgentModelId || undefined}
              providerMode="local"
            />
          ) : view === 'chats' && activeGame === 'scrabble' ? (
            <ScrabbleConsole
              onExit={() => setActiveGame(null)}
              modelId={activeModelId || preferences.primaryAgentModelId || undefined}
              providerMode="local"
            />
          ) : view === 'chats' && activeGame === 'maker' ? (
            <MakerConsole
              onExit={() => setActiveGame(null)}
              cartId={activeCartId}
              modelId={activeModelId || preferences.primaryAgentModelId || undefined}
              providerMode="local"
            />
          ) : view === 'chats' && activeGame === 'cart' ? (
            <CartConsole
              onExit={() => setActiveGame(null)}
              cartId={activeCartId}
              onEdit={(id) => { setActiveCartId(id); setActiveGame('maker'); }}
            />
          ) : view === 'chats' ? (
            <>
              <WorkspaceBar />
              <ChatFeed messages={messages} loading={loading} liveTools={liveTools} loadingLabel={loadingLabel} onSuggestion={handleSuggestion} plan={plan} />
              <InputBar
                onSend={sendMessage}
                onStop={handleStop}
                loading={loading}
                defaultText={suggestionText}
                autoSpeak={preferences.autoSpeakResponses}
                onAutoSpeakChange={value => updatePreferences({ autoSpeakResponses: value })}
                voiceInputLocale={preferences.voiceInputLocale}
                voiceInputModel={preferences.voiceInputModel}
                onVoiceInputModelChange={id => updatePreferences({ voiceInputModel: id })}
                imageModelId={preferences.imageModelId}
                imageSize={preferences.imageSize}
                musicModelId={preferences.musicModelId}
                videoModelId={preferences.videoModelId}
                preferredModelId={preferences.primaryAgentModelId}
                preferredModelFamily={preferences.agentModelFamily}
                sessionUsage={sessionUsage}
                activeModelId={activeModelId}
              />
              <AiDisclosureFooter />
            </>
          ) : view === 'tasks' ? (
            <TasksView />
          ) : view === 'people' ? (
            <PeopleView />
          ) : view === 'knowledge' ? (
            <KnowledgeView />
          ) : view === 'background' ? (
            <BackgroundView />
          ) : view === 'chatbots' ? (
            <ChatbotsView />
          ) : view === 'maker' ? (
            <MakerConsole
              onExit={() => setView('chats')}
              modelId={activeModelId || preferences.primaryAgentModelId || undefined}
              providerMode="local"
            />
          ) : (
            <SettingsView
              preferences={preferences}
              onUpdatePreferences={updatePreferences}
              onOpenOnboarding={() => setShowOnboarding(true)}
            />
          )}
        </div>
      </div>
      <OnboardingModal
        open={showOnboarding}
        onClose={() => {
          updatePreferences({ onboardingDismissed: true });
          setShowOnboarding(false);
          if (!getPreferences().tourDone) setShowTour(true);
        }}
      />
      <ProductTour
        open={showTour && !showOnboarding}
        onClose={() => { updatePreferences({ tourDone: true }); setShowTour(false); }}
      />
      <ToastsHost />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onViewChange={setView}
        onNewChat={handleNewSession}
      />
    </div>
  );
}

function CompactShell({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    let raf = 0;
    let lastH = 0;
    const measure = () => {
      // scrollHeight catches content overflow even when CSS height is
      // clamped by the parent; offsetHeight catches the box size when
      // the element is laid out freely. Take the max.
      let h = Math.max(el.scrollHeight, el.offsetHeight);
      // Sum children heights as a third source of truth — when the
      // element itself is clamped to the window, scrollHeight may also
      // be clamped on macOS WebKit. Children outside the visible region
      // still report their natural height via getBoundingClientRect.
      let sum = 0;
      Array.from(el.children).forEach(c => {
        const r = (c as HTMLElement).getBoundingClientRect();
        sum += r.height;
      });
      if (sum > h) h = sum;
      return Math.ceil(h);
    };
    const apply = () => {
      const h = measure();
      if (h === lastH) return;
      lastH = h;
      void resizeWidgetHeight(h);
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };
    // Layout observer — fires on box-size changes
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    Array.from(el.children).forEach(c => ro.observe(c as Element));
    // Subtree mutation observer — fires whenever DOM changes anywhere
    // inside the shell (new messages, expanded tool cards, plan rows…).
    const mo = new MutationObserver(schedule);
    mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    // Re-attach RO to newly-added direct children too.
    const rootMo = new MutationObserver(() => {
      Array.from(el.children).forEach(c => {
        try { ro.observe(c as Element); } catch {}
      });
      schedule();
    });
    rootMo.observe(el, { childList: true });
    apply();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      rootMo.disconnect();
    };
  }, []);
  return (
    <div
      ref={outerRef}
      className="flex flex-col bg-[var(--bg)] text-[var(--text)] overflow-hidden"
    >
      <div ref={innerRef} className="flex flex-col flex-shrink-0">
        {children}
      </div>
    </div>
  );
}

function CompactHeader(_props: { sessionUsage?: { promptTokens: number; completionTokens: number; lastTokPerSec: number } }) {
  return (
    <div
      data-tauri-drag-region
      className="h-[28px] flex-shrink-0 flex items-center gap-[8px] px-[56px] pl-[10px] bg-transparent border-b-[2px] border-b-[var(--border)] select-none"
    >
      <div className="flex-shrink-0 flex items-center pointer-events-none">
        <AnimalAvatar size={18} />
      </div>
      <div className="flex-shrink-0 flex items-center">
        <LocalRuntimeToggle size={20} />
      </div>
      <div className="flex-1" />
    </div>
  );
}
