import type { TaskItem } from '../types';

const monthFormatter = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const dayFormatter = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const detailFormatter = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

export const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, index) => {
  const ref = new Date(Date.UTC(2024, 0, 1 + index));
  return dayFormatter.format(ref).replace('.', '');
});

export function toDateKey(value: Date) {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayDateKey() {
  return toDateKey(new Date());
}

export function taskDateKey(task: Pick<TaskItem, 'scheduledFor'>) {
  return task.scheduledFor.slice(0, 10);
}

export function buildMonthGrid(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function formatMonthLabel(anchor: Date) {
  const label = monthFormatter.format(anchor);
  return label.slice(0, 1).toUpperCase() + label.slice(1);
}

export function formatTaskMoment(task: Pick<TaskItem, 'scheduledFor' | 'allDay'>) {
  if (task.allDay) return `${task.scheduledFor.slice(0, 10)} · journée`;
  return task.scheduledFor.replace('T', ' · ');
}

export function formatTaskDetail(value: string, allDay: boolean) {
  if (allDay) return value.slice(0, 10);
  return detailFormatter.format(new Date(value));
}
