# Progsoft AI — Monkey

**IA multi-modale sans cloud commercial.** Chat, embeddings, image, transcription audio — tout tourne sur ta machine, ou chez un autre user du réseau P2P chiffré. Le serveur Progsoft ne fait jamais d'inférence. Pas de proxy OpenRouter, pas de subprocessor LLM, aucun payload ne quitte le réseau d'app.

## Pitch

> Un écosystème IA complet (LLM + vecteurs + image + transcription) en **local** (runtime bundlé) ou **P2P** (un peer du réseau Progsoft, chiffré E2E, modèle open-weights signé). **Gratuit, sans pub, sans tracking.** Tout (modèles, skins, avatars, animaux) est libre d'accès. Pas de credits, pas de subscription, pas de paywall.

## Architecture

```
┌─────────────────────────────────┐                  ┌──────────────────────────────┐
│ USER A (Tauri 2 desktop)        │                  │ SERVEUR Progsoft (NestJS)    │
│                                 │  ws / https      │                              │
│ • Agent loop (TS)               │ ◄──────────────► │ • Auth + JWT                 │
│ • SQLite + sqlite-vec           │   match request  │ • Matchmaking P2P             │
│ • Mémoire + KB locale           │                  │ • Catalogue modèles statique │
│ • llama-server / sd / whisper   │                  │ • Profils publics opt-in     │
│ • Llama Guard filtre contenu    │                  │ • Conv blob chiffré opaque   │
│ • Provider runtime signé        │                  │ • Distribution binaires      │
│ • Catalogue cosmétiques bundlé  │                  │                              │
└──────────────┬──────────────────┘                  └──────────────────────────────┘
               │
               │ E2E Noise XK — chiffré bout en bout
               │ contenu invisible au serveur
               ▼
┌─────────────────────────────────┐
│ USER B (Tauri 2 + provider mode)│
│ • Sert 1+ modalités whitelist   │
│ • Hash poids vérifié au boot    │
│ • Filtre contenu avant retour   │
│ • Contribution libre, non rémunérée │
└─────────────────────────────────┘
```

**Invariant local-first** : le serveur ne stocke **jamais** content/prompts/embeddings/profile/docs/conversations. Il fait l'annuaire des peers + sert le catalogue modèles + distribue les binaires. C'est tout.

## Stack

| Côté | Tech |
|------|------|
| Serveur | NestJS, Prisma, PostgreSQL (auth + matchmaking metadata + social blobs opaques) |
| Client desktop | Tauri 2, React, Rust (`rusqlite` + `sqlite-vec`) |
| Runtime LLM/embed | `llama-server` bundlé (llama.cpp `b4404`), sidecar Tauri |
| Runtime image | `sd-server` bundlé (stable-diffusion.cpp, Flux schnell) |
| Runtime audio | `whisper-server` bundlé (whisper.cpp) |
| Chiffrement P2P | Noise XK (libsodium) |
| Filtre contenu | Llama Guard 3 (8B) double-pass prompt+output, fail-closed |
| Vecteurs | sqlite-vec (BLOB Float32 + cosine JS) |

## Catalogue modèles (v1, refresh 2026-05-20)

Catalogue **fermé**, hash SHA256 figé serveur-side, vérifié au download. Pas de "load any GGUF" via P2P.

### Chat (3 familles)

| ID | Famille | Taille | Ctx | Licence | Shareable |
|----|---------|--------|-----|---------|-----------|
| `phi-4-mini-instruct` | Phi | 2.5 GB | 16k | MIT | ✓ |
| `llama-3.2-3b-instruct` | Llama | 2.0 GB | 16k | Llama-3.2-Community | ✓ |
| `qwen3-4b` | Qwen | 2.5 GB | 32k | Apache-2.0 | ✓ |
| `qwen3-8b` | Qwen | 5.0 GB | 32k | Apache-2.0 | ✓ |

### Embeddings (RAG, KB, mémoire)

| ID | Dim | Ctx | Taille | Licence |
|----|-----|-----|--------|---------|
| `qwen3-embedding-0.6b` | 1024 | 32k | 600 MB | Apache-2.0 |
| `qwen3-embedding-4b` | 2560 | 32k | 2.5 GB | Apache-2.0 |

### Image (génération)

| ID | Backend | Taille | VRAM | Licence |
|----|---------|--------|------|---------|
| `flux-schnell-q4` | sd.cpp | 6 GB | 8 GB | Apache-2.0 |
| `flux-schnell-q8` | sd.cpp | 12 GB | 16 GB | Apache-2.0 |

### Transcription audio

| ID | Backend | Taille | Langues | Licence |
|----|---------|--------|---------|---------|
| `whisper-small` | whisper.cpp | 150 MB | multi | MIT |
| `whisper-large-v3-turbo-q5` | whisper.cpp | 600 MB | multi | MIT |

### Safety (jamais user-facing)

- `llama-guard-3-8b` — classifier double-pass prompt+output côté provider, refus opaque `content_blocked`.

## Picker hardware-aware

Au boot ou à l'opt-in provider, l'app sonde RAM / disque / bande passante mémoire et calcule **par modalité** le meilleur modèle qui passe 3 gates :

1. **RAM full-context** : `poids + kv_cache × ctxLen + 1 GB headroom OS ≤ RAM`.
2. **Disque** : `taille × 1.4 ≤ free`.
3. **Throughput** : `bandwidth / sizeGb × 30s ≥ 60 tokens`.

`auditCapabilities(probe)` retourne `{chat, embed, image, transcribe}` — chaque slot = meilleur modèle qui passe, ou `null` + raison. Mode `shareableOnly` filtre les modèles aux licences non-redistribuables.

Quand l'user enable provider share, l'UI affiche le rapport audit et il toggle par modalité ce qu'il accepte de servir.

## Endpoints serveur

| Endpoint | Rôle |
|----------|------|
| `POST /api/auth/*` | Login, register, password reset |
| `POST /api/matchmaking/route` | Retourne peer info + token éphémère |
| `POST /api/matchmaking/announce` | Provider annonce sa dispo (modalité, modelId, hash poids, tok/s, latence) |
| `POST /api/matchmaking/jobs/settle` | Provider signale job fini (stats only, idempotent) |
| `GET /api/models` | Catalogue statique par modalité |
| `GET /api/providers/:id/stats` | Stats publiques par (provider, modèle, modalité) |
| `GET /api/u/:handle` | Profil public opt-in |
| `POST /api/conv/share` | Upload conv blob chiffré opaque, retourne `id` (clé reste côté client) |
| `GET /api/downloads/{app,monkey}/:platform` | Distribution binaires signés |

## Modèle économique

**Aucun.** L'app est gratuite, sans pub, sans tracking, sans subscription. Catalogue cosmétiques (skins, avatars, frames, animaux) entièrement libre. Les providers contribuent leur compute volontairement — pas de rémunération, pas de credits, pas de marketplace.

## Client desktop

```
desktop/
├── src-tauri/src/
│   ├── db.rs              rusqlite + sqlite-vec
│   ├── llama_runtime.rs   sidecar llama-server (chat + embed)
│   ├── sd_runtime.rs      (à venir) sidecar sd-server (image)
│   ├── whisper_runtime.rs (à venir) sidecar whisper-server (transcribe)
│   ├── noise_p2p.rs       Noise XK responder
│   └── main.rs
└── src/
    ├── models/
    │   ├── catalog.ts       catalogue unifié multi-modalités, sha256 pinned
    │   └── auto-picker.ts   3-gate picker, audit par modalité
    ├── llama/auto-runtime.ts  télécharge + boot llama-server au besoin
    ├── memory/                atoms + dreams + KB locale, hybrid ANN+FTS+RRF
    ├── agent/                 agent loop, plan 2-tier, DoD auto-injection
    ├── components/ProviderHostingPanel.tsx  audit + toggle par modalité
    └── screens/AgentScreen.tsx
```

DB locale : `~/.monkey/data.db`. Schéma : `memory_atom`, `memory_dream`, `knowledge_document`, `knowledge_chunk`, `user_profile` + tables FTS5 + colonnes `embedding_blob` Float32.

## Capacités agent

- **Plan 2-tier** : `set_plan` étape par étape, mutables code-side only
- **Definition of Done** : checks exécutables (`file_exists`, `shell_exit_zero`, `http_get_ok`, `playwright_nav`, `tool_result_no_erreur`)
- **Auto-injection DoD** : la première user-message est analysée — template DoD ajouté au dernier step selon type (jeu / web / script / rapport)
- **Audit progressif** : avant `done`, runner exécute tous les DoD ; échec → message correctif réinjecté + 2 cycles max
- **Garde-fous** : tool name validé (`TOOL_REGISTRY`), audit fail-closed (parse error → ok=false), gate déterministe `ERREUR:` empêche `done` silencieux après échec
- **Mémoire RAG** : atoms + dreams + master profile fusionnés, hybrid ANN+FTS+RRF, dedup cosine ≥ 0.95
- **Knowledge base** : ingestion docs → chunks ~800 chars overlap 100, search hybrid avec ref `[title p.X]`
- **Plafond qualité** : ce que produit un 4-8B open-weights, pas plus. Cible 70% des usages quotidiens couverts à 80-90%. Code complexe et reasoning multi-step long restent imparfaits — à assumer dans le marketing.

## Variables d'environnement

| Variable | Rôle | Défaut |
|----------|------|--------|
| `PORT` | Port serveur | `3469` |
| `JWT_SECRET` | Secret JWT | — |
| `CSRF_SECRET` | Secret CSRF (obligatoire en prod) | — |
| `FORGE_KEK_HEX` | KEK hex 32 bytes pour chiffrer les tokens Forge | — |
| `DATABASE_URL` | PostgreSQL | — |
| `ADMIN_EMAIL`, `ADMIN_DEFAULT_PASSWORD` | Compte admin auto | `admin@admin.com` / `changeme123` |
| `VITE_SIDECAR_URL` (desktop) | URL serveur Progsoft | `http://localhost:3469` |
| `MAX_SETTLE_TOKENS` | Cap anti-abuse sur settle | `200000` |

## Démarrage

```bash
# Database
docker compose up -d db

# Serveur
npm install
npx prisma migrate deploy
npm run build && node dist/main.js   # ou: npm run start:dev

# Desktop
cd desktop
npm install
npm run tauri dev                    # download bundled llama-server au premier boot
```

Compte admin auto-créé au premier boot avec `mustChangePassword: true`.

## Roadmap

- **Phase 0** ✅ — nettoyer modules cloud LLM, doc en cohérence avec le pivot P2P, llama-server bundlé.
- **Phase 1** (en cours) — catalogue multi-modal unifié (chat + embed + image + transcribe), picker hardware-aware par modalité, sidecars sd-server + whisper-server.
- **Phase 2** — protocole provider P2P complet (Noise XK + attestation + canary sampling), matchmaking par modalité, profils publics + conv partagées.
- **Phase 3** — catalogue cosmétiques étendu (bundlé client), marketing wave 1 (HN, Privacy media).
- **Phase 4** — salons multi-user, vidéo (si benchmark réseau le permet).

## Licence

[AGPL-3.0-or-later](LICENSE). Code inspectable et modifiable. Toute redistribution (y compris SaaS) doit publier ses modifications sous la même licence.
