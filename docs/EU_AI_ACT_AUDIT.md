# EU AI Act — Audit de conformité Monkey / Progsoft AI

**Date** : 2026-05-18 (mise à jour pivot P2P + local-only, suppression OpenRouter)
**Régulation** : Règlement (UE) 2024/1689 ("AI Act")
**Périmètre** : application desktop Tauri Monkey + serveur NestJS (auth + matchmaking + cosmetics + credits) + sidecar Python `monkey/`. **Aucun appel à un service d'inférence cloud commercial** : inférence soit locale (Ollama), soit P2P chiffré bout-en-bout entre utilisateurs de l'app.
**Méthode** : classification par tier de risque, mapping rôle (provider/deployer), check obligations applicables aux dates en vigueur (mai 2026).

> Document informatif. Ne constitue pas un conseil juridique. Confirmer avec AI Office / autorité nationale compétente / conseil qualifié avant mise sur le marché EU.

---

## 1. Qualification juridique

### Rôle Monkey vis-à-vis de l'AI Act

| Composant | Rôle | Justification |
|---|---|---|
| Auteurs des poids open-weights (Meta Llama, Mistral AI, Alibaba Qwen, Google Gemma, Microsoft Phi) | **GPAI providers** | Entraînent et publient les modèles fondation open-weights distribués par Monkey |
| **Monkey (l'app desktop + serveur)** | **Provider d'un système AI** | Intègre des GPAI open-weights dans un système AI (l'agent + orchestration de tools + runtime P2P signé) et le met à disposition d'utilisateurs finaux. **Pas** distributeur de modèle cloud commercial. |
| Utilisateur agissant comme **Provider P2P** (partage son compute) | Sub-deployer technique | Exécute sur sa machine des inférences pour d'autres utilisateurs. Aucun rôle éditorial — runtime signé par Monkey, filtre contenu obligatoire. |
| Utilisateur final consommateur | **Deployer** (si usage professionnel) ou hors champ (si usage personnel strict) | Art. 3(4) — "deployer" suppose usage dans le cadre d'une activité professionnelle |

**Monkey n'est PAS** :
- Provider d'un GPAI model (ne train pas, ne fine-tune pas — voir `monkey/` et `desktop/src/agent/`).
- Provider d'un système high-risk (aucun cas d'usage Annexe III).

**Monkey EST** :
- Provider d'un **système AI** (l'agent + orchestration de tools) au sens Art. 3(1).
- Soumis à l'**Article 50 transparence** (limited-risk) car l'agent : (a) interagit avec des personnes physiques, (b) génère du contenu synthétique (texte, images via Flux, audio transcrit).
- Soumis à l'**Article 4 AI literacy** (en vigueur depuis 2 Feb 2025).

### Territorialité
Application extra-territoriale (Art. 2). Si l'app est distribuée dans l'UE OU si l'output est utilisé dans l'UE → AI Act s'applique, même si l'éditeur est hors UE.

---

## 2. Classification par tier de risque

### 2.1 Vérification Art. 5 — pratiques interdites

| Pratique interdite | Présence dans Monkey | Statut |
|---|---|---|
| Manipulation/déception subliminale causant préjudice | Non | ✅ OK |
| Exploitation de vulnérabilités (âge, handicap, situation socio-éco) | Non | ✅ OK |
| Social scoring | Non | ✅ OK |
| Prédiction criminelle par seul profilage | Non | ✅ OK |
| Scraping non-ciblé de visages | Non | ✅ OK |
| Reconnaissance d'émotions en milieu travail/éducation | Non | ✅ OK |
| Catégorisation biométrique attributs sensibles | Non | ✅ OK |
| RBI temps réel espace public (law enforcement) | Non | ✅ OK |

**Note OSINT** : les outils `monkey/tools/osint_*.py` (WHOIS, DNS, Wayback, Gravatar, HIBP, social media pivot, image reverse search, géolocation) ne tombent **pas** dans Art. 5 tant que l'usage reste passif/déclaratif. ⚠️ Si l'utilisateur s'en sert pour du **profilage de personnes physiques avec impact significatif** (ex. décision RH, scoring crédit), le système peut basculer en high-risk Annexe III. Documenter usage attendu dans les CGU.

### 2.2 Vérification Annexe III — high-risk

| Catégorie Annexe III | Présence | Statut |
|---|---|---|
| Biométrie (RBI, catégorisation, reconnaissance émotions) | Non | ✅ OK |
| Infrastructures critiques | Non | ✅ OK |
| Éducation / formation pro (admission, évaluation) | Non | ✅ OK |
| Emploi / gestion travailleurs (recrutement, promotion, surveillance) | ⚠️ Persona "HR" disponible — voir §3.3 | À documenter |
| Services essentiels (crédit, assurance, urgences, prestations) | Non | ✅ OK |
| Law enforcement | Non | ✅ OK |
| Migration / asile / frontières | Non | ✅ OK |
| Justice / processus démocratiques | Non | ✅ OK |

### 2.3 Conclusion classification

**Système Monkey = Limited-Risk (Article 50)** + obligations Art. 4 AI literacy.

Pas high-risk. Pas prohibé. Mais **risque de basculement** si features ajoutées (voir §6).

---

## 3. Audit conformité — obligations applicables

### 3.1 Art. 4 — AI literacy (en vigueur depuis 2 Feb 2025)

> Providers et deployers doivent assurer un niveau suffisant de "AI literacy" de leur staff et de toute personne opérant l'AI en leur nom.

| Item | État actuel | Gap |
|---|---|---|
| Documentation interne sur capacités/limites des modèles | Partielle (CLAUDE.md, system prompts) | 🔴 Pas de doc dédiée AI literacy |
| Formation staff sur risques LLM (hallucination, biais, prompt injection) | Non documentée | 🔴 À formaliser |
| Section docs utilisateur sur limites de l'agent | Non | 🔴 Manque |

**Action** : `docs/AI_LITERACY.md` (mis à jour 2026-05-18) couvre : nature des LLM open-weights 7-9B, hallucinations, exposition du prompt en mode P2P, limites des tools, responsabilité utilisateur sur outputs, classifieur de contenu Provider-side.

### 3.2 Art. 50(1) — disclosure interaction AI-humain (en vigueur 2 Aug 2026)

> Providers de systèmes intended to interact with natural persons doivent designer le système pour informer les personnes qu'elles interagissent avec une AI, sauf si évident.

**Surfaces concernées dans Monkey** :
- `desktop/src/screens/AgentScreen.tsx` — interface chat principale
- `desktop/src/whatsapp/wa-bridge.ts` — bridge WhatsApp (l'agent répond à des tiers via WA)
- `desktop/src/mail/` — bridge mail (l'agent envoie/répond à des mails)

| Surface | Évident que c'est une AI ? | Gap |
|---|---|---|
| Chat desktop principal | Oui (UI dédiée "agent") | ✅ OK |
| WhatsApp — message sortant à un tiers | **Non** — le tiers reçoit un message comme d'une vraie personne | 🔴 **GAP MAJEUR** |
| Mail — réponse envoyée à un tiers | **Non** — le tiers ne sait pas que c'est généré | 🔴 **GAP MAJEUR** |

**Action prioritaire** :
- WhatsApp : par défaut, append signature `🤖 Réponse générée par assistant AI` ou opt-out explicite avec consentement éclairé du destinataire. Option configurable per-contact.
- Mail : signature mail mentionnant l'assistance AI dans la draft, supprimable par l'utilisateur après revue humaine (lui devient deployer responsable).
- Documenter exception "human-in-the-loop with editorial responsibility" si l'utilisateur valide chaque envoi.

### 3.3 Art. 50(2) — marquage contenu synthétique (en vigueur 2 Aug 2026)

> Providers de systèmes générant audio/image/video/text synthétique doivent marquer les outputs en format machine-readable + détectables comme générés par AI.

| Output | Marquage actuel | Gap |
|---|---|---|
| Texte généré par LLM (chat, mail, WA) | Aucun | 🔴 À implémenter (au minimum métadonnée fichier si export) |
| Images générées (Flux) | Aucun watermark / aucune métadonnée C2PA | 🔴 **GAP** — fichiers sauvés avec prefix `_generated_` mais pas de marquage robuste |
| Transcriptions audio | Label "Transcript:" en chat | ⚠️ Suffit pour usage interne, insuffisant si export |

**Action** :
- Images : intégrer métadonnée EXIF/XMP `XMP-dc:Source = "AI-generated"` + idéalement signature C2PA (Content Credentials).
- Texte exporté : si copy/save de réponse → ajouter footer optionnel "Généré par AI".
- Aligner sur draft guidelines Commission du 8 mai 2026 (`references/article-50.md` dans le skill).

### 3.4 Art. 50(3) — emotion recognition / biometric categorization
Pas applicable (aucune feature de ce type).

### 3.5 Art. 50(4) — deepfakes
Pas applicable (Flux génère des images, mais pas spécifiquement des deepfakes de personnes réelles dans le workflow nominal). ⚠️ Si l'utilisateur prompt "image de [personnalité publique]" → contenu peut tomber sous deepfake disclosure → deployer (l'utilisateur) responsable. Documenter dans CGU.

### 3.6 GPAI (Art. 53–55)
Monkey n'entraîne ni ne fine-tune de modèle fondation. **Hors champ direct**. Mais en tant qu'intégrateur **redistribuant des poids open-weights** via le mécanisme de provisioning de Provider, Monkey doit :
- Conserver les liens publics vers les model cards et déclarations GPAI des auteurs (Meta, Mistral AI, Alibaba, Google, Microsoft) ;
- Documenter dans la doc utilisateur la chaîne de provenance des poids et leur hash figé serveur-side ;
- Vérifier que les modèles whitelistés disposent d'une licence permettant la redistribution non-commerciale et l'usage commercial limité (cf. licences Llama Community License, Mistral Research/Commercial, Apache-2.0 pour Qwen/Phi, Gemma Terms).

### 3.7 Conformité indirecte — RGPD

Bien qu'hors AI Act stricto sensu, le RGPD s'applique au traitement de données perso. Le **local-first invariant** (CLAUDE.md) est un atout majeur, **renforcé par la suppression de tout sous-traitant LLM commercial** depuis le pivot 2026-05-18 :
- Serveur ne stocke PAS de payload, ne fait PAS d'inférence (✅ minimisation maximale).
- Logs minimaux : `userId`, `modelId`, `durationMs`, `ts` — **plus de `tokens_in/out`** car le serveur n'observe pas l'inférence (✅ proportionnalité).
- Données utilisateur dans `desktop/src` → maîtrise totale par l'utilisateur (✅ portabilité, effacement).
- Aucun sous-traitant LLM (pas d'OpenAI, Anthropic, OpenRouter au registre Art. 30) → registre simplifié.

⚠️ Point de vigilance restant : **mode P2P**. Le prompt est lisible en clair par la machine du Provider (autre utilisateur). Canal chiffré E2E (Noise XX), mais l'extrémité Provider peut être physiquement hors UE. Mesures : (a) restriction "EU-only peers" disponible en Settings, (b) drapeau pays affiché avant établissement du canal, (c) information transparente dans la Privacy Policy embarquée. Base légale : exécution du contrat (Art. 6(1)(b)) + information explicite à l'utilisateur au premier lancement.

---

## 4. Tableau de synthèse — exposition pénalités

| Obligation | Statut actuel | Pénalité max |
|---|---|---|
| Art. 5 (interdictions) | Conforme | €35M / 7% CA — N/A |
| Art. 4 AI literacy | ✅ `docs/AI_LITERACY.md` créé | €15M / 3% CA |
| Art. 50(1) interaction disclosure (chat desktop) | ✅ OK + banner empty-state ajouté | €15M / 3% CA |
| Art. 50(1) interaction disclosure (WhatsApp/Mail vers tiers) | ✅ `withAiDisclosure()` WA + `_append_ai_disclosure_*` mail | €15M / 3% CA |
| Art. 50(2) marquage synthétique (texte) | ✅ Mention "AI-assisted reply" dans bridges WA/Mail | €15M / 3% CA |
| Art. 50(2) marquage synthétique (images Flux) | ✅ PNG tEXt + EXIF UserComment + sidecar `.ai.json` (`_write_ai_provenance`) | €15M / 3% CA |
| Annexe III (high-risk) | Non applicable | — |
| GPAI Art. 53–55 | Non applicable (consumer, pas provider) | — |

**Échéance critique** : **2 Aug 2026** (Art. 50). Avec Digital Omnibus AI provisoirement adopté (7 mai 2026), grâce possible jusqu'au **2 Dec 2026** pour les systèmes generative AI déjà sur le marché EU avant le 2 août 2026.

---

## 4bis. Pivot 2026-05-18 — suppression dépendance LLM cloud commercial

Décision produit : retrait complet d'OpenRouter et de toute API d'inférence commerciale. Inférence désormais **soit locale (Ollama)**, **soit P2P chiffré bout-en-bout** entre deux utilisateurs de l'app. Conséquences AI Act :

- ❌ Plus de transfert de prompt vers OpenAI / Anthropic / OpenRouter → un poste de risque RGPD majeur disparaît.
- ✅ Chaîne de sous-traitance LLM = vide. Registre Art. 30 simplifié.
- ✅ Confidentialité du prompt par défaut : reste chez l'utilisateur (local) ou ne traverse qu'un canal Noise vers un peer (P2P).
- ⚠️ Nouveau risque : un utilisateur agissant comme Provider voit en clair les prompts qui passent par sa machine pendant l'inférence. **Mitigation obligatoire** : classifieur de contenu (Llama Guard 3) côté Provider ; runtime signé ; transparence dans la Privacy Policy ; option local-only pour contenus sensibles ; restriction matchmaking EU-only.
- ⚠️ Nouveau risque : redistribution de poids GPAI → vérifier les licences (cf. §3.6).

## 4ter. Correctifs appliqués (historique 2026-05-17)

| Gap | Fichier modifié | Mécanisme |
|---|---|---|
| Disclosure WA tiers (Art. 50(1)) | `desktop/src/whatsapp/wa-bridge.ts` | `withAiDisclosure()` appendé à `kind === 'contact'`, idempotent |
| Disclosure Mail tiers (Art. 50(1)) | `monkey/tools/mail.py` | `_append_ai_disclosure_text/html()` dans `mail_send`, idempotent, EN+FR |
| Watermark images (Art. 50(2)) | `monkey/tools/image.py` (génération locale) | PNG tEXt + EXIF UserComment via Pillow/piexif (best-effort), sidecar `.ai.json` (fail-safe). `src/llm-proxy/` retiré au pivot 2026-05-18. |
| Chat first-interaction disclosure | `desktop/src/components/ChatFeed.tsx` | Banner empty-state "Vous interagissez avec un assistant IA" |
| Personas re-qualifiés (Annex III mitigation) | `desktop/src/personas/registry.ts`, `monkey/personas.py` | HR → "Assistant Connaissance RH" / Recruiter → "Assistant Recrutement (rédaction)" / Legal → "Assistant Juridique (information)" / Analyst → "Analyste Data" — system prompts refusent désormais ranking/scoring/décisions individuelles |
| OSINT legal framework | `monkey/agent.py` `_PROTO_OSINT` | Cadre légal explicite : purpose limitation, data minimization, refus credit/RH/predictive policing, escalade obligatoire en cas de doute |
| AI literacy (Art. 4) | `docs/AI_LITERACY.md` (nouveau) | Doc complète : limites LLM, prompt injection, biais, responsabilités, usages interdits |

Personas conservés (selon décision utilisateur) mais re-qualifiés comme assistants de **rédaction & connaissance**, jamais décisionnels. Cela évite le basculement Annex III(4) emploi / III(5) services essentiels / III(8) justice.

OSINT conservé (selon décision utilisateur) mais encadré : seul cas d'usage public+légitime autorisé, refus explicite pour les cas Annex III/Art. 5.

## 4ter. Gaps résiduels post-correctifs (re-audit 2026-05-17)

Vérification terrain après correctifs P0 — gaps mineurs restants :

| # | Gap | Priorité | Note |
|---|---|---|---|
| 1 | Pas de signature C2PA cryptographique sur images (PNG tEXt + EXIF best-effort seulement) | P2 | State-of-art, pas obligation AI Act |
| 2 | CGU / Privacy Policy embarquées (`desktop/src/compliance/legal-text.ts`) ré-écrites au pivot 2026-05-18 : suppression mention OpenRouter, ajout exposition P2P, ajout EU-only matchmaking option | ✅ Fait | — |
| 3 | Logs serveur sans champ `disclosure_emitted: bool` | P1 | Utile pour audit trail en cas de contrôle |
| 4 | Texte copié hors app perd le marquage synthétique | P2 | Draft guidelines Commission floues sur ce point |
| 5 | `scripts/test-gate.sh` ne teste pas la présence des disclosures (risque régression silencieuse) | P1 | Ajouter assertions grep sur `withAiDisclosure` / `_append_ai_disclosure` / `_write_ai_provenance` |

Aucun gap résiduel P0 côté AI Act. Tous postes Art. 4 / Art. 50 verts.

## 5. Plan d'action priorisé

### P0 — Avant 2 Aug 2026 (ou 2 Dec 2026 si Digital Omnibus s'applique)

1. **AI disclosure dans bridges WhatsApp & Mail**
   - Implémenter dans `desktop/src/whatsapp/wa-bridge.ts` : signature configurable, on par défaut.
   - Implémenter dans `desktop/src/mail/` : draft contient mention AI; utilisateur peut éditer avant envoi (et devient alors deployer responsable du contenu final).

2. **Watermark/métadonnée sur images générées (locales)**
   - Implémenté dans `monkey/tools/image.py` pour la génération locale (SDXL/Flux quand activé) : PNG tEXt + EXIF UserComment + sidecar `.ai.json`.
   - Idéal : signature C2PA via `c2pa-node` ou équivalent Rust côté Tauri.

3. **Doc AI literacy** (`docs/AI_LITERACY.md`)
   - Pour staff interne : limites LLM, prompt injection, hallucinations, biais.
   - Pour utilisateurs (intégrer dans onboarding/CGU) : "vous êtes deployer responsable des outputs envoyés à des tiers".

4. **CGU / Privacy Policy embarquées** ✅ Ré-écrites au pivot 2026-05-18 dans `desktop/src/compliance/legal-text.ts` (version `LEGAL_VERSION = '2026-05-18'`) :
   - Mention explicite : aucun sous-traitant LLM, inférence locale ou P2P uniquement.
   - Exposition P2P documentée (Provider voit le prompt en clair).
   - Restrictions d'usage : interdit pour scoring crédit, RH décisionnel, services essentiels (sinon bascule high-risk).
   - Acceptance + version stockée localement, ré-acceptance à chaque bump de `LEGAL_VERSION`.

### P1 — Bonnes pratiques recommandées

5. **Inventaire modèles whitelistés** + lien vers model cards des auteurs open-weights (Llama-3.1-8B, Mistral-7B, Qwen-2.5-7B, Gemma-2-9B, Phi-3-mini, Llama-Guard-3-8B). Hash de poids figé serveur-side.
6. **Persona "HR" review** : confirmer que le persona n'aide qu'à drafter/organiser, jamais à décider d'embauche/promotion. Ajouter disclaimer en haut du system prompt persona HR.
7. **Logging conformité** : ajouter aux logs server `(userId, model, endpoint)` un champ `disclosure_emitted: bool` quand applicable.
8. **Bouton "Why this answer?"** dans chat : affichage modèle utilisé, contexte injecté (KB chunks, memory atoms) → renforce transparence Art. 13-style même si pas obligatoire pour limited-risk.

### P2 — Veille

9. Suivre adoption finale du **Digital Omnibus AI** (texte définitif post mai 2026).
10. Suivre **draft guidelines Article 50 Commission** (consultation jusqu'au 3 juin 2026, version finale attendue Q3 2026).
11. Surveiller publication des **harmonised standards** (CEN-CENELEC JTC 21) pouvant déclencher application des obligations high-risk en différé.

---

## 6. Risques de basculement (à surveiller en cas d'évolution produit)

Toute feature future qui **automatiserait une décision** ou **profilerait des personnes physiques** dans ces domaines déclencherait le régime **high-risk Annexe III** :

| Feature hypothétique | Tier déclenché | Coût conformité |
|---|---|---|
| Persona HR qui filtre des CV ou score des candidats | High-risk Annexe III(4) | Conformity assessment, CE, doc technique, FRIA |
| OSINT enrichi pour scoring crédit | High-risk Annexe III(5) | Idem + supervision humaine documentée |
| Tool d'aide à la décision juridique sur faits/droit | High-risk Annexe III(8) | Idem |
| Reconnaissance d'émotions sur audio/vidéo utilisateur | Limited-risk Art. 50(3) **OU** prohibé si milieu travail/édu | — |
| Génération de deepfakes de personnes réelles | Limited-risk Art. 50(4) deployer disclosure | — |
| Stockage server-side de conversations | Hors AI Act stricto sensu, mais casse l'invariant local-first → RGPD plus complexe | — |

**Règle interne suggérée** : ajouter à `CLAUDE.md` une section "AI Act guardrails" qui liste les features interdites sans review légale.

---

## 7. Statut global

| Dimension | Évaluation |
|---|---|
| Risque réglementaire actuel | **Limited-risk (Art. 50)** |
| Exposition financière sans action | jusqu'à **€15M / 3% CA** mondial annuel |
| Effort de mise en conformité estimé | **2-4 semaines dev** (disclosure WA/Mail, watermark images, docs AI literacy, CGU) |
| Échéance dure | **2 août 2026** (avec sursis possible au 2 décembre 2026 via Digital Omnibus) |
| Atouts | Local-first invariant **renforcé** (zéro sous-traitant LLM), single BTCPay XMR path, codebase modulaire, runtime Provider signé, classifieur de contenu Llama Guard côté Provider, whitelist de poids hashés |
| Points de vigilance | Mode P2P (Provider voit prompt en clair → option local-only obligatoire pour sensible), redistribution poids open-weights (licences à valider modèle par modèle), intégrité du runtime Provider (signature + attestation à implémenter Phase 1) |

---

## 8. Sources

- Règlement (UE) 2024/1689 — https://eur-lex.europa.eu/eli/reg/2024/1689/oj
- AI Act Service Desk (Commission) — https://ai-act-service-desk.ec.europa.eu/
- Draft guidelines Article 50 (8 mai 2026) — https://digital-strategy.ec.europa.eu/en/library/draft-guidelines-implementation-transparency-obligations-certain-ai-systems-under-article-50-ai-act
- Skill interne : `~/.claude/skills/eu-ai-act/`

---

*Audit produit avec le skill `eu-ai-act`. Mettre à jour à chaque évolution produit susceptible de toucher une catégorie Annexe III ou un usage Art. 5.*
