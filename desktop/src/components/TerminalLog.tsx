import { useTranslation } from 'react-i18next';
import type { ToolCall } from '../types';

const TOOL_LABELS: Record<string, string> = {
  think: 'think', set_plan: 'plan', define_dod: 'dod', verify_step: 'verify',
  fetch_page: 'fetch', search_and_read: 'search', product_search: 'shop',
  browser_navigate: 'nav', browser_get_text: 'read', browser_get_links: 'links',
  browser_click: 'click', browser_fill: 'fill', browser_scroll: 'scroll',
  browser_run_js: 'js', browser_screenshot: 'shot', browser_navigate_back: 'back',
  browser_current_url: 'url', browser_wait_for: 'wait',
  read_file: 'read', write_file: 'write', list_dir: 'ls', list_dir_images: 'imgs', grep_files: 'grep',
  run_command: 'sh',
  create_task: 'task+', list_tasks: 'tasks', update_task: 'task~', delete_task: 'task-',
  remember: 'mem+', search_memory: 'mem?', forget: 'mem-',
  save_to_kb: 'kb+', search_kb: 'kb?', list_kb: 'kb', forget_kb: 'kb-',
  github_list_repos: 'gh:repos', github_list_notifications: 'gh:notif',
  github_list_issues: 'gh:issues', github_create_issue: 'gh:issue+',
  gmail_compose: 'gmail', discord_send_message: 'discord',
  whatsapp_compose: 'wa', google_calendar_create_event: 'gcal',
  google_drive_open: 'gdrive', slack_send_message: 'slack',
  telegram_send_message: 'tg', notion_search: 'notion?', notion_create_page: 'notion+',
  dropbox_list_files: 'dbx', dropbox_upload_text: 'dbx+',
  shortcut_list_workflows: 'sc:wf', shortcut_search_stories: 'sc?',
  shortcut_create_story: 'sc+', messenger_open: 'fb', instagram_open: 'ig',
  x_compose_post: 'x', linkedin_open_share: 'li', zoom_open: 'zoom',
};

function describe(tool: ToolCall, t: any): string {
  const a: any = tool.args || {};
  switch (tool.name) {
    case 'think': return String(a.reasoning || '').slice(0, 200);
    case 'set_plan': return `${(a.steps || []).length} ${t('terminal.steps')}`;
    case 'define_dod': return `step=${a.step_id} criteria=${(a.criteria || []).length}`;
    case 'verify_step': return a.step_id ? `step=${a.step_id}` : t('terminal.currentStep');
    case 'fetch_page': return String(a.url || '');
    case 'search_and_read': return String(a.query || '');
    case 'product_search': return [a.query, a.site].filter(Boolean).join(' @ ');
    case 'browser_navigate': return String(a.url || '');
    case 'browser_get_text':
    case 'browser_click':
    case 'browser_wait_for': return String(a.selector || '(page)');
    case 'browser_fill': return `${a.selector || ''} = ${a.value || ''}`;
    case 'browser_scroll': return `${a.direction || 'down'} ${a.amount || ''}`;
    case 'browser_run_js': return String(a.code || '').slice(0, 80);
    case 'read_file':
    case 'write_file': return String(a.path || '');
    case 'list_dir': return String(a.path || '.');
    case 'grep_files': return `${a.pattern || ''} in ${a.path || '.'}`;
    case 'run_command': return [a.cwd ? `(${a.cwd})` : '', a.command || ''].filter(Boolean).join(' ');
    case 'create_task': return [a.title, a.scheduled_for].filter(Boolean).join(' @ ');
    case 'update_task': return `id=${a.task_id} ${a.title || ''}`;
    case 'delete_task': return `id=${a.task_id}`;
    case 'remember': return String(a.content || '').slice(0, 100);
    case 'search_memory': return String(a.query || '');
    case 'forget': return a.atom_id ? `id=${a.atom_id}` : String(a.query || '');
    case 'save_to_kb': return String(a.title || '');
    case 'search_kb': return String(a.query || '');
    case 'forget_kb': return `id=${a.doc_id}`;
    case 'gmail_compose': return [a.to, a.subject].filter(Boolean).join(' / ');
    case 'discord_send_message':
    case 'slack_send_message': return String(a.content || a.url || '').slice(0, 100);
    case 'whatsapp_compose': return [a.phone, a.text].filter(Boolean).join(' / ').slice(0, 100);
    case 'google_calendar_create_event': return [a.title, a.start].filter(Boolean).join(' @ ');
    case 'google_drive_open': return [a.kind, a.query].filter(Boolean).join(' ');
    case 'telegram_send_message': return [a.target, a.text].filter(Boolean).join(' / ').slice(0, 100);
    case 'notion_search':
    case 'notion_create_page': return String(a.title || a.query || '');
    case 'dropbox_list_files':
    case 'dropbox_upload_text': return String(a.path || '');
    case 'shortcut_search_stories':
    case 'shortcut_create_story': return String(a.title || a.query || '');
    case 'github_list_issues':
    case 'github_create_issue': return [a.repo, a.title].filter(Boolean).join(' / ');
    case 'x_compose_post':
    case 'linkedin_open_share': return String(a.text || a.url || '').slice(0, 100);
    default: return String(a.query || a.url || a.path || a.command || a.title || a.handle || '').slice(0, 120);
  }
}

const NEON = 'var(--accent)';
const NEON_DIM = 'var(--accent-dim)';
const NEON_FAINT = 'var(--accent-glow)';

export default function TerminalLog({ liveTools, loadingLabel }: { liveTools: ToolCall[]; loadingLabel: string }) {
  const { t } = useTranslation();
  const current = [...liveTools].reverse().find(t => !t.output) || liveTools[liveTools.length - 1];
  const tag = current ? (TOOL_LABELS[current.name] || current.name) : '';
  const desc = current ? describe(current, t) : '';
  const running = current ? !current.output : true;
  const count = liveTools.length;

  return (
    <>
      <style>{`
        @keyframes term-cursor { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
        @keyframes term-flash { from { opacity: 0; transform: translateY(-2px) } to { opacity: 1; transform: none } }
        .term-bubble { animation: term-flash 140ms ease-out both; }
      `}</style>
      <div
        className="term-bubble flex flex-col justify-center max-w-[85%]"
        key={current?.name + ':' + count}
        style={{
          fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.5,
          background: 'var(--bg)',
          color: NEON,
          border: `1px solid ${NEON_DIM}`,
          borderRadius: '14px 14px 14px 4px',
          padding: '10px 14px',
          minHeight: 36,
          boxShadow: `0 0 10px ${NEON_FAINT} inset, 0 0 6px ${NEON_FAINT}`,
          textShadow: `0 0 5px ${NEON_FAINT}`,
          alignSelf: 'flex-start',
        }}
      >
        <div className="flex gap-[8px] items-center flex-wrap" style={{ rowGap: 2 }}>
          <span style={{ color: running ? NEON_DIM : NEON, fontWeight: 700 }}>{running ? '›' : '✓'}</span>
          {tag && <span style={{ color: NEON, fontWeight: 700 }}>{tag}</span>}
          {count > 1 && <span style={{ color: NEON_DIM, fontSize: 10 }}>[{count}]</span>}
          {!tag && (
            <>
              <span style={{ color: NEON }}>{loadingLabel || '…'}</span>
              <span className="inline-block w-[6px] h-[12px]" style={{ background: NEON, animation: 'term-cursor 1s steps(2) infinite' }} />
            </>
          )}
        </div>
        {tag && (
          <div style={{
            paddingLeft: 16,
            color: NEON_DIM,
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            marginTop: 2,
          }}>
            {desc || loadingLabel || '…'}
          </div>
        )}
      </div>
    </>
  );
}
