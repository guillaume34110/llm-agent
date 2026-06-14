export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  rawContent?: string;
  createdAt?: string;
  toolCalls?: ToolCall[];
  planSteps?: string[];  // set_plan card injected in feed
  attachments?: MessageAttachment[];
  usageTokens?: { prompt: number; completion: number };
  costCents?: number;
  modelId?: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, any>;
  output?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  provider?: string;
  category?: string;
  contextLength?: number;
  inputCost?: number;
  outputCost?: number;
  inputCostPer1MTokensCents?: number;
  outputCostPer1MTokensCents?: number;
  tokensPerSecond?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsAudioInput?: boolean;
  supportsImageOutput?: boolean;
  family?: string;
  sizeB?: number;
  activeB?: number;
  task?: string;
  minVramGb?: number;
  license?: string;
  icon?: string;
  minThroughput?: number;
  throughputUnit?: 'tokPerSec' | 'realtimeFactor' | 'itemsPerSec' | 'secondsPerImage';
  downgradeTo?: string | null;
}

export interface Session {
  id: string;
  name: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface ProfileResponse {
  email: string;
  name?: string;
  facts: Record<string, string>;
}

export interface StatusResponse {
  authenticated: boolean;
}

export interface ChatResponse {
  response: string;
  session_id?: string;
}

export type TaskStatus = 'planned' | 'done' | 'cancelled';

export interface TaskInput {
  title: string;
  details?: string;
  scheduledFor: string;
  endsAt?: string | null;
  allDay?: boolean;
  status?: TaskStatus;
  source?: string;
  agentPrompt?: string | null;
  shellCommand?: string | null;
  recurrence?: string | null;
  recurrenceUntil?: string | null;
  recurrenceCount?: number | null;
  modelId?: string | null;
  imageModelId?: string | null;
  imageSize?: string | null;
  musicModelId?: string | null;
  videoModelId?: string | null;
  mode?: 'report' | 'alert';
  waChatJid?: string | null;
  waChatLabel?: string | null;
  waChatKind?: 'owner' | 'contact' | null;
  toolMode?: 'full' | 'chat_only' | 'chat_search' | null;
  contextFolder?: string | null;
  reportMode?: 'always' | 'conditional' | null;
  reportCondition?: string | null;
}

export interface TaskRunLogEntry {
  ts: string;
  kind: string;
  label: string;
  detail?: string;
}

export interface TaskRunHistoryEntry {
  startedAt?: string | null;
  finishedAt?: string | null;
  result?: string | null;
  ok?: boolean;
}

export interface TaskDraft extends TaskInput {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  runHistory?: TaskRunHistoryEntry[];
}

export interface TaskItem {
  id: string;
  title: string;
  details: string;
  scheduledFor: string;
  endsAt?: string | null;
  allDay: boolean;
  status: TaskStatus;
  source: string;
  createdAt: string;
  updatedAt: string;
  agentPrompt?: string | null;
  shellCommand?: string | null;
  runResult?: string | null;
  runStartedAt?: string | null;
  runFinishedAt?: string | null;
  recurrence?: string | null;
  recurrenceUntil?: string | null;
  recurrenceCount?: number | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  runHistory?: TaskRunHistoryEntry[];
  runLog?: TaskRunLogEntry[];
  modelId?: string | null;
  imageModelId?: string | null;
  imageSize?: string | null;
  musicModelId?: string | null;
  videoModelId?: string | null;
  mode?: 'report' | 'alert';
  waChatJid?: string | null;
  waChatLabel?: string | null;
  waChatKind?: 'owner' | 'contact' | null;
  toolMode?: 'full' | 'chat_only' | 'chat_search' | null;
  contextFolder?: string | null;
  reportMode?: 'always' | 'conditional' | null;
  reportCondition?: string | null;
}

export type AttachmentKind = 'text' | 'image' | 'pdf' | 'binary';

export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: AttachmentKind;
  absolutePath?: string | null;
}

export interface ComposerAttachment extends MessageAttachment {
  textContent?: string;
  previewUrl?: string;
}

export type StepStatus = 'pending' | 'running' | 'verifying' | 'done' | 'failed' | 'skipped';

export interface DoDResult {
  checkType: string;
  ok: boolean;
  detail: string;
  cmd?: string;
  stdout?: string;
  exitCode?: number;
  screenshotPath?: string;
  durationMs?: number;
}

export interface AgentPlan {
  steps: string[];
  current: number;
  statuses: StepStatus[];
  results?: Record<string, DoDResult[]>;
  skipReasons?: Record<string, string>;
  screenshots?: string[];
  incomplete?: boolean;
  finalAuditStatus?: 'ok' | 'failed' | null;
  finalAuditIssues?: string[];
}

export type Screen = 'login' | 'agent';
export type AgentView = 'inbox' | 'chats' | 'tasks' | 'people' | 'knowledge' | 'background' | 'chatbots' | 'settings';
