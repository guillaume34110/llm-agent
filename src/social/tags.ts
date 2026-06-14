// Closed vocabulary for inquiry/wall tags. Adding a tag = schema change.
// Server validates every tag against this list — free-text input rejected.
// Why closed: prevents SEO/keyword spam, prevents indexing of private signals,
// keeps i18n surface trivial.

export const TAGS = [
  // Engineering
  'rust', 'typescript', 'python', 'go', 'web-frontend', 'web-backend',
  'mobile', 'systems', 'embedded', 'devops', 'security', 'cryptography',
  'distributed', 'databases', 'compilers',
  // AI / data
  'ml', 'llm', 'nlp', 'vision', 'rl', 'data-engineering', 'mlops',
  // Design / product
  'ux-design', 'product', 'writing', 'graphics', 'animation', 'music-prod',
  'audio', 'gamedev',
  // Science / academic
  'math', 'physics', 'biology', 'chemistry', 'neuroscience', 'economics',
  // Business / ops
  'finance', 'legal', 'community', 'support', 'translation',
  // Hardware / other
  'hardware', 'iot', 'robotics', 'fpga',
  // Generic
  'open-source', 'research', 'teaching', 'mentoring', 'art',
] as const;

export type Tag = typeof TAGS[number];
const TAG_SET = new Set<string>(TAGS);

export function isValidTag(t: string): t is Tag {
  return TAG_SET.has(t);
}

export function sanitizeTags(input: unknown, max = 8): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const t of input) {
    if (typeof t === 'string' && isValidTag(t) && out.size < max) out.add(t);
  }
  return [...out];
}

// Max simultaneously subscribed tags per user. Forces focus, deters scraping.
export const MAX_USER_TAGS = 5;
