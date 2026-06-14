type Listener<T> = (value: T) => void;

export interface LocalStore<T> {
  read: () => T;
  write: (value: T) => void;
  update: (updater: (value: T) => T) => T;
  subscribe: (listener: Listener<T>) => () => void;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createLocalStore<T>(key: string, fallback: T): LocalStore<T> {
  const eventName = `local-store:${key}`;

  function read(): T {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return cloneValue(fallback);
      return JSON.parse(raw) as T;
    } catch {
      return cloneValue(fallback);
    }
  }

  function write(value: T) {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(eventName, { detail: value }));
  }

  function update(updater: (value: T) => T): T {
    const next = updater(read());
    write(next);
    return next;
  }

  function subscribe(listener: Listener<T>) {
    const onCustom = (event: Event) => {
      const custom = event as CustomEvent<T>;
      listener(custom.detail ?? read());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) listener(read());
    };
    window.addEventListener(eventName, onCustom as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(eventName, onCustom as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }

  return { read, write, update, subscribe };
}
