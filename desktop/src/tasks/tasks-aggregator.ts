import type { TaskItem } from '../types';
import { listTasks, listUpcoming } from './task-client';

export type TaskBucket = 'overdue' | 'today' | 'tomorrow' | 'thisWeek' | 'later' | 'done';

export interface TaskBucketGroup {
  id: TaskBucket;
  label: string;
  items: TaskItem[];
}

function startOfDay(d = new Date()): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function bucketOf(task: TaskItem, now: number): TaskBucket {
  if (task.status === 'done' || task.status === 'cancelled') return 'done';
  const t = new Date(task.nextRunAt || task.scheduledFor).getTime();
  if (!Number.isFinite(t)) return 'later';
  const today = startOfDay(new Date(now));
  const tomorrow = today + 24 * 3600 * 1000;
  const dayAfter = tomorrow + 24 * 3600 * 1000;
  const weekEnd = today + 7 * 24 * 3600 * 1000;
  if (t < today) return 'overdue';
  if (t < tomorrow) return 'today';
  if (t < dayAfter) return 'tomorrow';
  if (t < weekEnd) return 'thisWeek';
  return 'later';
}

const LABELS: Record<TaskBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  later: 'Later',
  done: 'Done',
};

const ORDER: TaskBucket[] = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later', 'done'];

export function groupTasks(tasks: TaskItem[]): TaskBucketGroup[] {
  const now = Date.now();
  const map = new Map<TaskBucket, TaskItem[]>();
  for (const b of ORDER) map.set(b, []);
  for (const t of tasks) {
    map.get(bucketOf(t, now))!.push(t);
  }
  for (const b of ORDER) {
    const arr = map.get(b)!;
    arr.sort((a, b) => {
      const ta = new Date(a.nextRunAt || a.scheduledFor).getTime();
      const tb = new Date(b.nextRunAt || b.scheduledFor).getTime();
      return ta - tb;
    });
  }
  return ORDER.map(id => ({ id, label: LABELS[id], items: map.get(id)! })).filter(g => g.items.length > 0);
}

export interface TasksSnapshot {
  all: TaskItem[];
  upcoming: TaskItem[];
  overdueCount: number;
  todayCount: number;
  inboxCount: number;
}

export async function fetchTasksSnapshot(): Promise<TasksSnapshot> {
  const [all, upcoming] = await Promise.all([
    listTasks().catch(() => [] as TaskItem[]),
    listUpcoming(50).catch(() => [] as TaskItem[]),
  ]);
  const now = Date.now();
  let overdueCount = 0;
  let todayCount = 0;
  for (const t of upcoming) {
    if (t.status !== 'planned') continue;
    const b = bucketOf(t, now);
    if (b === 'overdue') overdueCount++;
    else if (b === 'today') todayCount++;
  }
  return { all, upcoming, overdueCount, todayCount, inboxCount: overdueCount + todayCount };
}
