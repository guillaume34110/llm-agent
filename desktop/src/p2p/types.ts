// Shared P2P types. The transport returns OpenAI-shaped completions so the
// rest of the desktop client (agent loop, llm-client) stays oblivious to
// whether the work happened locally or on a remote peer.

export interface ProviderHandle {
  id: string;
  userId: string;
  endpoint: string;
  publicKey: string;
  attested: boolean;
  lastSeenAt: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; [k: string]: unknown }>;
  tools?: unknown[];
  tool_choice?: unknown;
  stream?: false;
}

export interface ChatCompletionResponse {
  text: string;
  tool_calls?: unknown[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
