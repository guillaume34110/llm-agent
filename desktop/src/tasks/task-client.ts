import type { TaskInput, TaskItem } from '../types';

const baseUrl = import.meta.env.VITE_SIDECAR_URL || 'http://localhost:3471';
export const TASKS_CHANGED_EVENT = 'monkey-tasks-changed';

function emitTasksChanged() {
  window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT));
}

export function subscribeTasksChanged(onChange: () => void) {
  window.addEventListener(TASKS_CHANGED_EVENT, onChange as EventListener);
  return () => window.removeEventListener(TASKS_CHANGED_EVENT, onChange as EventListener);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.detail || body.message || body.error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function listTasks(): Promise<TaskItem[]> {
  return request<TaskItem[]>('/tasks');
}

export async function listUpcoming(limit = 20): Promise<TaskItem[]> {
  return request<TaskItem[]>(`/tasks/upcoming?limit=${limit}`);
}

export async function createTask(payload: TaskInput): Promise<TaskItem> {
  const res = await request<{ ok: boolean; task: TaskItem }>('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  emitTasksChanged();
  return res.task;
}

export async function updateTask(taskId: string, patch: Partial<TaskInput>): Promise<TaskItem> {
  const res = await request<{ ok: boolean; task: TaskItem }>(`/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  emitTasksChanged();
  return res.task;
}

export async function deleteTask(taskId: string): Promise<void> {
  await request<{ ok: boolean }>(`/tasks/${taskId}`, { method: 'DELETE' });
  emitTasksChanged();
}

export async function previewRecurrence(params: {
  recurrence: string;
  scheduledFor: string;
  count?: number;
  recurrenceUntil?: string | null;
  recurrenceCount?: number | null;
}): Promise<string[]> {
  const res = await request<{ ok: boolean; occurrences: string[] }>('/recurrence/preview', {
    method: 'POST',
    body: JSON.stringify({
      recurrence: params.recurrence,
      scheduledFor: params.scheduledFor,
      count: params.count ?? 5,
      recurrenceUntil: params.recurrenceUntil || null,
      recurrenceCount: params.recurrenceCount || null,
    }),
  });
  return res.occurrences;
}
