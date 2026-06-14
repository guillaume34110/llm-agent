export interface ClassifiedAgentError {
  key: string;
  vars?: Record<string, string>;
}

export function classifyAgentError(raw: string): ClassifiedAgentError {
  const low = (raw || '').toLowerCase();
  if (low.includes('rate_limit') || low.includes('429') || low.includes('rate limit')) {
    return { key: 'agentScreen.error.rateLimited' };
  }
  if (low.includes('fetch failed') || low.includes('network') || low.includes('econnrefused') || low.includes('timeout')) {
    return { key: 'agentScreen.error.networkError' };
  }
  if (low.includes('unauthorized') || low.includes('401')) {
    return { key: 'agentScreen.error.sessionExpired' };
  }
  return { key: 'agentScreen.error.generic', vars: { error: raw } };
}
