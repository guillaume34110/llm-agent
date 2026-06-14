import { createLocalStore } from '../lib/local-store';
import { pushToast } from '../notifications/notification-center';

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobLogEntry {
  at: string;
  message: string;
}

export interface BackgroundJob {
  id: string;
  kind: string;
  title: string;
  status: JobStatus;
  progress: number;
  payload: Record<string, unknown>;
  logs: JobLogEntry[];
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

interface JobContext {
  log: (message: string) => void;
  setProgress: (value: number) => void;
  signal: AbortSignal;
}

type JobRunner = (job: BackgroundJob, ctx: JobContext) => Promise<string | void>;

const store = createLocalStore<BackgroundJob[]>('monkey-background-jobs', []);
const runners = new Map<string, JobRunner>();
const activeJobs = new Set<string>();
const abortControllers = new Map<string, AbortController>();

export class JobCanceledError extends Error {
  constructor() { super('canceled'); this.name = 'JobCanceledError'; }
}

function getNow() {
  return new Date().toISOString();
}

function patchJob(jobId: string, patch: Partial<BackgroundJob>) {
  store.update(prev => prev.map(job => (
    job.id === jobId
      ? { ...job, ...patch, updatedAt: getNow() }
      : job
  )));
}

function appendLog(jobId: string, message: string) {
  store.update(prev => prev.map(job => (
    job.id === jobId
      ? {
          ...job,
          logs: [...job.logs, { at: getNow(), message }],
          updatedAt: getNow(),
        }
      : job
  )));
}

async function executeJob(job: BackgroundJob) {
  const runner = runners.get(job.kind);
  if (!runner || activeJobs.has(job.id)) return;
  activeJobs.add(job.id);
  const controller = new AbortController();
  abortControllers.set(job.id, controller);
  patchJob(job.id, { status: 'running', error: undefined });
  try {
    const result = await runner(job, {
      log: message => appendLog(job.id, message),
      setProgress: value => patchJob(job.id, { progress: Math.max(0, Math.min(1, value)) }),
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new JobCanceledError();
    patchJob(job.id, {
      status: 'done',
      progress: 1,
      result: result || 'Terminé',
      finishedAt: getNow(),
    });
    pushToast({ title: job.title, body: 'Job terminé', tone: 'success' });
  } catch (error: unknown) {
    const isCancel = controller.signal.aborted || error instanceof JobCanceledError || (error instanceof Error && error.name === 'AbortError');
    patchJob(job.id, {
      status: 'failed',
      error: isCancel ? 'Annulé' : (error instanceof Error ? error.message : String(error)),
      finishedAt: getNow(),
    });
    pushToast({ title: job.title, body: isCancel ? 'Job annulé' : 'Job en échec', tone: isCancel ? 'info' : 'error' });
  } finally {
    activeJobs.delete(job.id);
    abortControllers.delete(job.id);
  }
}

export function cancelJob(jobId: string) {
  const ctrl = abortControllers.get(jobId);
  if (ctrl) {
    appendLog(jobId, 'Annulation demandée…');
    ctrl.abort();
    return;
  }
  // Pending (not yet running) or stale running flag: mark failed directly.
  const job = store.read().find(j => j.id === jobId);
  if (!job) return;
  if (job.status === 'pending' || job.status === 'running') {
    patchJob(jobId, { status: 'failed', error: 'Annulé', finishedAt: getNow() });
  }
}

export function registerJobRunner(kind: string, runner: JobRunner) {
  runners.set(kind, runner);
}

export function getJobs() {
  return store.read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function subscribeJobs(listener: (jobs: BackgroundJob[]) => void) {
  return store.subscribe(value => {
    listener([...value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  });
}

export function clearFinishedJobs() {
  store.write(store.read().filter(job => job.status === 'running' || job.status === 'pending'));
}

export function enqueueJob(kind: string, title: string, payload: Record<string, unknown>) {
  const job: BackgroundJob = {
    id: crypto.randomUUID(),
    kind,
    title,
    status: 'pending',
    progress: 0,
    payload,
    logs: [],
    createdAt: getNow(),
    updatedAt: getNow(),
  };
  store.write([job, ...store.read()]);
  void executeJob(job);
  return job;
}

export function resumePendingJobs() {
  for (const job of store.read()) {
    if (job.status === 'pending' || job.status === 'running') {
      void executeJob({ ...job, status: 'pending' });
    }
  }
}
