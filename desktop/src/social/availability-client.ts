// Client for /api/social/inquiry-settings — controls whether this user is
// discoverable as a collaborator for incoming LLM-to-LLM negotiations.
//
// Server stores only opt-in flags + tags + modes. Never KB content, never
// user prompts. Match negotiations themselves run E2E via Noise XK; the
// server only sees that an inquiry was broadcast to N opted-in users.

const backendUrl = (import.meta as any).env?.VITE_BACKEND_URL || 'http://localhost:3469';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('jwt');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const AVAILABILITY_MODES = [
  'find_collab',
  'find_mate',
  'find_worker',
  'find_opinion',
  'find_review',
  'find_expertise',
] as const;
export type AvailabilityMode = typeof AVAILABILITY_MODES[number];

export const AVAILABILITY_TAGS = [
  'rust', 'typescript', 'python', 'go', 'web-frontend', 'web-backend',
  'mobile', 'systems', 'embedded', 'devops', 'security', 'cryptography',
  'distributed', 'databases', 'compilers',
  'ml', 'llm', 'nlp', 'vision', 'rl', 'data-engineering', 'mlops',
  'ux-design', 'product', 'writing', 'graphics', 'animation', 'music-prod',
  'audio', 'gamedev',
  'math', 'physics', 'biology', 'chemistry', 'neuroscience', 'economics',
  'finance', 'legal', 'community', 'support', 'translation',
  'hardware', 'iot', 'robotics', 'fpga',
  'open-source', 'research', 'teaching', 'mentoring', 'art',
] as const;
export type AvailabilityTag = typeof AVAILABILITY_TAGS[number];

export const MAX_USER_TAGS = 5;

export interface AvailabilitySettings {
  userId: string;
  acceptInquiries: boolean;
  acceptedModes: string[];
  acceptedTags: string[];
  maxPerDay: number;
  responseRate30d?: number | null;
}

export interface AvailabilityPatch {
  acceptInquiries?: boolean;
  acceptedModes?: string[];
  acceptedTags?: string[];
  maxPerDay?: number;
}

export async function fetchAvailability(): Promise<AvailabilitySettings> {
  const res = await fetch(`${backendUrl}/api/social/inquiry-settings`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`availability fetch failed: ${res.status}`);
  return res.json();
}

export async function updateAvailability(patch: AvailabilityPatch): Promise<AvailabilitySettings> {
  const res = await fetch(`${backendUrl}/api/social/inquiry-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`availability update failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}
