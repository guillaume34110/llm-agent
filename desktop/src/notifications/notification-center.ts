export interface AppToast {
  id: string;
  title: string;
  body?: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
  createdAt: number;
}

type ToastListener = (toasts: AppToast[]) => void;

const listeners = new Set<ToastListener>();
let toasts: AppToast[] = [];

function emit() {
  for (const listener of listeners) listener([...toasts]);
}

export function pushToast(input: Omit<AppToast, 'id' | 'createdAt'>) {
  const toast: AppToast = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...input,
  };
  toasts = [...toasts, toast];
  emit();
  window.setTimeout(() => dismissToast(toast.id), 6000);
  return toast.id;
}

export function dismissToast(id: string) {
  const next = toasts.filter(toast => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function subscribeToasts(listener: ToastListener) {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}
