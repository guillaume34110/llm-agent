import { open as openExternal } from '@tauri-apps/plugin-shell';
import { getIntegrationAccounts, updateIntegrationAccounts } from './app-accounts-service';

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3';

export interface ShortcutWorkflowStateSummary {
  id: number;
  name: string;
  type: string;
  position: number;
  color?: string;
  num_stories?: number;
}

export interface ShortcutWorkflowSummary {
  id: number;
  name: string;
  description: string;
  default_state_id: number;
  states: ShortcutWorkflowStateSummary[];
}

export interface ShortcutStorySummary {
  id: number;
  app_url: string;
  name: string;
  story_type?: string;
  description?: string | null;
  workflow_state_id?: number;
  deadline?: string | null;
}

interface ShortcutSearchResponse {
  total: number;
  data: ShortcutStorySummary[];
  next: string | null;
}

function safeOpen(url: string) {
  return openExternal(url).catch(() => {
    window.location.href = url;
  });
}

function getToken() {
  return getIntegrationAccounts().shortcut.token.trim();
}

function shortcutHeaders() {
  const token = getToken();
  if (!token) throw new Error('Token Shortcut local manquant');
  return {
    'Content-Type': 'application/json',
    'Shortcut-Token': token,
  };
}

async function shortcutRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SHORTCUT_API}${path}`, {
    ...init,
    headers: {
      ...shortcutHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Shortcut HTTP ${response.status}${body ? `: ${body}` : ''}`);
  }
  return response.json() as Promise<T>;
}

function clampLimit(limit: number) {
  return Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 10, 50));
}

export async function openShortcutPage(url = '') {
  const target = url.trim() || getIntegrationAccounts().shortcut.appUrl.trim() || 'https://app.shortcut.com';
  await safeOpen(target);
  return `OK: Shortcut ouvert ${target}`;
}

export async function listShortcutWorkflows() {
  const workflows = await shortcutRequest<ShortcutWorkflowSummary[]>('/workflows');
  return [...workflows].sort((a, b) => a.name.localeCompare(b.name));
}

export async function validateShortcutAccount() {
  const workflows = await listShortcutWorkflows();
  const current = getIntegrationAccounts().shortcut;
  updateIntegrationAccounts({
    shortcut: {
      token: current.token,
      appUrl: current.appUrl,
      defaultWorkflowStateId: current.defaultWorkflowStateId,
      lastValidatedAt: new Date().toISOString(),
      lastError: '',
    },
  });
  return workflows;
}

export async function searchShortcutStories(query: string, limit = 10) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error('Recherche Shortcut vide');
  const params = new URLSearchParams();
  params.set('query', normalizedQuery);
  params.set('page_size', String(clampLimit(limit)));
  params.set('detail', 'slim');
  params.append('entity_types', 'story');
  const result = await shortcutRequest<ShortcutSearchResponse>(`/search/stories?${params.toString()}`);
  return result.data || [];
}

async function resolveWorkflowStateId(input?: number) {
  if (Number.isFinite(input) && Number(input) > 0) return Number(input);
  const configured = Number.parseInt(getIntegrationAccounts().shortcut.defaultWorkflowStateId, 10);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const workflows = await listShortcutWorkflows();
  const fallback = workflows[0]?.default_state_id ?? workflows[0]?.states?.[0]?.id;
  if (!fallback) throw new Error('Aucun workflow Shortcut disponible');
  return fallback;
}

export async function createShortcutStory(input: {
  title: string;
  description?: string;
  storyType?: string;
  workflowStateId?: number;
  deadline?: string;
}) {
  const title = input.title.trim();
  if (!title) throw new Error('Titre Shortcut manquant');
  const workflowStateId = await resolveWorkflowStateId(input.workflowStateId);
  const body: Record<string, unknown> = {
    name: title,
    workflow_state_id: workflowStateId,
  };
  if (input.description?.trim()) body.description = input.description.trim();
  if (input.storyType?.trim()) body.story_type = input.storyType.trim();
  if (input.deadline?.trim()) body.deadline = input.deadline.trim();
  return shortcutRequest<ShortcutStorySummary>('/stories', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function formatShortcutWorkflows(workflows: ShortcutWorkflowSummary[]) {
  if (!workflows.length) return 'OK: aucun workflow Shortcut';
  const currentDefault = Number.parseInt(getIntegrationAccounts().shortcut.defaultWorkflowStateId, 10);
  return workflows.map(workflow => {
    const states = [...workflow.states]
      .sort((a, b) => a.position - b.position)
      .map(state => {
        const tags = [
          state.id === workflow.default_state_id ? 'workflow-default' : '',
          state.id === currentDefault ? 'config-default' : '',
          state.type || '',
        ].filter(Boolean).join(', ');
        return `- ${state.name} (#${state.id}${tags ? ` · ${tags}` : ''})`;
      })
      .join('\n');
    return `${workflow.name} (#${workflow.id})\n${states}`;
  }).join('\n\n');
}

export function formatShortcutStories(stories: ShortcutStorySummary[]) {
  if (!stories.length) return 'OK: aucune story Shortcut';
  return stories.map(story => {
    const meta = [
      story.story_type ? `[${story.story_type}]` : '',
      story.workflow_state_id ? `state #${story.workflow_state_id}` : '',
      story.deadline ? `due ${story.deadline}` : '',
    ].filter(Boolean).join(' · ');
    return `#${story.id} ${story.name}${meta ? `\n${meta}` : ''}\n${story.app_url}`;
  }).join('\n\n');
}
