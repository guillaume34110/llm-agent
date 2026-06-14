import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

export type WidgetMode = 'widget' | 'expanded';

const STORAGE_KEY = 'widget-mode';

export const WIDGET_SIZE = { width: 480, height: 74 } as const;
export const EXPANDED_SIZE = { width: 1100, height: 720 } as const;
export const WIDGET_MAX_HEIGHT = 560;
export const WIDGET_MIN_HEIGHT = 74;

const win = (() => { try { return getCurrentWindow(); } catch { return null; } })();

type Listener = (m: WidgetMode) => void;
const listeners = new Set<Listener>();

function readPersisted(): WidgetMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'widget' ? 'widget' : 'expanded';
  } catch {
    return 'widget';
  }
}

function persist(m: WidgetMode) {
  try { localStorage.setItem(STORAGE_KEY, m); } catch {}
}

let current: WidgetMode = readPersisted();

export function getWidgetMode(): WidgetMode {
  return current;
}

export function subscribeWidgetMode(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

async function applyWindowFor(mode: WidgetMode) {
  if (!win) return;
  const size = mode === 'widget' ? WIDGET_SIZE : EXPANDED_SIZE;
  try {
    await win.setAlwaysOnTop(mode === 'widget');
    if (mode === 'expanded') {
      lastAppliedHeight = 0;
      await win.setMinSize(new LogicalSize(380, 280));
      await win.setMaxSize(null);
      await win.setSize(new LogicalSize(size.width, size.height));
      try { await win.center(); } catch {}
    } else {
      lastAppliedHeight = 0;
      await win.setMinSize(new LogicalSize(380, WIDGET_MIN_HEIGHT));
      await win.setMaxSize(new LogicalSize(4000, WIDGET_MIN_HEIGHT));
      await win.setSize(new LogicalSize(size.width, size.height));
    }
  } catch (e) {
    console.warn('widget-mode: window apply failed', e);
  }
}

export async function setWidgetMode(next: WidgetMode) {
  if (next === current) return;
  current = next;
  persist(next);
  document.documentElement.setAttribute('data-widget-mode', next);
  await applyWindowFor(next);
  listeners.forEach(l => { try { l(next); } catch {} });
}

let lastAppliedHeight = 0;
export async function resizeWidgetHeight(h: number) {
  if (!win || current !== 'widget') return;
  const clamped = Math.max(WIDGET_MIN_HEIGHT, Math.min(WIDGET_MAX_HEIGHT, Math.ceil(h)));
  if (clamped === lastAppliedHeight) return;
  const prev = lastAppliedHeight;
  lastAppliedHeight = clamped;
  try {
    const cur = await win.innerSize();
    const sf = await win.scaleFactor();
    const curW = Math.round(cur.width / sf);
    if (clamped > prev) {
      // Growing: relax max BEFORE setting min/size, otherwise macOS rejects
      // setMinSize when new min > current max.
      await win.setMaxSize(new LogicalSize(4000, WIDGET_MAX_HEIGHT));
      await win.setMinSize(new LogicalSize(380, clamped));
      await win.setSize(new LogicalSize(curW, clamped));
      await win.setMaxSize(new LogicalSize(4000, clamped));
    } else {
      // Shrinking: relax min first, then size, then tighten both to lock height.
      await win.setMinSize(new LogicalSize(380, WIDGET_MIN_HEIGHT));
      await win.setSize(new LogicalSize(curW, clamped));
      await win.setMaxSize(new LogicalSize(4000, clamped));
      await win.setMinSize(new LogicalSize(380, clamped));
    }
  } catch (e) { console.warn('resizeWidgetHeight failed', e); }
}

export async function toggleWidgetMode() {
  await setWidgetMode(current === 'widget' ? 'expanded' : 'widget');
}

export async function initWidgetMode() {
  document.documentElement.setAttribute('data-widget-mode', current);
  await applyWindowFor(current);
}
