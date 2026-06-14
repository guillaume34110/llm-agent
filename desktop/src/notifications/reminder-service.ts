import { api } from '../api';
import { getPreferences } from '../preferences/preferences-service';
import { pushToast } from './notification-center';
import type { TaskItem } from '../types';

const STORAGE_KEY = 'monkey-reminder-sent';
let intervalId: number | null = null;

function readSent() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSent(value: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function shouldNotify(task: TaskItem, now: Date) {
  if (task.status !== 'planned') return false;
  if (task.allDay) {
    const scheduled = new Date(`${task.scheduledFor.slice(0, 10)}T09:00:00`);
    return Math.abs(now.getTime() - scheduled.getTime()) < 60_000;
  }
  const scheduled = new Date(task.scheduledFor);
  return Math.abs(now.getTime() - scheduled.getTime()) < 60_000;
}

async function requestPermissionIfNeeded() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

async function notifyTask(task: TaskItem) {
  const permission = await requestPermissionIfNeeded();
  const body = task.details || (task.allDay ? 'Rappel journée entière' : task.scheduledFor.replace('T', ' '));
  if (permission === 'granted') {
    new Notification(task.title, { body });
    return;
  }
  pushToast({ title: task.title, body, tone: 'info' });
}

async function tick() {
  const preferences = getPreferences();
  if (!preferences.reminderNotifications) return;
  const now = new Date();
  const sent = readSent();
  const tasks = await api.getTasks().catch(() => [] as TaskItem[]);
  for (const task of tasks) {
    const sentKey = `${task.id}:${task.updatedAt}:${task.scheduledFor}`;
    if (sent[sentKey]) continue;
    if (!shouldNotify(task, now)) continue;
    await notifyTask(task);
    sent[sentKey] = new Date().toISOString();
  }
  writeSent(sent);
}

export function startReminderLoop() {
  if (intervalId != null) return;
  intervalId = window.setInterval(() => {
    void tick();
  }, 30_000);
  void tick();
}

export function stopReminderLoop() {
  if (intervalId == null) return;
  window.clearInterval(intervalId);
  intervalId = null;
}
