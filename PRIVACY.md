# Privacy Policy — Progsoft AI / Monkey

_Last updated: 2026-05-19_

This document describes what data Progsoft AI ("we", "the service") processes,
why, on what legal basis, how long we keep it, and what rights you have under
the EU General Data Protection Regulation (GDPR / RGPD).

It applies to the Progsoft AI desktop app ("Monkey"), the matchmaking /
billing server, and the optional provider runtime you may run to share compute.

## 1. Core principle — local-first

**Your chats, your memory, your documents, your knowledge base, your
embeddings, and your conversations never leave your device unless you
explicitly share them.** They live in the desktop app's local SQLite database
and local filesystem only.

The server stores **only** what is strictly necessary for authentication,
billing, P2P matchmaking, and abuse defense. Prompts and model responses are
**not stored on the server**, not even temporarily.

## 2. Data controller & contact

- **Controller:** Progsoft AI
- **Contact / privacy requests:** privacy@progsoft.ai
- For erasure or export requests, you can also use the in-app buttons
  (Settings → Account → Export my data / Delete my account), which call
  `GET /api/account/export` and `DELETE /api/account` respectively.

## 3. What the server processes, why, and how long

| Category | Fields | Purpose | Legal basis (Art. 6) | Retention |
|---|---|---|---|---|
| **Account** | email, password hash (bcrypt), role, credits balance, createdAt | Authenticate you, run the service | Contract (b) | Until account deletion |
| **Billing — credits ledger** | userId, amount, type, description, balanceAfter, ts | Account credits gained / spent | Contract (b) + legal obligation (c) — accounting | **7 years** (French fiscal hold). userId anonymised on account deletion (User row anonymised, ledger preserved). |
| **Billing — BTCPay events** | deliveryId, invoiceId, type, processedAt, payment rail (ln / xmr) | Idempotent webhook processing | Contract (b) | **90 days** then auto-purged |
| **Usage logs** | userId, modelId, tokensIn/out, durationMs, ts (no prompts, no responses) | Cost computation, abuse defense, debugging | Legitimate interest (f) | **365 days** then auto-purged |
| **P2P matchmaking** | provider/consumer userId, modelId, status, cost/earn cents | Pair a request with a provider, settle credit transfer | Contract (b) | Until account deletion (then deleted; the fiscal trace lives in credits ledger) |
| **Provider registration & stats** | userId, modelId, endpoint, public key, hashes, tier counters | Run the P2P directory and rewards | Contract (b) | Until provider withdraws or account deletion |
| **Attestation / canary samples** | providerId, modelId, canary hash, response hash, valid bool | Detect cheating providers | Legitimate interest (f) — service integrity | Until account deletion |
| **Social opt-in features** (inquiry, wall, match, project rooms, groups) | userId, opt-in settings, opaque E2E ciphertext blobs | Run the agent-mediated social features you opted into | Consent (a) | Until you opt out or delete account |
| **OAuth (forge accounts)** | userId, provider, externalId, handle, encrypted access/refresh token, scope, expiresAt | Authenticate to GitHub/GitLab/Gitea/Forgejo on your behalf | Consent (a) | Until you disconnect or delete account. Tokens are **encrypted** with a server-held KEK. |
| **Password reset tokens** | userId, hashed token, expiresAt | One-shot password reset | Contract (b) | Until used or expired; then auto-purged daily |
| **Public profile** (if you create one) | userId, handle, bio, avatar cosmetic | Display you on the public profile page | Consent (a) | Until you delete the profile or the account |

## 4. What the server **never** stores

- The **plaintext** of any chat message, prompt, completion, agent thought,
  document, memory note, embedding, or knowledge base content.
- Your local files.
- Your IP geolocation history (we see IPs at the TLS/HTTP layer for routing;
  they are not durably logged tied to userId).
- Telemetry beyond the categories above.

## 5. P2P — what the provider can see

When you route a request to a peer provider:

- The Noise XK channel between your client and the provider is **end-to-end
  encrypted**. The Progsoft server (matchmaker) sees only the routing metadata
  (who talks to whom, which model, token counts after settlement) — never the
  prompt or the response.
- **The provider's runtime sees your prompt and the model's response in
  plaintext.** This is unavoidable: the LLM must read the prompt to answer.
  Provider runtimes are signed binaries with an attestation channel and a
  Llama-Guard-style content filter, but you should treat any P2P request as
  visible to the operator of the provider machine you were routed to.
- You can opt out of P2P routing in Settings → Compute and run only local
  Ollama models.

## 6. Subprocessors

- **BTCPay Server instance** — Lightning Network (BTC-LN) and Monero (XMR)
  checkout for credit top-ups and cosmetics. You pick the rail at checkout —
  LN by default (fast, low fees, broadly legal), XMR opt-in (maximum privacy).
  We hand off you to the BTCPay invoice page; BTCPay sees the payment and
  notifies us via signed webhook. We never see your wallet, neither rail.
- **Hosting** — the matchmaker / billing server runs on infrastructure we
  control.
- We do **not** use any third-party LLM proxy (OpenAI, Anthropic,
  OpenRouter, …). All inference runs on your machine or on a peer provider.

## 7. Your rights

Under GDPR Art. 15–22 you have the right to:

- **Access / portability (Art. 15, 20)** — get a JSON export of everything the
  server holds about you: `GET /api/account/export` (or in-app button).
  E2E-encrypted blobs are included raw (only your client-side keys can decrypt
  them); OAuth tokens are redacted because they are server-encrypted KEK
  secrets and not user-portable.
- **Erasure (Art. 17)** — delete your account: `DELETE /api/account` (or in-app
  button). All PII tables are purged including OAuth tokens. The credits
  ledger is kept with the User row anonymised for the 7-year fiscal hold and
  then auto-purged.
- **Rectification (Art. 16)** — change your email / password from the app.
- **Restriction / objection (Art. 18, 21)** — contact us at the address above.
- **Lodge a complaint (Art. 77)** — with your national supervisory authority
  (in France: the CNIL — https://www.cnil.fr).

We respond to requests within **30 days**.

## 8. Security

- Passwords are stored as bcrypt hashes (cost 10).
- OAuth tokens are encrypted at rest with a server-held KEK.
- P2P traffic uses Noise XK (mutual authentication + forward secrecy).
- Provider binaries are signed (Ed25519); the runtime self-attests at boot.
- TLS in transit on all server endpoints.

## 9. Children

Progsoft AI is not directed at children under 16 and we do not knowingly
collect data from them.

## 10. Changes to this policy

We will update the "Last updated" date at the top and surface a notice in the
app for material changes.
