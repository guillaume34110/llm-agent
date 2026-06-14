import type { AgentView } from '../types';
import { fetchInquiryInbox, type InquiryRecord } from '../social/inquiry-client';
import { listMyMatchSessions, type MatchSession } from '../social/match-client';
import { getJobs, type BackgroundJob } from '../jobs/job-service';
import { listTasks } from '../tasks/task-client';
import type { TaskItem } from '../types';

export type InboxKind = 'inquiry' | 'match' | 'task' | 'job';
export type InboxSection = 'social' | 'agent';

export interface InboxItem {
  id: string;
  kind: InboxKind;
  section: InboxSection;
  title: string;
  subtitle: string;
  ts: number;
  goto: AgentView;
}

async function loadInquiries(): Promise<InboxItem[]> {
  try {
    const inq = await fetchInquiryInbox();
    return inq.map((i: InquiryRecord) => ({
      id: `inq-${i.id}`,
      kind: 'inquiry' as const,
      section: 'social' as const,
      title: `Inquiry · ${i.mode.replace('find_', '')}`,
      subtitle: (i.filters.tags || []).join(' · ') || 'No tags',
      ts: new Date(i.createdAt).getTime(),
      goto: 'people' as AgentView,
    }));
  } catch {
    return [];
  }
}

async function loadMatches(): Promise<InboxItem[]> {
  try {
    const sessions = await listMyMatchSessions();
    return sessions
      .filter((s: MatchSession) => s.status === 'open')
      .map((s: MatchSession) => ({
        id: `match-${s.id}`,
        kind: 'match' as const,
        section: 'social' as const,
        title: 'Match session · awaiting reply',
        subtitle: `inquiry ${s.inquiryId.slice(0, 8)} · expires ${new Date(s.expiresAt).toLocaleDateString()}`,
        ts: new Date(s.createdAt).getTime(),
        goto: 'people' as AgentView,
      }));
  } catch {
    return [];
  }
}

function loadJobs(): InboxItem[] {
  try {
    const jobs: BackgroundJob[] = getJobs();
    return jobs
      .filter(j => j.status === 'failed' || j.status === 'running' || j.status === 'pending')
      .map(j => ({
        id: `job-${j.id}`,
        kind: 'job' as const,
        section: 'agent' as const,
        title: `${j.status === 'failed' ? 'Job failed' : 'Job running'} · ${j.title}`,
        subtitle: j.error || (j.logs[j.logs.length - 1]?.message ?? j.kind),
        ts: new Date(j.updatedAt || j.createdAt).getTime(),
        goto: 'background' as AgentView,
      }));
  } catch {
    return [];
  }
}

async function loadTasks(): Promise<InboxItem[]> {
  try {
    const tasks = await listTasks();
    const now = Date.now();
    const window = 24 * 60 * 60 * 1000;
    return tasks
      .filter((t: TaskItem) => {
        if (t.status !== 'planned') return false;
        const sched = new Date(t.scheduledFor).getTime();
        if (!Number.isFinite(sched)) return false;
        return sched <= now + window;
      })
      .slice(0, 20)
      .map((t: TaskItem) => {
        const sched = new Date(t.scheduledFor).getTime();
        const overdue = sched < now;
        return {
          id: `task-${t.id}`,
          kind: 'task' as const,
          section: 'agent' as const,
          title: `${overdue ? 'Task overdue' : 'Task due soon'} · ${t.title}`,
          subtitle: t.details || t.source || '',
          ts: sched,
          goto: 'tasks' as AgentView,
        };
      });
  } catch {
    return [];
  }
}

export async function fetchInboxItems(): Promise<InboxItem[]> {
  const [inq, matches, tasks] = await Promise.all([loadInquiries(), loadMatches(), loadTasks()]);
  const jobs = loadJobs();
  const all = [...inq, ...matches, ...tasks, ...jobs];
  all.sort((a, b) => b.ts - a.ts);
  return all;
}
