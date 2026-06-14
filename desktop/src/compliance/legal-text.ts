// Static legal copy bundled with the app. Update version when content changes.
export const LEGAL_VERSION = '2026-05-25';

export const TERMS_OF_SERVICE = `# Terms of Service

_Last updated: ${'2026-05-25'}_

## 1. Acceptance
By using Progsoft (the "App"), you agree to these Terms.

## 2. Eligibility
You must be at least 16 years old to use the App (this is enforced at first launch).

## 3. The Service
The App is a desktop AI assistant. It runs open-weight LLMs **locally on your machine** (via Ollama or a bundled llama-server) or **peer-to-peer with another user of the App** (end-to-end encrypted). The Progsoft server **never** performs LLM inference, never proxies prompts, and never stores conversation content. The server only handles authentication, peer-to-peer matchmaking metadata, and minimal usage logs (model name, duration, timestamps — no message content).

## 4. Free use
The App is free. No subscription, no top-ups, no paywall. Every feature, every whitelisted model, and every cosmetic is available at no cost.

## 5. Peer-to-peer inference
When you submit a prompt and no local model is selected, the App may route your request to another user of the network (a "Provider") over an end-to-end encrypted channel. **The Provider's machine sees your prompt in clear text during inference**, because the model needs to read it. The Progsoft server does not see the prompt. The App applies a content classifier (Llama Guard) on the Provider side to refuse illegal content before responding.

Conversely, if you opt to act as a Provider, you accept that other users' prompts will reach your machine for inference. The App refuses to log them, and the Provider runtime is signed by Progsoft to prevent tampering — but a determined local administrator could still inspect them. Operate as a Provider only if you accept this.

## 6. Acceptable use
You agree not to use the App to: generate illegal content (including CSAM, terrorism instructions, fraud); impersonate others; produce deepfakes of real persons without consent; commit fraud; or violate applicable law (including the EU AI Act prohibitions in Article 5). Content classifier refusals are not bypassable; attempting to do so is a violation of these Terms.

## 7. AI output disclaimer
LLM output may be incorrect, biased, or hallucinated. The whitelisted models (7-9B parameters) are competent for everyday assistance but should not be relied on for legal, medical, financial, or safety-critical decisions without independent verification. You remain responsible for what you do with the output.

## 8. Synthetic content
Any text, image, or audio produced by the App is AI-generated and marked as such. Images carry embedded metadata (PNG tEXt + EXIF) and a sidecar manifest (\`.ai.json\`), per EU AI Act Art. 50(2). You agree not to remove or obscure these markings.

## 9. Account termination
You may delete your account at any time from Settings. We may suspend or terminate accounts that violate these Terms (notably repeated content classifier circumvention attempts, or running a malicious Provider).

## 10. Liability
The App is provided "as is" without warranty. To the maximum extent permitted by law, our liability is excluded.

## 11. Changes
We may update these Terms; continued use after changes constitutes acceptance.

## 12. Contact
gaillard.guillaum@gmail.com`;

export const PRIVACY_POLICY = `# Privacy Policy

_Last updated: ${'2026-05-25'}_

## What stays on your device
Conversations, memory, knowledge base, files, mail credentials, integrations, agent state, model weights — **all stored locally** in the App's SQLite database and filesystem. The Progsoft server never receives them.

## What the server stores
- Email address and password hash (for login).
- Public profile (only if you explicitly opt in): handle, avatar choice, persona name, optional short status, badges.
- Shared conversation blobs (only if you explicitly share a conversation): **encrypted client-side**, the server stores an opaque blob and cannot read it.
- Minimal job logs: \`userId\`, \`modelId\`, \`durationMs\`, \`timestamp\`. **No prompt, no response content.**
- Peer-to-peer matchmaking metadata: temporary "online" status, declared models, declared throughput, **never** the contents of inferences.

## What the server never stores
- Prompts you send.
- Responses returned by any model.
- Embeddings.
- Memory atoms, knowledge base, files.

## Peer-to-peer inference exposure
When the App routes your request to another user (a Provider) because no local model is selected, **the Provider's machine sees the prompt in clear text** during inference. This is technically unavoidable: a model must read the prompt. The communication channel between you and the Provider is end-to-end encrypted (Noise protocol), so the Progsoft server is blind to the content. The Provider runtime is a signed binary that refuses to log prompts, but local administrators of a Provider machine could still inspect them. **For maximally sensitive content, switch to local-only mode** (Settings → Inference → Local only).

## Legal basis (GDPR Art. 6)
- Contract performance: account, matchmaking.
- Consent: collected at first launch (age + data processing).

## Subprocessors
- **Hosting** — backend deployed on EU infrastructure.

**No LLM provider subprocessor.** Progsoft does not contract OpenAI, Anthropic, OpenRouter, or any other cloud inference service to process your prompts. Inference happens on your machine or on a peer's machine.

## International transfers
No prompt content leaves the encrypted user ↔ peer channel. The Progsoft server is hosted in the EU. If a peer you are connected to is outside the EU, the encrypted channel still terminates on their machine — but their physical location is outside our control. The App displays the peer's declared country (best-effort) before establishing the channel, and you may restrict matchmaking to EU-only peers in Settings.

## Your rights (GDPR)
- **Art. 15 access / portability**: download all your data from Settings → "Export my data".
- **Art. 17 erasure**: delete your account from Settings.
- **Art. 21 objection**, **Art. 16 rectification**: contact us.
- **Art. 77 complaint**: lodge with your local data protection authority.

## Retention
- Account: until you delete it.
- Job logs: 12 months, then auto-deleted.
- Shared conversation blobs: until you delete them, or auto-expiry you choose (24h / 7 days / never).

## Cookies
The App uses a session cookie (JWT) for authentication. No tracking, no analytics, no advertising cookies.

## Security
Passwords are hashed with bcrypt. JWT secrets are server-side env vars. HTTPS enforced in production. Local SQLite is OS-protected per user account. The peer-to-peer channel uses Noise XX (mutual authentication + forward secrecy).

## Children
The App is not directed at children under 16. Age is confirmed at first launch.

## Contact
gaillard.guillaum@gmail.com — data controller.`;
