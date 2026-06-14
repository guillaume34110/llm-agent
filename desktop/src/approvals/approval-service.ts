export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  title: string;
  summary: string;
  detail: string;
  createdAt: number;
}

type QueueListener = (queue: ApprovalRequest[]) => void;
type PendingResolver = (decision: boolean) => void;

const listeners = new Set<QueueListener>();
const queue: ApprovalRequest[] = [];
const pendingResolvers = new Map<string, PendingResolver>();
const allowlistedToolsBySession = new Map<string, Set<string>>();

function getAllowlist(sessionId: string) {
  let allowlist = allowlistedToolsBySession.get(sessionId);
  if (!allowlist) {
    allowlist = new Set<string>();
    allowlistedToolsBySession.set(sessionId, allowlist);
  }
  return allowlist;
}

function emit() {
  const snapshot = [...queue];
  for (const listener of listeners) listener(snapshot);
}

function formatDetail(args: unknown): string {
  try {
    const text = JSON.stringify(args, null, 2);
    return text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text;
  } catch {
    return String(args ?? '');
  }
}

function buildSummary(toolName: string, args: Record<string, unknown>): { title: string; summary: string } {
  switch (toolName) {
    case 'run_command':
      return {
        title: 'Commande shell',
        summary: String(args.command ?? 'Commande non fournie'),
      };
    case 'write_file':
      return {
        title: 'Écriture fichier',
        summary: String(args.path ?? 'Chemin non fourni'),
      };
    case 'read_file':
      return {
        title: 'Lecture fichier',
        summary: String(args.path ?? 'Chemin non fourni'),
      };
    case 'list_dir':
      return {
        title: 'Liste dossier',
        summary: String(args.path ?? 'Chemin non fourni'),
      };
    case 'grep_files':
      return {
        title: 'Recherche fichiers',
        summary: `${String(args.path ?? 'Chemin non fourni')} · ${String(args.pattern ?? '')}`,
      };
    case 'browser_navigate':
      return {
        title: 'Navigation web',
        summary: String(args.url ?? 'URL non fournie'),
      };
    case 'browser_get_text':
      return {
        title: 'Lecture page web',
        summary: String(args.selector ?? 'Page courante'),
      };
    case 'browser_get_links':
      return {
        title: 'Lecture liens web',
        summary: `Limite ${String(args.limit ?? 30)}`,
      };
    case 'browser_click':
      return {
        title: 'Clic web',
        summary: String(args.selector ?? 'Sélecteur non fourni'),
      };
    case 'browser_fill':
      return {
        title: 'Saisie web',
        summary: `${String(args.selector ?? 'Sélecteur non fourni')} ← ${String(args.value ?? '')}`,
      };
    case 'browser_run_js':
      return {
        title: 'Script navigateur',
        summary: 'Exécution de JavaScript dans la page courante',
      };
    case 'browser_navigate_back':
      return {
        title: 'Retour navigateur',
        summary: 'Retour à la page précédente',
      };
    case 'browser_current_url':
      return {
        title: 'URL navigateur',
        summary: 'Lecture de l’URL courante',
      };
    case 'browser_screenshot':
      return {
        title: 'Capture navigateur',
        summary: 'Capture de la page courante',
      };
    default:
      return {
        title: toolName,
        summary: 'Action locale sensible',
      };
  }
}

export function needsApproval(toolName: string) {
  return [
    'read_file',
    'list_dir',
    'grep_files',
    'run_command',
    'write_file',
    'browser_navigate',
    'browser_get_text',
    'browser_get_links',
    'browser_click',
    'browser_fill',
    'browser_run_js',
    'browser_screenshot',
    'browser_navigate_back',
    'browser_current_url',
    'github_create_issue',
    'gmail_compose',
    'discord_send_message',
    'whatsapp_compose',
    'google_calendar_create_event',
    'google_drive_open',
    'slack_send_message',
    'telegram_send_message',
    'notion_create_page',
    'dropbox_upload_text',
    'shortcut_create_story',
    'messenger_open',
    'instagram_open',
    'x_compose_post',
    'linkedin_open_share',
    'zoom_open',
  ].includes(toolName);
}

export async function requestApproval(toolName: string, args: Record<string, unknown>, sessionId = 'global') {
  if (!needsApproval(toolName) || getAllowlist(sessionId).has(toolName)) return true;
  const { title, summary } = buildSummary(toolName, args);
  const request: ApprovalRequest = {
    id: crypto.randomUUID(),
    sessionId,
    toolName,
    title,
    summary,
    detail: formatDetail(args),
    createdAt: Date.now(),
  };
  queue.push(request);
  emit();
  return new Promise<boolean>(resolve => {
    pendingResolvers.set(request.id, resolve);
  });
}

export function decideApproval(id: string, decision: boolean, rememberForSession = false) {
  const index = queue.findIndex(item => item.id === id);
  if (index === -1) return;
  const [request] = queue.splice(index, 1);
  if (decision && rememberForSession) getAllowlist(request.sessionId).add(request.toolName);
  emit();
  const resolver = pendingResolvers.get(id);
  pendingResolvers.delete(id);
  resolver?.(decision);
}

const SIDECAR_BASE = (import.meta as any).env?.VITE_SIDECAR_URL || 'http://localhost:3471';

// Approval requests forwarded from the Python sidecar (dangerous shell, etc.).
// Decision must POST back to /approve so the sidecar dispatch thread unblocks.
export function enqueueRemoteApproval(opts: {
  id: string;
  sessionId: string;
  toolName: string;
  title?: string;
  summary?: string;
  args?: Record<string, unknown>;
  bypass?: boolean;
}): Promise<boolean> {
  const summary = opts.summary || buildSummary(opts.toolName, opts.args || {}).summary;
  const title = opts.title || buildSummary(opts.toolName, opts.args || {}).title;
  const request: ApprovalRequest = {
    id: opts.id,
    sessionId: opts.sessionId,
    toolName: opts.toolName,
    title,
    summary,
    detail: formatDetail(opts.args ?? {}),
    createdAt: Date.now(),
  };
  queue.push(request);
  emit();
  return new Promise<boolean>(resolve => {
    pendingResolvers.set(request.id, async (decision) => {
      try {
        const allowSession = decision && !opts.bypass && (allowlistedToolsBySession.get(opts.sessionId)?.has(opts.toolName));
        await fetch(`${SIDECAR_BASE}/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: opts.id,
            decision: decision ? 'allow' : 'deny',
            scope: allowSession ? 'session' : 'once',
            session_id: opts.sessionId,
            tool: opts.toolName,
          }),
        });
      } catch {}
      resolve(decision);
    });
  });
}

export function subscribeApprovals(listener: QueueListener) {
  listeners.add(listener);
  listener([...queue]);
  return () => {
    listeners.delete(listener);
  };
}
