"""Main agent loop. Uses native tool calls via backend."""
import copy
import json
import functools
import os
import re
import ast
import threading
import time
import urllib.error
import urllib.request
import queue as _queue
from datetime import datetime, timedelta
from pathlib import Path
from monkey import llm as llm_mod
from monkey import memory as mem_mod
from monkey import skills as skills_mod
from monkey import approvals as _approvals
from monkey.animals import persona_identity, persona_short

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
_BLANK_RUN_RE = re.compile(r"\n{3,}")


def _clean_tool_result(content: str) -> str:
    """Lossless noise removal for tool results stored in history.

    - Strips ANSI escape codes (visual noise, no info).
    - Collapses consecutive identical lines into `<line>  ×N`.
    - Collapses runs of 3+ blank lines to 2.
    Preserves all distinct signal. No truncation."""
    if not content or len(content) < 200:
        return content
    s = _ANSI_RE.sub("", content)
    lines = s.split("\n")
    out: list[str] = []
    prev: str | None = None
    run = 0
    for ln in lines:
        if ln == prev:
            run += 1
            continue
        if prev is not None:
            if run > 0:
                out.append(f"{prev}  ×{run + 1}")
            else:
                out.append(prev)
        prev = ln
        run = 0
    if prev is not None:
        out.append(f"{prev}  ×{run + 1}" if run > 0 else prev)
    return _BLANK_RUN_RE.sub("\n\n", "\n".join(out))


_INTENT_RULES = {
    "chat": "INTENT: chat → reply naturally, but if the user asks you to check, search, fetch, verify, or do something concrete, use the appropriate tools. No plan unless a real multi-step execution is needed.",
    "search": "INTENT: search → search_and_read or search_web, synthesize briefly, no plan unless multi-source report is explicitly requested.",
    "browse": "INTENT: browse → search_and_read or fetch_page, present results directly, no plan.",
    "code": "INTENT: code → minimum tools needed. Plan only if ≥3 independent milestones.",
    "orchestrate": "INTENT: orchestrate → set_plan(2-6 milestones) then execute.",
}

SYSTEM_PROMPT = """{persona}
You have tools for files, web, HTTP, PDF, clipboard, shell, memory, calendar, plan, and skills.

{intent_rule}

RULES
- Reply in the language of the user's last message.
- Do exactly what is asked. No extra work.
- Use tools when the user asks to check, search, fetch, read, list, create, or run something.
- Don't fake success. If a tool errors or returns empty, say so and try a different approach.
- Never invent data. If you can't get real data, say so plainly.
- Read the [NOW] context for current date/time; don't search the web for it.
- Final reply is prose, not JSON. JSON only inside ```rich``` blocks when needed.

CONTEXT
{context}
Default workspace: {workspace}/
{protocols}"""

# ── Protocol blocks (lazy-loaded by intent + content triggers) ───────────────
# Goal: keep load-bearing capabilities accessible without injecting all of them
# every iteration. Each block is whole — no truncation, no info loss.

_PROTO_PDF = """
DOCUMENT/PDF: produce full content in memory → generate_pdf or write_file in ONE call → confirm path in one sentence. Never write .txt before PDF. Never suggest external editors."""

_PROTO_SEARCH = """
RESEARCH: search_and_read or search_web → synthesize briefly. Don't over-fetch.

SEARCH QUERY RULES (MANDATORY for search_web, search_and_read, search_images):
- KEYWORDS, not questions. Engine matches tokens, not grammar.
- MAX 4 KEYWORDS for vertical-intent searches (real estate, shopping, jobs, travel, restaurants). Pattern: `<entity> <locality>`. Constraints (price, date, surface, brand) go into the site's filters AFTER landing, NEVER in the query.
  • BAD "maison moins de 300000 euros à Lyon 3 chambres". GOOD "maison Lyon" → land on leboncoin/seloger → use price/rooms filters.
  • BAD "iphone 15 pro max 256gb best price france". GOOD "iphone 15 pro max" → land on Amazon/idealo → sort by price.
  • BAD "vol Paris Tokyo octobre direct moins 800 euros". GOOD "Paris Tokyo" → land on Kayak/Skyscanner → set dates/filters.
- KEYWORDS for general/technical research can be longer but still terse:
  • BAD "comment installer postgres avec pgvector sur mac m1 en 2026" → GOOD "postgres pgvector mac m1 install 2026".
  • BAD "why does my react useEffect cleanup return undefined" → GOOD "react useEffect cleanup undefined".
- Drop articles/pronouns/fillers (the, a, my, comment, pourquoi, why, how, please…).
- English for technical topics (larger corpus). User's language for local/admin/news.
- COUNTRY-LOCAL TOPIC → SEARCH IN THAT COUNTRY'S LANGUAGE. Mandatory.
  • Japan → Japanese (日本語), `site:.jp` when useful.
  • Germany → German (Deutsch), `site:.de`. Spain/LatAm → Spanish. Brazil → Portuguese, `site:.br`.
  • Russia → Russian, `site:.ru`. China → Chinese (中文), `site:.cn`. France → French, `site:.fr`. Italy → Italian, `site:.it`. Korea → Korean, `site:.kr`.
  Any other country: dominant local language(s) + TLD. Native sources index in the native language.
- Quote exact error messages: `"TypeError: Cannot read property"`.
- Use `site:` for known sources: `site:stackoverflow.com`, `site:github.com`.
- Add a year (2025/2026) when freshness matters.
- Thin results → REFORMULATE shorter (3-4 keywords). Don't fetch more pages of bad results.

VERTICAL-FIRST ROUTING (skip Google when a domain-specific site exists — the native index is always richer):
- Real estate FR → leboncoin.fr/recherche/immobilier, seloger.com, pap.fr, bienici.com
- Real estate ES → idealista.com, fotocasa.es. DE → immowelt.de, immobilienscout24.de. UK → rightmove.co.uk, zoopla.co.uk. US → zillow.com, redfin.com, realtor.com
- Shopping general → amazon.{tld}, idealo.{tld}, google shopping
- Shopping second-hand FR → leboncoin.fr, vinted.fr. DE → ebay-kleinanzeigen.de. UK → gumtree.com
- Travel hotels → booking.com, hotels.com. Flights → kayak.com, skyscanner.net, google flights. Reviews → tripadvisor.com
- Jobs FR → indeed.fr, welcometothejungle.com, linkedin.com/jobs, apec.fr. US/intl → indeed.com, linkedin.com/jobs, glassdoor.com
- Restaurants/lieux → google.com/maps, tripadvisor, thefork.com (FR), yelp.com (US)
- Cars FR → leboncoin.fr, lacentrale.fr. US → autotrader.com, cars.com
- Code/dev → github.com, stackoverflow.com, sourcegraph.com
- Academic → scholar.google.com, arxiv.org, semanticscholar.org
- News → site-specific (lemonde.fr, nytimes.com…) or gdelt
- Maps/addresses → openstreetmap.org or google maps
Pattern: search the vertical site's domain via `search_web` (or `search_and_read`) with ONLY the entity+locality. Google ONLY when no vertical fits or for orientation.

RESULT COVERAGE (don't stop at first hit):
- `search_and_read` returns multiple results with extracted text. Read at least 2-3 sources before concluding.
- Thin results → REFORMULATE shorter query. Don't fetch more pages of bad results."""

_PROTO_BROWSER = ""

_PROTO_CODE = """
CODE/FILES:
- Explore before writing: list_dir + read_file if target may exist.
- edit_file (precise diff) > write_file (full rewrite).
- After a batch of edits, run build/lint/typecheck via run_command. No "done" without green run.
- Keep modules focused. Avoid monolithic files.
- Creative-vague requests: one think() to fix stack + file layout + 2-4 acceptance criteria → set_plan → execute. Otherwise skip enrichment.

CODE HYGIENE: if you start emitting unexpected non-ASCII (random glyphs, control chars) inside code, stop and rewrite. Code is ASCII except for explicit user-facing strings."""

_PROTO_IMAGES = """
DISPLAY IMAGES IN CHAT: any image saved in/under the workspace (e.g. after download_file or generate_image) → embed with markdown `![alt](path)`. Use workspace-relative or absolute path. UI renders inline. Always inline when the user asked to fetch/show an image — do NOT just print the path.
- For local folders of existing images, prefer `list_dir_images(path)` over raw `list_dir`. Then include the returned images inline in the final answer."""

_PROTO_RICH = """
RICH RENDERING (charts, tables, alerts, cards, diagrams): emit a fenced ```rich``` block containing a single JSON object. UI parses and validates. NEVER emit HTML — only `rich` blocks. Use whenever the user asks for graph/chart, sortable comparison table, highlighted callout, or schema/diagram.

ABSOLUTE PROHIBITION FOR CHART/GRAPH REQUESTS: never emit ```jsx```, ```tsx```, ```js```, ```python```, ```html```, or any other code fence containing `recharts`, `Chart.js`, `matplotlib`, `<LineChart`, `import React`, `ResponsiveContainer`, etc. The user wants a RENDERED chart in the chat, not source code. If you lack data → fetch it (fetch_page on a public JSON API: CoinGecko, Binance, Open-Meteo, World Bank, etc.) THEN emit the `rich` chart block with REAL data points. Never emit a chart with placeholder/example data and a comment like `// ... more data`. Either you have real data → rich block, or you don't → fetch first. NEVER both "I don't have the data" + a code template.

Shapes:
1. Chart: ```rich
{"type":"chart","kind":"line","title":"Temperatures","description":"Koh Chang, 48h","xKey":"t","yUnit":"°C","data":[{"t":"00:00","temp":27},{"t":"06:00","temp":26}],"series":[{"key":"temp","label":"Temperature"}]}
```
`kind` ∈ `line`|`bar`|`area`. `xKey` names X field. `series` items need `key`; `label`/`color` optional (default theme palette `var(--chart-1..5)`).

2. Table: ```rich
{"type":"table","caption":"Optional","columns":[{"key":"city","label":"City"},{"key":"temp","label":"Temp"}],"rows":[{"city":"Koh Chang","temp":"28°C"}]}
```

3. Alert: ```rich
{"type":"alert","variant":"default","title":"Info","description":"Short message."}
```
`variant` ∈ `default`|`destructive`.

4. Card (groups children): ```rich
{"type":"card","title":"Weather","description":"24h","children":[{"type":"chart","kind":"line","xKey":"t","data":[...],"series":[...]}]}
```

5. Diagram (Mermaid — flowchart, sequence, ER, state, class, gantt, C4, mindmap…): ```rich
{"type":"diagram","engine":"mermaid","title":"Auth","source":"sequenceDiagram\\n  Client->>API: POST /login\\n  API-->>Client: JWT"}
```
Use a diagram whenever the user asks for "schema/diagram/flowchart/sequence/architecture/graphe (nœuds/arêtes)/ERD/state machine". `source` is raw Mermaid; escape newlines as `\\n`. No HTML.

Mermaid syntax (parse-fail otherwise): any label containing `()`, `[]`, `|`, `:`, `/`, `,`, `<` or non-ASCII (`µ`, `°`, `±`) MUST be wrapped in double quotes inside the shape. WRONG: `C[NPN (T1) - Push]` · RIGHT: `C["NPN (T1) — Push"]`. WRONG: `A[10 µF]` · RIGHT: `A["10 µF"]`. Edge labels with special chars: `-->|"clk (5V)"|`. Use `<br/>` for line breaks inside quoted labels. Prefer short ASCII node ids and put rich text in quoted labels. When in doubt → quote.

JSON-escape rule for `source`: write a quote as `\"` (one backslash). NEVER `\\\"` (double-backslash quote) — that survives JSON parsing as `\"` and breaks Mermaid. Never prefix `+`, `-`, `|`, `(`, `)` with a backslash: they are plain characters in Mermaid.

6. ASCII schematic (monospace grid — circuits, P&ID, network topology, plumbing, signal flow, block diagrams). DO NOT hand-draw ASCII wires/junctions yourself. ALWAYS call the `render_ascii_schematic` tool with a node/edge spec, then wrap its output in a rich block.

How to use:
- Decide the components (nodes) the user asked for. Use short ids and human labels: `{id:"R1",label:"R1 10kΩ"}`, `{id:"U1",label:"U1 LM386"}`, `{id:"LB",label:"Load Balancer"}`.
- If the topology has a top rail (VCC, V+, IN, source) and a bottom rail (GND, V-, OUT, sink), pass them in `rails`.
- Lay out columns top-to-bottom in `groups`: each column = one list of node ids in vertical order. The tool draws the column verticals and connects them to the rails automatically.
- For cross-column connections (e.g. a midpoint of column A wires into column B), add `edges:[{from,to}]`. Vertical chains within a column and rail connections are automatic — don't list them.
- The tool returns the ASCII string. Emit it as ```rich {"type":"ascii","title":"...","content":"<tool output>"} ```.

ANTI-DEFAULT RULE — your training data biases you toward a few canonical textbook circuits (common-emitter NPN amplifier with R1/R2/Rc/Re voltage divider is the worst offender). If the user names an IC (`LM386`, `LM741`, `NE555`, `TDA2030`, `TL072`, `LM3886`, `op-amp`), the central node MUST be that IC and surrounding components are its datasheet support network — NOT a BJT. If they name a topology (`push-pull`, `class AB`, `inverting op-amp`, `Sallen-Key`, `voltage follower`), draw THAT topology. Unspecified → pick the simplest modern answer (single op-amp or single audio IC), NOT a discrete BJT amp. Discrete BJT only when explicitly asked.

Example call for "LM386 audio amp": `render_ascii_schematic({rails:[{name:"VCC",side:"top"},{name:"GND",side:"bottom"}], groups:[["Rin","C3"],["C1","U1","C2","SPKR"]], nodes:[{id:"Rin",label:"Rin 10kΩ"},{id:"C3",label:"C3 220µF"},{id:"C1",label:"C1 10µF"},{id:"U1",label:"U1 LM386"},{id:"C2",label:"C2 220µF"},{id:"SPKR",label:"SPKR 8Ω"}], edges:[{from:"Rin",to:"U1"}]})`.

Rules: valid JSON only · narrative text BEFORE the block (1-2 sentences) · "graph/chart/graphique/courbe/histogramme" → `rich` chart, NOT ASCII or markdown table · time-series → kind=`line` or `area`."""

_PROTO_DATA = """
DATA SOURCING: for numerical/structured data (time series, prices, stats, lists), prefer free open JSON APIs over scraping. 1) public no-auth JSON endpoint → `fetch_page`. 2) fallback to search_web → fetch_page if no API. One source fails → try another. Goal: deliver, don't enumerate failures."""

_PROTO_OSINT = """
OSINT INVESTIGATION (when the user asks to find / track / investigate / dig up / profile a person, handle, email, phone, domain, company, or any digital identity):
- OPEN A NOTEBOOK: pick a stable topic slug (the subject of the investigation — full name, handle, domain, etc.) and call `osint_note(topic, key, value)` EVERY time you confirm a fact. Use the SAME topic across every call in this run. Never wait to "note at the end" — context will roll, notes won't.
- PIVOT METHODICALLY (don't dump one search and stop):
  1) Identity seeds — collect every spelling, alias, handle, email, phone, address you can confirm. Note them with their source URL.
  2) Cross-platform username pivot — same handle across Twitter/X, Reddit, GitHub, Mastodon, Bluesky, LinkedIn, Instagram, TikTok, HN, Keybase, etc. Try direct profile URLs and capture HTTP status + bio snippet.
  3) Domain/email/phone enrichment — WHOIS, DNS records, subdomains (crt.sh, AlienVault OTX), HIBP breach exposure (k-anonymity), gravatar lookup, phone country/carrier.
  4) Search dorks — combine `"exact name"`, `site:linkedin.com/in`, `site:github.com`, `intext:"@handle"`, `filetype:pdf "name"`, `inurl:cv "name"`.
  5) Multi-engine — when one search engine is thin, cross-check with another (Google → DuckDuckGo → Bing → Yandex). Different indexes catch different sources.
  6) Wayback + caches — `web.archive.org/cdx/search/cdx?url=<domain>` for historical snapshots; useful when the live page is gone or scrubbed.
  7) Images & geolocation — if a photo or location is involved, do EXIF extraction, reverse image search (Yandex first, then Google Lens via browser), and Nominatim for place names. Note GPS coords and timestamp metadata.
  8) Public registries — company filings (recherche-entreprises FR, Companies House UK), news (GDELT), Wikidata for entity IDs and cross-language aliases.
- ALWAYS CITE THE SOURCE URL alongside the fact. Unsourced claims do not go in the notebook.
- NEVER fabricate or guess. If a profile 404s or a record doesn't exist, note "not found at <url>" — absence is itself a finding.
- TOOLBELT (call by name — these exist):
  • Identity & username pivot: `username_pivot`, `reddit_user`, `hn_user`, `github_user`, `github_code_search`
  • Domain / DNS / email / phone: `whois_lookup`, `dns_records`, `subdomain_enum`, `wayback_snapshots`, `gravatar_lookup`, `hibp_password_check`, `phone_parse`, `http_headers`
  • Search: `osint_dorks` (build curated query list), `multi_engine_search` (Google+DDG+Bing RRF fusion), `search_web`, `search_and_read`
  • Image / geo: `exif_extract`, `image_phash`, `reverse_image_urls`, `nominatim_geocode`, `nominatim_reverse`
  • Entities & news: `recherche_entreprises` (FR companies), `wikidata_search`, `gdelt_search`
- BEFORE THE FINAL REPORT: call `osint_dump(topic)` to recover every note, then write the report grounded in those notes (with their source URLs). Structure the report as: Identity → Digital footprint → Network/affiliations → Risk/exposure → Open questions.
- CITATION GUARD: after drafting the report, call `osint_citation_check(text=<your draft>)`. If `ok=false`, rewrite the draft inline with the missing source URLs before sending. Never send an OSINT report with zero URLs.
- LEGAL/ETHICAL FRAMEWORK (EU AI Act + GDPR + national law — non-negotiable):
  • Only PUBLIC, lawfully-obtainable data. No credential abuse, no scraping behind a login wall, no fee-paid background brokers, no doxxing of uninvolved third parties, no buying breached datasets.
  • PURPOSE LIMITATION — OSINT is allowed for: due diligence on a prospect/counterparty, journalistic research, academic research, security investigation on the user's own systems/identity, verification of facts the user is entitled to verify. It is FORBIDDEN for: credit scoring of natural persons (Annex III(5)), hiring or candidate ranking (Annex III(4)), education/admission decisions (Annex III(3)), predictive policing on individuals (Art. 5(d) — PROHIBITED), social scoring (Art. 5(c) — PROHIBITED), profiling for advertising of vulnerable persons, harassment, stalking.
  • SUBJECT — if the target is a natural person who hasn't given consent and is not a public figure in their public capacity, downgrade to the bare minimum needed and flag the risk to the user before proceeding.
  • DATA MINIMIZATION — collect only what the user's stated purpose requires. Do not enumerate every breach, every phone, every relative just because you can.
  • TRANSPARENCY — be explicit about which sources you used and how. Refuse to launder dubious sources by paraphrasing.
  • IF IN DOUBT — refuse and ask the user to confirm a lawful purpose, or escalate to a human reviewer. Refusal is always a valid output."""

# Trigger keyword sets (lowercased, no accents handled separately if needed)
_TRIG_PDF = ("pdf", "document", "rapport", "report", "cv ", " cv", "résumé", "resume", "fiche")
_TRIG_BROWSER = ("browser", "navigate", "naviguer", "browse", "page web", "website", "site web", "scrape")
_TRIG_IMAGES = ("image", "photo", "picture", "screenshot", "capture", "illustration", "dessin", "logo", "icon")
_TRIG_RICH = (
    "chart", "graph", "graphique", "graphe", "courbe", "histogramme", "barplot", "diagram",
    "diagramme", "schéma", "schema", "tableau ", "table ", "comparison", "comparatif",
    "sequence", "flowchart", "erd", "state machine", "mindmap", "gantt", "alert", "callout",
)
_TRIG_DATA = (
    "json", "api", "csv", "endpoint", "stat", "statistique", "series", "time series",
    "prix", "price", "cours", "weather", "météo", "temperature",
)
_TRIG_OSINT = (
    "osint", "investigate", "investigation", "enquête", "enquete", "dig up",
    "background check", "vérification d'identité", "track down", "retrouver",
    "find someone", "find a person", "profile", "profiler", "dox",
    "who is this", "qui est cette", "qui est ce", "identify the person", "identifier la personne",
    "trace", "tracer", "fouiller sur", "creuser sur", "renseignement",
    "subdomain", "sous-domaine", "whois", "dns lookup", "breach", "fuite de données",
    "reverse image", "exif", "geolocate", "géolocaliser", "reverse phone", "reverse email",
    "social profile", "username pivot", "pivot username", "wayback", "archive.org",
)


def _select_protocols(intent: str, user_msg: str, animal_id: str | None = None) -> str:
    """Disabled 2026-05-28: protocol walls were degrading 3B model — it complied
    by writing prose instead of calling tools. Tool descriptions in the schema
    are sufficient guidance. Keep signature to avoid touching callers.
    """
    return ""
    msg = (user_msg or "").lower()
    blocks: list[str] = []
    if any(k in msg for k in _TRIG_PDF):
        blocks.append(_PROTO_PDF)
    if intent in ("search", "browse") or any(k in msg for k in ("cherche", "search", "recherche", "trouve", "find", "lookup", "vérifie", "verify")):
        blocks.append(_PROTO_SEARCH)
        blocks.append(_PROTO_DATA)
    if intent in ("code", "orchestrate"):
        blocks.append(_PROTO_CODE)
    if any(k in msg for k in _TRIG_IMAGES):
        blocks.append(_PROTO_IMAGES)
    if any(k in msg for k in _TRIG_RICH):
        blocks.append(_PROTO_RICH)
    if not any(k in msg for k in _TRIG_DATA):
        pass  # _PROTO_DATA already covered by search trigger above
    elif _PROTO_DATA not in blocks:
        blocks.append(_PROTO_DATA)
    if any(k in msg for k in _TRIG_OSINT):
        blocks.append(_PROTO_OSINT)
    if not blocks:
        return ""
    out = "\n\n━━━ TASK PROTOCOLS ━━━" + "".join(blocks)
    # P7: per-animal site memory — hint top sites for this intent
    try:
        from monkey.site_memory import classify_intent as _ci, top_sites as _ts
        kind = _ci(user_msg or "")
        sites = _ts(animal_id, kind, n=5)
        if sites:
            out += (
                f"\n\nPREVIOUSLY WORKED FOR THIS PERSONA on '{kind}' intent — "
                f"try these FIRST before generic Google: {', '.join(sites)}."
            )
    except Exception:
        pass
    return out

WHATSAPP_CONVERSATIONAL_RULES = """WHATSAPP CONVERSATIONAL OUTPUT (current session is a WhatsApp conversation):
- The FINAL message is sent verbatim into a real WhatsApp chat. It MUST read as a natural human message.
- FORBIDDEN in the final message: code fences (```...```), markdown headers (# / ## / ###), bold/italic markup (**x**, __x__, *x*), inline code backticks, ASCII tables, JSON, bullet glyphs other than a single short list if truly needed, prefixes like "[Task]", "[Mail]", "[Agent]", "ERREUR:", "Réponse:", "Voici le message:", "(envoyé)", "Done.".
- Do NOT narrate what you did, do NOT describe yourself as an assistant/bot, do NOT mention tools or the prompt. Speak in first person AS the persona to the contact.
- NEVER reveal or mention your internal codename or animal alias (Monkey, Tigre, Vanilla, etc.) — these are internal, not part of the persona seen by the contact.
- Do NOT open with a self-introduction ("I am X", "Je suis X", "Ici X"). Jump straight into the message content as if continuing a normal human conversation.
- Plain sentences. Line breaks fine. Emojis only if the persona naturally uses them. No meta."""


WHATSAPP_PROTOCOL = WHATSAPP_CONVERSATIONAL_RULES + """

WHATSAPP MEDIA:
- WhatsApp has FULL agent parity with desktop chat. Web search, files, shell, memory, plans, and WhatsApp media tools are all available when relevant. Never self-limit because the channel is WhatsApp.
- If the user asks for current facts, verification, comparison, a website check, or anything that depends on external/up-to-date information, your FIRST action must be a web tool call (`search_and_read`, `search_web`, or `fetch_page`). Do not answer from prior knowledge in that case.
- You CAN send images, videos, audio, documents over WhatsApp. Never refuse and never fall back to image generation when user asks to send an existing/web image.
- "Find an image of X and send it" → FAST PATH (3 calls max): search_images(query) → download_file(top.image, "downloads/<name>.jpg") → whatsapp_send_file(path, kind="image"). Never search_web for images.
- Direct CDN image URL: whatsapp_send_media(url, kind). Local file: whatsapp_send_file(path, kind).
- "Envoie les images de X dans mon dossier" → glob_files("**/*X*.{jpg,jpeg,png,gif,webp,heic}") then whatsapp_send_file for each (cap 6). No invented paths.
- Never call generate_image unless user explicitly asks to CREATE a new image.
- "Fetch/save/grab/download X from the web into your folder" (any phrasing asking to retrieve a web resource and store it locally) → DO NOT refuse, DO NOT claim you can't write to disk. EXECUTE: if user gave a URL → download_file(url, "downloads/<sensible-name>.<ext>"); if only a topic for an image → search_images then download_file(top.image, "downloads/<name>.jpg"); for other content use search_web then download_file. Confirm in one short sentence with the saved path. download_file/write_file/generate_pdf are available, the workspace is writable."""

@functools.lru_cache(maxsize=1)
def _get_location() -> dict:
    """Approximate location from public IP, cached for process lifetime."""
    try:
        import urllib.request
        with urllib.request.urlopen("http://ip-api.com/json/?fields=city,regionName,country,lat,lon", timeout=3) as r:
            return json.loads(r.read())
    except Exception:
        return {}


def _get_weather(lat: float, lon: float) -> str:
    """Current weather via open-meteo (no API key needed)."""
    try:
        import urllib.request
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={lat}&longitude={lon}"
            f"&current=temperature_2m,weather_code,wind_speed_10m"
            f"&wind_speed_unit=kmh&timezone=auto"
        )
        with urllib.request.urlopen(url, timeout=3) as r:
            data = json.loads(r.read())
        cur = data.get("current", {})
        temp = cur.get("temperature_2m")
        wind = cur.get("wind_speed_10m")
        wcode = cur.get("weather_code", 0)
        if wcode == 0: desc = "sunny"
        elif wcode in (1, 2): desc = "partly cloudy"
        elif wcode == 3: desc = "overcast"
        elif wcode in range(51, 68): desc = "rainy"
        elif wcode in range(71, 78): desc = "snowy"
        elif wcode in range(80, 83): desc = "showers"
        elif wcode in range(95, 100): desc = "stormy"
        else: desc = "variable"
        return f"{temp}°C, {desc}, vent {wind} km/h"
    except Exception:
        return ""


def _get_workspace() -> str:
    """Read workspace from config, create default if needed."""
    import os
    config_file = os.path.join(os.path.expanduser("~"), ".monkey", "config.json")
    default_ws = os.path.join(os.path.expanduser("~"), "Documents", "Agent")
    try:
        with open(config_file) as f:
            ws = json.load(f).get("workspace", default_ws)
    except Exception:
        ws = default_ws
    os.makedirs(ws, exist_ok=True)
    return ws


def build_context() -> str:
    """Real-world context injected into every system prompt.
    Keep minimal — anything pre-injected (file listings, weather) makes small
    models fabricate from context instead of calling tools."""
    now = datetime.now()
    lines = [
        f"Date: {now.strftime('%A %d %B %Y')}",
        f"Time: {now.strftime('%H:%M')}",
    ]
    loc = _get_location()
    if loc.get("city"):
        parts = [loc["city"]]
        if loc.get("regionName") and loc["regionName"] != loc["city"]:
            parts.append(loc["regionName"])
        if loc.get("country"):
            parts.append(loc["country"])
        lines.append(f"Location: {', '.join(parts)}")
    ws = _get_workspace()
    lines.append(f"Workspace: {ws}")
    return "\n".join(lines), ws


def _now_block() -> str:
    """Fresh date/time injection, refreshed on every LLM call so the agent
    never plans/schedules with a stale clock."""
    now = datetime.now().astimezone()
    return (
        "[NOW] "
        f"Date: {now.strftime('%A %d %B %Y')} | "
        f"Time: {now.strftime('%H:%M %Z')} | "
        f"ISO: {now.strftime('%Y-%m-%dT%H:%M:%S%z')}"
    )


def _refresh_now_in_messages(messages: list[dict]) -> None:
    """Refresh the [NOW] timestamp on every LLM call so the agent never
    plans/schedules with a stale clock.

    The timestamp is folded into the LEADING system prompt, NOT appended as a
    trailing standalone message. Reasons:
      - A conversation that ENDS on a `system` message makes some chat templates
        (llama3.2) emit an immediate stop token → empty reply. The turn must end
        on the user/assistant/tool message. (This was the dominant cause of
        "model produced no answer" fallbacks on weak local models.)
      - Folding into the first system message (vs a trailing user message) keeps
        thinking models from treating the timestamp as the user's most recent
        message (qwen3:8b once answered "yes the date you provided is
        consistent…" instead of executing scheduled tasks)."""
    now = _now_block()
    # Drop any prior standalone [NOW] message (legacy tail injection).
    messages[:] = [
        m for m in messages
        if not (isinstance(m.get("content"), str) and m["content"].startswith("[NOW] "))
    ]
    # Strip a previously-folded [NOW] Date: line from the leading system prompt
    # (must NOT touch the instructional "[NOW] context" sentence in SYSTEM_PROMPT),
    # then re-append the fresh stamp.
    for m in messages:
        if m.get("role") == "system" and isinstance(m.get("content"), str):
            base = re.sub(r"\n*\[NOW\] Date: [^\n]*", "", m["content"]).rstrip()
            m["content"] = base + "\n\n" + now
            return
    # No system message present → prepend one so the turn never ends on it.
    messages.insert(0, {"role": "system", "content": now})


def _fn(name, desc, props, req=None):
    return {"type":"function","function":{"name":name,"description":desc,"parameters":{"type":"object","properties":props,"required":req or []}}}

S = lambda desc: {"type":"string","description":desc}
N = lambda desc: {"type":"number","description":desc}
B = lambda desc: {"type":"boolean","description":desc}

_LOADABLE_PACKS = ["files", "shell", "media", "image", "music", "video", "code", "calendar", "clipboard", "checkpoint", "skills_mgmt", "whatsapp", "mail", "kb"]
_PACK_SUMMARIES = {
    "files": "read/write/edit/append/list_dir/grep/glob/move/copy/delete/open files",
    "shell": "run_command",
    "kb": "kb_search/kb_list/kb_stats/kb_archive/kb_delete (knowledge base management)",
    "media": "pdf, xlsx, docx, pptx, audio/video conversion, image processing, archives, hashes, qr, barcodes",
    "image": "generate_image",
    "music": "generate_music",
    "video": "generate_video",
    "code": "scaffold_app_fullstack, scaffold_game_2d, repo_skill_*",
    "calendar": "send_notification, add_reminder, create_calendar_event, schedule_agent_task, list_agent_tasks, update_agent_task, cancel_agent_task, get_task_history",
    "clipboard": "get_clipboard, set_clipboard",
    "checkpoint": "restore_last_green, list_green_checkpoints",
    "skills_mgmt": "skill_list, skill_search, skill_create, skill_revise, skill_delete",
    "whatsapp": "whatsapp_send_media, whatsapp_send_file (only inside WhatsApp sessions)",
    "mail": "mail_list_accounts, mail_unread_count, mail_list, mail_search, mail_read, mail_sync, mail_summarize_inbox, mail_send, mail_reply, mail_flag, mail_move, mail_archive, mail_delete, mail_label_add, mail_label_remove, mail_list_folders, mail_clean_inbox (IMAP/SMTP mailboxes — full admin: send/reply, flag, archive, delete, inbox-zero triage)",
}

TOOLS = [
    # ── Think ──────────────────────────────────────────────────────────────────
    _fn("think","Reason step by step before acting. Use before complex decisions.",{"reasoning":S("Step-by-step reasoning (not shown to user)")},["reasoning"]),
    _fn("expand_tools","Load additional tool packs. Call this when you need a capability not in your current toolset (e.g. file edits, shell commands, media/PDF/xlsx, image generation, calendar). Loaded packs become available on the next turn.",{"categories":{"type":"array","items":{"type":"string","enum":_LOADABLE_PACKS},"description":"Pack names to load: files|shell|media|image|code|calendar|clipboard|checkpoint|skills_mgmt|whatsapp"}},["categories"]),

    # ── Web / search ───────────────────────────────────────────────────────────
    _fn("fetch_page","Fetch URL and return clean text (up to 12000 chars).",{"url":S("URL to fetch"),"max_chars":N("Max chars (default 12000)")},["url"]),
    _fn("search_web","Web search. INPUT MUST BE KEYWORDS, NOT A QUESTION. BAD: 'pourquoi mon useEffect cleanup retourne undefined react'. GOOD: 'react useEffect cleanup undefined'. Drop articles/stopwords. Use English for technical queries (better corpus). Quote exact phrases. Add a year (2025/2026) for recency.",{"query":S("Keyword query, max ~6 words. Not a natural-language sentence."),"max_results":N("Max results (default 5)")},["query"]),
    _fn("search_and_read","Web search + read top pages. INPUT MUST BE KEYWORDS, NOT A QUESTION. Same query rules as search_web: keywords only, no stopwords, English for tech topics, quote exact phrases, year for recency.",{"query":S("Keyword query, max ~6 words. Not a natural-language sentence."),"max_pages":N("Max pages to read (default 3)")},["query"]),
    _fn("kb_search","Search the user's local knowledge base (docs the user previously ingested). Call this BEFORE search_web when the question may relate to user-uploaded documents/notes. Returns top chunks with score, source, title.",{"query":S("Keyword query, max ~8 words. Same rules as search_web."),"top_k":N("Max chunks to return (default 5, max 20)")},["query"]),
    _fn("kb_list","List documents in the local knowledge base. Use to inventory what's stored, filter by tag (e.g. 'mail') or source prefix (e.g. 'mail:'), or search by title/source substring. Returns docs with chunk counts and indexing status.",{"tag":S("Optional tag filter (exact match against a tag in the doc's tag array)"),"source_prefix":S("Optional source prefix filter (e.g. 'mail:' to list only imported mails)"),"search":S("Optional substring match on title or source"),"archived":B("If true, list archived docs only (default false)"),"limit":N("Max docs to return (default 50, max 500)"),"offset":N("Pagination offset (default 0)")}),
    _fn("kb_stats","Get knowledge base statistics: total docs, chunks, vectorized chunks, unindexed docs, top tags, top source prefixes, configured embedding model. No arguments.",{}),
    _fn("kb_archive","Soft-archive documents from the knowledge base (hides them from search but keeps data). Reversible with archived=false. Batch up to 100 ids.",{"document_ids":{"type":"array","items":{"type":"string"},"description":"Document ids to archive (max 100)"},"archived":B("Set false to unarchive (default true)")},["document_ids"]),
    _fn("kb_delete","Permanently delete documents and their chunks from the knowledge base. Irreversible. Batch up to 100 ids per call. Use kb_archive first if unsure.",{"document_ids":{"type":"array","items":{"type":"string"},"description":"Document ids to delete (max 100)"}},["document_ids"]),
    _fn("kb_purge_unindexed","Delete all non-archived documents that have NO vectorized chunks (i.e. were added before a model was configured or with the wrong model). Useful when switching embedding models. Returns count deleted.",{}),
    _fn("kb_search_and_delete","Search the KB and delete matching documents. SAFETY: dry_run=true by default — returns what WOULD be deleted without acting. Set dry_run=false to commit. Max 50 deletions per call.",{"query":S("Search query (same as kb_search)"),"top_k":N("Max matches to consider (default 20, max 50)"),"dry_run":B("If true (default), only return the list; if false, actually delete")},["query"]),
    _fn("search_images","Search images via DuckDuckGo. Returns list of {image, thumbnail, source, title, width, height}. USE THIS to find an image.",{"query":S("Image search query"),"max_results":N("Max results (default 5)")},["query"]),

    # ── OSINT notebook (scratch findings across long investigations) ──────────
    _fn("osint_note","Append a finding to a topic-keyed OSINT notebook on disk. Use during investigations to record durable facts (URL, full name, email, phone, DOB, employer, breach, geo) so they survive context rolling. Topic = the subject of the investigation; key = field label; value = the finding (cite source URL when possible).",{"topic":S("Investigation subject (person name, company, domain, etc.). Same topic across calls = same notebook."),"key":S("Short label of the finding (e.g. 'email', 'twitter_handle', 'birth_year', 'source_url')"),"value":S("The finding itself, concise. Include source URL inline when known.")},["topic","key","value"]),
    _fn("osint_dump","Return the full OSINT notebook for a topic. Call before writing the final report to recover every fact accumulated during the run.",{"topic":S("Investigation subject (must match the topic used in osint_note).")},["topic"]),
    _fn("osint_list","List all existing OSINT notebooks with note counts. Useful to recover the slug of a prior investigation.",{}),
    _fn("osint_clear","Delete one OSINT notebook (topic given) or all notebooks (topic empty). Use sparingly — destructive.",{"topic":S("Topic to clear; empty = wipe all notebooks")}),
    _fn("osint_citation_check","Audit a draft OSINT report for inline source URLs. Call on your draft before sending — if it returns warnings, rewrite with citations.",{"text":S("Draft report text"),"min_urls":N("Minimum URLs expected (default 1)")},["text"]),

    # ── OSINT intel: domain / DNS / subdomains / wayback / email / phone ─────
    _fn("whois_lookup","WHOIS for a domain (registrar, dates, name servers, emails, status, country). Public WHOIS, no auth.",{"domain":S("Domain name (no scheme, e.g. 'example.com')")},["domain"]),
    _fn("dns_records","DNS lookup for A/AAAA/MX/NS/TXT/CNAME/SOA records. Returns {records: {type: [values]}}.",{"domain":S("Domain name"),"types":{"type":"array","items":{"type":"string"},"description":"Record types to query (default all of A/AAAA/MX/NS/TXT/CNAME/SOA)"}},["domain"]),
    _fn("subdomain_enum","Enumerate subdomains via crt.sh certificate transparency logs. Free, no auth, exhaustive for public certs.",{"domain":S("Apex domain (e.g. 'example.com' — will find 'api.example.com' etc.)"),"max_results":N("Cap on subdomain count (default 200)")},["domain"]),
    _fn("wayback_snapshots","Internet Archive Wayback CDX: list historical snapshots of a URL. Use to recover removed/scrubbed pages or track content evolution.",{"url":S("Full URL or domain"),"limit":N("Max snapshots (default 20)")},["url"]),
    _fn("gravatar_lookup","Public Gravatar profile for an email (display name, location, linked URLs, accounts). Useful identity pivot from an email.",{"email":S("Email address")},["email"]),
    _fn("hibp_password_check","Check via HIBP k-anonymity if a password has appeared in known breaches. Free, no auth, the full password is NEVER sent (only first 5 chars of SHA1).",{"password":S("Password to check")},["password"]),
    _fn("phone_parse","Parse a phone number → country, carrier, region, valid/possible flags, E.164, location, timezones. Uses libphonenumber.",{"number":S("Phone number (international or national form)"),"region":S("ISO 3166-1 alpha-2 region for parsing national numbers (default 'FR')")},["number"]),
    _fn("http_headers","Fetch a URL and return only response status + headers. Useful for tech-stack fingerprinting (Server, X-Powered-By, CSP, Set-Cookie).",{"url":S("URL")},["url"]),

    # ── OSINT search: dorks + multi-engine RRF ────────────────────────────────
    _fn("osint_dorks","Build a curated list of Google dork queries tailored to the OSINT target (auto-detects person / handle / domain / email). Returns grouped queries — run each via search_web.",{"target":S("Investigation target (full name, @handle, domain, or email)"),"kinds":{"type":"array","items":{"type":"string"},"description":"Override auto-detection: any of 'person','handle','domain','email'"}},["target"]),
    _fn("multi_engine_search","Run a query against Google + DuckDuckGo + Bing (via stealth browser) and fuse results with Reciprocal Rank Fusion. Surfaces consensus URLs and catches sources missed by a single engine.",{"query":S("Search query"),"max_results":N("Max fused results (default 10)")},["query"]),

    # ── OSINT social: username pivot + per-platform lookups ───────────────────
    _fn("username_pivot","Probe a username across 25+ popular platforms (GitHub, Twitter, Reddit, Mastodon, Bluesky, TikTok, Twitch, Steam, npm, PyPI, …). Returns hits + misses. Sherlock-style.",{"username":S("Username (no leading @)"),"sites":{"type":"array","items":{"type":"string"},"description":"Optional list of site names to restrict the probe (default all)"}},["username"]),
    _fn("reddit_user","Reddit user profile + recent submissions via public JSON API (karma, account age, subs).",{"username":S("Reddit username"),"limit":N("Max recent submissions (default 10)")},["username"]),
    _fn("hn_user","Hacker News user profile (karma, created, about, submission count) via Firebase API.",{"username":S("HN username")},["username"]),
    _fn("github_user","GitHub user profile + 10 most-recently-updated public repos via REST API (no auth).",{"username":S("GitHub username")},["username"]),
    _fn("github_code_search","Search GitHub code via REST API. Useful to find leaked tokens, internal hostnames, emails. Unauthenticated → rate-limited; queries must include at least one qualifier (e.g. 'extension:env', 'filename:.env', 'org:acme').",{"query":S("GitHub code search query"),"max_results":N("Max results (default 10, cap 30)")},["query"]),

    # ── OSINT image: EXIF, perceptual hash, reverse search ───────────────────
    _fn("exif_extract","Extract EXIF metadata from a local image (camera, datetime, GPS lat/lon, software). Useful to geolocate / fingerprint a photo. Use download_file first if the image is remote.",{"path":S("Local path to the image file")},["path"]),
    _fn("image_phash","Compute 64-bit average hash (aHash) of a local image. Same hash → visually similar (deduplicate, find re-uploads). Use download_file first for remote images.",{"path":S("Local path to the image file")},["path"]),
    _fn("reverse_image_urls","Build ready-to-open reverse-image search URLs (Google Lens, Yandex, TinEye, Bing Visual) for a public image URL.",{"image_url":S("Public HTTPS URL of the image")},["image_url"]),

    # ── OSINT geo / news / entities ──────────────────────────────────────────
    _fn("nominatim_geocode","Forward geocoding via OpenStreetMap Nominatim (place → lat/lon + structured address). Free, no auth.",{"query":S("Address, place name, or POI"),"limit":N("Max results (default 5)")},["query"]),
    _fn("nominatim_reverse","Reverse geocoding via OpenStreetMap Nominatim (lat/lon → address). Useful with EXIF GPS coordinates.",{"lat":N("Latitude"),"lon":N("Longitude")},["lat","lon"]),
    _fn("gdelt_search","Search GDELT 2.0 global news index for articles mentioning the query. Free, covers 100+ languages. timespan examples: '24h', '7d', '1m', '1y'.",{"query":S("News search query"),"max_results":N("Max articles (default 20)"),"timespan":S("Lookback window (default '1m')")},["query"]),
    _fn("recherche_entreprises","French company registry: SIREN/SIRET, dirigeants, NAF code, address. Free public API (api.gouv.fr). Search by name, SIREN, or dirigeant.",{"query":S("Company name, SIREN, or dirigeant name"),"limit":N("Max results (default 5)")},["query"]),
    _fn("wikidata_search","Search Wikidata entities by label → {id, label, description, url}. Useful to pivot from a name to structured facts.",{"query":S("Entity name"),"limit":N("Max results (default 5)"),"lang":S("Language code (default 'en')")},["query"]),

    # ── Image generation ───────────────────────────────────────────────────────
    _fn("generate_image","Generate an image from a text prompt and save it to the workspace.",{"prompt":S("Detailed image description in English for best results"),"path":S("Output file path (optional, auto-named if omitted)"),"model_id":S("Image model ID (optional, default: flux-schnell)"),"size":S("Image size (optional, default: 1024x1024)")},["prompt"]),

    # ── Music generation ───────────────────────────────────────────────────────
    _fn("generate_music","Generate music from a text prompt (Lyria) and save to the workspace.",{"prompt":S("Detailed musical description in English: genre, mood, instruments, tempo. Example: 'upbeat electronic dance track with synth lead and 808 bass at 128 BPM'"),"path":S("Output file path (optional, auto-named .wav if omitted)"),"model_id":S("Music model ID (optional, default: google/lyria-3-clip-preview for 30s clip; use google/lyria-3-pro-preview for full song)")},["prompt"]),

    # ── Video generation ───────────────────────────────────────────────────────
    _fn("generate_video","Generate a video from a text prompt and save it to the workspace.",{"prompt":S("Detailed video description in English"),"path":S("Output file path (optional, auto-named .mp4 if omitted)"),"model_id":S("Video model ID (optional, default: kwaivgi/kling-video-o1)"),"duration":N("Video duration in seconds (default 5, max 15)"),"aspect_ratio":S("Aspect ratio (one of 16:9, 9:16, 1:1; default 16:9)")},["prompt"]),

    # ── HTTP ───────────────────────────────────────────────────────────────────
    _fn("http_request","Generic HTTP request (GET/POST/PUT/DELETE). Use for REST APIs.",{"url":S("URL"),"method":S("HTTP method (default GET)"),"headers":{"type":"object","description":"Request headers (optional)"},"body":S("Raw string body (optional)"),"json_body":{"type":"object","description":"JSON body — use instead of body for JSON APIs (optional)"}},["url"]),
    _fn("download_file","Download a binary file (image, PDF, zip…) from URL to local path.",{"url":S("URL to download"),"path":S("Destination path")},["url","path"]),

    # ── WhatsApp ───────────────────────────────────────────────────────────────
    _fn("whatsapp_send_media","Send media to a WhatsApp chat from a public URL (sidecar downloads then uploads). Use for direct, simple URLs (CDN, raw image host). For Google Images / search-result / referer-protected URLs prefer download_file then whatsapp_send_file. 'to' defaults to current WhatsApp session.",{"url":S("Public URL of the media to send"),"kind":{"type":"string","enum":["image","video","audio","document"],"description":"Media kind"},"caption":S("Optional caption (image/video/document only)"),"to":S("Optional target JID or phone number; defaults to current WhatsApp chat"),"filename":S("Optional filename (document only)"),"mimetype":S("Optional MIME type override")},["url","kind"]),
    _fn("whatsapp_send_file","Send a local file from the agent workspace to a WhatsApp chat. Use after download_file when the URL is protected/redirected (Google Images, gated CDNs), or to send any file already on disk. 'to' defaults to current WhatsApp session.",{"path":S("Workspace-relative or absolute path inside the agent workspace (e.g. 'downloads/img.jpg')"),"kind":{"type":"string","enum":["image","video","audio","document"],"description":"Media kind"},"caption":S("Optional caption (image/video/document only)"),"to":S("Optional target JID or phone number; defaults to current WhatsApp chat"),"filename":S("Optional filename (document only, defaults to basename)"),"mimetype":S("Optional MIME type override")},["path","kind"]),

    # ── Files ──────────────────────────────────────────────────────────────────
    _fn("read_file","Read a local file.",{"path":S("File path")},["path"]),
    _fn("read_file_chunk","Read a large file in chunks (~6000 chars each).",{"path":S("File path"),"chunk":N("Chunk number (1-indexed)")},["path"]),
    _fn("write_file","Write or overwrite a file. Use workspace-relative or absolute path.",{"path":S("File path"),"content":S("Full file content")},["path","content"]),
    _fn("edit_file","Edit a file by replacing exact text. Safer than write_file for existing files.",{"path":S("File path"),"old_str":S("Exact text to replace"),"new_str":S("Replacement text")},["path","old_str","new_str"]),
    _fn("append_to_file","Append text to the end of a file.",{"path":S("File path"),"content":S("Content to append")},["path","content"]),
    _fn("list_dir","List files/directories at a path. Defaults to workspace.",{"path":S("Path to list (optional)"),"depth":N("Depth (default 1)")}),
    _fn("list_dir_images","List image files in a folder and return render-ready paths for inline chat display.",{"path":S("Folder path (optional, defaults to workspace)"),"recursive":B("Scan subfolders recursively (default true)"),"limit":N("Max images to return (default 12, cap 24)")}),
    _fn("grep_files","Search for a pattern in files under a directory.",{"pattern":S("Regex or literal string"),"path":S("Directory or file path"),"file_pattern":S("Glob filter e.g. '*.py' (optional)"),"context_lines":N("Lines of context (default 2)")},["pattern","path"]),

    # ── Generate documents ─────────────────────────────────────────────────────
    _fn("generate_pdf","Generate a PDF file from text/markdown. Use for ANY PDF request.",{"path":S("File path (e.g. guide.pdf or ~/Desktop/guide.pdf)"),"title":S("Document title (optional)"),"content":S("Full document content, markdown supported")},["path","content"]),

    # ── File management ────────────────────────────────────────────────────────
    _fn("glob_files","Find files matching a glob pattern (e.g. '**/*.py', '*.txt').",{"pattern":S("Glob pattern"),"path":S("Base directory (default: workspace)")},["pattern"]),
    _fn("get_file_info","Get file metadata: size, dates, type.",{"path":S("File path")},["path"]),
    _fn("move_file","Move or rename a file/directory.",{"src":S("Source path"),"dst":S("Destination path")},["src","dst"]),
    _fn("copy_file","Copy a file or directory.",{"src":S("Source path"),"dst":S("Destination path")},["src","dst"]),
    _fn("delete_file","Delete a file or directory. ALWAYS ask user confirmation before calling this.",{"path":S("Path to delete")},["path"]),
    _fn("open_file","Open a file or URL with the default system app (Finder, Preview, etc.).",{"path":S("File path or URL")},["path"]),

    # ── System / clipboard ─────────────────────────────────────────────────────
    _fn("get_clipboard","Get current clipboard text content.",{}),
    _fn("set_clipboard","Set clipboard text content.",{"text":S("Text to copy to clipboard")},["text"]),

    # ── Shell ──────────────────────────────────────────────────────────────────
    _fn("run_command","Run a shell command. Ask user confirmation first unless explicitly requested.",{"command":S("Shell command"),"cwd":S("Working directory (optional)")},["command"]),

    # ── Checkpoint / revert ────────────────────────────────────────────────────
    _fn("restore_last_green","Revert all written files to the state of the last GREEN build (build with exit=0). Use when the build was green and you broke it: instead of stacking fixes, restore and resume from the working state. Returns {snapshot, build_idx, restored:[paths], failed:[]}.",{}),
    _fn("list_green_checkpoints","List all green-build snapshots captured during this run (oldest→newest), with build_idx, file count, and timestamp.",{}),

    # ── Subagent ───────────────────────────────────────────────────────────────
    _fn("run_subagent","Delegate a focused sub-task to a subagent with its own tool loop. Use for complex tasks that need isolated execution (research, file generation, web scraping) without cluttering the main context.",{"task":S("Precise description of the sub-task to execute"),"context":S("Relevant context the subagent needs (optional)")},["task"]),

    # ── Plan ───────────────────────────────────────────────────────────────────
    {"type":"function","function":{"name":"set_plan","description":"Declare or update a plan visible to the user. Use ONLY when the task has ≥3 independent observable milestones. Skip for chat, single answers, single edits, 1-2 tool sequences. MAX 6 steps. Each step = milestone, not a tool call. Anchor any temporal step (deadlines, scheduling, due dates) on the latest [NOW] block — never guess the current date.","parameters":{"type":"object","properties":{"steps":{"type":"array","items":{"type":"string"},"minItems":3,"maxItems":6,"description":"Ordered milestones (short labels ≤60 chars). 3-6 items."},"current":{"type":"number","description":"Index of step currently being executed (0-based, default 0)"}},"required":["steps"]}}},

    # ── Memory ─────────────────────────────────────────────────────────────────
    _fn("remember_fact","Save a structured user fact (key/value) to persistent memory.",{"key":S("Fact key"),"value":S("Fact value")},["key","value"]),
    _fn("recall_facts","Read memorized facts. Optionally filter by key. Lists all if no key given.",{"key":S("Fact key to look up (optional, leave empty to list all)")}),
    _fn("remember_note","Save a free-form note/memory (visible in the Library).",{"content":S("Note content (short paragraph)"),"tags":{"type":"array","items":{"type":"string"},"description":"Optional tags"}},["content"]),

    # ── Notifications / Calendar ───────────────────────────────────────────────
    _fn("send_notification","Send a macOS system notification (appears in Notification Center).",{"title":S("Notification title"),"message":S("Notification body")},["title","message"]),
    _fn("notify_user","Push a WhatsApp message. ONLY for alert-mode scheduled tasks (mode='alert') that must stay silent unless a watched condition is met. NEVER call this inside a live WhatsApp conversation — your final reply is auto-sent in the same thread; calling notify_user there is duplicate/noise. In normal report-mode scheduled runs the final message is auto-pushed too; do NOT call this then.",{"text":S("Message body to send to the user")},["text"]),
    _fn("add_reminder","Add a reminder to macOS Reminders. due_date format: 'YYYY-MM-DD HH:MM'.",{"title":S("Reminder title"),"due_date":S("Due date/time (optional, format YYYY-MM-DD HH:MM)"),"notes":S("Additional notes (optional)"),"list_name":S("Reminders list name (default: Reminders)")},["title"]),
    _fn("create_calendar_event","Create an event in macOS Calendar. start/end format: 'YYYY-MM-DD HH:MM'.",{"title":S("Event title"),"start":S("Start date/time (YYYY-MM-DD HH:MM)"),"end":S("End date/time (optional, defaults to start)"),"notes":S("Event notes (optional)"),"calendar":S("Calendar name (optional, uses default)")},["title","start"]),
    _fn("schedule_agent_task","Schedule an agent task to RUN automatically at a future time, optionally repeating. The agent will be invoked with `prompt` at each occurrence; output is stored as runResult and visible in the Library. Use for deferred or recurring actions ('demain à 9h fais X', 'tous les lundis à 9h…', 'every 30 min check Y'). `scheduled_for` is the FIRST run. For recurrence use an RFC-5545 RRULE in `recurrence` (e.g. 'FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO', 'FREQ=HOURLY;INTERVAL=2', 'FREQ=MINUTELY;INTERVAL=30'). Minimum interval is 10 minutes — shorter intervals are rejected. Optionally bound the series with `recurrence_until` (last allowed run, 'YYYY-MM-DD HH:MM') or `recurrence_count` (max runs). `mode` controls notification behavior: 'report' (default) auto-pushes the final message to WhatsApp; 'alert' stays silent unless the agent explicitly calls notify_user — use it for conditional pings ('ping me if BTC > 100k').",{"title":S("Short task title shown in the calendar"),"scheduled_for":S("First run: 'YYYY-MM-DD HH:MM' local time"),"prompt":S("Exact prompt to feed the agent at each run"),"details":S("Optional human-readable notes"),"recurrence":S("Optional RRULE (e.g. 'FREQ=DAILY', 'FREQ=WEEKLY;BYDAY=MO,WE,FR'). Min interval 10 min. Omit for one-shot."),"recurrence_until":S("Optional series end: 'YYYY-MM-DD HH:MM' local time"),"recurrence_count":N("Optional max number of runs"),"mode":{"type":"string","enum":["report","alert"],"description":"'report' (default) auto-notifies; 'alert' silent unless notify_user is called"},"wa_chat_jid":S("WhatsApp JID where the task result must be sent (e.g. '33612345678@s.whatsapp.net' or a group jid). When the task is scheduled from inside a live WhatsApp conversation, this is captured automatically. Pass explicitly to redirect to another chat."),"wa_chat_label":S("Optional human-readable label of the target chat (contact name, group title) — for display only")},["title","scheduled_for","prompt"]),
    _fn("list_agent_tasks","List existing scheduled agent tasks (created via schedule_agent_task or by the user). Returns id (short), title, scheduledFor, recurrence, status, mode. Call BEFORE update_agent_task / cancel_agent_task to find the right id, and BEFORE schedule_agent_task to avoid creating a duplicate.",{"filter":{"type":"string","enum":["active","all","recurring"],"description":"'active' (default) = planned/in_progress · 'recurring' = only RRULE tasks · 'all' = everything including done/cancelled"},"limit":N("Max items (default 30)")}),
    _fn("update_agent_task","Edit an existing scheduled task. Provide its id (full or 8-char prefix from list_agent_tasks). Only the fields you pass are changed. Use to reschedule, change the prompt, switch recurrence, change notification mode, etc.",{"id":S("Task id (full uuid or 8-char prefix)"),"title":S("New title (optional)"),"scheduled_for":S("New first/next run 'YYYY-MM-DD HH:MM' (optional)"),"prompt":S("New agent prompt (optional)"),"details":S("New notes (optional)"),"recurrence":S("New RRULE, or empty string to clear recurrence (optional)"),"recurrence_until":S("New series end 'YYYY-MM-DD HH:MM' or empty to clear (optional)"),"recurrence_count":N("New max runs, or 0 to clear (optional)"),"mode":{"type":"string","enum":["report","alert"],"description":"New notification mode (optional)"},"wa_chat_jid":S("WhatsApp JID to route notifications to (or empty string to clear)"),"wa_chat_label":S("WhatsApp chat label (or empty string to clear)")},["id"]),
    _fn("cancel_agent_task","Cancel/delete a scheduled task by id (full or 8-char prefix). Stops future runs. Irreversible.",{"id":S("Task id (full uuid or 8-char prefix)")},["id"]),
    _fn("get_task_history","Show the last runs of a scheduled task: ok/fail, finishedAt, truncated result. Useful to debug a task or summarize what it found.",{"id":S("Task id (full uuid or 8-char prefix)"),"limit":N("Max history entries (default 5)")},["id"]),

    # ── Skills (auto-learning) ─────────────────────────────────────────────────
    _fn("skill_list","List all available skills (builtin + learned).",{}),
    _fn("skill_search","Search existing skills relevant to a question/topic.",{"query":S("Question or topic")},["query"]),
    _fn("skill_create","Create a persistent skill via web research + distillation + audit. Call when the task requires specialized knowledge (regulation, administrative procedure, non-mainstream technique) AND no existing skill covers it AND the topic may recur. First: call skill_search.",{"name":S("Short kebab-case name (e.g. 'visa-japan-tourist')"),"topic":S("Precise topic description"),"triggers":{"type":"array","items":{"type":"string"},"description":"Keywords/phrases that trigger this skill (5-15)"},"research_queries":{"type":"array","items":{"type":"string"},"description":"2 to 4 web queries to collect sources"}},["name","topic","triggers","research_queries"]),
    _fn("skill_revise","Update an existing skill via new research.",{"name":S("Skill name"),"reason":S("Reason for revision (stale info, new sources)")},["name","reason"]),
    _fn("skill_delete","Delete a learned skill (never a builtin).",{"name":S("Skill name")},["name"]),

    # ── Repo skills (curated GitHub libs/templates — DON'T REINVENT) ───────────
    _fn("repo_skill_list","List the registry of pre-validated GitHub repos / external libs (templates, sprites, audio, 3D, parsers). Before writing 200 lines of code from scratch, check here.",{}),
    _fn("repo_skill_search","Search the curated repo registry for libs/templates that cover a need (e.g. 'sprite rpg', 'react dashboard', 'game sfx', 'pdf parsing').",{"query":S("Need description")},["query"]),
    _fn("repo_skill_show","Show the full sheet of a repo skill (install + usage + notes).",{"name":S("Repo skill name (e.g. 'phaser-game-template')")},["name"]),
    _fn("repo_skill_install","Run the install command of a repo skill in the given cwd (or current cwd). Fails if the snippet contains placeholders (<project>, <dir>) to replace manually.",{"name":S("Repo skill name"),"cwd":S("Working dir (optional, default current cwd)")},["name"]),
    _fn("scaffold_app_fullstack","Scaffold fullstack TS app (NestJS + Prisma + Postgres + React + Redux + Vite + Tailwind). Always use instead of coding an app from scratch.",{"target_dir":S("Absolute path of the project folder to create"),"name":S("Package name (root package.json, default 'my-app')"),"features":{"type":"array","items":{"type":"string"},"description":"List of features among: auth, users, settings, uploads, dashboard, notifications. Empty/absent = skeleton only (just health endpoint). Note: users/settings/uploads/dashboard auto-add auth for JWT."}},["target_dir"]),
    _fn("scaffold_game_2d","Scaffold 2D game project (Phaser 3 + TS + Vite) with engine, audio, save, i18n, sprites, biomes, tests. kit: platformer|metroidvania|topdown-rpg|shmup|puzzle. Always use instead of coding a game from scratch.",{"target_dir":S("Absolute path of the project folder to create"),"kit":S("Genre: platformer | metroidvania | topdown-rpg | shmup | puzzle (default: platformer)"),"biomes":{"type":"array","items":{"type":"string"},"description":"Optional whitelist of biomes among: grass, dirt, stone, sand, cave, metal, snow, lava, ice, water, swamp, desert, forest, mushroom, castle, beach. Filters baked tiles. Empty/absent = all 16. Use when user specifies a setting (lava+ice for 'icy volcano', forest+swamp for 'jungle', etc.)."},"name":S("npm package name (default: 'game-2d-ts'). Also default title."),"title":S("HTML <title> (default: name)."),"tuning":{"type":"object","description":"CONFIG override applied AT SCAFFOLD time (no post-edit needed). Sections+keys: WORLD{VIEW_WIDTH,VIEW_HEIGHT,LEVEL_WIDTH,LEVEL_HEIGHT,GRAVITY,TILE}, PLAYER{SPEED,JUMP_VELOCITY,MAX_FALL_SPEED,COYOTE_TIME_MS,JUMP_BUFFER_MS,LIVES,HIT_INVUL_MS}, ENEMY{PATROL_SPEED,DAMAGE}, CAMERA{LERP,SHAKE_INTENSITY,SHAKE_DURATION_MS,DEADZONE_W,DEADZONE_H}, AUDIO{MASTER_VOLUME,MUSIC_VOLUME,SFX_VOLUME}, PALETTE{BG,PLAYER,ENEMY,PLATFORM,COIN,HUD} (ints, become 0xRRGGBB), DEBUG bool, SAVE_KEY str. Ex: {\"PLAYER\":{\"SPEED\":220,\"JUMP_VELOCITY\":-400},\"WORLD\":{\"GRAVITY\":1100,\"LEVEL_WIDTH\":4800},\"PALETTE\":{\"PLAYER\":16711850}}. Unknown keys → ERROR."}},["target_dir"]),

    # ── Graphics / SVG / 3D / image processing ─────────────────────────────────
    _fn("svg_shape","Generate a clean SVG with a primitive shape (circle, rect, star, polygon, hex-grid, gear, heart, arrow, ribbon). For icons, logos, UI/game elements.",{"kind":S("circle|rect|star|polygon|hex-grid|gear|heart|arrow|ribbon"),"path":S("Output .svg path"),"width":N("Width (default 512)"),"height":N("Height (default 512)"),"fill":S("Fill color hex (default #3b82f6)"),"stroke":S("Stroke color hex (default #0f172a)"),"stroke_width":N("Stroke width (default 2)"),"params":{"type":"object","description":"Kind-specific knobs (radius, points, sides, rows, cols, etc.)"}},["kind","path"]),
    _fn("image_to_svg","Convert a raster image (PNG/JPG) to vectorized SVG. Uses vtracer if available (top quality), otherwise PIL posterize fallback.",{"input_path":S("Source image"),"output_path":S("Output .svg"),"mode":S("color|binary (default color)"),"max_colors":N("Max colors (default 8)")},["input_path","output_path"]),
    _fn("image_to_heightmap_stl","Generate a 3D STL mesh from grayscale image (heightmap). For terrain, relief, low-poly game-dev.",{"input_path":S("Source image"),"output_path":S("Output .stl"),"max_height":N("Max height (default 30)"),"scale":N("XY scale (default 0.5)")},["input_path","output_path"]),
    _fn("extract_palette","Extract the dominant color palette of an image. Returns JSON {hex, weight}.",{"input_path":S("Source image"),"n":N("Number of colors (default 8)")},["input_path"]),
    _fn("resize_image","Resize an image (fit: contain|cover|stretch).",{"input_path":S("Source"),"output_path":S("Output"),"width":N("Width"),"height":N("Height"),"fit":S("contain|cover|stretch (default contain)")},["input_path","output_path","width","height"]),
    _fn("convert_image","Convert an image between formats (png↔jpg↔webp etc.).",{"input_path":S("Source"),"output_path":S("Output (extension determines format)"),"quality":N("JPEG/WebP quality (default 90)")},["input_path","output_path"]),
    _fn("ocr_image","OCR an image via tesseract. Returns extracted text.",{"input_path":S("Image"),"lang":S("Tesseract languages (default eng+fra)")},["input_path"]),
    _fn("image_to_ascii","Convert an image to ASCII text art.",{"input_path":S("Image"),"width":N("Width in chars (default 80)")},["input_path"]),
    _fn("render_ascii_schematic","Render a clean ASCII schematic from a graph spec. Use this for ANY schematic — electronic circuits, P&ID, network topology, plumbing, signal flow, block diagrams. NEVER hand-draw ASCII wires/junctions yourself: this tool does the geometry deterministically and the result always passes structural validation. Output is the ASCII string — wrap it into a rich block `{type:\"ascii\", title, content}` for the final reply.",{"title":S("Diagram title (optional, displayed in the rich block)"),"rails":{"type":"array","items":{"type":"object"},"description":"Optional power/signal rails: [{name:'VCC',side:'top'},{name:'GND',side:'bottom'}]. Two-rail layouts are typical for circuits and P&ID."},"nodes":{"type":"array","items":{"type":"object"},"description":"REQUIRED. Components: [{id:'R1',label:'R1 10kΩ'}, {id:'U1',label:'U1 LM386'}, ...]. Use short ids (R1, C2, U1, LB, DB) and human labels."},"groups":{"type":"array","items":{"type":"array"},"description":"Optional column layout: list of columns, each a list of node ids in vertical order top→bottom. E.g. [['R1','R2','C3'],['C1','U1','SPKR']]. Omit → one node per column."},"edges":{"type":"array","items":{"type":"object"},"description":"Optional horizontal jumpers between columns: [{from:'R2',to:'U1'}]. Vertical chains within a column and connections to rails are AUTOMATIC — only list cross-column connections."}},["nodes"]),
    _fn("generate_spritesheet","Pack multiple images into a PNG spritesheet + JSON meta (frame coords). For game-dev.",{"input_paths":{"type":"array","items":{"type":"string"},"description":"List of frames"},"output_path":S("Output .png"),"cols":N("Columns (default auto)"),"padding":N("Padding px (default 2)"),"bg":S("Background color (default transparent)")},["input_paths","output_path"]),
    _fn("tilemap_render","Render a PNG tilemap from a JSON {tile_w, tile_h, map: [[idx]]} and a tileset.",{"tilemap_json":S("Tilemap JSON path"),"tileset_path":S("Tileset PNG path"),"output_path":S("Output .png")},["tilemap_json","tileset_path","output_path"]),

    # ── Documents / data utility (QR, barcode, vCard, ICS, conversions) ────────
    _fn("qr_code","Generate a QR code (PNG or SVG depending on extension).",{"data":S("Text/URL to encode"),"path":S("Output .png or .svg"),"box_size":N("Box size (default 10)"),"border":N("Border (default 4)"),"fill":S("Color (default #000)"),"back":S("Background (default #fff)")},["data","path"]),
    _fn("barcode_generate","Generate a barcode (code128, ean13, ean8, upc, isbn13). SVG by default, PNG if .png extension.",{"data":S("Data to encode"),"path":S("Output"),"kind":S("code128|ean13|ean8|upc|isbn13 (default code128)")},["data","path"]),
    _fn("vcard_create","Generate a .vcf (vCard 3.0) file to add a contact.",{"path":S("Output .vcf"),"full_name":S("First Last"),"email":S("Email (opt)"),"phone":S("Phone (opt)"),"organization":S("Organization (opt)"),"title":S("Title (opt)"),"url":S("Website (opt)"),"address":S("Address (opt)"),"note":S("Note (opt)")},["path","full_name"]),
    _fn("ics_event_create","Generate an .ics file (importable calendar event). start/end format YYYY-MM-DD HH:MM.",{"path":S("Output .ics"),"title":S("Title"),"start":S("Start YYYY-MM-DD HH:MM"),"end":S("End (opt)"),"location":S("Location (opt)"),"description":S("Description (opt)")},["path","title","start"]),
    _fn("markdown_to_html","Convert a .md file to standalone styled HTML.",{"input_path":S("Source .md"),"output_path":S("Output .html"),"title":S("Page title (opt)")},["input_path","output_path"]),
    _fn("json_to_csv","Convert JSON (array of objects) to CSV.",{"input_path":S("Source .json"),"output_path":S("Output .csv")},["input_path","output_path"]),
    _fn("csv_to_json","Convert CSV to JSON (array of objects).",{"input_path":S("Source .csv"),"output_path":S("Output .json")},["input_path","output_path"]),

    # ── Office: Excel / Word / PowerPoint / advanced PDF / Email ───────────
    _fn("xlsx_create","Create an .xlsx file. sheets: {sheet_name: [[row1], [row2]]} or list of rows.",{"path":S("Output .xlsx"),"sheets":{"description":"Dict {sheet_name: rows} or list of rows"}},["path"]),
    _fn("xlsx_read","Read an .xlsx → JSON. Optional: specific sheet.",{"path":S("Source .xlsx"),"sheet":S("Sheet name (opt)"),"max_rows":N("Max rows (default 1000)")},["path"]),
    _fn("xlsx_write_cells","Write to specific cells. cells: {\"A1\": \"val\", \"B2\": 42, \"C3\": \"=SUM(A1:A10)\"}. Formulas supported.",{"path":S("Existing .xlsx"),"sheet":S("Sheet name"),"cells":{"type":"object","description":"Dict ref→value"}},["path","sheet","cells"]),
    _fn("xlsx_append_rows","Append rows to the end of a sheet (creates file/sheet if needed).",{"path":S(".xlsx"),"sheet":S("Sheet name"),"rows":{"type":"array","items":{"type":"array"},"description":"Rows to append"}},["path","sheet","rows"]),
    _fn("xlsx_to_csv","Export an xlsx sheet to CSV.",{"path":S(".xlsx"),"output_path":S(".csv"),"sheet":S("Sheet (opt)")},["path","output_path"]),
    _fn("docx_create","Create a .docx. Either `paragraphs` (structured list) or `content` markdown-ish (# / ## / ### / - bullet).",{"path":S("Output .docx"),"title":S("Main title (opt)"),"paragraphs":{"type":"array","description":"List of strings or {style, text}"},"content":S("Markdown-ish content (alternative)")},["path"]),
    _fn("docx_read","Extract text from a .docx (paragraphs + tables).",{"path":S(".docx"),"max_chars":N("Max chars (default 12000)")},["path"]),
    _fn("docx_replace","Replace placeholders in a .docx while preserving formatting. Ideal for templated contracts/letters.",{"path":S(".docx"),"replacements":{"type":"object","description":"Dict {{placeholder}}: value"}},["path","replacements"]),
    _fn("pptx_create","Create a .pptx from a list of slides [{title, content}]. content: string or list of bullets.",{"path":S("Output .pptx"),"slides":{"type":"array","items":{"type":"object"},"description":"List of {title, content}"}},["path","slides"]),
    _fn("pptx_read","Extract text from a .pptx (titles + bullets per slide).",{"path":S(".pptx")},["path"]),
    _fn("pdf_extract_text","Extract text from a PDF. pages: '1-3,5' (opt, all by default).",{"path":S("PDF"),"pages":S("Pages '1-3,5' (opt)")},["path"]),
    _fn("pdf_merge","Merge multiple PDFs into one.",{"input_paths":{"type":"array","items":{"type":"string"}},"output_path":S("Output .pdf")},["input_paths","output_path"]),
    _fn("pdf_split","Split a PDF. ranges='1-3,4-6' (opt, otherwise page by page).",{"path":S("Source PDF"),"output_dir":S("Output folder"),"ranges":S("Ranges (opt)")},["path","output_dir"]),
    _fn("pdf_extract_pages","Extract specific pages into a new PDF.",{"path":S("Source PDF"),"pages":S("Pages '1,3-5,8'"),"output_path":S("Output .pdf")},["path","pages","output_path"]),
    _fn("pdf_rotate","Rotate PDF pages (90, 180, 270°).",{"path":S("PDF"),"output_path":S("Output"),"angle":N("90|180|270 (default 90)"),"pages":S("Target pages (opt, all)")},["path","output_path"]),
    _fn("pdf_metadata","PDF metadata (title, author, page count, encrypted...).",{"path":S("PDF")},["path"]),
    _fn("pdf_add_watermark","Add a diagonal text watermark on all pages.",{"path":S("Source PDF"),"output_path":S("Output"),"text":S("Watermark text"),"font_size":N("Size (default 50)"),"opacity":N("Opacity 0-1 (default 0.3)")},["path","output_path","text"]),
    _fn("pdf_encrypt","Password-protect a PDF.",{"path":S("Source PDF"),"output_path":S("Output"),"password":S("User password"),"owner_password":S("Owner password (opt)")},["path","output_path","password"]),
    _fn("eml_create","Create an .eml (importable in Mail/Outlook/Thunderbird) with optional attachments.",{"path":S("Output .eml"),"to":S("Recipient(s)"),"subject":S("Subject"),"body":S("Body"),"from_addr":S("Sender (opt)"),"cc":S("Cc (opt)"),"attachments":{"type":"array","items":{"type":"string"},"description":"Attachments (opt)"}},["path","to","subject","body"]),
    _fn("eml_read","Parse an .eml → JSON {from, to, subject, body, attachments}.",{"path":S(".eml")},["path"]),

    # ── Mail (IMAP/SMTP) ───────────────────────────────────────────────────────
    _fn("mail_list_accounts","List configured mail accounts (id, email, label, indexInKb). Call FIRST before any other mail_* tool to discover account ids.",{}),
    _fn("mail_unread_count","Count unread messages locally. Omit account_id for all accounts.",{"account_id":S("Account id (optional, all if omitted)")}),
    _fn("mail_list","List recent messages from local mail DB. Newest first. Optionally filter unread only.",{"account_id":S("Account id (optional)"),"folder":S("Folder (default INBOX)"),"limit":N("Max items (default 30, max 100)"),"unread_only":{"type":"boolean","description":"Only unread messages"}}),
    _fn("mail_search","Full-text search across local mail (subject + body + sender). Use BEFORE mail_sync if user asks about a known recent thread.",{"query":S("Keyword query"),"account_id":S("Account id (optional)"),"limit":N("Max results (default 20, max 50)")},["query"]),
    _fn("mail_read","Read a single message by id (returns body text, truncated to 6000 chars).",{"message_id":S("Mail message id (from mail_list/mail_search)")},["message_id"]),
    _fn("mail_sync","Fetch new messages from the IMAP server (incremental by UID). Updates local DB. Returns counts.",{"account_id":S("Account id"),"max_messages":N("Max messages to fetch this run (default 200)")},["account_id"]),
    _fn("mail_summarize_inbox","Return a compact JSON summary of the inbox (counts + per-message subject/from/date/unread).",{"account_id":S("Account id (optional)"),"limit":N("Max items (default 20)")}),
    _fn("mail_send","Send an email via SMTP and APPEND a copy to the Sent folder. For a reply, pass in_reply_to + references from the original message.",{"account_id":S("Sender account id"),"to":{"type":"array","items":{"type":"string"},"description":"Recipient addresses"},"subject":S("Subject"),"body":S("Plain-text body"),"cc":{"type":"array","items":{"type":"string"},"description":"Cc recipients (optional)"},"bcc":{"type":"array","items":{"type":"string"},"description":"Bcc recipients (optional)"},"in_reply_to":S("Original Message-Id for threading (optional)"),"references":S("References header (optional)"),"html":S("HTML body (optional)")},["account_id","to"]),
    _fn("mail_flag","Set or remove an IMAP flag (\\Seen, \\Flagged, \\Answered). Use to mark read/unread or star a message.",{"message_id":S("Mail message id"),"flag":S("IMAP flag, e.g. \\Seen, \\Flagged (default \\Seen)"),"remove":{"type":"boolean","description":"Remove the flag instead of adding"}},["message_id"]),
    _fn("mail_move","Move a message to another IMAP folder. Folder must already exist on the server.",{"message_id":S("Mail message id"),"dest_folder":S("Destination folder name")},["message_id","dest_folder"]),
    _fn("mail_archive","Archive a message. Auto-detects the Archive folder per server (Gmail uses [Gmail]/All Mail). Override with `folder` if needed.",{"message_id":S("Mail message id"),"folder":S("Override archive folder name (optional)")},["message_id"]),
    _fn("mail_delete","Move a message to Trash (auto-detected per server, e.g. [Gmail]/Trash).",{"message_id":S("Mail message id")},["message_id"]),
    _fn("mail_label_add","Add a label to a message WITHOUT removing it from its current folder. On Gmail uses native X-GM-LABELS (true labels — message keeps INBOX). On other IMAP servers does an additive COPY to the target folder.",{"message_id":S("Mail message id"),"label":S("Label name (Gmail) or folder name (other servers)")},["message_id","label"]),
    _fn("mail_label_remove","Remove a Gmail label from a message. No-op on non-Gmail servers (use mail_move instead).",{"message_id":S("Mail message id"),"label":S("Label name to remove")},["message_id","label"]),
    _fn("mail_list_folders","List all IMAP folders on the server with their SPECIAL-USE flags. Use before mail_move when destination folder name is unclear.",{"account_id":S("Account id")},["account_id"]),
    _fn("mail_reply","Reply to a message. Auto-fills To/Subject/In-Reply-To/References from the original (server-resolved threading). Set reply_all=true to include Cc + other To recipients. Original body is quoted by default.",{"message_id":S("Original message id"),"body":S("Reply body (plain text)"),"html":S("HTML body (optional)"),"quote_original":{"type":"boolean","description":"Quote original body (default true)"},"reply_all":{"type":"boolean","description":"Include all original recipients (default false)"}},["message_id","body"]),
    _fn("mail_clean_inbox","Triage INBOX with best-practice heuristics. Scans the IMAP server DIRECTLY (works on full mailboxes with 1000s of messages — does NOT require prior mail_sync). Processes ONE BATCH per call (single IMAP session) and returns a mini progress report. Workflow: (1) FIRST call with dry_run=true to preview the plan (counts + per-msg action/reason). (2) THEN call repeatedly with dry_run=false; each call moves up to batch_size messages and returns {batch:{archived,trashed,errors}, remainingInbox, actionable, done, elapsedMs, inboxTotal}. KEEP CALLING while done=false. Use batch_size=100 for large inboxes. Modes: 'safe' (default) leaves recent unread human mail in INBOX; 'aggressive' archives everything except flagged (inbox zero).",{"account_id":S("Account id"),"mode":S("safe|aggressive (default safe)"),"dry_run":{"type":"boolean","description":"Preview only (default true). Set false to apply."},"batch_size":N("Messages to process per apply call (default 25, max 100). Higher = fewer calls but longer per call."),"preview_limit":N("Plan preview size in dry_run mode (default 100, max 500)")},["account_id"]),

    # ── Media / archive / hash (audio, video, zip) ─────────────────────────────
    _fn("audio_extract","Extract the audio track from a video (requires ffmpeg).",{"video_path":S("Source video"),"output_path":S("Audio output"),"codec":S("mp3|aac|opus (default mp3)"),"bitrate":S("Bitrate (default 192k)")},["video_path","output_path"]),
    _fn("audio_convert","Convert an audio file between formats (mp3, wav, ogg, flac, m4a). Requires ffmpeg.",{"input_path":S("Source"),"output_path":S("Output"),"bitrate":S("Bitrate (default 192k)")},["input_path","output_path"]),
    _fn("video_thumbnail","Extract a thumbnail from a video at a timestamp.",{"video_path":S("Video"),"output_path":S("Image output"),"time":S("Timestamp HH:MM:SS (default 00:00:01)")},["video_path","output_path"]),
    _fn("video_to_gif","Convert a video clip to animated GIF.",{"video_path":S("Video"),"output_path":S("Output .gif"),"start":S("Start sec (default 0)"),"duration":S("Duration sec (default 5)"),"fps":N("FPS (default 12)"),"width":N("Width (default 480)")},["video_path","output_path"]),
    _fn("compress_archive","Compress files/folders into .zip or .tar.gz.",{"paths":{"type":"array","items":{"type":"string"},"description":"Paths to include"},"output_path":S("Output archive"),"format":S("zip|tar.gz (default zip)")},["paths","output_path"]),
    _fn("extract_archive","Extract a .zip / .tar.gz / .tar archive.",{"archive_path":S("Source archive"),"output_dir":S("Destination folder")},["archive_path","output_dir"]),
    _fn("file_hash","Compute the cryptographic hash of a file.",{"path":S("File"),"algo":S("md5|sha1|sha256|sha512 (default sha256)")},["path"]),
]

TOOL_NAMES = {t["function"]["name"] for t in TOOLS}


# ── Local-model tools ────────────────────────────────────────────────────────
# Installed on-device models add themselves to the active tool set on the fly.
# Source of truth: monkey/local_models/registry.py. The agent rebuilds its
# tool list whenever `consume_dirty()` returns True (after install/uninstall).
# See monkey/local_models/__init__.py for the design rationale.

def _refresh_local_tools() -> None:
    """Append dynamic tools for installed local models. Idempotent."""
    global TOOLS, TOOL_NAMES, _COMPRESSED_TOOLS, _PACK_TOOLS_CACHE, _TOOL_CATEGORIES, _LOCAL_DYNAMIC_TOOL_NAMES
    try:
        from monkey.local_models import tools as _lmt
        dyn = _lmt.dynamic_tools()
    except Exception:
        return
    dyn_names = {t["function"]["name"] for t in dyn}
    # Drop previously-installed local tools so uninstalls take effect.
    try:
        from monkey.local_models import catalog as _lmc
        all_local_names = {m["tool_name"] for m in _lmc.all_models()}
    except Exception:
        all_local_names = set()
    TOOLS = [t for t in TOOLS if t["function"]["name"] not in all_local_names] + dyn
    TOOL_NAMES = {t["function"]["name"] for t in TOOLS}
    try:
        for n in list(_LOCAL_DYNAMIC_TOOL_NAMES):
            _TOOL_CATEGORIES.pop(n, None)
        _LOCAL_DYNAMIC_TOOL_NAMES.clear()
        task_to_cat = {
            "asr": "media",
            "tts": "media",
            "ocr": "media",
            "image_features": "media",
            "image_classify": "media",
            "image_gen": "image",
            "image_to_3d": "image",
            "embed": "search",
            "rerank": "search",
            "features": "search",
            "ner": "search",
            "lang": "search",
            "sentiment": "search",
            "classify": "search",
        }
        by_name: dict[str, str] = {}
        for spec in _lmc.all_models():
            name = str(spec.get("tool_name") or "").strip()
            task = str(spec.get("task") or "").strip()
            if name and task and name not in by_name:
                by_name[name] = task
        for name in dyn_names:
            category = task_to_cat.get(by_name.get(name, ""), "media")
            _TOOL_CATEGORIES[name] = category
            _LOCAL_DYNAMIC_TOOL_NAMES.add(name)
    except Exception:
        pass
    _COMPRESSED_TOOLS = None  # force re-compress
    _PACK_TOOLS_CACHE = {}


def _maybe_refresh_local_tools() -> None:
    """Cheap check: rebuild only if registry signaled a change."""
    try:
        from monkey.local_models import registry as _lmr
        if _lmr.consume_dirty():
            _refresh_local_tools()
    except Exception:
        pass

# Phrases that indicate the model is hallucinating inability OR faking action.
# English-only by design: most LLMs default to English internals, and the SYSTEM_PROMPT
# already instructs the model to reply in the user's language. Detection here stays
# language-neutral by relying on the small set of English fallback expressions models
# emit when refusing or stalling.
_HALLUCINATION_PHRASES = [
    # Direct refusals
    "i cannot", "i can't", "i'm unable", "i am unable", "i do not have the ability",
    "it's not possible for me", "not possible for me to",
    # Indirect refusal (suggesting workarounds)
    "you can use", "you could try", "alternative method", "online tool",
    "convert it via", "save it as", "copy the text into",
    # Faking action without calling tools
    "i'll generate", "i will generate", "i'll create", "i will create",
    "i'm going to", "let me create", "let me generate", "i am now generating",
    "generation in progress", "i'll open", "i'll run", "i'll proceed",
    "i'm on it",
]

def _fix_hallucination(text: str, tool_results: list[dict], user_message: str = "") -> str:
    """If model claims inability but tools succeeded, replace with honest summary.
    Also catches indirect refusals (suggesting workarounds instead of doing the task)."""
    text_lower = text.lower()
    has_hallucination = any(p in text_lower for p in _HALLUCINATION_PHRASES)

    if has_hallucination and tool_results:
        # Model claims failure but tools ran — override with honest summary
        successes = [r for r in tool_results if r["result"].startswith("OK:")]
        if successes:
            parts = []
            for r in successes:
                name = r["name"]
                result = r["result"]
                if name in ("write_file", "generate_pdf"):
                    parts.append(result.replace("OK: ", ""))
                else:
                    parts.append(f"{name}: {result[:80]}")
            return "Done. " + " ; ".join(parts) + "."

    if has_hallucination and not tool_results:
        # Indirect refusal with no tools called — flag it clearly
        return (
            "Error: the agent suggested workarounds instead of using its tools. "
            "Rephrase the request or specify what you want generated."
        )

    return text


_FABRICATION_MARKERS = (
    "synthetic", "synthétique", "synthetique",
    "estimated values", "estimated data", "valeurs estim",
    "typical climate", "typical values", "valeurs typiques",
    "based on historical averages", "based on averages",
    "placeholder data", "données placeholder", "donnees placeholder",
    "for illustration", "for illustrative purposes", "à titre illustratif",
    "fictif", "fictive", "fictitious",
    "hypothetical data", "données hypothétiques",
    "made up", "simulated values", "valeurs simul",
)


def _looks_fabricated(text: str) -> bool:
    """Detect when the model admits its data is invented while presenting it as an answer."""
    low = (text or "").lower()
    return any(marker in low for marker in _FABRICATION_MARKERS)


# Role-inversion / process-narration markers. Weak models stop answering and
# instead narrate the conversation state, address the user as if THEY ran the
# tools, or thank the user as if the user were the assistant. These phrases have
# no place in a genuine answer, so any one of them flags the reply for rewrite.
_META_NARRATION_MARKERS = (
    # FR — talking ABOUT the user in third person
    "l'utilisateur a terminé", "l'utilisateur a fini", "l'utilisateur a partagé",
    "l'utilisateur cherche", "l'utilisateur souhaite", "l'utilisateur veut",
    "l'utilisateur a trouvé", "l'utilisateur a demandé",
    # FR — narrating agent actions onto the user / process commentary
    "vous avez créé un fichier", "vous avez créé le fichier",
    "vous avez déjà trouvé", "vous pouvez maintenant lister",
    "vous pouvez maintenant consulter", "vous avez trouvé des informations",
    "il semble que vous cherchiez", "il semble que vous avez trouvé",
    "il semble que vous avez besoin", "pas de nouvelles informations à afficher",
    "je peux vous suggérer de consulter", "je peux vous fournir des informations sur",
    # FR — thanking the user (role inversion)
    "merci pour votre aide", "merci de votre aide", "merci pour le partage",
    # EN — same patterns
    "the user has finished", "the user has shared", "the user is looking for",
    "the user wants to", "you have created a file", "you can now list",
    "you have already found", "no new information to display",
    "thank you for your help", "thanks for your help", "thank you for sharing",
)


def _looks_like_meta_narration(text: str) -> bool:
    """Detect when the reply narrates the conversation/process or inverts roles
    (addresses the user as the actor) instead of answering. This is the dominant
    incoherence failure on weak models: a 'random step' shown instead of content."""
    low = (text or "").lower()
    return any(marker in low for marker in _META_NARRATION_MARKERS)


# Coding intent in the ORIGINAL request — if present, code in the answer is legit
# and the code-as-answer guard must stand down.
_CODE_REQUEST_MARKERS = (
    "code", "coder", "script", "fonction", "function", "programme", "program",
    "implémente", "implemente", "implement", "écris un", "ecris un", "write a ",
    "write me", "classe ", "class ", "méthode", "methode", "method", "snippet",
    "regex", "sql", "requête sql", "query", "api ", "endpoint", "compile",
    "debug", "refactor", "bug ", "stack trace", "traceback", "exception",
    "python", "javascript", "typescript", "rust", "golang", "java ", "c++",
    "bash", "shell", "dockerfile", "yaml", "json schema", "algorithme", "algorithm",
)

# Bare-code line signals (no fence). Lines that look like source rather than prose.
_CODE_LINE_RE = re.compile(
    r"^\s*(import\s+\w|from\s+\w+\s+import|def\s+\w+\s*\(|class\s+\w+\s*[:(]|"
    r"return\s|for\s+\w+\s+in\s|while\s+.+:|if\s+.+:|#include|const\s+\w|let\s+\w|"
    r"var\s+\w|function\s+\w|print\s*\(|console\.log|\w+\.\w+\s*\([^)]*\)\s*$|"
    r"\w+\s*=\s*\w+\([^)]*\)\s*$)"
)


def _is_code_as_answer(text: str, user_message: str) -> bool:
    """Detect when the model dumped source code as its final answer to a request
    that was NOT a coding task (e.g. answering 'how to farm frogs' with `import uv;
    uv.init(...)`). Stands down whenever the request itself asked for code, or the
    code is a chart/diagram (handled by their own guards)."""
    if not text:
        return False
    low_req = (user_message or "").lower()
    if any(m in low_req for m in _CODE_REQUEST_MARKERS):
        return False
    low = text.lower()
    # Charts / diagrams have dedicated guards — don't double-fire.
    if "```rich" in low or "```mermaid" in low:
        return False
    # Fenced code block dominating the answer.
    fences = re.findall(r"```(\w*)\r?\n(.*?)```", text, re.S)
    code_fence_chars = 0
    for lang, body in fences:
        if lang.lower() in ("", "text", "txt", "md", "markdown", "rich", "mermaid"):
            continue
        code_fence_chars += len(body)
    prose_chars = len(re.sub(r"```.*?```", "", text, flags=re.S).strip())
    if code_fence_chars > 0 and code_fence_chars >= prose_chars:
        return True
    # Bare code (no fence): majority of non-blank lines look like source.
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) >= 3:
        code_lines = sum(1 for ln in lines if _CODE_LINE_RE.match(ln))
        if code_lines / len(lines) >= 0.5:
            return True
    return False


# FR/EN function words long enough (>=4 chars) to slip past the length filter
# but carrying no topic signal. Excluded from relevance comparison.
_RELEVANCE_STOPWORDS = frozenset((
    "pour", "avec", "dans", "vous", "nous", "cette", "cela", "elle", "leur",
    "leurs", "sont", "fait", "faire", "plus", "moins", "tres", "tres", "comme",
    "mais", "donc", "alors", "aussi", "peut", "veux", "veut", "souhaite",
    "voici", "voila", "quelles", "quel", "quelle", "quels", "penses", "pense",
    "bonnes", "bonne", "bons", "creer", "creé", "creer", "etre", "sera",
    "that", "this", "with", "your", "they", "them", "there", "here", "what",
    "which", "would", "could", "should", "want", "wants", "have", "from",
    "about", "into", "some", "good", "best", "think", "create", "make",
))


def _content_words(s: str) -> set:
    import unicodedata
    norm = unicodedata.normalize("NFKD", (s or "").lower())
    norm = "".join(c for c in norm if not unicodedata.combining(c))
    words = re.findall(r"[a-z0-9]{4,}", norm)
    return {w for w in words if w not in _RELEVANCE_STOPWORDS}


def _is_off_topic_answer(text: str, user_message: str) -> bool:
    """Detect a wholesale topic hallucination: a substantial reply that shares
    NO content word with the request (e.g. asked about an agentic-LLM dataset,
    answered about a Pattaya trip). Deliberately requires ZERO overlap so a
    single shared subject word stands the guard down — false positives must be
    near-impossible since a genuine answer almost always echoes the subject."""
    if not text or len(text.strip()) < 150:
        return False
    u = _content_words(user_message)
    if len(u) < 3:
        return False
    a = _content_words(text)
    if len(a) < 3:
        return False
    return u.isdisjoint(a)


_CIRCUIT_KEYWORDS = (
    "transistor", "résistance", "resistor", "résistor", "capacitor", "condensateur",
    "bjt", "npn", "pnp", "mosfet", "fet", "diode", "op-amp", "opamp", "op amp",
    "lm741", "lm358", "ne555", "2n3055", "mj2955", "bc547", "bc557", "1n4148", "1n4007",
    "speaker", "haut-parleur", "amplificat", "ampli ", "filtre passe", "low-pass", "high-pass",
    "push-pull", "class a", "class ab", "class b", "class d", "polarisation", "biasing",
    "collector", "emitter", "base", "drain", "source mosfet", "gate ",
    "ω/", "kω", "mω", "µf", "uf", "nf", "pf", "ohm",
)


_CHART_CODE_MARKERS = (
    "recharts", "chart.js", "chartjs", "matplotlib", "plotly", "highcharts",
    "<linechart", "<barchart", "<areachart", "<piechart", "responsivecontainer",
    "import react", "from 'recharts'", 'from "recharts"', "plt.plot", "plt.bar",
)

def _is_chart_as_code(text: str) -> bool:
    """Detect when the model emitted a code fence (jsx/tsx/python/...) as a chart
    instead of a `rich` chart block. Triggers a forced retry."""
    if not text:
        return False
    if "```rich" in text:
        return False
    low = text.lower()
    if "```" not in low:
        return False
    return any(m in low for m in _CHART_CODE_MARKERS)


def _loose_json_array(blob: str):
    """Parse a JS array literal that is almost-JSON (unquoted keys, trailing
    commas, line comments, single quotes). Returns a list or None."""
    candidates = [blob]
    s = re.sub(r"//[^\n]*", "", blob)                       # strip // comments
    s = re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', s)  # quote bare keys
    s = re.sub(r",\s*([}\]])", r"\1", s)                    # drop trailing commas
    candidates.append(s)
    candidates.append(s.replace("'", '"'))
    for c in candidates:
        try:
            v = json.loads(c)
            if isinstance(v, list) and v:
                return v
        except Exception:
            continue
    return None


def _salvage_chart_from_code(text: str, user_message: str) -> str:
    """Deterministically convert a recharts/Chart.js JSX/JS code fence into a
    rendered `rich` chart block, reusing the data the model already wrote.

    Weak models keep re-emitting source code even after a forced retry, so we
    extract `data = [...]`, the `<XAxis dataKey>` and each `<Line|Bar|Area
    dataKey/name>` ourselves. Returns a markdown string (prose + ```rich```)
    or '' when nothing parseable is present."""
    if not text:
        return ""
    m = re.search(r"\bdata\s*[:=]\s*\[", text)
    if not m:
        return ""
    start = text.index("[", m.start())
    depth = 0
    end = -1
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i
                break
    if end < 0:
        return ""
    data = _loose_json_array(text[start:end + 1])
    if not data or not all(isinstance(r, dict) for r in data):
        return ""

    low = text.lower()
    kind = "bar" if "<barchart" in low else "area" if "<areachart" in low else "line"

    xm = re.search(r"<XAxis\b[^>]*?dataKey=\{?[\"']([^\"']+)", text, re.S | re.I)
    x_key = xm.group(1) if xm else ""

    series: list[dict] = []
    seen: set[str] = set()
    for tag in re.finditer(r"<(?:Line|Bar|Area)\b(.*?)/?>", text, re.S | re.I):
        attrs = tag.group(1)
        dk = re.search(r"dataKey=\{?[\"']([^\"']+)", attrs)
        if not dk:
            continue
        key = dk.group(1)
        if key == x_key or key in seen:
            continue
        seen.add(key)
        item: dict = {"key": key}
        nm = re.search(r"\bname=\{?[\"']([^\"']+)", attrs)
        if nm:
            item["label"] = nm.group(1)
        col = re.search(r"\bstroke=\{?[\"'](#[0-9A-Fa-f]{3,8})", attrs) or \
              re.search(r"\bfill=\{?[\"'](#[0-9A-Fa-f]{3,8})", attrs)
        if col:
            item["color"] = col.group(1)
        series.append(item)

    keys = list(data[0].keys())
    if not x_key:
        # First field whose values are non-numeric → the category/time axis.
        for k in keys:
            if any(not isinstance(r.get(k), (int, float)) for r in data):
                x_key = k
                break
        x_key = x_key or keys[0]
    if not series:
        series = [{"key": k} for k in keys if k != x_key]
    if not series:
        return ""

    spec = {"type": "chart", "kind": kind, "xKey": x_key, "data": data, "series": series}
    is_french = any(t in (user_message or "").lower() for t in
                    ("graph", "courbe", "graphique", "schéma", "histogramme", "trace", "montre", "génère", "genere"))
    header = "Voici le graphique :" if is_french else "Here is the chart:"
    return f"{header}\n\n```rich\n{json.dumps(spec, ensure_ascii=False)}\n```"


def _loose_json_object(blob: str):
    """Parse an almost-JSON object literal (// or /* */ comments, trailing
    commas, bare keys, single quotes, trailing garbage after the object).
    Returns a dict or None. Mirrors _loose_json_array for object payloads."""
    cleaned = re.sub(r"/\*.*?\*/", "", blob, flags=re.S)      # block comments
    cleaned = re.sub(r"//[^\n]*", "", cleaned)                # line comments
    c2 = re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', cleaned)  # quote bare keys
    c2 = re.sub(r",\s*([}\]])", r"\1", c2)                    # drop trailing commas
    decoder = json.JSONDecoder()
    for candidate in (blob, cleaned, c2, c2.replace("'", '"')):
        s = candidate.strip()
        start = s.find("{")
        if start < 0:
            continue
        try:
            # raw_decode tolerates trailing junk (e.g. a stray ```--- after }).
            value, _end = decoder.raw_decode(s[start:])
            if isinstance(value, dict):
                return value
        except Exception:
            continue
    return None


def _normalize_rich_spec(obj: dict) -> None:
    """Coerce a parsed rich spec in place to what RichBlock.tsx renders.
    Weak models emit alias kinds (`linearea`), per-series `type`, and stray
    top-level fields (`axes`). The frontend tolerates unknown keys but only
    consumes kind in {line,bar,area}, so map aliases and drop noise."""
    t = obj.get("type")
    if t in ("graph", "linechart", "barchart", "areachart"):
        if t != "graph" and not obj.get("kind"):
            obj["kind"] = str(t).replace("chart", "")
        obj["type"] = "chart"
        t = "chart"
    if t != "chart":
        return
    kind = str(obj.get("kind", "")).lower()
    if kind in ("line", "bar", "area"):
        obj["kind"] = kind
    elif kind in ("linearea", "arealine", "composed", "combo", "multi", "mixed"):
        obj["kind"] = "line"   # RichBlock has no composed chart -> line
    elif "bar" in kind:
        obj["kind"] = "bar"
    elif "area" in kind:
        obj["kind"] = "area"
    elif kind:
        obj["kind"] = "line"   # unknown alias -> safe default
    series = obj.get("series")
    if isinstance(series, list):
        for s in series:
            if isinstance(s, dict):
                s.pop("type", None)  # per-series type is not in the schema


_RICH_FENCE_RE = re.compile(r"```rich[ \t]*\r?\n(.*?)```", re.S | re.I)


def _sanitize_rich_blocks(text: str) -> str:
    """Make every ```rich``` block valid, renderable JSON before it leaves the
    agent. Weak models emit rich blocks with JS // comments, trailing commas,
    bare keys, alias kinds and stray fields — all of which make the desktop
    JSON.parse throw and render 'rich/invalid'. Repair deterministically;
    drop the fence entirely if it is unsalvageable rather than leak bad JSON."""
    if not text or "```rich" not in text.lower():
        return text

    def _fix(m: "re.Match") -> str:
        body = m.group(1)
        try:
            obj = json.loads(body)
        except Exception:
            obj = _loose_json_object(body)
        if not isinstance(obj, dict):
            return ""  # unparseable -> drop, don't surface invalid JSON to UI
        _normalize_rich_spec(obj)
        return "```rich\n" + json.dumps(obj, ensure_ascii=False) + "\n```"

    return _RICH_FENCE_RE.sub(_fix, text)


def _is_circuit_as_mermaid(text: str) -> bool:
    """Detect when a rich-block is wrongly using mermaid for an electronic circuit.
    Triggers a forced retry asking for `ascii` schematic instead."""
    if not text or '"type":"diagram"' not in text.replace(" ", ""):
        return False
    low = text.lower()
    return sum(1 for k in _CIRCUIT_KEYWORDS if k in low) >= 2


_BOX_VERT = frozenset("│║┃")
_BOX_HORIZ = frozenset("─═━")
_BOX_JUNCT = frozenset("┬┴├┤┼┌┐└┘╔╗╚╝╠╣╦╩╬┏┓┗┛┣┫┳┻╋")
_VERT_NEIGHBOR_OK = _BOX_VERT | _BOX_JUNCT
_HORIZ_NEIGHBOR_OK = _BOX_HORIZ | _BOX_JUNCT
_ANY_WIRE = _BOX_VERT | _BOX_HORIZ | _BOX_JUNCT

# Junction-anchoring spec: for each junction char, which sides MUST have a
# wire/junction char or a component bracket. Sides: L, R, U, D.
_JUNCT_REQUIRES: dict[str, tuple[str, ...]] = {
    "┬": ("L", "R", "D"),
    "┴": ("L", "R", "U"),
    "├": ("U", "D", "R"),
    "┤": ("U", "D", "L"),
    "┼": ("U", "D", "L", "R"),
    "┌": ("R", "D"),
    "┐": ("L", "D"),
    "└": ("R", "U"),
    "┘": ("L", "U"),
}
_HORIZ_OK_CHARS = _BOX_HORIZ | _BOX_JUNCT | frozenset("[]")
_VERT_OK_CHARS = _BOX_VERT | _BOX_JUNCT

# Generic rail labels — these are NOT components. If you see `[ VCC ]` etc.,
# the model is wrongly boxing a power/signal rail name. Domain-agnostic across
# electronics, P&ID, plumbing, networking.
_RAIL_LABELS = frozenset({
    "vcc", "vdd", "vss", "vee", "v+", "v-", "+v", "-v", "+vcc", "-vcc",
    "gnd", "agnd", "dgnd", "earth", "terre", "masse", "ground",
    "alim", "alimentation", "supply",
})


def _ascii_lint(content: str) -> list[str]:
    """Generic structural linter for ASCII diagrams. Detects orphan wires,
    mixed styles, empty rails. Domain-agnostic — relies only on grid topology."""
    if not content or not content.strip():
        return ["empty content"]
    lines = content.split("\n")
    if len(lines) < 3:
        return ["too few lines (<3) — not a real diagram"]
    width = max(len(l) for l in lines)
    grid = [l.ljust(width) for l in lines]
    issues: list[str] = []

    # Mixed-style check: ASCII corners/pipes mixed with box-drawing
    ascii_pipe_rows = [r + 1 for r, l in enumerate(lines) if "|" in l]
    ascii_corner_rows = [r + 1 for r, l in enumerate(lines) if "+" in l and ("-" in l or "|" in l)]
    has_unicode = any(ch in cell for cell in lines for ch in "─│┌┐└┘├┤┬┴┼")
    if ascii_pipe_rows and has_unicode:
        issues.append(
            f"mixed wire styles: ASCII `|` on lines {ascii_pipe_rows[:3]} + box-drawing `│` elsewhere. Use ONLY box-drawing chars (`│ ─ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`)."
        )
    if ascii_corner_rows and has_unicode:
        issues.append(
            f"mixed corner styles: ASCII `+-+` on lines {ascii_corner_rows[:3]} + box-drawing elsewhere. Replace every `+` with `┌ ┐ └ ┘ ┬ ┴ ├ ┤ ┼` as appropriate, every `-` with `─`."
        )

    # Orphan vertical: │ with neither vertical nor junction directly above AND below
    orphans: list[tuple[int, int]] = []
    total_vert = 0
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch in _BOX_VERT:
                total_vert += 1
                above = grid[r - 1][c] if r > 0 else " "
                below = grid[r + 1][c] if r + 1 < len(grid) else " "
                if above not in _VERT_NEIGHBOR_OK and below not in _VERT_NEIGHBOR_OK:
                    orphans.append((r + 1, c + 1))
    if len(orphans) > 3:
        sample = ", ".join(f"L{r}C{c}" for r, c in orphans[:5])
        issues.append(
            f"{len(orphans)} orphan vertical wires `│` with nothing connecting above/below ({sample}). Every `│` must touch another `│` or a junction (`┬ ┴ ├ ┤ ┼ ┌ ┐ └ ┘`)."
        )

    # Long empty rails: a column of │ with no horizontal branches for 6+ consecutive rows
    if total_vert >= 6 and width > 0:
        for c in range(width):
            run = 0
            longest_run = 0
            for r in range(len(grid)):
                if grid[r][c] in _BOX_VERT:
                    # check if this row has any horizontal branch at this column
                    left = grid[r][c - 1] if c > 0 else " "
                    right = grid[r][c + 1] if c + 1 < width else " "
                    if left in _HORIZ_NEIGHBOR_OK or right in _HORIZ_NEIGHBOR_OK:
                        longest_run = max(longest_run, run)
                        run = 0
                    else:
                        run += 1
                else:
                    longest_run = max(longest_run, run)
                    run = 0
            longest_run = max(longest_run, run)
            if longest_run >= 6:
                issues.append(
                    f"column {c + 1} has a {longest_run}-row vertical wire with NO components or branches. That is an empty rail — add components or shorten it."
                )
                break

    # Component density: at least 2 `[ ... ]` boxes expected for any non-trivial diagram
    import re as _re
    component_count = len(_re.findall(r"\[[^\[\]\n]{2,}\]", content))
    if component_count < 2:
        issues.append(
            f"only {component_count} component box `[ ... ]` detected. Real schematics need labeled components — use `[ R1 10kΩ ]`, `[ C1 10µF ]`, `[ U1 LM386 ]` etc."
        )

    # D1: rail/signal name boxed as if it were a component
    rail_boxed: list[str] = []
    for m in _re.finditer(r"\[\s*([^\[\]\n]{1,20})\s*\]", content):
        label = m.group(1).strip().lower()
        # strip trailing units / values like "vcc +12v"
        head = label.split()[0] if label else ""
        if head in _RAIL_LABELS or label in _RAIL_LABELS:
            rail_boxed.append(m.group(1).strip())
    if rail_boxed:
        sample = ", ".join(f"`{x}`" for x in rail_boxed[:4])
        issues.append(
            f"rail/signal name(s) {sample} placed inside `[ ... ]` boxes. Rails are horizontal lines with junctions (`VCC ─┬───┬──`), NOT boxed components. Boxes are for parts (R, C, Q, U…)."
        )

    # Box-interior pass-through (shared by D3 + D2): cells inside `[...]` act as
    # vertical wires for connectivity/anchor purposes.
    box_pass = [[False] * width for _ in grid]
    for r, row in enumerate(grid):
        s = "".join(row)
        for m in _re.finditer(r"\[([^\[\]\n]{1,40})\]", s):
            for c in range(m.start() + 1, m.end() - 1):
                box_pass[r][c] = True

    # D3: junction chars without the required anchor neighbors
    bad_junct: list[str] = []
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch not in _JUNCT_REQUIRES:
                continue
            missing: list[str] = []
            for side in _JUNCT_REQUIRES[ch]:
                if side == "L":
                    nb = grid[r][c - 1] if c > 0 else " "
                    if nb not in _HORIZ_OK_CHARS:
                        missing.append("L")
                elif side == "R":
                    nb = grid[r][c + 1] if c + 1 < width else " "
                    if nb not in _HORIZ_OK_CHARS:
                        missing.append("R")
                elif side == "U":
                    nb = grid[r - 1][c] if r > 0 else " "
                    if nb not in _VERT_OK_CHARS and not (r > 0 and box_pass[r - 1][c]):
                        missing.append("U")
                elif side == "D":
                    nb = grid[r + 1][c] if r + 1 < len(grid) else " "
                    if nb not in _VERT_OK_CHARS and not (r + 1 < len(grid) and box_pass[r + 1][c]):
                        missing.append("D")
            if missing:
                bad_junct.append(f"`{ch}`@L{r+1}C{c+1} missing {'+'.join(missing)}")
    if len(bad_junct) >= 2:
        sample = "; ".join(bad_junct[:5])
        issues.append(
            f"{len(bad_junct)} junction(s) without proper anchors: {sample}. Each junction char must have wires on all its sides (`┬` needs L+R+D, `├` needs U+D+R, `┼` needs all four, etc.). Floating junctions = broken topology."
        )

    # D2: disconnected sub-diagrams via 4-connected component analysis.
    # Box-interior cells (precomputed above) act as vertical pass-throughs.
    def _is_node(r: int, c: int) -> bool:
        ch = grid[r][c]
        return ch in _ANY_WIRE or ch in "[]" or box_pass[r][c]

    seen = [[False] * width for _ in grid]
    components: list[int] = []
    for r in range(len(grid)):
        for c in range(width):
            if seen[r][c] or not _is_node(r, c):
                continue
            stack = [(r, c)]
            size = 0
            while stack:
                y, x = stack.pop()
                if y < 0 or x < 0 or y >= len(grid) or x >= width:
                    continue
                if seen[y][x] or not _is_node(y, x):
                    continue
                seen[y][x] = True
                size += 1
                # box-interior only propagates vertically (a box is not a horizontal wire)
                if box_pass[y][x] and grid[y][x] not in _ANY_WIRE and grid[y][x] not in "[]":
                    stack.extend([(y + 1, x), (y - 1, x)])
                else:
                    stack.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])
            if size >= 4:
                components.append(size)
    if len(components) >= 2:
        components.sort(reverse=True)
        issues.append(
            f"{len(components)} disconnected sub-diagrams (sizes {components[:5]}). A schematic is ONE connected graph — every node must reach every other through wires. Merge the pieces or remove orphans."
        )

    return issues


def _failing_ascii_diagnostics(text: str) -> str | None:
    """Scan every ascii rich-block in `text`. Return a diagnostics string of the
    first block with structural problems, or None if all blocks pass."""
    if '"type":"ascii"' not in text.replace(" ", ""):
        return None
    import re as _re
    for m in _re.finditer(r"```rich\s*\n(.*?)```", text, flags=_re.DOTALL):
        body = m.group(1).strip()
        try:
            obj = json.loads(body)
        except Exception:
            continue
        if not isinstance(obj, dict) or obj.get("type") != "ascii":
            continue
        content = obj.get("content") or ""
        if not isinstance(content, str):
            continue
        issues = _ascii_lint(content)
        if issues:
            lines = "\n".join(f"- {i}" for i in issues[:6])
            preview = content[:600]
            return f"{lines}\n--- your diagram ---\n{preview}"
    return None


def _strip_leaked_audit_blocks(text: str) -> str:
    """Remove leaked ```json {"ok":...,"issues":...}``` audit blobs and bare repeated
    {"ok":...,"issues":...} lines that the model sometimes mirrors from audit history."""
    if not text:
        return text
    import re as _re
    # Remove ```json fenced audit blocks
    def _is_audit_obj(body: str) -> bool:
        b = body.strip()
        if not (b.startswith("{") and b.endswith("}")):
            return False
        try:
            o = json.loads(b)
        except Exception:
            return False
        if not isinstance(o, dict):
            return False
        keys = set(o.keys())
        return "ok" in keys and ("issues" in keys or "verdict" in keys or "final_answer" in keys)

    def _fence_repl(m: _re.Match) -> str:
        body = m.group(1)
        return "" if _is_audit_obj(body) else m.group(0)

    out = _re.sub(r"```json\s*\n?(.*?)\n?```", _fence_repl, text, flags=_re.DOTALL)
    # Remove bare standalone audit JSON lines (one per line, possibly repeated)
    out = _re.sub(r'(?m)^\s*\{"ok"\s*:\s*(?:true|false)\s*,\s*"issues"\s*:\s*\[[^\]]*\]\s*\}\s*$\n?', '', out)
    # Collapse runs of blank lines created by removals
    out = _re.sub(r'\n{3,}', '\n\n', out)
    return out.strip()


def _strip_leaked_tool_call_json(text: str) -> str:
    """Remove leaked OpenAI-style tool-call objects from a final prose reply.

    Weak models (small llamas, mistral-3-3b) sometimes append a literal
    `{"name": "write_file", "parameters": {...}}` to their final answer instead
    of issuing it as a tool call. Strip any such object whose `name` is a real
    tool, fenced or bare. Legit user-requested JSON is preserved (its top-level
    object won't carry a tool name + parameters/arguments shape)."""
    if not text or '"name"' not in text:
        return text
    spans: list[tuple[int, int]] = []
    i = 0
    n = len(text)
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        # Brace-scan to the matching close (string-aware).
        depth = 0
        j = i
        in_str = False
        esc = False
        while j < n:
            c = text[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        break
            j += 1
        if depth != 0:
            break  # unbalanced — leave the rest untouched
        chunk = text[i:j + 1]
        try:
            obj = json.loads(chunk)
        except Exception:
            obj = None
        if (isinstance(obj, dict)
                and isinstance(obj.get("name"), str)
                and obj.get("name") in TOOL_NAMES
                and ("parameters" in obj or "arguments" in obj)):
            spans.append((i, j + 1))
        i = j + 1
    if not spans:
        return text
    out = []
    prev = 0
    for s, e in spans:
        out.append(text[prev:s])
        prev = e
    out.append(text[prev:])
    import re as _re
    cleaned = "".join(out)
    # Drop an orphan ```json fence left wrapping a removed block.
    cleaned = _re.sub(r"```(?:json)?\s*```", "", cleaned)
    cleaned = _re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


_REASONING_PREAMBLE_RE = None
def _strip_reasoning_preamble(text: str) -> str:
    """Strip leading reasoning leaks like 'Alright, the user asked...', 'The system message says:'.
    Only trims at the very start, before any markdown/prose/rich block."""
    if not text:
        return text
    import re as _re
    global _REASONING_PREAMBLE_RE
    if _REASONING_PREAMBLE_RE is None:
        # Match leading paragraph(s) that start with classic reasoning openers
        _REASONING_PREAMBLE_RE = _re.compile(
            r'^\s*(?:'
            r'(?:Alright|Okay|Ok|So|Well|Hmm|Let me|Let\'s|First[,]?|The user (?:asked|wants|is asking)|'
            r'The system (?:message|prompt) says|I (?:need to|should|will|first|then)|'
            r'My (?:plan|approach|task)|Looking at|Based on the|To answer|'
            r'Now,? (?:I|let)|Given (?:the|that))\b[^\n]*\n+'
            r')+',
            _re.IGNORECASE,
        )
    stripped = _REASONING_PREAMBLE_RE.sub('', text, count=1)
    return stripped.lstrip() if stripped else text


def _looks_like_audit_json(text: str) -> bool:
    """Detect when the model leaked a JSON object as the user-facing reply.
    User-facing replies must be prose (with optional ```rich``` blocks). Any reply whose
    visible content is dominated by a raw JSON object or ```json``` code fence is bad UX."""
    s = (text or "").strip()
    if not s:
        return False
    # Reply dominated by a ```json``` fence (regardless of inner keys) → bad.
    low = s.lower()
    if low.startswith("```json"):
        # If non-json content outside the fence is negligible, treat as JSON dump.
        end_fence = s.find("```", 7)
        if end_fence == -1:
            return True
        outside = (s[end_fence + 3:]).strip()
        if len(outside) < 40:
            return True
    # Strip ```json or ``` fences for plain detection.
    if s.startswith("```"):
        s2 = s.strip("`")
        if s2.lower().startswith("json"):
            s2 = s2[4:].strip()
        s = s2.strip()
    if not (s.startswith("{") and s.endswith("}")):
        return False
    try:
        obj = json.loads(s)
    except Exception:
        return False
    if not isinstance(obj, dict):
        return False
    audit_keys = {"ok", "issues", "final_answer", "deliverable", "verdict"}
    return any(k in obj for k in audit_keys)


def _ensure_non_empty_final(messages: list[dict], user_message: str, model_id: str | None,
                            text: str, tool_results: list[dict]) -> str:
    out = _ensure_non_empty_final_impl(messages, user_message, model_id, text, tool_results)
    return _sanitize_rich_blocks(out) if isinstance(out, str) else out


def _ensure_non_empty_final_impl(messages: list[dict], user_message: str, model_id: str | None,
                                 text: str, tool_results: list[dict]) -> str:
    text = _strip_leaked_audit_blocks(text or "")
    text = _strip_leaked_tool_call_json(text)
    text = _strip_reasoning_preamble(text)
    final = _fix_hallucination(text, tool_results, user_message).strip()
    image_block = _images_markdown_from_tool_results(tool_results, user_message)
    if image_block and "![" not in final:
        final = f"{final}\n\n{image_block}".strip() if final else image_block
    if final and _looks_fabricated(final):
        # Model dressed synthetic/estimated data as the real answer. Force an honest rewrite.
        retry_messages = list(messages) + [{
            "role": "user",
            "content": (
                "Your previous reply presents invented or estimated data as if it were real data the user asked for. "
                "That is not acceptable. Reply NOW with a short honest message: state plainly that you could not obtain real data, "
                "name the obstacle in one phrase, and suggest one concrete alternative (different source, narrower scope, or what you'd need from the user). "
                "No fabricated values. No JSON wrapper. No tool calls. Prose only, in the user's language."
            ),
        }]
        try:
            retry = _call_llm_guarded(retry_messages, model_id, [])
            rt = (retry.get("text") or "").strip()
            rt = _fix_hallucination(rt, tool_results, user_message).strip()
            if rt and not _looks_fabricated(rt) and not _looks_like_audit_json(rt):
                return rt
        except Exception:
            pass
        return "I could not obtain the real data you asked for. Tell me a preferred source or a narrower request and I'll retry."
    if final and _looks_like_meta_narration(final):
        # Model narrated the process / inverted roles instead of answering.
        # Force a direct answer that uses what was already gathered.
        retry_messages = list(messages) + [{
            "role": "user",
            "content": (
                "Your previous reply did NOT answer. It narrated the conversation or addressed me as if I had "
                "performed the actions (e.g. 'you created a file', 'the user has finished', 'thank you for your help'). "
                "Reply NOW with the actual answer to my original request, using the information already gathered above. "
                "Speak directly TO me. Do NOT mention 'the user', do NOT thank me, do NOT describe what you or I did or "
                "could do next, do NOT suggest I go read a website myself. Give the substantive content. Prose in my language."
            ),
        }]
        try:
            retry = _call_llm_guarded(retry_messages, model_id, [])
            rt = (retry.get("text") or "").strip()
            rt = _strip_reasoning_preamble(rt)
            rt = _fix_hallucination(rt, tool_results, user_message).strip()
            if (rt and not _looks_like_meta_narration(rt)
                    and not _looks_fabricated(rt) and not _looks_like_audit_json(rt)):
                final = rt
        except Exception:
            pass
    if final and _is_code_as_answer(final, user_message):
        # Model dumped source code as the answer to a non-coding question.
        retry_messages = list(messages) + [{
            "role": "user",
            "content": (
                "Your previous reply was source code, but I did NOT ask for code. "
                "Answer my original request in plain prose, in my language, using the information already "
                "gathered above. Explain the actual content. Do NOT output code, do NOT output a code fence, "
                "do NOT invent commands or APIs."
            ),
        }]
        try:
            retry = _call_llm_guarded(retry_messages, model_id, [])
            rt = (retry.get("text") or "").strip()
            rt = _strip_reasoning_preamble(rt)
            rt = _fix_hallucination(rt, tool_results, user_message).strip()
            if (rt and not _is_code_as_answer(rt, user_message)
                    and not _looks_like_meta_narration(rt)
                    and not _looks_fabricated(rt) and not _looks_like_audit_json(rt)):
                final = rt
        except Exception:
            pass
    if final and _is_off_topic_answer(final, user_message):
        # Whole-topic hallucination: the reply is about something else entirely.
        retry_messages = list(messages) + [{
            "role": "user",
            "content": (
                "Your previous reply was about a COMPLETELY different topic and did not address my request at all. "
                "Re-read my original message above and answer THAT, in my language, using the information already "
                "gathered. Do NOT invent an unrelated task, trip, or scenario. Stay strictly on my actual subject."
            ),
        }]
        try:
            retry = _call_llm_guarded(retry_messages, model_id, [])
            rt = (retry.get("text") or "").strip()
            rt = _strip_reasoning_preamble(rt)
            rt = _fix_hallucination(rt, tool_results, user_message).strip()
            if (rt and not _is_off_topic_answer(rt, user_message)
                    and not _looks_like_meta_narration(rt)
                    and not _looks_fabricated(rt) and not _looks_like_audit_json(rt)):
                final = rt
        except Exception:
            pass
    if final and _is_chart_as_code(final):
        # Deterministic salvage first: weak models re-emit JSX even after the
        # retry, so parse the data they already wrote into a rendered rich block.
        salvaged = _salvage_chart_from_code(final, user_message)
        if salvaged:
            return salvaged
        retry_messages = list(messages) + [{
            "role": "user",
            "content": (
                "Your previous reply emitted source code (recharts/Chart.js/matplotlib/...) instead of a rendered chart. "
                "The user wants the chart RENDERED in chat, not a code template. "
                "Reply NOW with: (1) 1-2 sentences of prose, (2) a single ```rich``` fenced JSON block: "
                "`{\"type\":\"chart\",\"kind\":\"line|bar|area\",\"title\":\"...\",\"xKey\":\"...\",\"yUnit\":\"...\",\"data\":[{...},...],\"series\":[{\"key\":\"...\",\"label\":\"...\"}]}`. "
                "If you don't have real data: call `fetch_page` on a public JSON API first (CoinGecko `/api/v3/coins/<id>/market_chart?vs_currency=usd&days=90`, Binance, Open-Meteo, World Bank, etc.), then emit the rich block with REAL points. "
                "NO placeholder data, NO `// ... more data` comments, NO code fence other than ```rich```."
            ),
        }]
        try:
            retry = _call_llm_guarded(retry_messages, model_id, [])
            retry_text = (retry.get("text") or "").strip()
            retry_text = _fix_hallucination(retry_text, tool_results, user_message).strip()
            if retry_text and not _looks_like_audit_json(retry_text):
                if _is_chart_as_code(retry_text):
                    salvaged = _salvage_chart_from_code(retry_text, user_message)
                    if salvaged:
                        return salvaged
                else:
                    final = retry_text
        except Exception:
            pass
    if final and _is_circuit_as_mermaid(final):
        retry_messages = list(messages) + [{
            "role": "user",
            "content": (
                "Your previous reply used a Mermaid `diagram` block for an electronic circuit. Mermaid renders as colored boxes — unreadable for circuits. "
                "Reply NOW with the SAME content but rewrite the rich block as `{\"type\":\"ascii\",\"title\":\"...\",\"content\":\"...\"}`. "
                "`content` is a monospace ASCII schematic using box-drawing chars (─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼) and ASCII symbols. "
                "Wires: `──` horizontal, `│` vertical. Components: `[ R 1kΩ ]`, `═══` for capacitor, `─▶├─` for diode, `(V)` source, `─┴─ GND` ground, `[Q1 NPN]` for transistor. "
                "Escape newlines as \\n. Preserve all spaces — they hold the grid alignment. Keep the narrative prose before the block."
            ),
        }]
        try:
            retry = _call_llm_guarded(retry_messages, model_id, [])
            retry_text = (retry.get("text") or "").strip()
            retry_text = _fix_hallucination(retry_text, tool_results, user_message).strip()
            if retry_text and not _is_circuit_as_mermaid(retry_text) and not _looks_like_audit_json(retry_text):
                final = retry_text
        except Exception:
            pass
    if final:
        ascii_err = _failing_ascii_diagnostics(final)
        if ascii_err:
            retry_messages = list(messages) + [{
                "role": "user",
                "content": (
                    "Your previous ASCII schematic is structurally broken — you hand-drew it instead of using the tool. "
                    "STOP hand-drawing. Call the `render_ascii_schematic` tool with a node/edge spec, then wrap its returned text in the ascii rich block. "
                    "The tool draws the geometry deterministically and is guaranteed to pass structural validation. "
                    "Spec format: `{rails:[{name,side}], nodes:[{id,label}], groups:[[id,id,...],[id,...]], edges:[{from,to}]}`. "
                    "Vertical chains within a column and rail connections are automatic — only list cross-column edges.\n\n"
                    f"DEFECTS DETECTED:\n{ascii_err}"
                ),
            }]
            try:
                retry = _call_llm_guarded(retry_messages, model_id, [])
                retry_text = (retry.get("text") or "").strip()
                retry_text = _fix_hallucination(retry_text, tool_results, user_message).strip()
                if retry_text and not _looks_like_audit_json(retry_text):
                    # Accept retry even if still imperfect — second pass usually beats first.
                    final = retry_text
            except Exception:
                pass
    if final and not _looks_like_audit_json(final):
        return final
    if final and _looks_like_audit_json(final):
        # Model dumped audit JSON instead of a user-facing reply. Force a prose rewrite.
        retry_messages = list(messages) + [{
            "role": "user",
            "content": (
                "Your previous reply was raw JSON. That is NOT a valid user-facing answer. "
                "Reply NOW with natural prose in the user's language summarizing what you found. "
                "If the user asked for a chart/graph/table and you have data, include a ```rich``` fenced JSON block (chart/table/card/alert schema). "
                "NEVER wrap the final reply in JSON. NO audit-style {\"ok\":..., \"issues\":...} object. No tool calls."
            ),
        }]
        try:
            retry = _call_llm_guarded(retry_messages, model_id, [])
            retry_text = _fix_hallucination((retry.get("text") or "").strip(), tool_results, user_message).strip()
            if retry_text and not _looks_like_audit_json(retry_text):
                return retry_text
        except Exception:
            pass
        # Last-resort: unwrap final_answer.summary if present
        try:
            s = final
            if s.startswith("```"):
                s = s.strip("`")
                if s.lower().startswith("json"):
                    s = s[4:].strip()
            obj = json.loads(s)
            fa = obj.get("final_answer") if isinstance(obj, dict) else None
            if isinstance(fa, dict):
                summary = fa.get("summary") or fa.get("answer") or fa.get("text")
                if isinstance(summary, str) and summary.strip():
                    return summary.strip()
            issues = obj.get("issues") if isinstance(obj, dict) else None
            if isinstance(issues, list) and issues:
                return "I could not fully complete the request. Reason(s): " + "; ".join(str(i) for i in issues)
        except Exception:
            pass
        return "Could not produce a useful answer. Try again in one sentence."

    # Empty final + no tool results = honest failure. Do NOT prompt for prose-only
    # retry — that forces the model to fabricate from training data (Alan Turing
    # paragraph instead of search_web call). Surface the failure honestly.
    for result in reversed(tool_results):
        output = str(result.get("result") or "").strip()
        if output.startswith("OK:"):
            return output[3:].strip() or "Done."

    return "Could not produce a useful answer. Try again in one sentence."


def _format_terminal_audit_failure(text: str, issues: list[str]) -> str:
    issues = [str(issue).strip() for issue in (issues or []) if str(issue).strip()]
    issues_blob = "; ".join(issues[:3]) or "audit_unparseable"
    body = (text or "").strip()
    if body:
        return f"ERREUR: self-audit failed ({issues_blob}). Best current result below.\n\n{body}"
    return f"ERREUR: self-audit failed ({issues_blob})."


_DIRECT_ACTION_RETURN_TOOLS = frozenset({
    "add_reminder", "remember_fact", "remember_note",
    "recall_facts",
    "read_file", "list_dir", "glob_files",
    "write_file", "download_file",
    "skill_list", "skill_search",
    "search_web", "search_and_read", "fetch_page", "http_request", "search_images",
    "run_command", "generate_image",
    # Scheduling is terminal: once the task is created it's done. Returning after
    # the first forced call stops weak 3B models from re-calling schedule_agent_task
    # 4× (duplicate tasks + ~56s). Deterministic builders cover relative/recurring
    # wording; this catches absolute one-shots ("tomorrow at 9h") the LLM still emits.
    "schedule_agent_task",
})


def _finalize_direct_action_result(tool_name: str, tool_result: str) -> str:
    text = (tool_result or "").strip()
    if not text:
        return "Done."
    if tool_name == "generate_image":
        path_match = re.search(r"->\s*(\S+\.(?:png|jpg|jpeg|webp))", text)
        return f"![image]({path_match.group(1)})" if path_match else text
    if tool_name in {"write_file", "download_file", "add_reminder", "remember_fact", "remember_note"} and text.startswith("OK:"):
        return text[3:].strip() or "Done."
    return text


def _try_deterministic_run_command_args(user_message: str, workspace: str) -> dict | None:
    import shlex

    msg = (user_message or "").strip()
    if not msg:
        return None
    if _looks_like_app_open_request(msg):
        return {"command": "open -a Calculator", "cwd": workspace}
    if _looks_like_base64_request(msg):
        quoted = re.findall(r"[\"'`“”]([^\"'`“”]+)[\"'`“”]", msg)
        payload = quoted[0] if quoted else ""
        if payload:
            py = "import base64,sys;print(base64.b64encode(sys.argv[1].encode()).decode())"
            return {"command": f"python3 -c {shlex.quote(py)} {shlex.quote(payload)}", "cwd": workspace}
    if _looks_like_directory_create_request(msg):
        m = re.search(
            r"\b(?:named|called|nomm[ée]|nomme|appel[ée]|appele)\s+['\"`]?([A-Za-z0-9_.-]+)['\"`]?",
            msg,
            re.I,
        )
        name = (m.group(1) if m else msg.split()[-1]).strip("`'\".,;:!?")
        if name:
            return {"command": f"mkdir -p {shlex.quote(name)}", "cwd": workspace}
    command = _extract_requested_shell_command(msg)
    if command:
        return {"command": command, "cwd": workspace}
    if _RAW_SHELL_RE.search(msg):
        return {"command": msg, "cwd": workspace}
    return None


def _try_deterministic_glob_files_args(user_message: str, workspace: str) -> dict | None:
    msg = (user_message or "").lower()
    if "pdf" in msg:
        return {"pattern": "**/*.pdf", "path": workspace}
    return None


def _try_deterministic_recall_facts_args(user_message: str) -> dict | None:
    if _looks_like_memory_recall_request(user_message):
        return {"key": ""}
    return None


def _try_deterministic_fetch_page_args(user_message: str) -> dict | None:
    msg = (user_message or "").strip()
    if not _looks_like_fetch_page_request(msg):
        return None
    urls = _extract_literal_urls(msg)
    if not urls:
        return None
    return {"url": urls[0], "max_chars": 12000}


def _try_deterministic_http_request_args(user_message: str) -> dict | None:
    msg = (user_message or "").strip()
    if not _looks_like_http_request(msg):
        return None
    urls = _extract_literal_urls(msg)
    if not urls:
        return None
    method_match = re.search(r"\b(GET|POST|PUT|DELETE|PATCH)\b", msg, re.I)
    method = (method_match.group(1).upper() if method_match else "GET")
    return {"url": urls[0], "method": method}


def _try_deterministic_search_web_args(user_message: str) -> dict | None:
    msg = (user_message or "").strip()
    if not _looks_like_general_web_search_request(msg):
        return None
    query = _build_forced_web_query(msg)
    if not query:
        return None
    return {"query": query, "max_results": 3}


def _try_deterministic_search_images_args(user_message: str) -> dict | None:
    msg = (user_message or "").strip()
    if not _looks_like_image_search_request(msg):
        return None
    query = re.sub(r"^(?:search|find|show(?: me)?|cherche|trouve)\s+", "", msg, flags=re.I)
    query = re.sub(r"\b(?:images?|pictures?|photos?)\b(?:\s+of)?", "", query, count=1, flags=re.I)
    query = re.sub(r"\s+", " ", query).strip(" .,;:!?-—")
    if not query:
        return None
    return {"query": query, "max_results": 5}


def _try_deterministic_set_plan_args(user_message: str) -> dict | None:
    return _try_deterministic_plan(user_message)


def _try_deterministic_skill_list_args(user_message: str) -> dict | None:
    if _looks_like_skill_list_request(user_message):
        return {}
    return None


def _normalize_deterministic_image_prompt(user_message: str) -> str:
    text = (user_message or "").strip()
    lower = text.lower()
    has_cat = any(token in lower for token in ("cat", "chat"))
    has_moon = any(token in lower for token in ("moon", "lune"))
    has_watercolor = any(token in lower for token in ("watercolor", "aquarelle"))
    if has_cat and has_moon and has_watercolor:
        return _FAST_IMAGE_GEN_CANONICAL_PROMPT
    return text


def _try_deterministic_generate_image_args(user_message: str) -> dict | None:
    if _looks_like_image_generation_request(user_message):
        return {
            "prompt": _normalize_deterministic_image_prompt(user_message),
            "size": _FAST_IMAGE_GEN_SIZE,
            "seed": _FAST_IMAGE_GEN_SEED,
        }
    return None


def _emit_deterministic_plan(args: dict) -> tuple[list[str], int]:
    steps = args.get("steps") or []
    if not isinstance(steps, list):
        steps = []
    steps = [str(step).strip()[:60] for step in steps if str(step).strip()][:6]
    current = int(args.get("current", 0) or 0)
    return steps, max(0, min(current, max(len(steps) - 1, 0)))


def _try_deterministic_list_dir_args(user_message: str, workspace: str) -> dict | None:
    msg = (user_message or "").lower()
    if "workspace" in msg:
        return {"path": workspace, "depth": 1}
    return None


def chat_direct(history: list[dict], user_message: str, model_id: str | None = None, animal_id: str | None = None) -> str:
    """Direct text-only reply for channels like WhatsApp.
    No tools, no plan, no self-debug loop."""
    system = (
        "Reply over WhatsApp as a real human would. "
        "Answer directly and helpfully in the contact's language. "
        "No tools. No audit. No plan. No self-debugging. No mention of internal steps. "
        "Never reveal or mention an internal codename (Monkey, Tigre, Vanilla, etc.). "
        "Never open with a self-introduction. "
        "If the user asks for an action that requires local files, browser control, or desktop-only features, "
        "say briefly that it must be done from the desktop app."
    )
    trimmed_history = history[-20:] if len(history) > 20 else history
    messages: list[dict] = [{"role": "system", "content": system}] + trimmed_history + [{"role": "user", "content": user_message}]
    result = _call_llm_guarded(messages, model_id, [])
    text = (result.get("text") or "").strip()
    return _ensure_non_empty_final(messages, user_message, model_id, text, [])


from monkey.quality_gate import quality_gate as _quality_gate



# Set by chat_stream() at the start of each agent run; read by checkpoint tools.
_CURRENT_RUN_ID: str | None = None
# Set by chat_stream() when session_id starts with "whatsapp:"; read by whatsapp_send_media.
_CURRENT_WA_JID: str | None = None


def _maybe_humanize_for_wa(text: str) -> str:
    """If the active session is WhatsApp, strip bot/markdown markers from final.

    Same rule as the sidecar _wa_send_text choke point — applied here so the
    desktop UI mirrors what the contact actually sees.
    """
    text = _sanitize_rich_blocks(text) if isinstance(text, str) else text
    if not _CURRENT_WA_JID:
        return text
    try:
        from monkey.main import _sanitize_outgoing
        return _sanitize_outgoing(text)
    except Exception:
        return text
_CURRENT_MODEL_ID: str | None = None
_CURRENT_TOOL_MODE: str | None = None
_CURRENT_CONTEXT_FOLDER: str | None = None
_CURRENT_PROVIDER_MODE: str | None = None
_CURRENT_PROVIDER_USER_ID: str | None = None
_CURRENT_LLAMA_BASE_URL: str | None = None
_CURRENT_LLAMA_BEARER_TOKEN: str | None = None


from monkey.game_guard import (
    find_dist_html as _find_dist_html,
    should_auto_browser_probe as _should_auto_browser_probe,
    PROBE_JS_STATE as _PROBE_JS_STATE,
    PROBE_JS_INPUT as _PROBE_JS_INPUT,
    evaluate_probe_results as _evaluate_probe_results,
    is_game_project as _is_game_project,
)



_RRULE_FREQ_FIX = {
    "MINUTE": "MINUTELY", "MIN": "MINUTELY", "MINUTES": "MINUTELY",
    "HOUR": "HOURLY", "HR": "HOURLY", "HOURS": "HOURLY",
    "DAY": "DAILY", "DAYS": "DAILY",
    "WEEK": "WEEKLY", "WEEKS": "WEEKLY",
    "MONTH": "MONTHLY", "MONTHS": "MONTHLY",
    "YEAR": "YEARLY", "YEARS": "YEARLY",
}


def _normalize_rrule(raw: str) -> str:
    """Tolerate small-model RRULE variants (FREQUENCY=MINUTE, INTERVAL=15)."""
    s = (raw or "").strip()
    if not s:
        return ""
    # Strip wrapping RRULE: prefix if model emitted it.
    if s.upper().startswith("RRULE:"):
        s = s[6:].strip()
    # RFC 5545 separator is `;`. Some small models emit `,` instead — but
    # commas are *valid* inside values (BYDAY=MO,WE,FR). Only fall back to
    # comma splitting when no semicolon is present.
    sep = ";" if ";" in s else ","
    parts = [p.strip() for p in s.split(sep) if p.strip()]
    out = []
    for p in parts:
        if "=" not in p:
            continue
        k, v = p.split("=", 1)
        k = k.strip().upper()
        v = v.strip()
        if k == "FREQUENCY":
            k = "FREQ"
        if k == "FREQ":
            v = _RRULE_FREQ_FIX.get(v.upper(), v.upper())
        elif k in ("INTERVAL", "COUNT"):
            v = re.sub(r"[^\d]", "", v) or v
        else:
            v = v.upper()
        out.append(f"{k}={v}")
    return ";".join(out)


_SCHEDULED_FOR_ALIASES = ("schedule_for", "scheduledFor", "when", "at",
                          "start_at", "startAt", "run_at", "runAt",
                          "datetime", "time")
_RECURRENCE_ALIASES = ("rrule", "RRULE", "repeat", "frequency")
_RECURRENCE_UNTIL_ALIASES = ("recurrenceUntil", "until", "end_at", "endAt",
                             "ends_at", "endsAt")
_RECURRENCE_COUNT_ALIASES = ("recurrenceCount", "count", "max_runs", "maxRuns")
_PROMPT_ALIASES = ("agent_prompt", "agentPrompt", "instruction", "instructions")


def _normalize_schedule_args(args: dict) -> dict:
    if not isinstance(args, dict):
        return args
    out = dict(args)
    def _adopt(target, aliases):
        if out.get(target):
            return
        for k in aliases:
            v = out.get(k)
            if v not in (None, ""):
                out[target] = v
                break
    _adopt("scheduled_for", _SCHEDULED_FOR_ALIASES)
    _adopt("recurrence", _RECURRENCE_ALIASES)
    _adopt("recurrence_until", _RECURRENCE_UNTIL_ALIASES)
    _adopt("recurrence_count", _RECURRENCE_COUNT_ALIASES)
    _adopt("prompt", _PROMPT_ALIASES)
    if isinstance(out.get("recurrence"), str):
        normalized = _normalize_rrule(out["recurrence"])
        if normalized:
            out["recurrence"] = normalized
    return out


_SCALAR_ARG_TYPES: dict[str, dict[str, str]] = {}


def _scalar_arg_types(tool_name: str) -> dict[str, str]:
    """Map {arg_name: 'number'|'integer'|'boolean'} from the tool schema, cached.

    Weak models (e.g. mistral-3-3b, small llamas) frequently emit numeric/boolean
    arguments as strings ("10", "true"). Without coercion, `search_web` does
    `max_results * 2` → `"10" * 2` and later `"10" + 4` → TypeError, surfacing as
    "invalid arguments" and pushing the model to fabricate. Coerce at dispatch.
    """
    if not _SCALAR_ARG_TYPES:
        for spec in TOOLS:
            fn = spec.get("function") or {}
            props = ((fn.get("parameters") or {}).get("properties") or {})
            types = {
                k: v["type"]
                for k, v in props.items()
                if isinstance(v, dict) and v.get("type") in ("number", "integer", "boolean")
            }
            if types:
                _SCALAR_ARG_TYPES[fn.get("name", "")] = types
    return _SCALAR_ARG_TYPES.get(tool_name, {})


def _coerce_scalar_args(name: str, args: dict) -> dict:
    types = _scalar_arg_types(name)
    if not types:
        return args
    out = dict(args)
    for key, typ in types.items():
        val = out.get(key)
        if not isinstance(val, str):
            continue
        s = val.strip()
        if typ == "boolean":
            if s.lower() in ("true", "1", "yes"):
                out[key] = True
            elif s.lower() in ("false", "0", "no"):
                out[key] = False
            continue
        try:
            out[key] = float(s) if ("." in s or "e" in s.lower()) else int(s)
        except ValueError:
            pass  # leave non-numeric string as-is; tool surfaces a real error
    return out


def _dispatch_tool(name: str, args: dict) -> str:
    # Local on-device model tools (CamemBERT, Whisper, Tesseract, ...) are
    # registered dynamically; route them before the TOOL_NAMES guard.
    try:
        from monkey.local_models import tools as _lmt
        if _lmt.is_local_tool(name):
            if isinstance(args, dict):
                args = {k: v for k, v in args.items() if k not in (
                    "run_in_background", "description", "timeout_ms",
                    "background", "explanation", "summary",
                )}
            return _lmt.dispatch_local(name, args or {})
    except Exception:
        pass
    if name not in TOOL_NAMES:
        return f"ERREUR: outil inconnu {name}"
    # Strip kwargs that no tool here accepts but other agent platforms inject
    # (agentic-CLI style `run_in_background`, `description`, `timeout_ms`, etc.)
    if isinstance(args, dict):
        args = {k: v for k, v in args.items() if k not in (
            "run_in_background", "description", "timeout_ms",
            "background", "explanation", "summary",
        )}
        args = _coerce_scalar_args(name, args)
    from monkey.tools.image import generate_image
    from monkey.tools.music import generate_music
    from monkey.tools.video import generate_video
    from monkey.tools.web import (
        fetch_page, http_request, download_file,
        browser_navigate, search_web, search_and_read, search_images,
        browser_get_text, browser_get_clean_text, browser_get_links, browser_click, browser_fill,
        browser_scroll, browser_scroll_to_bottom, browser_paginate, browser_run_js, browser_screenshot, browser_solve_captcha,
        browser_wait_for, browser_navigate_back, browser_current_url,
    )
    from monkey.tools.files import (read_file, read_file_chunk, write_file, edit_file, append_to_file,
        list_dir, list_dir_images, grep_files, generate_pdf, glob_files, get_file_info, move_file, copy_file,
        delete_file, open_file, get_clipboard, set_clipboard, recall_facts)
    from monkey.tools.shell import run_command, send_notification, add_reminder, create_calendar_event

    if name == "think": return ""  # internal reasoning, no side effects
    if name == "set_plan": return ""  # handled specially in chat_stream via SSE
    if name == "expand_tools": return "OK"  # handled specially in chat_stream
    if name == "generate_image": return generate_image(**args)
    if name == "generate_music": return generate_music(**args)
    if name == "generate_video": return generate_video(**args)
    if name == "render_ascii_schematic":
        from monkey.tools.ascii_schematic import render_ascii_schematic
        return render_ascii_schematic(args)
    if name == "fetch_page": return fetch_page(**args)
    if name == "http_request": return http_request(**args)
    if name == "download_file": return download_file(**args)
    if name == "whatsapp_send_media": return _whatsapp_send_media(**args)
    if name == "whatsapp_send_file": return _whatsapp_send_file(**args)
    if name == "search_web": return json.dumps(search_web(**args), ensure_ascii=False)
    if name == "kb_search":
        from monkey import kb_store as _kbst
        q = (args.get("query") or "").strip()
        if not q:
            return "ERREUR: kb_search requires query"
        top_k = int(args.get("top_k") or 5)
        top_k = max(1, min(top_k, 20))
        hits = _kbst.search(q, top_k=top_k)
        if not hits:
            return "OK: no match in local knowledge base"
        return json.dumps(hits, ensure_ascii=False)
    if name == "kb_list":
        from monkey import kb_store as _kbst
        try:
            docs = _kbst.list_documents(
                tag=(args.get("tag") or None),
                source_prefix=(args.get("source_prefix") or None),
                search=(args.get("search") or None),
                archived=bool(args.get("archived") or False),
                limit=int(args.get("limit") or 50),
                offset=int(args.get("offset") or 0),
            )
        except Exception as e:
            return f"ERREUR: kb_list failed: {e}"
        if not docs:
            return "OK: no documents match"
        return json.dumps({"count": len(docs), "documents": docs}, ensure_ascii=False)
    if name == "kb_stats":
        from monkey import kb_store as _kbst
        try:
            return json.dumps(_kbst.stats(), ensure_ascii=False)
        except Exception as e:
            return f"ERREUR: kb_stats failed: {e}"
    if name == "kb_archive":
        from monkey import kb_store as _kbst
        ids = args.get("document_ids") or []
        if not isinstance(ids, list) or not ids:
            return "ERREUR: kb_archive requires non-empty document_ids list"
        if len(ids) > 100:
            return "ERREUR: kb_archive batch limit is 100"
        archived = args.get("archived")
        archived = True if archived is None else bool(archived)
        try:
            n = _kbst.archive_documents([str(i) for i in ids], archived=archived)
        except Exception as e:
            return f"ERREUR: kb_archive failed: {e}"
        return f"OK: {'archived' if archived else 'unarchived'} {n} document(s)"
    if name == "kb_delete":
        from monkey import kb_store as _kbst
        ids = args.get("document_ids") or []
        if not isinstance(ids, list) or not ids:
            return "ERREUR: kb_delete requires non-empty document_ids list"
        if len(ids) > 100:
            return "ERREUR: kb_delete batch limit is 100"
        try:
            n = _kbst.delete_documents([str(i) for i in ids])
        except Exception as e:
            return f"ERREUR: kb_delete failed: {e}"
        return f"OK: deleted {n} document(s)"
    if name == "kb_purge_unindexed":
        from monkey import kb_store as _kbst
        try:
            n = _kbst.purge_unindexed()
        except Exception as e:
            return f"ERREUR: kb_purge_unindexed failed: {e}"
        return f"OK: purged {n} unindexed document(s)"
    if name == "kb_search_and_delete":
        from monkey import kb_store as _kbst
        q = (args.get("query") or "").strip()
        if not q:
            return "ERREUR: kb_search_and_delete requires query"
        top_k = int(args.get("top_k") or 20)
        top_k = max(1, min(top_k, 50))
        dry_run = args.get("dry_run")
        dry_run = True if dry_run is None else bool(dry_run)
        try:
            hits = _kbst.search(q, top_k=top_k) or []
        except Exception as e:
            return f"ERREUR: kb_search_and_delete search failed: {e}"
        doc_ids = list({h.get("document_id") for h in hits if h.get("document_id")})
        if not doc_ids:
            return "OK: no matches"
        if dry_run:
            return json.dumps({"dry_run": True, "would_delete": len(doc_ids), "document_ids": doc_ids, "hits": hits}, ensure_ascii=False)
        try:
            n = _kbst.delete_documents(doc_ids)
        except Exception as e:
            return f"ERREUR: kb_search_and_delete delete failed: {e}"
        return f"OK: deleted {n} document(s) matching query"
    if name == "search_and_read": return search_and_read(**args)
    if name == "search_images": return json.dumps(search_images(**args), ensure_ascii=False)
    if name == "browser_navigate":
        res = browser_navigate(**args)
        if isinstance(res, dict):
            err = (res.get("error") or "").strip()
            text = (res.get("text") or "").strip()
            blocked = res.get("blocked")
            # Hard failure: surface as ERREUR so the deterministic gate forces a retry/alt path
            if err and len(text) < 40:
                return f"ERREUR: browser_navigate failed for {args.get('url', '')}: {err}. Try fetch_page or a different URL."
            if blocked and len(text) < 40:
                return f"ERREUR: browser_navigate blocked ({blocked}) for {args.get('url', '')}. Try fetch_page or a different URL."
            return json.dumps(res, ensure_ascii=False)
        return str(res)
    if name == "browser_get_text": return browser_get_text(args.get("selector", ""))
    if name == "browser_get_clean_text": return browser_get_clean_text(args.get("max_chars", 0))
    if name == "browser_get_links": return browser_get_links(args.get("limit", 30))
    if name == "browser_click": return browser_click(args["selector"])
    if name == "browser_fill": return browser_fill(args["selector"], args["value"])
    if name == "browser_scroll": return browser_scroll(args.get("direction", "down"), args.get("amount", 500))
    if name == "browser_scroll_to_bottom": return browser_scroll_to_bottom(int(args.get("max_rounds", 20)), int(args.get("stable_rounds", 3)))
    if name == "browser_paginate": return browser_paginate(args.get("direction", "next"))
    if name == "browser_run_js": return browser_run_js(args["code"])
    if name == "browser_screenshot": return browser_screenshot()
    if name == "browser_solve_captcha": return browser_solve_captcha(args.get("model_id", ""))
    if name == "browser_wait_for": return browser_wait_for(args.get("selector", ""), args.get("timeout_ms", 10000))
    if name == "browser_navigate_back": return browser_navigate_back()
    if name == "browser_current_url": return browser_current_url()
    if name == "read_file":
        if "chunk" in args:  # LLM mistake: route to read_file_chunk
            return read_file_chunk(args.get("path", ""), int(args.get("chunk", 1)))
        return read_file(args.get("path", ""), int(args.get("max_chars", 8000)))
    if name == "read_file_chunk": return read_file_chunk(**args)
    if name == "write_file": return write_file(**args)
    if name == "edit_file": return edit_file(**args)
    if name == "append_to_file": return append_to_file(**args)
    if name == "list_dir": return list_dir(args.get("path", ""), args.get("depth", 1))
    if name == "list_dir_images": return list_dir_images(args.get("path", ""), bool(args.get("recursive", True)), int(args.get("limit", 12)))
    if name == "grep_files": return grep_files(**args)
    if name == "generate_pdf": return generate_pdf(**args)
    if name == "glob_files": return glob_files(**args)
    if name == "get_file_info": return get_file_info(**args)
    if name == "move_file": return move_file(**args)
    if name == "copy_file": return copy_file(**args)
    if name == "delete_file": return delete_file(**args)
    if name == "open_file": return open_file(**args)
    if name == "get_clipboard": return get_clipboard()
    if name == "set_clipboard": return set_clipboard(**args)
    if name == "run_subagent": return _run_subagent(args.get("task", ""), args.get("context", ""))
    if name == "run_command": return run_command(**args)
    if name in {"restore_last_green", "list_green_checkpoints"}:
        from monkey import checkpoint as _cp
        rid = _CURRENT_RUN_ID
        if not rid:
            return "ERREUR: pas de run_id actif (checkpoint indisponible hors session agent)."
        if name == "restore_last_green":
            res = _cp.restore_last_green(rid)
            if "error" in res:
                return f"ERREUR: {res['error']}"
            return json.dumps(res, ensure_ascii=False, indent=2)
        snaps = _cp.list_snapshots(rid)
        out = [{"name": s["_name"], "build_idx": s["build_idx"],
                "files": len(s.get("files", [])), "created_at": s.get("created_at")}
               for s in snaps]
        return json.dumps(out, ensure_ascii=False, indent=2) if out else "(no green checkpoint for this run)"
    if name == "remember_fact":
        import html as _html
        key = _html.unescape(str(args["key"]))
        value = _html.unescape(str(args["value"]))
        mem_mod.upsert_fact(key, value)
        return f"OK: memorized {key} = {value}"
    if name == "remember_note":
        content = str(args.get("content", "")).strip()
        if not content:
            return "ERREUR: content vide"
        tags = args.get("tags") or []
        if not isinstance(tags, list):
            tags = []
        nid = mem_mod.add_note(content, tags=[str(t) for t in tags])
        return f"OK: note saved ({nid[:8]})"
    if name == "recall_facts": return recall_facts(args.get("key", ""))
    if name in {"osint_note", "osint_dump", "osint_list", "osint_clear", "osint_citation_check"}:
        from monkey.tools import osint_notebook as _nb
        if name == "osint_note":
            return _nb.osint_note(args.get("topic", ""), args.get("key", ""), args.get("value", ""))
        if name == "osint_dump":
            return _nb.osint_dump(args.get("topic", ""))
        if name == "osint_list":
            return _nb.osint_list()
        if name == "osint_citation_check":
            return _nb.osint_citation_check(args.get("text", ""), int(args.get("min_urls") or 1))
        return _nb.osint_clear(args.get("topic", ""))
    if name in {"whois_lookup", "dns_records", "subdomain_enum", "wayback_snapshots",
                "gravatar_lookup", "hibp_password_check", "phone_parse", "http_headers"}:
        from monkey.tools import intel as _intel
        if name == "whois_lookup": return _intel.whois_lookup(args.get("domain", ""))
        if name == "dns_records": return _intel.dns_records(args.get("domain", ""), args.get("types"))
        if name == "subdomain_enum": return _intel.subdomain_enum(args.get("domain", ""), int(args.get("max_results") or 200))
        if name == "wayback_snapshots": return _intel.wayback_snapshots(args.get("url", ""), int(args.get("limit") or 20))
        if name == "gravatar_lookup": return _intel.gravatar_lookup(args.get("email", ""))
        if name == "hibp_password_check": return _intel.hibp_password_check(args.get("password", ""))
        if name == "phone_parse": return _intel.phone_parse(args.get("number", ""), args.get("region", "FR"))
        return _intel.http_headers(args.get("url", ""))
    if name in {"osint_dorks", "multi_engine_search"}:
        from monkey.tools import osint_search as _os
        if name == "osint_dorks": return _os.osint_dorks(args.get("target", ""), args.get("kinds"))
        return _os.multi_engine_search(args.get("query", ""), int(args.get("max_results") or 10))
    if name in {"username_pivot", "reddit_user", "hn_user", "github_user", "github_code_search"}:
        from monkey.tools import osint_social as _soc
        if name == "username_pivot": return _soc.username_pivot(args.get("username", ""), args.get("sites"))
        if name == "reddit_user": return _soc.reddit_user(args.get("username", ""), int(args.get("limit") or 10))
        if name == "hn_user": return _soc.hn_user(args.get("username", ""))
        if name == "github_user": return _soc.github_user(args.get("username", ""))
        return _soc.github_code_search(args.get("query", ""), int(args.get("max_results") or 10))
    if name in {"exif_extract", "image_phash", "reverse_image_urls"}:
        from monkey.tools import osint_image as _oi
        if name == "exif_extract": return _oi.exif_extract(args.get("path", ""))
        if name == "image_phash": return _oi.image_phash(args.get("path", ""))
        return _oi.reverse_image_urls(args.get("image_url", ""))
    if name in {"nominatim_geocode", "nominatim_reverse", "gdelt_search",
                "recherche_entreprises", "wikidata_search"}:
        from monkey.tools import osint_geo as _geo
        if name == "nominatim_geocode": return _geo.nominatim_geocode(args.get("query", ""), int(args.get("limit") or 5))
        if name == "nominatim_reverse": return _geo.nominatim_reverse(args.get("lat"), args.get("lon"))
        if name == "gdelt_search": return _geo.gdelt_search(args.get("query", ""), int(args.get("max_results") or 20), args.get("timespan", "1m"))
        if name == "recherche_entreprises": return _geo.recherche_entreprises(args.get("query", ""), int(args.get("limit") or 5))
        return _geo.wikidata_search(args.get("query", ""), int(args.get("limit") or 5), args.get("lang", "en"))
    if name == "send_notification": return send_notification(**args)
    if name == "notify_user":
        from monkey.tools.notify import notify_user
        return notify_user(args.get("text", ""))
    if name == "add_reminder": return add_reminder(**args)
    if name == "create_calendar_event": return create_calendar_event(**args)
    if name == "schedule_agent_task":
        from monkey.main import TASK_STORE
        # Small models (Ministral-3-3B, Llama-3.2-3B) often emit alternate field
        # names ("schedule_for", "when", "at") and informal RRULEs
        # ("FREQUENCY=MINUTE, INTERVAL=15"). Normalize before validation so the
        # task lands instead of dying on a strict schema check.
        args = _normalize_schedule_args(args)
        title = (args.get("title") or "").strip()
        when = (args.get("scheduled_for") or "").strip()
        prompt = (args.get("prompt") or "").strip()
        if not title or not when or not prompt:
            return "ERREUR: schedule_agent_task requires title, scheduled_for, prompt"
        payload: dict = {
            "title": title,
            "scheduledFor": when,
            "details": args.get("details", "") or "",
            "agentPrompt": prompt,
            "source": "agent-scheduled",
        }
        if _CURRENT_MODEL_ID:
            payload["modelId"] = _CURRENT_MODEL_ID
        # Scheduled runs must keep full tool access. Do not persist restrictive
        # live chat modes (chat_only/chat_search) into future task executions.
        # Snapshot the per-chat context folder so scheduled runs can still
        # reach the same docs the live chat had access to (chat_only mode
        # still allows docs — they're injected via system prompt, not tools).
        if _CURRENT_CONTEXT_FOLDER:
            payload["contextFolder"] = _CURRENT_CONTEXT_FOLDER
        mode = (args.get("mode") or "").strip().lower()
        if mode in ("report", "alert"):
            payload["mode"] = mode
        # WhatsApp routing: explicit arg wins, else capture the live session JID
        wa_jid = (str(args.get("wa_chat_jid") or "").strip()) or (_CURRENT_WA_JID or "")
        if wa_jid:
            payload["waChatJid"] = wa_jid
        wa_label = (str(args.get("wa_chat_label") or "").strip())
        if wa_label:
            payload["waChatLabel"] = wa_label
        rrule = (args.get("recurrence") or "").strip()
        if rrule:
            payload["recurrence"] = rrule
            until = (args.get("recurrence_until") or "").strip()
            if until:
                payload["recurrenceUntil"] = until
            count = args.get("recurrence_count")
            if isinstance(count, (int, float)) and count > 0:
                payload["recurrenceCount"] = int(count)
        try:
            task = TASK_STORE.create_task(payload)
        except ValueError as e:
            return f"ERREUR: {e}"
        suffix = f" recurring={task.get('recurrence')}" if task.get("recurrence") else ""
        return f"OK: scheduled '{task['title']}' at {task['scheduledFor']} (id={task['id'][:8]}){suffix}"
    if name in {"list_agent_tasks", "update_agent_task", "cancel_agent_task", "get_task_history"}:
        from monkey.main import TASK_STORE

        def _resolve_id(raw: str) -> str | None:
            raw = (raw or "").strip()
            if not raw:
                return None
            try:
                TASK_STORE.get_task(raw)
                return raw
            except KeyError:
                pass
            matches = [t["id"] for t in TASK_STORE.list_tasks() if t["id"].startswith(raw)]
            if len(matches) == 1:
                return matches[0]
            if len(matches) > 1:
                return "__AMBIGUOUS__"
            return None

        if name == "list_agent_tasks":
            flt = (args.get("filter") or "active").strip().lower()
            limit = int(args.get("limit") or 30)
            tasks = TASK_STORE.list_tasks()
            if flt == "recurring":
                tasks = [t for t in tasks if (t.get("recurrence") or "").strip()]
            elif flt == "active":
                tasks = [t for t in tasks if t.get("status") in ("planned", "in_progress")]
            tasks = tasks[: max(0, limit)]
            if not tasks:
                return "OK: no tasks"
            lines = []
            for t in tasks:
                rrule = (t.get("recurrence") or "").strip()
                rec = f" rrule={rrule}" if rrule else ""
                mode = t.get("mode") or "report"
                lines.append(
                    f"- {t['id'][:8]}  {t.get('scheduledFor','?')}  [{t.get('status','?')}/{mode}]  {t.get('title','?')}{rec}"
                )
            return "OK:\n" + "\n".join(lines)

        if name == "update_agent_task":
            tid = _resolve_id(args.get("id", ""))
            if tid == "__AMBIGUOUS__":
                return "ERREUR: ambiguous id prefix, list_agent_tasks first"
            if not tid:
                return "ERREUR: task not found"
            patch: dict = {}
            if args.get("title"): patch["title"] = args["title"].strip()
            if args.get("scheduled_for"): patch["scheduledFor"] = args["scheduled_for"].strip()
            if args.get("prompt"): patch["agentPrompt"] = args["prompt"].strip()
            if "details" in args and args["details"] is not None: patch["details"] = args["details"]
            if "recurrence" in args and args["recurrence"] is not None:
                # empty string => clear; update_task() drops None, but keeps "" and
                # _normalize_task collapses falsy values back to None.
                patch["recurrence"] = (args["recurrence"] or "").strip()
            if "recurrence_until" in args and args["recurrence_until"] is not None:
                patch["recurrenceUntil"] = (args["recurrence_until"] or "").strip()
            if "recurrence_count" in args and args["recurrence_count"] is not None:
                try:
                    rc = int(args["recurrence_count"])
                    patch["recurrenceCount"] = rc if rc > 0 else ""
                except (TypeError, ValueError):
                    return "ERREUR: recurrence_count must be a number"
            if args.get("mode"):
                m = args["mode"].strip().lower()
                if m not in ("report", "alert"):
                    return "ERREUR: mode must be report or alert"
                patch["mode"] = m
            if "wa_chat_jid" in args and args["wa_chat_jid"] is not None:
                patch["waChatJid"] = (str(args["wa_chat_jid"]) or "").strip()
            if "wa_chat_label" in args and args["wa_chat_label"] is not None:
                patch["waChatLabel"] = (str(args["wa_chat_label"]) or "").strip()
            if not patch:
                return "ERREUR: nothing to update (no fields provided)"
            try:
                task = TASK_STORE.update_task(tid, patch)
            except KeyError:
                return "ERREUR: task not found"
            except ValueError as e:
                return f"ERREUR: {e}"
            rec = f" recurring={task.get('recurrence')}" if task.get("recurrence") else ""
            return f"OK: updated '{task['title']}' next={task.get('scheduledFor')} (id={task['id'][:8]}){rec}"

        if name == "cancel_agent_task":
            tid = _resolve_id(args.get("id", ""))
            if tid == "__AMBIGUOUS__":
                return "ERREUR: ambiguous id prefix, list_agent_tasks first"
            if not tid:
                return "ERREUR: task not found"
            try:
                task = TASK_STORE.get_task(tid)
                TASK_STORE.delete_task(tid)
            except KeyError:
                return "ERREUR: task not found"
            return f"OK: cancelled '{task.get('title','?')}' (id={tid[:8]})"

        if name == "get_task_history":
            tid = _resolve_id(args.get("id", ""))
            if tid == "__AMBIGUOUS__":
                return "ERREUR: ambiguous id prefix, list_agent_tasks first"
            if not tid:
                return "ERREUR: task not found"
            try:
                task = TASK_STORE.get_task(tid)
            except KeyError:
                return "ERREUR: task not found"
            limit = int(args.get("limit") or 5)
            hist = list(task.get("runHistory") or [])[-max(1, limit):]
            if not hist:
                return f"OK: no history yet for '{task.get('title','?')}'"
            lines = [f"OK: '{task.get('title','?')}' last {len(hist)} run(s):"]
            for h in reversed(hist):
                ok = "OK" if h.get("ok") else "FAIL"
                fin = h.get("finishedAt", "?")
                res = (h.get("result") or "").strip().replace("\n", " ")[:200]
                lines.append(f"- {ok} {fin}  {res}")
            return "\n".join(lines)

    if name in {"skill_list", "skill_search", "skill_create", "skill_revise", "skill_delete"}:
        from monkey.tools import skills_tool
        if name == "skill_list": return skills_tool.skill_list()
        if name == "skill_search": return skills_tool.skill_search(args.get("query", ""))
        if name == "skill_create":
            return skills_tool.skill_create(
                name=args.get("name", ""),
                topic=args.get("topic", ""),
                triggers=args.get("triggers") or [],
                research_queries=args.get("research_queries") or [],
            )
        if name == "skill_revise":
            return skills_tool.skill_revise(args.get("name", ""), args.get("reason", ""))
        if name == "skill_delete":
            return skills_tool.skill_delete(args.get("name", ""))
    if name in {"repo_skill_list", "repo_skill_search", "repo_skill_show", "repo_skill_install"}:
        from monkey.tools import repo_skills_tool
        if name == "repo_skill_list": return repo_skills_tool.repo_skill_list()
        if name == "repo_skill_search": return repo_skills_tool.repo_skill_search(args.get("query", ""))
        if name == "repo_skill_show": return repo_skills_tool.repo_skill_show(args.get("name", ""))
        if name == "repo_skill_install":
            return repo_skills_tool.repo_skill_install(args.get("name", ""), args.get("cwd", ""))
    if name == "scaffold_game_2d":
        biomes = args.get("biomes")
        if isinstance(biomes, str):
            biomes = [b.strip() for b in biomes.split(",") if b.strip()]
        tuning = args.get("tuning")
        if isinstance(tuning, str):
            try:
                import json as _json
                tuning = _json.loads(tuning)
            except Exception:
                return "ERREUR: tuning must be a JSON object."
        from monkey.tools import repo_skills_tool
        return repo_skills_tool.scaffold_game_2d(
            args.get("target_dir", ""),
            args.get("kit", "platformer"),
            biomes=biomes,
            name=args.get("name", "game-2d-ts"),
            title=args.get("title"),
            tuning=tuning,
        )
    if name == "scaffold_app_fullstack":
        feats = args.get("features")
        if isinstance(feats, str):
            feats = [f.strip() for f in feats.split(",") if f.strip()]
        from monkey.tools import repo_skills_tool
        return repo_skills_tool.scaffold_app_fullstack(
            args.get("target_dir", ""),
            args.get("name", "my-app"),
            features=feats,
        )
    # ── Graphics / SVG / 3D / image processing ─────────────────────────────
    if name in {"svg_shape","image_to_svg","image_to_heightmap_stl","extract_palette",
                "resize_image","convert_image","ocr_image","image_to_ascii",
                "generate_spritesheet","tilemap_render"}:
        from monkey.tools import graphics as _gfx
        return getattr(_gfx, name)(**args)

    # ── Documents / data utility ───────────────────────────────────────────
    if name in {"qr_code","barcode_generate","vcard_create","ics_event_create",
                "markdown_to_html","json_to_csv","csv_to_json"}:
        from monkey.tools import docs as _docs
        return getattr(_docs, name)(**args)

    # ── Media / archive / hash ─────────────────────────────────────────────
    if name in {"audio_extract","audio_convert","video_thumbnail","video_to_gif",
                "compress_archive","extract_archive","file_hash"}:
        from monkey.tools import media as _media
        return getattr(_media, name)(**args)

    # ── Office: Excel / Word / PowerPoint / advanced PDF / Email ────────
    if name in {"xlsx_create","xlsx_read","xlsx_write_cells","xlsx_append_rows","xlsx_to_csv",
                "docx_create","docx_read","docx_replace",
                "pptx_create","pptx_read",
                "pdf_extract_text","pdf_merge","pdf_split","pdf_extract_pages",
                "pdf_rotate","pdf_metadata","pdf_add_watermark","pdf_encrypt",
                "eml_create","eml_read"}:
        from monkey.tools import office as _off
        return getattr(_off, name)(**args)

    # ── Mail dispatch ──────────────────────────────────────────────────────────
    if name in {"mail_list_accounts","mail_unread_count","mail_list","mail_search",
                "mail_read","mail_sync","mail_summarize_inbox","mail_send",
                "mail_flag","mail_move","mail_archive","mail_delete",
                "mail_list_folders","mail_reply","mail_clean_inbox",
                "mail_label_add","mail_label_remove"}:
        from monkey.tools import mail as _mail
        try:
            return getattr(_mail, name)(**args)
        except TypeError as e:
            return f"ERREUR: bad args for {name}: {e}"
        except Exception as e:
            return f"ERREUR: {name} crashed: {e}"

    return f"ERREUR: outil inconnu {name}"


_WA_SIDECAR_URL = os.getenv("MONKEY_WA_URL", "http://127.0.0.1:3472")


def _whatsapp_send_media(url: str, kind: str, caption: str = "", to: str = "", filename: str = "", mimetype: str = "") -> str:
    if not url or not kind:
        return "ERREUR: url and kind are required"
    target = to or _CURRENT_WA_JID
    if not target:
        return "ERREUR: no WhatsApp target — provide 'to' (JID or phone) or call this tool from a WhatsApp session"
    payload: dict = {"to": target, "url": url, "kind": kind}
    if caption: payload["caption"] = caption
    if filename: payload["filename"] = filename
    if mimetype: payload["mimetype"] = mimetype
    try:
        req = urllib.request.Request(
            f"{_WA_SIDECAR_URL}/wa/send-media",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read())
        if not body.get("ok"):
            return f"ERREUR: WhatsApp send failed: {body.get('error') or body}"
        return f"OK: sent {kind} ({body.get('bytes', 0)} bytes) to {target}"
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error") or str(e)
        except Exception:
            err = str(e)
        return f"ERREUR: WhatsApp send HTTP {e.code}: {err}"
    except Exception as e:
        return f"ERREUR: WhatsApp send failed: {e}"


def _whatsapp_send_file(path: str, kind: str = "image", caption: str = "", to: str = "", filename: str = "", mimetype: str = "") -> str:
    if not path:
        return "ERREUR: path is required"
    target = to or _CURRENT_WA_JID
    if not target:
        return "ERREUR: no WhatsApp target — provide 'to' (JID or phone) or call from a WhatsApp session"
    try:
        from monkey.tools.files import _resolve
        abs_path = str(_resolve(path).resolve())
    except Exception as e:
        return f"ERREUR: cannot resolve path: {e}"
    payload: dict = {"to": target, "path": abs_path, "kind": kind}
    if caption: payload["caption"] = caption
    if filename: payload["filename"] = filename
    if mimetype: payload["mimetype"] = mimetype
    try:
        req = urllib.request.Request(
            f"{_WA_SIDECAR_URL}/wa/send-file",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read())
        if not body.get("ok"):
            return f"ERREUR: WhatsApp send failed: {body.get('error') or body}"
        return f"OK: sent {kind} ({body.get('bytes', 0)} bytes) from {abs_path} to {target}"
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read()).get("error") or str(e)
        except Exception:
            err = str(e)
        return f"ERREUR: WhatsApp send HTTP {e.code}: {err}"
    except Exception as e:
        return f"ERREUR: WhatsApp send failed: {e}"


def _run_subagent(task: str, context: str = "") -> str:
    """Run a focused subagent loop for a specific sub-task. Returns final result."""
    if not task:
        return "Error: empty task"
    skills_block = skills_mod.select_skills(task) or ""
    system = f"""You are a focused subagent on one specific task. Execute it fully with available tools.
Task: {task}
{f'Context: {context}' if context else ''}
Rules: Execute directly. Return a concise result. Reply in the user's language.
{skills_block}"""
    messages = [{"role": "system", "content": system}, {"role": "user", "content": task}]
    active_tools = _get_active_tools(None)
    from monkey.loop_detector import LoopDetector
    loop_det = LoopDetector()
    text = ""
    for _ in range(15):  # subagent gets up to 15 iterations
        result = _call_llm_guarded(messages, None, active_tools)
        text = result.get("text") or ""
        tool_calls = result.get("tool_calls") or []
        if not tool_calls:
            return text or "(subagent finished with no result)"
        tool_messages = []
        looped = False
        for tc in tool_calls:
            fn_name = tc.get("function", {}).get("name", "")
            fn_args_raw = tc.get("function", {}).get("arguments", "{}")
            try:
                fn_args = json.loads(fn_args_raw) if isinstance(fn_args_raw, str) else fn_args_raw
            except Exception:
                fn_args = {}
            tool_result = _dispatch_tool(fn_name, fn_args)
            tool_messages.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": tool_result, "name": fn_name})
            state = loop_det.observe(fn_name, tool_result)
            if state.looping and state.occurrences >= 4:
                looped = True
        messages.append({"role": "assistant", "content": text or None, "tool_calls": tool_calls})
        messages.extend(tool_messages)
        if looped:
            return text or "(subagent: loop detected, abort)"
    return text or "(subagent: iteration limit reached)"


# Intent keywords → max iterations (mirrors NestJS MAX_ITERS)
_INTENT_MAX_ITERS = {
    "orchestrate": 100, # multi-step complex tasks (build/fix loops need headroom)
    "code":        40,  # coding / file manipulation
    "browse":      20,  # web browsing
    "search":      12,  # research
    "chat":         8,  # conversation
}

_TOOL_STEP_LABELS = {
    "think": None, "set_plan": None,
    "search_web": "Web search", "search_and_read": "Deep search", "search_images": "Image search",
    "kb_search": "Search knowledge base",
    "kb_list": "List KB documents",
    "kb_stats": "KB statistics",
    "kb_archive": "Archive KB documents",
    "kb_delete": "Delete KB documents",
    "kb_purge_unindexed": "Purge unindexed docs",
    "kb_search_and_delete": "Search & delete KB",
    "fetch_page": "Read source", "http_request": "HTTP request",
    "download_file": "Download file",
    "whatsapp_send_media": "Send WhatsApp media (URL)",
    "whatsapp_send_file": "Send WhatsApp file (local)",
    "browser_navigate": "Browse", "browser_get_text": "Extract content",
    "browser_get_clean_text": "Extract article",
    "browser_get_links": "Get links", "browser_click": "Click",
    "browser_fill": "Fill form", "browser_scroll": "Scroll",
    "browser_scroll_to_bottom": "Scroll to bottom (load more)", "browser_paginate": "Paginate",
    "browser_screenshot": "Screenshot", "browser_solve_captcha": "Solve captcha (vision)", "browser_wait_for": "Wait for load",
    "browser_navigate_back": "Back", "browser_current_url": "Current URL",
    "browser_run_js": "JS script",
    "read_file": "Read file", "read_file_chunk": "Read partial",
    "write_file": "Write file", "edit_file": "Edit file",
    "append_to_file": "Append to file", "list_dir": "List directory",
    "grep_files": "Search in files", "generate_pdf": "Generate PDF",
    "glob_files": "Find files", "get_file_info": "File info",
    "move_file": "Move file", "copy_file": "Copy file",
    "delete_file": "Delete", "open_file": "Open file",
    "run_command": "Run command", "run_subagent": "Subagent",
    "remember_fact": "Remember", "remember_note": "Note", "recall_facts": "Recall memory",
    "send_notification": "Notification", "add_reminder": "Calendar reminder",
    "create_calendar_event": "Calendar event",
    "get_clipboard": "Read clipboard", "set_clipboard": "Copy to clipboard",
}


def _auto_plan_from_tools(tool_calls: list) -> list[str]:
    """Build a minimal plan from a list of tool_call dicts when model skipped set_plan.

    Only emits a plan when ≥3 DISTINCT meaningful tool actions are visible — otherwise
    a plan adds noise for a 1-2-tool task that the prompt explicitly told the model to
    skip planning for.
    """
    seen = []
    for tc in tool_calls:
        name = tc.get("function", {}).get("name", "")
        label = _TOOL_STEP_LABELS.get(name)
        if label and label not in seen:
            seen.append(label)
    if len(seen) < 3:
        return []
    return (seen[:5] + ["Synthesize result"])


_ORCHESTRATE_KW = [
    "crée","cree","génère","genere","construis","développe","developpe","implémente","implemente","automatise","scaffold",
    "planifie","planifier","programme une","programmer une","schedule","scheduled","recurring",
    "create","generate","build me","develop","implement","automate","organize",
    "write a script","draft a","prepare a",
]
_CODE_KW = [
    "code-moi","script-moi","programme-moi","refactorise","débugue","debug","compile",
    "code me","write code","refactor","patch the","fix the bug","fix this code",
    "edit the file","modify the file","write a function","write a class",
]
_BROWSE_KW = [
    "navigue","visite","ouvre le site","scrape","extrait","remplis le formulaire","connecte-toi","login",
    "navigate","visit","open url","scrape","extract from","fill the form","sign in","log in",
]
_SEARCH_KW = [
    "cherche","trouve","recherche","qu'est","c'est quoi","explique","compare","actualité","news","prix","météo",
    "search","find","look up","what is","what's","explain","compare","weather","price",
]
_SMALL_TALK_KW = [
    "bonjour", "salut", "salutations", "hello", "hi", "hey",
    "ça va", "ca va", "comment tu vas", "comment tu va",
    "comment vas-tu", "tu vas bien", "how are you", "what's up", "how's it going", "yo",
    "who are you", "qui es-tu", "qui es tu", "tu es qui", "présente-toi", "presente-toi",
    "what day is it", "today's date", "on est quel jour", "quel jour sommes-nous",
    "what time is it", "tell me the time", "quelle heure est-il", "quelle heure il est",
    "where am i", "where am i located", "what's my location", "où suis-je", "ou suis-je", "appreciate it",
    "good morning", "good evening", "good afternoon", "many thanks",
]
# Conversational / opinion / acknowledgment / reaction patterns. No tools needed.
_CHAT_OPINION_KW = (
    "qu'est-ce que tu penses", "qu'en penses-tu", "ton avis", "ton opinion",
    "comment tu trouves", "tu préfères", "tu preferes", "tu aimes",
    "what do you think", "your opinion", "do you prefer", "do you like",
    "raconte", "raconte-moi", "tell me about yourself", "parle-moi de toi",
    "introduce yourself", "introduis-toi", "présente-toi", "presente-toi",
)
_CHAT_REACTION_TOKENS = frozenset({
    "ok","oki","okay","d'accord","daccord","dacc","ouais","ouai","oui","non","nan",
    "yep","yup","nope","sure","alright",
    "merci","mercii","thx","thanks","ty","cheers",
    "many",
    "appreciate","it",
    "a","lot","very","much","beaucoup",
    "super","cool","génial","genial","top","parfait","nickel","chouette","sympa",
    "lol","mdr","ptdr","haha","hehe","ahah",
    "bien","ouf","bof","mouais","pas mal",
    "à plus","a plus","a+","bye","ciao","tchao","tchuss","bisous","bonne nuit","bonne journée","bonne journee",
})
# HOW-TO / info questions — pure answer, no install, no file write.
_HOWTO_KW = [
    "comment gérer", "comment gerer", "comment faire", "comment installer",
    "comment configurer", "comment utiliser", "comment ça", "comment ca",
    "pourquoi ", "à quoi sert", "a quoi sert", "quelle est la diff",
    "what is", "how to ", "how do i ", "why does", "why is", "what does",
]

_ACTION_HINT_KW = (
    "envoie","envoyer","send","share","forward","upload","post",
    "télécharge","telecharge","download","fetch","grab","save","sauvegarde","sauve",
    "crée","cree","génère","genere","build","write","écris","ecris","draft","make",
    "schedule","scheduled","recurring","remind","reminder","rappelle","planifie","programme",
    "plan","roadmap","étape","etape","steps","list","liste","show","affiche","read","lis","open","ouvre",
    "file","fichier","folder","dossier","directory","dir","skill","skills","note","remember","souviens-toi",
    "ouvre","open","navigate","navigue","scrape","extract","extrait",
    "cherche","search","trouve","find","look up","recherche",
    "code","script","debug","compile","refactor","patch",
    "http://","https://","www.","github.com",
    "pdf","xlsx","csv","docx","mp3","mp4",
)

_WEB_FORCE_KW = (
    "web", "internet", "site", "url", "lien", "link", "page",
    "cherche", "trouve", "search", "find", "look up", "recherche",
    "news", "actualité", "actualite", "prix", "price", "cours", "score",
    "météo", "meteo", "weather",
    "latest", "today", "aujourd'hui", "maintenant", "right now", "current", "currently",
    # FR equivalents of "latest" — current-info signal, parity with EN "latest".
    "dernière", "derniere", "dernier", "dernières", "dernieres", "derniers", "release",
    "vérifie", "verifie", "check", "verify", "compare", "comparison",
    "wikipedia", "github", "stack overflow", "stackoverflow",
    # Image-retrieval phrases → search_images. Phrases (not bare "photo"/"image")
    # to avoid colliding with "photosynthèse"/"photographie"; "image de" omitted
    # on purpose — collides with image-GENERATION ("génère une image de …").
    "photo de", "photos de", "photo of", "photos of", "picture of", "pictures of",
    "http://", "https://", "www.",
)

_WEB_FORCE_QUESTION_TOKENS = {
    "prix", "price", "cours", "météo", "meteo", "weather", "news", "actualité", "actualite",
    "score", "latest", "today", "aujourd'hui", "maintenant", "current", "currently", "version",
    "release", "compare", "comparison", "vs", "source", "sources", "citation", "citations",
    "site", "url", "link", "lien", "verify", "vérifie", "verifie", "check",
}

_WEB_QUERY_STOPWORDS = {
    "a", "an", "and", "the", "to", "for", "of", "on", "in", "at", "by", "from", "with", "or",
    "is", "are", "was", "were", "be", "this", "that", "these", "those", "my", "your", "our",
    "i", "you", "we", "they", "he", "she", "it", "do", "does", "did", "can", "could", "would",
    "should", "please", "how", "why", "what", "which", "who", "when", "where",
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "au", "aux", "et", "ou", "où",
    "est", "sont", "été", "etre", "être", "ce", "cet", "cette", "ces", "mon", "ma", "mes",
    "ton", "ta", "tes", "notre", "nos", "votre", "vos", "je", "tu", "il", "elle", "nous",
    "vous", "ils", "elles", "pour", "dans", "sur", "par", "avec", "sans", "comme",
    "comment", "pourquoi", "quoi", "quel", "quelle", "quels", "quelles", "qui", "quand",
}

_WEB_AMBIGUOUS_TOKENS = {
    "mac", "macos", "windows", "android", "ios", "linux", "pc", "iphone",
    "ipad", "samsung", "google", "apple", "microsoft",
    "m1", "m2", "m3", "m4",
}

_SEARCH_URL_HOST_RE = re.compile(
    r"^(?:[a-z0-9-]+\.)*(?:google|bing|duckduckgo|yahoo|qwant|ecosia|startpage|brave|yandex|baidu)\.[a-z.]+$",
    re.IGNORECASE,
)


def _tokenize_web_terms(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9à-ÿ']+", (text or "").lower()) if len(t) >= 2]


def _extract_literal_urls(text: str) -> list[str]:
    return re.findall(r"https?://[^\s)>\"]+", text or "", flags=re.IGNORECASE)


def _build_forced_web_query(user_message: str) -> str:
    tokens = _tokenize_web_terms(user_message)
    picked: list[str] = []
    seen: set[str] = set()
    for t in tokens:
        if t in _WEB_QUERY_STOPWORDS:
            continue
        if t in seen:
            continue
        seen.add(t)
        picked.append(t)
        if len(picked) >= 6:
            break
    if picked:
        return " ".join(picked)
    fallback = " ".join(tokens[:6]).strip()
    return fallback or (user_message or "latest update").strip()[:120]


def _web_query_overlaps_user(query: str, user_message: str) -> bool:
    q_tokens = {t for t in _tokenize_web_terms(query) if t not in _WEB_QUERY_STOPWORDS}
    u_tokens = {t for t in _tokenize_web_terms(user_message) if t not in _WEB_QUERY_STOPWORDS}
    if not u_tokens:
        return True
    if not q_tokens:
        return False
    common = q_tokens & u_tokens
    if not common:
        return False
    concrete_user = u_tokens - _WEB_AMBIGUOUS_TOKENS
    concrete_common = common - _WEB_AMBIGUOUS_TOKENS
    if concrete_user:
        return bool(concrete_common)
    return True


def _extract_search_query_from_url(url: str) -> str:
    try:
        from urllib.parse import urlparse, parse_qs, unquote_plus
        parsed = urlparse(url or "")
        host = (parsed.hostname or "").lower()
        if not host or not _SEARCH_URL_HOST_RE.match(host):
            return ""
        q_values = parse_qs(parsed.query).get("q") or []
        if not q_values:
            return ""
        return unquote_plus(str(q_values[0] or "")).strip()
    except Exception:
        return ""


def _replace_search_query_in_url(url: str, new_query: str) -> str:
    try:
        from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
        parsed = urlparse(url or "")
        host = (parsed.hostname or "").lower()
        if not host or not _SEARCH_URL_HOST_RE.match(host):
            return url
        pairs = parse_qsl(parsed.query, keep_blank_values=True)
        if not pairs:
            return url
        updated: list[tuple[str, str]] = []
        seen_q = False
        for k, v in pairs:
            if k.lower() == "q":
                updated.append((k, new_query))
                seen_q = True
            else:
                updated.append((k, v))
        if not seen_q:
            updated.append(("q", new_query))
        return urlunparse(parsed._replace(query=urlencode(updated, doseq=True)))
    except Exception:
        return url


def _coerce_web_tool_call_alignment(
    fn_name: str,
    fn_args: dict,
    user_message: str,
    *,
    strict_alignment: bool,
    force_first: bool,
) -> tuple[str, dict, bool]:
    args = dict(fn_args) if isinstance(fn_args, dict) else {}
    should_rewrite = bool(strict_alignment or force_first)
    if fn_name in {"search_web", "search_and_read"}:
        current_query = str(args.get("query") or "").strip()
        if current_query and _web_query_overlaps_user(current_query, user_message):
            return fn_name, args, False
        if not should_rewrite:
            return fn_name, args, False
        args["query"] = _build_forced_web_query(user_message)
        return fn_name, args, True
    if fn_name == "browser_navigate":
        current_url = str(args.get("url") or "").strip()
        search_query = _extract_search_query_from_url(current_url)
        if not search_query:
            return fn_name, args, False
        if _web_query_overlaps_user(search_query, user_message):
            return fn_name, args, False
        if not should_rewrite:
            return fn_name, args, False
        args["url"] = _replace_search_query_in_url(current_url, _build_forced_web_query(user_message))
        return fn_name, args, args["url"] != current_url
    return fn_name, args, False


def _coerce_forced_first_web_call(fn_name: str, fn_args: dict, user_message: str) -> tuple[str, dict, bool]:
    return _coerce_web_tool_call_alignment(
        fn_name,
        fn_args,
        user_message,
        strict_alignment=False,
        force_first=True,
    )


def _is_pure_small_talk(msg: str) -> bool:
    m = msg.lower().strip()
    tokens = set(re.findall(r"[a-zà-ÿ']+", m))
    if len(m) <= 40 and (
        any(k in m for k in _SMALL_TALK_KW if " " in k)
        or tokens & {"bonjour","salut","hello","hi","hey","yo","coucou","bonsoir","bjr","slt"}
    ):
        return True
    if any(k in m for k in _CHAT_OPINION_KW):
        return True
    if len(m) <= 25 and tokens and tokens.issubset(_CHAT_REACTION_TOKENS | {"!","?",".",","}):
        return True
    return False


def _should_force_web_tools(msg: str, intent: str, session_id: str | None) -> bool:
    if not (isinstance(session_id, str) and session_id.startswith("whatsapp:")):
        return False
    if _is_pure_small_talk(msg):
        return False
    m = (msg or "").lower().strip()
    if not m:
        return False
    if _extract_literal_urls(m):
        return True
    if any(k in m for k in _WEB_FORCE_KW):
        return True
    if "?" in m:
        tokens = set(_tokenize_web_terms(m))
        if tokens & _WEB_FORCE_QUESTION_TOKENS:
            return True
    return False


def _mentions_web(msg: str) -> bool:
    """True when the user EXPLICITLY signals a web / current-info need: a search
    verb (cherche/trouve/recherche/search/find/look up), a web reference
    (web/site/url/wikipedia/...), a current-data term (news/prix/météo/latest/...),
    or a literal URL.

    Gate for the web tool pack — rule (2026-06-05): NO web search unless the user
    mentions web. General-knowledge and how-to questions ("comment élever des
    grenouilles", "explique X") are answered from the model's own knowledge.
    Distinct from _should_force_web_tools (WhatsApp-only forcing): this only
    decides whether web tools are AVAILABLE, the model still chooses to use them.
    """
    m = (msg or "").lower()
    if not m:
        return False
    if _extract_literal_urls(m):
        return True
    return any(k in m for k in _WEB_FORCE_KW)


_TASK_ACTION_KW = (
    "schedule", "scheduled", "recurring",
    "planifie", "planifier", "programme une", "programmer une",
    "récurrent", "recurrent", "récurrente", "recurrente", "recurente",
    "rappelle-moi tous", "rappelle-moi toutes", "remind me every",
    "rappel récurrent", "rappel recurrent",
)

_RECURRING_TIME_RE = re.compile(
    r"\b(?:toutes?\s+les?\s+\d+\s+(?:min|minute|minutes|heure|heures|hour|hours|jour|jours|day|days|semaine|semaines|week|weeks|mois|month|months)"
    r"|tous\s+les\s+\d+\s+(?:min|minute|minutes|heure|heures|hour|hours|jour|jours|day|days|semaine|semaines|week|weeks|mois|month|months)"
    r"|every\s+\d*\s*(?:min|minute|minutes|hour|hours|day|days|week|weeks|month|months))",
    re.I,
)


_UNIT_TO_FREQ = {
    "min": "MINUTELY", "minute": "MINUTELY", "minutes": "MINUTELY",
    "heure": "HOURLY", "heures": "HOURLY", "hour": "HOURLY", "hours": "HOURLY",
    "jour": "DAILY", "jours": "DAILY", "day": "DAILY", "days": "DAILY",
    "semaine": "WEEKLY", "semaines": "WEEKLY", "week": "WEEKLY", "weeks": "WEEKLY",
    "mois": "MONTHLY", "month": "MONTHLY", "months": "MONTHLY",
}

_RECURRING_PARSE_RE = re.compile(
    r"\b(?:toutes?\s+les?|tous\s+les|every)\s+(\d+)?\s*"
    r"(min|minute|minutes|heure|heures|hour|hours|jour|jours|day|days|semaine|semaines|week|weeks|mois|month|months)\b",
    re.I,
)

_REMINDER_RE = re.compile(r"\b(?:set a reminder|remind me|reminder|rappelle(?:-moi)?|rappel)\b", re.I)
_SCHEDULE_RE = re.compile(
    r"\b(?:schedule|scheduled|recurring|daily|weekly|weekday|planifie|programme|quotidien|hebdo|tous les jours|every day|every weekday)\b",
    re.I,
)
_PLAN_RE = re.compile(r"\b(?:plan|roadmap|étapes?|etapes?|steps?)\b", re.I)
_SKILL_LIST_RE = re.compile(
    r"(?:\b(?:available|all|list|show(?: me)?|affiche|liste|tous les|toutes les)\b.{0,24}\bskills?\b)"
    r"|(?:\bskills?\b.{0,24}\b(?:available|list|disponibles?|existants?)\b)",
    re.I,
)
_SKILL_SEARCH_RE = re.compile(
    r"\b(?:search|find|cherche|trouve|look up)\b.{0,32}\bskill(?:s)?\b"
    r"|\bskill(?:s)?\b.{0,32}\b(?:for|about|on|sur|pour)\b",
    re.I,
)
_SKILL_RE = re.compile(r"\bskill(?:s)?\b", re.I)
_FILE_READ_TARGET_RE = re.compile(
    r"\b(?:file|fichier|package\.json|[\w.-]+\.(?:json|txt|md|py|ts|tsx|js|jsx|csv|html?|pdf))\b",
    re.I,
)
_FILE_WRITE_TARGET_RE = re.compile(
    r"\b(?:file|fichier|[\w.-]+\.(?:json|txt|md|py|ts|tsx|js|jsx|csv|html?|pdf))\b",
    re.I,
)
_FILE_LIST_TARGET_RE = re.compile(
    r"\b(?:files|fichiers|folder|dossier|directory|dir|répertoire|repertoire|workspace|pdfs?|images?|photos?)\b",
    re.I,
)
_FILE_READ_RE = re.compile(r"\b(?:read|open|show|affiche|lis|ouvre|display|what'?s inside)\b", re.I)
_FILE_WRITE_RE = re.compile(
    r"\b(?:write|create|save|edit|modify|append|écris|ecris|crée|cree|sauvegarde|modifie|ajoute)\b",
    re.I,
)
_FILE_LIST_RE = re.compile(r"\b(?:list|liste|show|affiche|montre|find|trouve|glob|search|cherche|ls|what(?:'s| is)\s+in)\b", re.I)
_MEMORY_RE = re.compile(
    r"\b(?:remember(?: this)?(?: fact)?|save (?:this |the )?fact(?: that)?|note that|souviens-toi|souviens toi|note ceci)\b",
    re.I,
)
# Memory-recall = "what do you know/remember ABOUT ME". Anchored on
# "about me" / "(sur|de) moi" so it can't fire on "do you remember the movie X".
# Since pure chat exposes zero tools (_CHAT_LEAN_TOOLS), this regex is the only
# path that surfaces stored facts in chat — keep FR + EN phrasings broad here,
# narrow on the "moi/me" anchor.
_MEMORY_RECALL_RE = re.compile(
    r"(?:"
    r"(?:what|tell me what)\s+(?:do\s+)?you\s+(?:remember|know)\s+about\s+me|"
    r"recall what you know about me|"
    r"list (?:the )?facts (?:you know )?about me|"
    r"tu\s+te\s+souviens\s+(?:de\s+)?(?:quoi\s+)?(?:sur|de)\s+moi|"
    r"te\s+souviens[- ]tu\s+(?:de\s+)?(?:quoi\s+)?(?:sur|de)\s+moi|"
    r"(?:qu['’]est[- ]ce que\s+)?tu\s+(?:sais|connais)\s+(?:quoi\s+)?(?:sur|de)\s+moi|"
    r"ce que\s+tu\s+(?:sais|connais)\s+(?:sur|de)\s+moi|"
    r"rappelle[- ]?moi\s+ce que tu sais\s+(?:sur|de)\s+moi|"
    r"liste\s+(?:les faits|ce)\s+que tu\s+(?:connais|sais)\s+(?:sur|de)\s+moi"
    r")",
    re.I,
)
_SHELL_REQUEST_RE = re.compile(
    r"\b(?:run|execute|launch|exécute|execute|lance)\b.{0,24}\b(?:command|cmd|shell|terminal)\b",
    re.I,
)
_RAW_SHELL_RE = re.compile(
    r"^\s*(?:mkdir|ls|cat|echo|git|npm|pnpm|yarn|python3?|node|curl|grep|rm|cp|mv|touch)\b"
    r"\s+(?:[-./~\"']|\w*[_./-]\w*|[A-Za-z][A-Za-z0-9_-]*)",
    re.I,
)
_DOWNLOAD_RE = re.compile(r"\b(?:download|fetch|grab|save|télécharge|telecharge)\b", re.I)
_FETCH_PAGE_RE = re.compile(r"\b(?:fetch|get|read|show|display|récupère|recupere|affiche|lis)\b.{0,24}\b(?:page|content|contenu|html)\b", re.I)
_HTTP_REQUEST_RE = re.compile(r"\b(?:api|endpoint|request|response|json|get|post|put|delete|patch|call)\b", re.I)
_DIR_CREATE_RE = re.compile(r"\b(?:create|make|mkdir|crée|cree)\b.{0,24}\b(?:folder|directory|dir|dossier|répertoire|repertoire)\b", re.I)
_WEATHER_RE = re.compile(r"\b(?:weather|météo|meteo|quel temps|il fait quel temps)\b", re.I)
_APP_OPEN_RE = re.compile(r"\b(?:open|launch|ouvre|lance)\b.{0,24}\b(?:calculator|calculatrice)\b", re.I)
_BASE64_RE = re.compile(r"\bbase64\b", re.I)
_IMAGE_SEARCH_RE = re.compile(r"\b(?:search|find|show|cherche|trouve|montre)\b.{0,24}\b(?:images?|pictures?|photos?)\b", re.I)
_GENERAL_WEB_SEARCH_RE = re.compile(
    r"\b(?:search|find|look up|show|fetch|get|cherche|trouve|recherche|news|actualité|actualite|latest|version|recipe|recette|restaurants?|homepage|article|wikipedia|github\.com|definition|définition|definition|price|prix|cours|usd|btc|bitcoin)\b",
    re.I,
)
_FAST_IMAGE_GEN_SIZE = "384x384"
_FAST_IMAGE_GEN_SEED = 1780042950
_FAST_IMAGE_GEN_CANONICAL_PROMPT = (
    "A watercolor painting of a cat on the moon, dreamy composition, "
    "soft brush strokes, detailed fur, starry night sky"
)


def _extract_requested_shell_command(msg: str) -> str | None:
    text = (msg or "").strip()
    if not text:
        return None
    quoted = re.search(
        r"^(?:run|execute|launch|exécute|execute|lance)\b(?:.{0,24}\b(?:for me|pour moi)\b)?\s*[`\"']([^`\"']+)[`\"']",
        text,
        re.I,
    )
    if quoted:
        return quoted.group(1).strip()
    direct = re.match(
        r"^(?:run|execute|launch|exécute|execute|lance)(?:\s+the\s+command|\s+la\s+commande|\s+command)?\s+(.+)$",
        text,
        re.I,
    )
    if direct:
        return direct.group(1).strip().strip("`")
    return None


def _looks_like_reminder_request(msg: str) -> bool:
    return bool(_REMINDER_RE.search(msg or ""))


def _looks_like_schedule_request(msg: str) -> bool:
    text = msg or ""
    return bool(_SCHEDULE_RE.search(text) or _RECURRING_TIME_RE.search(text))


def _looks_like_plan_request(msg: str) -> bool:
    text = msg or ""
    has_numbered_steps = bool(re.search(r"(?:^|[:\s])1\)\s*\S.*(?:^|[\s])2\)\s*\S", text, re.I))
    if has_numbered_steps and re.search(r"\b(?:organise|organize|arrange|structure|roadmap|plan)\b", text, re.I):
        return True
    return bool(
        _PLAN_RE.search(text)
        and re.search(r"\b(?:\d+\s*[- ]?step|\d+\s*étapes?|three|four|five|six|trois|quatre|cinq|six)\b", text, re.I)
    )


def _looks_like_skill_list_request(msg: str) -> bool:
    text = msg or ""
    return bool(_SKILL_LIST_RE.search(text) and not _SKILL_SEARCH_RE.search(text))


def _looks_like_skill_request(msg: str) -> bool:
    text = msg or ""
    return bool(_SKILL_SEARCH_RE.search(text) or (_SKILL_RE.search(text) and not _looks_like_skill_list_request(text)))


def _looks_like_file_read_request(msg: str) -> bool:
    text = msg or ""
    return bool(_FILE_READ_RE.search(text) and _FILE_READ_TARGET_RE.search(text))


def _looks_like_file_write_request(msg: str) -> bool:
    text = msg or ""
    return bool(_FILE_WRITE_RE.search(text) and _FILE_WRITE_TARGET_RE.search(text))


def _looks_like_file_listing_request(msg: str) -> bool:
    text = msg or ""
    return bool(_FILE_LIST_RE.search(text) and _FILE_LIST_TARGET_RE.search(text))


def _looks_like_memory_request(msg: str) -> bool:
    return bool(_MEMORY_RE.search(msg or ""))


def _looks_like_memory_recall_request(msg: str) -> bool:
    return bool(_MEMORY_RECALL_RE.search(msg or ""))


def _looks_like_shell_request(msg: str) -> bool:
    text = msg or ""
    return bool(_SHELL_REQUEST_RE.search(text) or _RAW_SHELL_RE.search(text) or _extract_requested_shell_command(text))


def _looks_like_download_request(msg: str) -> bool:
    text = msg or ""
    return bool(_DOWNLOAD_RE.search(text) and ("http://" in text or "https://" in text))


def _looks_like_fetch_page_request(msg: str) -> bool:
    text = msg or ""
    return bool(_FETCH_PAGE_RE.search(text) and ("http://" in text or "https://" in text))


def _looks_like_http_request(msg: str) -> bool:
    text = msg or ""
    urls = _extract_literal_urls(text)
    if not urls:
        return False
    if _looks_like_fetch_page_request(text) or _looks_like_download_request(text):
        return False
    if _HTTP_REQUEST_RE.search(text):
        return True
    return any("://api." in url.lower() or "/api/" in url.lower() for url in urls)


def _looks_like_directory_create_request(msg: str) -> bool:
    return bool(_DIR_CREATE_RE.search(msg or ""))


def _looks_like_weather_request(msg: str) -> bool:
    return bool(_WEATHER_RE.search(msg or ""))


def _looks_like_app_open_request(msg: str) -> bool:
    return bool(_APP_OPEN_RE.search(msg or ""))


def _looks_like_base64_request(msg: str) -> bool:
    return bool(_BASE64_RE.search(msg or ""))


def _looks_like_image_search_request(msg: str) -> bool:
    text = msg or ""
    if any(term in text.lower() for term in ("folder", "dossier", "directory", "workspace", "depuis le dossier", "dans le dossier")):
        return False
    return bool(_IMAGE_SEARCH_RE.search(text))


def _looks_like_general_web_search_request(msg: str) -> bool:
    text = msg or ""
    if not _GENERAL_WEB_SEARCH_RE.search(text):
        return False
    if any((
        _looks_like_file_listing_request(text),
        _looks_like_file_read_request(text),
        _looks_like_skill_list_request(text),
        _looks_like_skill_request(text),
        _looks_like_download_request(text),
        _looks_like_fetch_page_request(text),
        _looks_like_http_request(text),
        _looks_like_image_search_request(text),
        _looks_like_weather_request(text),
        _looks_like_shell_request(text),
    )):
        return False
    return True


def _looks_like_image_generation_request(msg: str) -> bool:
    text = msg or ""
    if any((
        _looks_like_directory_create_request(text),
        _looks_like_file_write_request(text),
        _looks_like_file_listing_request(text),
    )):
        return False
    return _is_image_gen_request(text)


def _looks_like_direct_action_request(msg: str) -> bool:
    text = msg or ""
    return any((
        _looks_like_reminder_request(text),
        _looks_like_schedule_request(text),
        _looks_like_plan_request(text),
        _looks_like_skill_request(text),
        _looks_like_file_read_request(text),
        _looks_like_file_write_request(text),
        _looks_like_file_listing_request(text),
        _looks_like_memory_request(text),
        _looks_like_memory_recall_request(text),
        _looks_like_shell_request(text),
        _looks_like_fetch_page_request(text),
        _looks_like_download_request(text),
        _looks_like_directory_create_request(text),
        _looks_like_weather_request(text),
        _looks_like_general_web_search_request(text),
        _looks_like_app_open_request(text),
        _looks_like_base64_request(text),
        _looks_like_image_search_request(text),
        _looks_like_image_generation_request(text),
    ))

_TASK_PREFIX_RE = re.compile(
    r"^(?:"
    r"cr[eé]e?z?\s+(?:[mt]oi\s+)?(?:une\s+)?(?:t[aâ]che\s+)?(?:r[eé]curr?ente?\s+)?|"
    r"planifie\s+(?:une\s+)?(?:t[aâ]che\s+)?(?:r[eé]curr?ente?\s+)?|"
    r"programme[rz]?\s+(?:une\s+)?(?:t[aâ]che\s+)?(?:r[eé]curr?ente?\s+)?|"
    r"schedule\s+(?:a\s+)?(?:recurring\s+)?(?:task\s+)?|"
    r"rappelle[\s-]?moi\s+(?:de\s+)?"
    r")",
    re.I,
)


def _parse_clock_time(msg: str) -> tuple[int, int] | None:
    text = msg or ""
    tm = re.search(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", text, re.I)
    if tm:
        hour = int(tm.group(1))
        minute = int(tm.group(2) or 0)
        meridiem = tm.group(3).lower()
        if hour == 12:
            hour = 0
        if meridiem == "pm":
            hour += 12
        return hour, minute
    tm = re.search(r"\b(?:à|a)?\s*(\d{1,2})h(?:(\d{2}))?\b", text, re.I)
    if tm:
        return int(tm.group(1)), int(tm.group(2) or 0)
    return None


def _try_deterministic_schedule(user_message: str) -> dict | None:
    """Extract schedule_agent_task args deterministically from a recurring request.

    Why: small models (Ministral-3-3B via Ollama) often fail to emit a valid
    tool_call JSON even when force-action engages — they hallucinate fake tool
    output as prose. When the user's wording is unambiguous (regex match on
    "toutes les N <unit>" / "every N <unit>"), build the call ourselves and
    skip the LLM entirely. Returns None if we can't extract a clean RRULE.
    """
    msg = (user_message or "").strip()
    if not msg:
        return None
    m = _RECURRING_PARSE_RE.search(msg)
    if not m:
        return None
    interval = int(m.group(1) or 1)
    unit = m.group(2).lower()
    freq = _UNIT_TO_FREQ.get(unit)
    if not freq:
        return None
    # schedule_agent_task rejects intervals shorter than 10 minutes.
    if freq == "MINUTELY" and interval < 10:
        return None
    rrule = f"FREQ={freq};INTERVAL={interval}"
    # Strip recurring directive prefix + the recurrence clause itself so the
    # scheduled prompt is just the action, not a re-scheduling instruction.
    body = _TASK_PREFIX_RE.sub("", msg).strip()
    body = _RECURRING_PARSE_RE.sub("", body).strip()
    body = re.sub(r"^(qui|that|to)\s+", "", body, flags=re.I)
    body = re.sub(r"\s+", " ", body).strip(" .,;:!?-—")
    if not body or len(body) < 3:
        return None
    delta_min = {
        "MINUTELY": interval,
        "HOURLY": interval * 60,
        "DAILY": interval * 1440,
        "WEEKLY": interval * 10080,
        "MONTHLY": interval * 43200,
    }.get(freq, 60)
    first = (datetime.now() + timedelta(minutes=delta_min)).strftime("%Y-%m-%d %H:%M")
    title = body[:60].strip(" .,;:!?-—") or body
    return {
        "title": title,
        "scheduled_for": first,
        "prompt": body,
        "recurrence": rrule,
    }


def _try_deterministic_weekday_schedule(user_message: str) -> dict | None:
    msg = (user_message or "").strip()
    if not msg:
        return None
    low = msg.lower()
    if not any(term in low for term in ("weekday", "weekdays", "en semaine", "jours ouvrés", "jours ouvres")):
        return None
    parsed_time = _parse_clock_time(msg)
    if not parsed_time:
        return None
    hour, minute = parsed_time
    now = datetime.now()
    first = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if first <= now:
        first += timedelta(days=1)
    while first.weekday() >= 5:
        first += timedelta(days=1)
    body = re.sub(r"^(?:schedule|planifie|programme)\s+", "", msg, flags=re.I)
    body = re.sub(r"\b(?:daily|every weekday|weekdays?|en semaine|quotidien(?:ne)?|tous les jours)\b", "", body, flags=re.I)
    body = re.sub(r"\b(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))\b", "", body, flags=re.I)
    body = re.sub(r"\b(?:à|a)?\s*\d{1,2}h(?:\d{2})?\b", "", body, flags=re.I)
    body = re.sub(r"\s+", " ", body).strip(" .,;:!?-—")
    body = re.sub(r"^(?:a|an|une?)\s+", "", body, flags=re.I)
    if not body:
        return None
    title = body[:60].strip(" .,;:!?-—") or body
    return {
        "title": title,
        "scheduled_for": first.strftime("%Y-%m-%d %H:%M"),
        "prompt": body,
        "recurrence": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    }


def _try_deterministic_weekly_schedule(user_message: str) -> dict | None:
    msg = (user_message or "").strip()
    if not msg:
        return None
    day_map = {
        "monday": ("MO", 0), "lundi": ("MO", 0),
        "tuesday": ("TU", 1), "mardi": ("TU", 1),
        "wednesday": ("WE", 2), "mercredi": ("WE", 2),
        "thursday": ("TH", 3), "jeudi": ("TH", 3),
        "friday": ("FR", 4), "vendredi": ("FR", 4),
        "saturday": ("SA", 5), "samedi": ("SA", 5),
        "sunday": ("SU", 6), "sundays": ("SU", 6), "dimanche": ("SU", 6), "dimanches": ("SU", 6),
    }
    low = msg.lower()
    match = next(((rrule, weekday) for term, (rrule, weekday) in day_map.items() if term in low), None)
    if match is None:
        return None
    parsed_time = _parse_clock_time(msg)
    if not parsed_time:
        return None
    byday, target_weekday = match
    hour, minute = parsed_time
    now = datetime.now()
    first = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    delta = (target_weekday - first.weekday()) % 7
    if delta == 0 and first <= now:
        delta = 7
    first += timedelta(days=delta)
    body = re.sub(r"^(?:schedule|set up|programme|planifie|remind me|rappelle(?:-moi)?)\s+", "", msg, flags=re.I)
    body = re.sub(r"\b(?:every|on|tous les|toutes les)\s+(?:sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|dimanches?|lundis?|mardis?|mercredis?|jeudis?|vendredis?|samedis?)\b", "", body, flags=re.I)
    body = re.sub(r"\b(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))\b", "", body, flags=re.I)
    body = re.sub(r"\b(?:à|a)?\s*\d{1,2}h(?:\d{2})?\b", "", body, flags=re.I)
    body = re.sub(r"\s+", " ", body).strip(" .,;:!?-—")
    body = re.sub(r"^(?:to\s+|pour\s+)", "", body, flags=re.I)
    if not body:
        return None
    title = body[:60].strip(" .,;:!?-—") or body
    return {
        "title": title,
        "scheduled_for": first.strftime("%Y-%m-%d %H:%M"),
        "prompt": body,
        "recurrence": f"FREQ=WEEKLY;BYDAY={byday}",
    }


# One-shot relative reminders: "in 60 min", "dans 2 heures", "in an hour".
# Weak 3B models call schedule_agent_task 4× in a row on these (one-shot has no
# recurring matcher, so it fell through to the LLM loop). Parse the delay here and
# dispatch a single non-recurring task. "every / toutes les" is recurring and is
# handled upstream — guard against it so we never steal a recurring request.
_ONESHOT_DELAY_RE = re.compile(
    r"\b(?:in|dans)\s+(\d+|an?|une?)\s*"
    r"(min|mins|minute|minutes|heure|heures|hour|hours|h)\b",
    re.I,
)


def _try_deterministic_oneshot_schedule(user_message: str) -> dict | None:
    msg = (user_message or "").strip()
    if not msg:
        return None
    # Recurring wording owns the request — let the recurring builders handle it.
    if _RECURRING_TIME_RE.search(msg) or _RECURRING_PARSE_RE.search(msg):
        return None
    m = _ONESHOT_DELAY_RE.search(msg)
    if not m:
        return None
    qty_raw = m.group(1).lower()
    qty = 1 if qty_raw in ("a", "an", "un", "une") else int(qty_raw)
    if qty <= 0:
        return None
    unit = m.group(2).lower()
    minutes = qty * 60 if unit.startswith("h") or "heure" in unit or "hour" in unit else qty
    first = (datetime.now() + timedelta(minutes=minutes)).strftime("%Y-%m-%d %H:%M")
    # Strip the scheduling prefix + the "in N <unit>" clause so the stored prompt
    # is just the action ("drink water"), not the scheduling instruction.
    body = _TASK_PREFIX_RE.sub("", msg).strip()
    body = _ONESHOT_DELAY_RE.sub("", body).strip()
    # Strip reminder/scheduling phrasing — leading OR left behind once a prefix
    # time clause ("dans 1 heure rappelle moi de …") is removed.
    body = re.sub(r"^(?:set\s+(?:a\s+)?reminder|reminder)\s+", "", body, flags=re.I)
    body = re.sub(r"^(?:remind\s+me|rappelle[\s-]?moi)\s+(?:to\s+|de\s+|d['’]\s*)?", "", body, flags=re.I)
    body = re.sub(r"^(?:to\s+|pour\s+|de\s+|que\s+|that\s+|qui\s+)", "", body, flags=re.I)
    body = re.sub(r"\s+", " ", body).strip(" .,;:!?-—")
    if not body or len(body) < 2:
        return None
    title = body[:60].strip(" .,;:!?-—") or body
    return {
        "title": title,
        "scheduled_for": first,
        "prompt": body,
    }


def _try_deterministic_plan(user_message: str) -> dict | None:
    msg = (user_message or "").strip()
    if not _looks_like_plan_request(msg):
        return None
    body = msg.split(":", 1)[1] if ":" in msg else msg
    numbered = [part.strip(" .-—")[:60] for part in re.split(r"\s*\d+\)\s*", body) if part.strip(" .-—")]
    if len(numbered) >= 3:
        return {"steps": numbered[:6], "current": 0}
    parts = re.split(r"\s*(?:,|;|\band then\b|\bthen\b|\bpuis\b|\bet\b)\s*", body, flags=re.I)
    steps = []
    for part in parts:
        clean = re.sub(r"^\d+\W*", "", part).strip(" .-—")
        if clean:
            steps.append(clean[:60])
    if len(steps) >= 3:
        return {"steps": steps[:6], "current": 0}
    count_match = re.search(r"\b(3|4|5|6|three|four|five|six|trois|quatre|cinq|six)\b", msg, re.I)
    count_map = {
        "3": 3, "4": 4, "5": 5, "6": 6,
        "three": 3, "four": 4, "five": 5, "six": 6,
        "trois": 3, "quatre": 4, "cinq": 5, "six": 6,
    }
    count = count_map.get((count_match.group(1).lower() if count_match else ""), 0)
    if count < 3:
        return None
    subject = re.sub(r"^(?:set up|create|plan|roadmap|fais|crée|cree|organise|organize)\s+", "", msg, flags=re.I)
    subject = re.sub(r"\b(?:a|an|une?)\s+\d+\s*[- ]?step\b", "", subject, flags=re.I)
    subject = re.sub(r"\b(?:three|four|five|six|trois|quatre|cinq|six)\s+étapes?\b", "", subject, flags=re.I)
    subject = re.sub(r"\b(?:roadmap|plan|project)\b", "", subject, flags=re.I)
    subject = re.sub(r"\s+", " ", subject).strip(" .:-—")
    if not subject:
        return None
    generic_steps = [
        f"Define scope and goals for {subject}",
        f"Gather assets and structure for {subject}",
        f"Build the main deliverable for {subject}",
        f"Review, polish, and ship {subject}",
        f"Validate quality for {subject}",
        f"Wrap up and publish {subject}",
    ]
    return {"steps": generic_steps[:count], "current": 0}


# Action tools eligible for the forced-first single-tool path even when lean
# pure chat hides them from the LLM tool list. All are regex-gated, unambiguous
# action intents. Web/search_web is intentionally absent — the only web path is
# _should_force_web_tools, preserving "no web search unless the user mentions it".
_LEAN_FORCEABLE_ACTIONS: frozenset[str] = frozenset({
    "recall_facts", "remember_note", "search_images",
})


def _detect_action_tool(msg: str, active_tool_names: set[str]) -> str | None:
    """Return a tool name to force on iter-1 via tool_choice='required', or None.

    Why: small/local models (Ministral-3-3B, Llama-3.2-3B…) often ignore tools
    and chat instead — "cree une tache recurente toutes les 15 minutes …" comes
    back as "What can I do for you today?". Mirrors _should_force_web_tools but
    targets action verbs instead of info-seeking patterns. Restricted to tools
    currently in the active pack so we never force a tool the model can't emit.
    """
    m = (msg or "").lower().strip()
    if not m or len(m) < 10:
        return None
    if _is_pure_small_talk(m):
        return None
    if "set_plan" in active_tool_names and _looks_like_plan_request(m):
        return "set_plan"
    if "add_reminder" in active_tool_names and _looks_like_reminder_request(m) and not _looks_like_schedule_request(m):
        return "add_reminder"
    if "recall_facts" in active_tool_names and _looks_like_memory_recall_request(m):
        return "recall_facts"
    if "schedule_agent_task" in active_tool_names:
        if any(k in m for k in _TASK_ACTION_KW) or _looks_like_schedule_request(m):
            return "schedule_agent_task"
        if _RECURRING_TIME_RE.search(m):
            return "schedule_agent_task"
    if "search_web" in active_tool_names and _looks_like_weather_request(m):
        return "search_web"
    if "search_web" in active_tool_names and _looks_like_general_web_search_request(m):
        return "search_web"
    if "fetch_page" in active_tool_names and _looks_like_fetch_page_request(m):
        return "fetch_page"
    if "http_request" in active_tool_names and _looks_like_http_request(m):
        return "http_request"
    if "download_file" in active_tool_names and _looks_like_download_request(m):
        return "download_file"
    if "generate_image" in active_tool_names and _looks_like_image_generation_request(m):
        return "generate_image"
    if "search_images" in active_tool_names and _looks_like_image_search_request(m):
        return "search_images"
    if "skill_list" in active_tool_names and _looks_like_skill_list_request(m):
        return "skill_list"
    if "skill_search" in active_tool_names and _looks_like_skill_request(m):
        return "skill_search"
    if "glob_files" in active_tool_names and _looks_like_file_listing_request(m) and "pdf" in m:
        return "glob_files"
    if "list_dir" in active_tool_names and _looks_like_file_listing_request(m):
        return "list_dir"
    if "read_file" in active_tool_names and _looks_like_file_read_request(m):
        return "read_file"
    if "write_file" in active_tool_names and _looks_like_file_write_request(m):
        return "write_file"
    if "remember_note" in active_tool_names and _looks_like_memory_request(m):
        return "remember_note"
    if "run_command" in active_tool_names and (
        _looks_like_shell_request(m)
        or _looks_like_directory_create_request(m)
        or _looks_like_app_open_request(m)
        or _looks_like_base64_request(m)
    ):
        return "run_command"
    return None


def _build_action_first_system(action_name: str, workspace: str, is_wa: bool) -> str:
    """Minimal system prompt for force-first-action turns.

    Why: the full SYSTEM_PROMPT + protocols + skills + KB context + pack catalog
    is ~10k+ chars of mostly-irrelevant rules for a "create one task" request.
    Small models (Ministral-3-3B via Ollama) get overwhelmed and emit prose
    that mimics tool output instead of a real tool_call. OpenRouter routes the
    same model with less surrounding noise — proves the model itself is capable.

    This stripped prompt keeps only what the model needs for ONE action call:
    fresh date/time (for relative scheduling), the tool name, and a short
    confirmation rule. WA channel gets the conversational output rule too.
    """
    parts = [
        _now_block(),
        "",
        f"You are an action-execution agent. The user has requested a concrete action: `{action_name}`.",
        "",
        "RULES:",
        f"- Your first response MUST be a call to `{action_name}` with parameters extracted from the user's message.",
        "- No prose. No clarifying questions. No enrichment. No plan. Just the tool call.",
        "- For relative times (\"in 15 minutes\", \"toutes les 15 minutes\"), use the [NOW] value above as the reference.",
        "- Reply in the user's language after the tool returns.",
        "",
        "AFTER TOOL RESULT:",
        "- Result starts with \"OK:\" → reply with ONE short sentence confirming what was scheduled (title + frequency).",
        "- Result starts with \"ERREUR:\" → state the error in one short sentence. Never fake success.",
        "",
        f"Workspace: {workspace}/",
    ]
    if is_wa:
        parts.append("")
        parts.append(
            "WHATSAPP REPLY: plain prose only. No markdown, no code fences, no bullets, "
            "no JSON, no tool names, no internal codenames (Monkey/Tigre/...). "
            "Speak naturally as the persona to the contact, in their language."
        )
    return "\n".join(parts)


def _build_chat_direct_system(persona: str, context_str: str, is_wa: bool) -> str:
    """Minimal system prompt for pure-chat turns that expose ZERO tools.

    Why: small local models (Llama-3.2-3B, Ministral-3-3B via Ollama) cannot
    resist calling whatever tools are dangled. On a plain knowledge/conversation
    question they loop tool calls (recall_facts/list_dir/expand_tools 8-14x →
    90-250s → empty answer). _CHAT_LEAN_TOOLS is therefore empty for pure chat —
    but the full ~10k-char agentic SYSTEM_PROMPT still pushes the model into
    tool-mode (it emits pseudo-tool TEXT like `search_web: "..."` instead of an
    answer). This stripped prompt removes the agent-loop framing so the model
    just answers, in the user's language, from its own knowledge.
    """
    parts = [
        persona.strip(),
        "",
        context_str.strip(),
        "",
        "Answer the user's message directly and helpfully, in THEIR language, "
        "using your own knowledge. Be concise and natural.",
        "You have NO tools for this message. Never output tool-call syntax, "
        "JSON, function names, or `search_web:`-style directives — just reply.",
        "Read the [NOW] context for the current date/time; never claim you cannot know it.",
    ]
    if is_wa:
        parts.append(
            "WHATSAPP REPLY: plain prose only. No markdown, no code fences, no "
            "bullets, no internal codenames. Speak naturally as the persona."
        )
    return "\n".join(parts)


def _detect_intent(msg: str) -> str:
    m = msg.lower().strip()
    # Greeting → chat.
    if _is_pure_small_talk(msg):
        return "chat"
    # Conversational fallback: short message with no action / info-seeking hint → chat.
    if len(m) <= 80 and "?" not in m and not any(k in m for k in _ACTION_HINT_KW) and not _looks_like_direct_action_request(m):
        return "chat"
    if any(k in m for k in _CODE_KW): return "code"
    if any(k in m for k in _BROWSE_KW): return "browse"
    # Web/search intent ONLY when the user explicitly signals a web / current-info
    # need (rule 2026-06-05: no web search unless the user mentions web). How-to and
    # general-knowledge questions ("comment élever des grenouilles", "explique X",
    # "qu'est-ce que X") are answered from the model's own knowledge — no reflexive
    # web search. _HOWTO_KW / _SEARCH_KW no longer route here; the model can still
    # call expand_tools(["search"]) mid-conversation if a real lookup is needed.
    if _mentions_web(m): return "search"
    if any(k in m for k in _ORCHESTRATE_KW): return "orchestrate"
    # Default to "chat" (toolless) — ambiguous messages with no action/keyword
    # hint should NOT pre-load the search/browse pack. Pre-loading primes the
    # LLM to call tools with canonical training filler. The model can still
    # call expand_tools when a real action is needed mid-conversation.
    return "chat"


_FLASH_MODEL_KW = ("flash", "mini", "small", "lite", "nano", "haiku", "fast")
_COMPACT_TOOL_SCHEMA_MODEL_KW = _FLASH_MODEL_KW + ("deepseek-v3", "deepseek-chat-v3")
_TRIVIAL_TOOLS: frozenset[str] = frozenset({
    "set_clipboard", "get_clipboard", "send_notification",
    "recall_facts", "remember_fact", "remember_note", "add_reminder",
    "think", "set_plan",
})
_COMPRESSED_TOOLS: list[dict] | None = None

# ── Tool packs by category ────────────────────────────────────────────────────
# Goal: send only the tools relevant to the detected intent + content triggers.
# Saves ~3-7k tokens per LLM call vs full schema.
_TOOL_CATEGORIES: dict[str, str] = {
    # core_min: minimal always-on set (think, plan, memory, subagent, expand)
    # + list_dir/read_file/get_file_info: read-only file inspection is so
    # universally requested ("show me folder X", "what's in file Y") that
    # forcing an expand_tools round-trip causes the model to narrate `ls`
    # instead of acting. Cheap (~3 tools), high impact on UX.
    "think": "core_min", "set_plan": "core_min",
    "run_subagent": "core_min", "expand_tools": "core_min",
    "remember_fact": "core_min", "recall_facts": "core_min", "remember_note": "core_min",
    # osint scratch notebook
    "osint_note": "osint", "osint_dump": "osint",
    "osint_list": "osint", "osint_clear": "osint", "osint_citation_check": "osint",
    # osint intel
    "whois_lookup": "osint", "dns_records": "osint", "subdomain_enum": "osint",
    "wayback_snapshots": "osint", "gravatar_lookup": "osint",
    "hibp_password_check": "osint", "phone_parse": "osint", "http_headers": "osint",
    "osint_dorks": "osint", "multi_engine_search": "osint",
    "username_pivot": "osint", "reddit_user": "osint", "hn_user": "osint",
    "github_user": "osint", "github_code_search": "osint",
    "exif_extract": "osint", "image_phash": "osint", "reverse_image_urls": "osint",
    "nominatim_geocode": "osint", "nominatim_reverse": "osint", "gdelt_search": "osint",
    "recherche_entreprises": "osint", "wikidata_search": "osint",
    # search (always loaded by default — covers 80% of requests across all languages)
    "search_web": "search", "search_and_read": "search", "search_images": "search",
    "fetch_page": "search", "http_request": "search", "download_file": "search",
    # kb_* tools — niche, only useful when user references KB; loaded on demand.
    "kb_search": "kb", "kb_list": "kb", "kb_stats": "kb",
    "kb_archive": "kb", "kb_delete": "kb",
    "kb_purge_unindexed": "kb", "kb_search_and_delete": "kb",
    # files (on demand) — list_dir/read_file/get_file_info promoted to core_min
    # so "list folder X" / "show file Y" requests don't need expand_tools first
    # (was causing the model to narrate `ls` instead of acting).
    "read_file": "core_min", "list_dir": "core_min", "get_file_info": "core_min",
    "list_dir_images": "core_min",
    "read_file_chunk": "files", "write_file": "files",
    "edit_file": "files", "append_to_file": "files",
    "grep_files": "files", "glob_files": "files",
    "move_file": "files", "copy_file": "files",
    "delete_file": "files", "open_file": "files",
    # shell
    "run_command": "shell",
    # clipboard
    "get_clipboard": "clipboard", "set_clipboard": "clipboard",
    # checkpoint
    "restore_last_green": "checkpoint", "list_green_checkpoints": "checkpoint",
    # calendar / notifications / scheduling
    "send_notification": "calendar", "add_reminder": "calendar",
    "create_calendar_event": "calendar", "schedule_agent_task": "calendar",
    # skills management
    "skill_list": "skills_mgmt", "skill_search": "skills_mgmt", "skill_create": "skills_mgmt",
    "skill_revise": "skills_mgmt", "skill_delete": "skills_mgmt",
    # browse
    "browser_navigate": "browse", "browser_get_text": "browse",
    "browser_get_clean_text": "browse", "browser_get_links": "browse",
    "browser_click": "browse", "browser_fill": "browse", "browser_scroll": "browse",
    "browser_scroll_to_bottom": "browse", "browser_paginate": "browse",
    "browser_run_js": "browse", "browser_screenshot": "browse", "browser_solve_captcha": "browse",
    "browser_wait_for": "browse", "browser_navigate_back": "browse",
    "browser_current_url": "browse",
    # whatsapp
    "whatsapp_send_media": "whatsapp", "whatsapp_send_file": "whatsapp",
    # code-scaffold
    "repo_skill_list": "code", "repo_skill_search": "code",
    "repo_skill_show": "code", "repo_skill_install": "code",
    "scaffold_app_fullstack": "code", "scaffold_game_2d": "code",
    # image-gen
    "generate_image": "image",
    # music-gen
    "generate_music": "music",
    # video-gen
    "generate_video": "video",
    # media (heavy doc/image/audio/video processing)
    "generate_pdf": "media",
    "svg_shape": "media", "image_to_svg": "media",
    "image_to_heightmap_stl": "media", "extract_palette": "media",
    "resize_image": "media", "convert_image": "media", "ocr_image": "media",
    "image_to_ascii": "media", "generate_spritesheet": "media", "tilemap_render": "media",
    "qr_code": "media", "barcode_generate": "media",
    "vcard_create": "media", "ics_event_create": "media",
    "markdown_to_html": "media", "json_to_csv": "media", "csv_to_json": "media",
    "xlsx_create": "media", "xlsx_read": "media", "xlsx_write_cells": "media",
    "xlsx_append_rows": "media", "xlsx_to_csv": "media",
    "docx_create": "media", "docx_read": "media", "docx_replace": "media",
    "pptx_create": "media", "pptx_read": "media",
    "pdf_extract_text": "media", "pdf_merge": "media", "pdf_split": "media",
    "pdf_extract_pages": "media", "pdf_rotate": "media", "pdf_metadata": "media",
    "pdf_add_watermark": "media", "pdf_encrypt": "media",
    "eml_create": "media", "eml_read": "media",
    "audio_extract": "media", "audio_convert": "media",
    "video_thumbnail": "media", "video_to_gif": "media",
    "compress_archive": "media", "extract_archive": "media", "file_hash": "media",
    # mail (IMAP/SMTP)
    "mail_list_accounts": "mail", "mail_unread_count": "mail", "mail_list": "mail",
    "mail_search": "mail", "mail_read": "mail", "mail_sync": "mail",
    "mail_summarize_inbox": "mail", "mail_send": "mail",
    "mail_flag": "mail", "mail_move": "mail", "mail_archive": "mail",
    "mail_delete": "mail", "mail_list_folders": "mail",
    "mail_reply": "mail", "mail_clean_inbox": "mail",
    "mail_label_add": "mail", "mail_label_remove": "mail",
}

# Universal pattern triggers — language-agnostic.
# Only character-class regexes (URLs, paths, file extensions) and universal
# technical tokens that exist identically across all natural languages
# (`npm`, `pip`, `cargo`, `git`, `docker`, `curl`). No natural-language words.
_UNIVERSAL_TRIGGERS: list[tuple[re.Pattern[str], frozenset[str]]] = [
    (re.compile(r"https?://", re.I), frozenset({"browse"})),
    (re.compile(r"(?:^|[\s'\"])(?:\.{1,2}/|~/|/[A-Za-z0-9_.-]+/|[A-Za-z]:\\)"), frozenset({"files"})),
    (re.compile(r"\.(pdf|xlsx?|docx?|pptx?|mp[34]|wav|ogg|flac|m4a|png|jpe?g|gif|webp|svg|heic|bmp|mkv|avi|mov|webm|zip|tar(?:\.gz)?|csv|md|html?|xml|eml|ics)\b", re.I), frozenset({"media", "files"})),
    (re.compile(r"```|^#!|\bnpm\b|\bpip\b|\bcargo\b|\bgit\b|\bdocker\b|\bcurl\b|\bbash\b|\bnpx\b", re.I), frozenset({"code", "shell", "files"})),
    # Literal UNIX command invocations: cmd + space + flag/path/quote. Strict on
    # the next token (must look like -flag, ./path, ~/path, /abs, or quoted) to
    # avoid false positives like "my cat is funny" or "I'll find out".
    (re.compile(r"\b(?:ls|cat|cp|mv|rm|mkdir|rmdir|chmod|chown|find|grep|head|tail|wc|ps|kill|tar|unzip|gzip|gunzip|which|whoami|uname|ssh|scp|rsync|du|df|lsof|sort|uniq|sed|awk|xargs|touch|stat|file|tree|mount|umount)\s+(?:[-+]|\.{1,2}(?:[/\s]|$)|~/|/|\"|')", re.I), frozenset({"shell", "files"})),
    # Multilingual file/folder NL hints: "le dossier X", "the folder X", "el archivo X".
    # Requires definite-article + file/folder noun + a name token. Catches the
    # common case where user asks about files without typing a literal path.
    # (list_dir/read_file are already in core_min — this loads the full files pack.)
    (re.compile(r"\b(?:le|la|les|the|el|los|las|der|die|das|il|lo|gli|un|une|une?s?)\s+(?:dossier|r[eé]pertoire|folder|director(?:y|io)|fichier|files?|carpeta|archivos?|ordner|datei|cartella|pasta|arquivo)\b", re.I), frozenset({"files"})),
    (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b|\b(?:imap|smtp|inbox|mailbox|e?-?mail|courriel|boite mail|bo[iî]te aux lettres)\b", re.I), frozenset({"mail"})),
    # OSINT signals: explicit keywords (any language), domain WHOIS terms, social-handle pattern.
    (re.compile(r"\b(?:osint|whois|dox|breach|wayback|exif|geolocate|g[eé]olocaliser|reverse\s+(?:image|phone|email)|username\s+pivot|background\s+check|enqu[eê]te|investigation|investigate|profile?r|track\s+down|retrouver|fouiller\s+sur|creuser\s+sur|sub-?domain|sous-domaine|crt\.sh|dns\s+lookup|gravatar|hibp|pwned|siren|siret|recherche-entreprises|wikidata|nominatim|gdelt)\b|\B@[A-Za-z0-9_]{3,30}\b", re.I), frozenset({"osint", "search", "browse"})),
    # Image-generation: explicit beneficiary only ("dessine-moi", "draw me").
    # NOTE — Previous broad gen-verb + image-noun regex was too loose: it matched
    # narrative text mentioning "image"/"scene"/"logo" inside multi-step tasks
    # (e.g. evangelization scenarios), which loaded the image pack and let the
    # LLM hallucinate `local_image_gen("a cat in a red hat")`-style canonical
    # filler. Users wanting image generation can phrase explicitly or call
    # expand_tools(["image"]).
    (re.compile(r"\b(?:dessine[-\s]+(?:moi|nous)|illustre[-\s]+(?:moi|nous)|draw\s+me|paint\s+me|sketch\s+me)\b", re.I), frozenset({"image"})),
]

# Intent → default pack set. core_min always merged in. Defaults stay minimal
# and language-neutral: search/browse are universally useful so kept by default.
# Anything else the model loads on demand via expand_tools.
_INTENT_PACKS: dict[str, frozenset[str]] = {
    # Keep defaults minimal. Small models (3B) collapse to empty completions
    # when given 30+ tools. browse (15 browser_* tools) is opt-in via URL
    # trigger; kb_* tools moved to "kb" pack (loaded when KB-relevant terms
    # appear). search pack itself is trimmed (see _TOOL_CATEGORIES).
    # chat: NO search pack. Rule 2026-06-05 — no web tools unless the user mentions
    # web. A web mention routes to "search" intent (see _detect_intent), so chat
    # intent never needs the web pack; model can still expand_tools(["search"]).
    # (core_min keeps think/memory + read-only file inspectors per the tested
    # invariant test_list_dir_in_default_chat_tools.)
    "chat": frozenset({"core_min"}),
    "search": frozenset({"core_min", "search"}),
    "browse": frozenset({"core_min", "search", "browse"}),
    "code": frozenset({"core_min", "search", "code", "files", "shell"}),
    # orchestrate: keep code/files/shell/calendar (planning + scheduling staples).
    # Drop media/image/mail — those packs include heavy-weight local tools
    # (local_transcribe, local_speak, local_image_gen) that the LLM otherwise
    # calls with canonical training-data fillers ("hello world", "/home/user/audio.wav").
    # The model can still load them on demand via expand_tools(["media"]) etc.
    # WhatsApp channel keeps full parity via _select_packs (see line below).
    "orchestrate": frozenset({"core_min", "search", "browse", "code", "files", "shell", "calendar"}),
}

_PACK_TOOLS_CACHE: dict[frozenset[str], list[dict]] = {}
_LOCAL_DYNAMIC_TOOL_NAMES: set[str] = set()


def _select_packs(intent: str, message: str, session_id: str | None,
                  scheduled_run: bool = False) -> frozenset[str]:
    packs = set(_INTENT_PACKS.get(intent, _INTENT_PACKS["search"]))
    packs.add("core_min")
    msg = message or ""
    # Web-mention gate (belt-and-suspenders): strip the web pack from non-web
    # intents (code/orchestrate) when the user did not mention web. Rule 2026-06-05
    # — no web search unless asked. search/browse intents are web by nature (set
    # only when web/URL mentioned, see _detect_intent) so are exempt. osint and
    # other _UNIVERSAL_TRIGGERS below re-add search/browse when their keywords hit.
    if intent not in ("search", "browse") and not _mentions_web(msg):
        packs.discard("search")
        packs.discard("browse")
    for pattern, triggered in _UNIVERSAL_TRIGGERS:
        if pattern.search(msg):
            packs.update(triggered)
    if _looks_like_schedule_request(msg) or _looks_like_reminder_request(msg):
        packs.add("calendar")
    if _looks_like_skill_request(msg) or _looks_like_skill_list_request(msg):
        packs.add("skills_mgmt")
    if _looks_like_image_generation_request(msg):
        packs.add("image")
    if _looks_like_file_read_request(msg) or _looks_like_file_write_request(msg) or _looks_like_file_listing_request(msg):
        packs.add("files")
    if _looks_like_shell_request(msg) or _looks_like_directory_create_request(msg) or _looks_like_app_open_request(msg) or _looks_like_base64_request(msg):
        packs.update({"shell", "files"})
    if isinstance(session_id, str) and session_id.startswith("whatsapp:") and not scheduled_run:
        # INVARIANT — DO NOT REGRESS: WhatsApp agent MUST have full parity with the desktop
        # fixed agent. Same tool capabilities, no "lightweight" mode. WhatsApp is a channel,
        # not a capability tier. Previous regression (commit shipping the core_min refactor)
        # left WA on {core_min, search, browse, whatsapp} only → no files/shell/media/image/
        # code/calendar. User-visible symptom: "the WhatsApp agent stopped using tools".
        # If you ever shrink this set, add an explicit prefs flag and DO NOT touch the default.
        # Scheduled tasks are different: they may target a WhatsApp chat, but they should not
        # inherit the live-chat full-parity prompt/tool blast by default. That path was loading
        # media tools (local_transcribe/local_speak/...) and causing filler tool calls.
        packs.add("whatsapp")
        packs.update(_INTENT_PACKS["orchestrate"])
        packs.update({"files", "shell", "media", "image", "code", "calendar", "mail",
                      "clipboard", "checkpoint", "skills_mgmt", "browse", "search"})
    return frozenset(packs)
from monkey.context_mgr import (
    summarize_tool_content as _summarize_tool_content,
    compact_history as _compact_history,
    scan_project_state as _scan_project_state,
    estimate_tokens as _estimate_tokens,
    synthesize_history as _synthesize_history,
    apply_message_window as _apply_message_window,
    prepare_messages_for_llm as _prepare_messages_for_llm,
    MAX_MESSAGES_IN_CONTEXT as _MAX_MESSAGES_IN_CONTEXT,
    KEEP_LAST_FULL as _KEEP_LAST_FULL,
    CONTEXT_SUMMARY_TRIGGER_TOKENS as _CONTEXT_SUMMARY_TRIGGER_TOKENS,
)


def _persist_session(user_message: str, final_text: str, tool_results: list[dict]) -> None:
    """No-op. Sessions used to be dumped verbatim into ~/.monkey/memory.db,
    which captured hallucinated outputs and re-injected them as 'memory'.
    Explicit memorization only via remember_fact / remember_note.
    """
    return




def _compress_tools(tools: list[dict]) -> list[dict]:
    compressed = []
    for t in tools:
        t2 = copy.deepcopy(t)
        fn = t2["function"]
        desc = fn.get("description", "")
        fn["description"] = re.split(r'[.!]', desc)[0].strip()[:80]
        props = fn.get("parameters", {}).get("properties", {})
        for pname, pval in props.items():
            if isinstance(pval.get("description"), str):
                pdesc = pval["description"]
                pval["description"] = re.split(r'[.(,]', pdesc)[0].strip()[:60]
        compressed.append(t2)
    return compressed


def _drop_unavailable_tools(tools: list[dict]) -> list[dict]:
    """Hide tools whose backend isn't usable right now. Runtime-conditional, so
    NOT baked into the global/pack caches (availability flips when the user
    installs a model). generate_image: drop when no FLUX nor custom image
    endpoint — stops weak models from attempting a guaranteed-to-fail gen."""
    try:
        from monkey.tools.image import image_generation_available
        if image_generation_available():
            return tools
    except Exception:
        return tools
    return [t for t in tools if t["function"]["name"] != "generate_image"]


# Pure-chat lean allowlist. core_min carries 17 tools (think, set_plan,
# run_subagent, expand_tools, remember_fact/note, recall_facts, read_file,
# list_dir, get_file_info, list_dir_images + 6 uncategorized task/notify tools).
# Weak 3B models over-trigger the heavy ones on plain chat → 7-14 needless
# calls / 90-250s (bugs.md 2026-06-05 over-tooling). Worst offender measured:
# recall_facts — on a general-knowledge question ("frog rearing tips?") the 3B
# loops recall_facts 11x with mangled keys, hits max_iters, returns empty.
# recall_facts is therefore EXCLUDED from lean chat: name-memory ("remember my
# name?") answers from conversation history, not stored facts. When packs is
# EXACTLY {core_min} (intent=chat, no trigger fired) we collapse to read-only
# file inspectors + the expand_tools escape hatch, so the model answers directly
# but can still pull a pack on demand.
# Keeps read_file/list_dir/get_file_info (test_list_dir_in_default_chat_tools)
# and excludes every write tool (test_write_tools_still_gated_behind_files_pack).
_CHAT_LEAN_TOOLS: frozenset[str] = frozenset()
_CHAT_ONLY_PACKS: frozenset[str] = frozenset({"core_min"})


def _get_active_tools(model_id: str | None, packs: frozenset[str] | None = None) -> list[dict]:
    global _COMPRESSED_TOOLS
    if _COMPRESSED_TOOLS is None:
        _COMPRESSED_TOOLS = _compress_tools(TOOLS)
    if not packs:
        return _drop_unavailable_tools(_COMPRESSED_TOOLS)
    cached = _PACK_TOOLS_CACHE.get(packs)
    if cached is None:
        if packs == _CHAT_ONLY_PACKS:
            cached = [
                t for t in _COMPRESSED_TOOLS
                if t["function"]["name"] in _CHAT_LEAN_TOOLS
            ]
        else:
            cached = [
                t for t in _COMPRESSED_TOOLS
                if _TOOL_CATEGORIES.get(t["function"]["name"], "core_min") in packs
            ]
        _PACK_TOOLS_CACHE[packs] = cached
    return _drop_unavailable_tools(cached)


def _first_web_tools(active_tools: list[dict]) -> list[dict]:
    # Forced first-web step should stay focused on query-based retrieval.
    # Allowing browser navigation here makes the model jump to unrelated pages.
    allowed = {"search_web", "search_and_read"}
    filtered = [t for t in active_tools if t["function"]["name"] in allowed]
    return filtered or active_tools


_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg"}
_IMAGE_REQUEST_TERMS = (
    "image", "images", "photo", "photos", "picture", "pictures",
    "img", "screenshot", "screenshots", "illustration", "illustrations",
    "image", "images",
)
_FOLDER_REQUEST_TERMS = (
    "folder", "directory", "dir", "dossier", "repertoire", "répertoire",
)

# Mirrors the _UNIVERSAL_TRIGGERS image-gen patterns so _forced_retry_plan can
# steer retries straight at generate_image when the model failed to call it.
_IMAGE_GEN_PATTERNS = (
    re.compile(
        r"\b(?:g[eé]n[eè]re[rs]?|generates?|cr[eé]e[rs]?|creates?|draws?|dessine[rs]?|illustre[rs]?|illustrates?|paints?|peins|peindre|peint|renders?|designs?|composes?|fais|fait|faire|makes?|imagine[rs]?)\b.{0,40}\b(?:image|images|picture|pictures|photo|photos|illustration|illustrations|dessin|dessins|drawing|drawings|painting|paintings|peinture|peintures|artwork|portrait|portraits|sc[eè]ne|scenes|sketch|sketches|sprite|sprites|icon|icons|ic[ôo]ne|ic[ôo]nes|logo|logos|banner|banners|banni[eè]res?|poster|posters|affiches?|cover|covers|couvertures?|wallpaper|wallpapers|mascotte|mascot|mascots)\b",
        re.I,
    ),
    re.compile(r"\b(?:dessine[-\s]+(?:moi|nous)|illustre[-\s]+(?:moi|nous)|draw\s+me|paint\s+me|sketch\s+me)\b", re.I),
    re.compile(r"^\s*(?:draw|paint|sketch|illustrate|create|generate|dessine|illustre|crée|cree|génère|genere)\b.{0,120}$", re.I),
)


def _is_image_gen_request(text: str) -> bool:
    msg = text or ""
    return any(p.search(msg) for p in _IMAGE_GEN_PATTERNS)


def _tool_names(active_tools: list[dict]) -> set[str]:
    return {t.get("function", {}).get("name") for t in active_tools}


def _subset_tools(active_tools: list[dict], allowed_names: tuple[str, ...]) -> list[dict]:
    filtered = [t for t in active_tools if t.get("function", {}).get("name") in allowed_names]
    return filtered or active_tools


_POSITIONAL_TOOL_ARG_NAMES: dict[str, tuple[str, ...]] = {
    "list_dir": ("path", "depth"),
    "list_dir_images": ("path", "recursive", "limit"),
    "glob_files": ("pattern", "path"),
    "read_file": ("path", "max_chars"),
    "read_file_chunk": ("path", "chunk"),
    "get_file_info": ("path",),
}


def _extract_inline_tool_call(text: str) -> tuple[str, dict] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.fullmatch(r"```(?:[a-zA-Z0-9_-]+)?\s*(.*?)```", raw, re.DOTALL)
    if fence:
        raw = fence.group(1).strip()
    raw = raw.strip()
    # JSON tool-call format: small models (e.g. mistral-3-3b) emit the OpenAI
    # function shape `{"name": "X", "parameters"|"arguments": {...}}` as content
    # instead of a native tool_call. llama.cpp's --jinja parser rejects it (HTTP
    # 500 "Failed to parse"); after we retry without native tools (llm.py), the
    # raw JSON lands here. Parse it directly before the Python-call path.
    if raw.startswith("{") or '"name"' in raw[:200]:
        candidate = raw
        if not candidate.startswith("{"):
            brace = re.search(r"\{.*\}", raw, re.DOTALL)
            candidate = brace.group(0) if brace else raw
        try:
            obj = json.loads(candidate)
        except Exception:
            obj = None
        if isinstance(obj, dict):
            fn_name = obj.get("name")
            fn_args = obj.get("parameters")
            if fn_args is None:
                fn_args = obj.get("arguments")
            if isinstance(fn_args, str):
                try:
                    fn_args = json.loads(fn_args)
                except Exception:
                    fn_args = None
            if isinstance(fn_name, str) and fn_name in TOOL_NAMES and isinstance(fn_args, dict):
                return fn_name, fn_args
    if "\n" in raw:
        lines = [line.strip() for line in raw.splitlines() if line.strip()]
        if len(lines) != 1:
            return None
        raw = lines[0]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)", raw):
        return None
    try:
        node = ast.parse(raw, mode="eval").body
    except Exception:
        m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)\((.*)\)", raw, re.DOTALL)
        if not m:
            return None
        fn_name = m.group(1)
        inner = m.group(2).strip()
        if fn_name not in TOOL_NAMES:
            return None
        if fn_name in {"list_dir", "list_dir_images", "read_file", "get_file_info"} and inner and "," not in inner and "=" not in inner:
            return fn_name, {"path": inner.strip().strip("`").strip("\"'")}
        return None
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
        return None
    fn_name = node.func.id
    if fn_name not in TOOL_NAMES:
        return None
    positional_names = _POSITIONAL_TOOL_ARG_NAMES.get(fn_name)
    if positional_names is None:
        return None
    args: dict[str, object] = {}
    for idx, arg in enumerate(node.args):
        if idx >= len(positional_names):
            return None
        try:
            args[positional_names[idx]] = ast.literal_eval(arg)
        except Exception:
            return None
    for kw in node.keywords:
        if kw.arg is None:
            return None
        try:
            args[kw.arg] = ast.literal_eval(kw.value)
        except Exception:
            return None
    return fn_name, args


def _is_folder_image_request(user_message: str) -> bool:
    text = (user_message or "").lower()
    wants_images = any(term in text for term in _IMAGE_REQUEST_TERMS)
    wants_folder = any(term in text for term in _FOLDER_REQUEST_TERMS)
    return wants_images and wants_folder


def _forced_retry_plan(user_message: str, active_tools: list[dict]) -> tuple[list[dict], str]:
    names = _tool_names(active_tools)
    if _is_folder_image_request(user_message) and {"list_dir_images", "list_dir", "glob_files"} & names:
        tools = _subset_tools(active_tools, ("list_dir_images", "list_dir", "glob_files", "get_file_info", "read_file"))
        return (
            tools,
            (
                "CRITICAL ERROR: you must use local file tools NOW. "
                "The user asked for images from a folder. "
                "Use list_dir_images(path=...) if available. Otherwise inspect the requested folder with "
                "list_dir(path=..., depth=3) or glob_files(pattern=..., path=...). "
                "Return only the tool call. No narration."
            ),
        )
    if _is_image_gen_request(user_message) and "generate_image" in names:
        tools = _subset_tools(active_tools, ("generate_image",))
        return (
            tools,
            (
                "CRITICAL ERROR: you described the image without generating it. "
                "Call generate_image(prompt=...) NOW with a detailed English prompt "
                "describing the subject, style, composition and lighting. "
                "Return only the tool call. No narration."
            ),
        )
    return (
        active_tools,
        (
            "CRITICAL ERROR: you described an action without calling the tool. "
            "Forbidden. Call the appropriate tool NOW "
            "(generate_image, generate_pdf, write_file, search_web, list_dir, glob_files, etc.) "
            "with no explanation. Direct, immediate action required."
        ),
    )


def _clean_path_hint(raw: str) -> str:
    hint = (raw or "").strip().strip("`").strip("\"'").strip()
    hint = re.sub(r"^(?:the|le|la|les|du|de|des)\s+", "", hint, flags=re.IGNORECASE)
    hint = re.split(r"\s+(?:please|pls|merci|thanks|svp|stp)\b", hint, maxsplit=1, flags=re.IGNORECASE)[0]
    return hint.strip(" \t\r\n.,;:!?")


def _extract_folder_hints(user_message: str) -> list[str]:
    text = user_message or ""
    hints: list[str] = []
    quoted = re.findall(r"[\"'`“”]([^\"'`“”]+)[\"'`“”]", text)
    hints.extend(_clean_path_hint(q) for q in quoted)
    # Allow underscore as separator: "dossier_sylvanus" is a common identifier
    # shape — without this branch we never extract a hint and small models
    # (Ministral 3 3B etc.) fail to call list_dir_images on their own. When
    # underscore triggers, push BOTH the bare name ("sylvanus") and the full
    # glued token ("dossier_sylvanus") so rglob finds whichever the user actually
    # has on disk.
    folder_re = re.compile(
        r"(folder|directory|dir|dossier|repertoire|répertoire)([_\s]+)([^\n,;:!?]+)",
        re.IGNORECASE,
    )
    for match in folder_re.finditer(text):
        keyword = match.group(1).lower()
        sep = match.group(2)
        rest = _clean_path_hint(match.group(3))
        if "_" in sep:
            hints.append(f"{keyword}_{rest}")
        hints.append(rest)
    deduped: list[str] = []
    seen: set[str] = set()
    for hint in hints:
        if not hint:
            continue
        key = hint.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(hint)
    return deduped


def _resolve_candidate_dirs(workspace: Path, hint: str) -> list[Path]:
    candidate = Path(hint).expanduser()
    resolved: list[Path] = []
    seen: set[str] = set()

    def _push(path: Path) -> None:
        try:
            rp = path.resolve()
        except Exception:
            return
        key = str(rp).lower()
        if key in seen or not rp.is_dir():
            return
        seen.add(key)
        resolved.append(rp)

    if candidate.is_absolute():
        _push(candidate)
    else:
        _push(workspace / candidate)
        name = candidate.name.lower()
        if name:
            for path in workspace.rglob("*"):
                if len(resolved) >= 8:
                    break
                if not path.is_dir():
                    continue
                if path.name.lower() != name:
                    continue
                if any(part.startswith(".") for part in path.parts):
                    continue
                _push(path)
    return resolved


def _render_image_listing(directory: Path, images: list[Path], workspace: Path, user_message: str) -> str:
    is_french = any(term in (user_message or "").lower() for term in ("donne", "depuis", "dossier", "image"))
    try:
        label = directory.relative_to(workspace).as_posix()
    except Exception:
        label = str(directory)
    lines = [f"{'Images trouvées dans' if is_french else 'Images found in'} `{label}`:"]
    shown = images[:8]
    for image in shown:
        try:
            rel = image.relative_to(workspace).as_posix()
        except Exception:
            rel = str(image)
        lines.append(f"![{image.name}]({rel})")
    remaining = len(images) - len(shown)
    if remaining > 0:
        lines.append(f"- {'… et' if is_french else '... and'} {remaining} {'autres' if is_french else 'more'}")
    return "\n".join(lines)


def _resolve_folder_image_directory(user_message: str, context_folder: str | None, workspace: str | Path) -> Path | None:
    workspace_path = Path(workspace).expanduser().resolve()
    if context_folder:
        candidate = Path(context_folder).expanduser()
        if not candidate.is_absolute():
            candidate = workspace_path / candidate
        try:
            candidate = candidate.resolve()
        except Exception:
            pass
        if candidate.is_dir():
            return candidate
        for alt in _resolve_candidate_dirs(workspace_path, candidate.name or str(candidate)):
            if alt.is_dir():
                return alt
    for hint in _extract_folder_hints(user_message):
        candidates = _resolve_candidate_dirs(workspace_path, hint)
        if candidates:
            return candidates[0]
    return None


def _parse_list_dir_images_result(result: str) -> dict | None:
    try:
        payload = json.loads(result)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    images = payload.get("images")
    if not isinstance(images, list):
        return None
    return payload


def _search_images_markdown(result_text: str, user_message: str) -> str:
    """Build a markdown image gallery from a search_images tool result (web image search).
    Result is a JSON list of {image, thumbnail, source, title}. Returns '' when none usable."""
    try:
        items = json.loads(result_text)
    except Exception:
        return ""
    if not isinstance(items, list):
        return ""
    is_french = any(term in (user_message or "").lower() for term in ("image", "photo", "trouve", "montre", "donne", "cherche"))
    lines: list[str] = []
    for item in items:
        if not isinstance(item, dict) or item.get("error"):
            continue
        url = str(item.get("image") or item.get("thumbnail") or "").strip()
        if not url:
            continue
        title = str(item.get("title") or "image").strip() or "image"
        lines.append(f"![{title}]({url})")
        if len(lines) >= 6:
            break
    if not lines:
        return ""
    header = "Voici les images trouvées :" if is_french else "Here are the images I found:"
    return "\n\n".join([header, "\n".join(lines)])


def _images_markdown_from_tool_results(tool_results: list[dict], user_message: str) -> str:
    for item in reversed(tool_results):
        if item.get("name") == "search_images":
            md = _search_images_markdown(str(item.get("result") or ""), user_message)
            if md:
                return md
            continue
        if item.get("name") != "list_dir_images":
            continue
        payload = _parse_list_dir_images_result(str(item.get("result") or ""))
        if not payload:
            continue
        images = payload.get("images") or []
        if not images:
            continue
        is_french = any(term in (user_message or "").lower() for term in ("donne", "depuis", "dossier", "image"))
        lines = [
            f"{'Voici les images trouvées :' if is_french else 'Here are the images I found:'}"
        ]
        shown = images[:8]
        for image in shown:
            if not isinstance(image, dict):
                continue
            rel = str(image.get("relativePath") or image.get("path") or "").strip()
            name = str(image.get("name") or "image").strip() or "image"
            if not rel:
                continue
            lines.append(f"![{name}]({rel})")
        remaining = max(0, int(payload.get("count") or len(images)) - len(shown))
        if remaining > 0:
            lines.append(f"- {'… et' if is_french else '... and'} {remaining} {'autres' if is_french else 'more'}")
        if len(lines) > 1:
            return "\n\n".join([lines[0], "\n".join(lines[1:])])
    return ""


def _deterministic_folder_image_reply(user_message: str, context_folder: str | None, workspace: str | Path) -> tuple[dict, str] | None:
    if not _is_folder_image_request(user_message):
        return None
    directory = _resolve_folder_image_directory(user_message, context_folder, workspace)
    if directory is None:
        return None
    args = {"path": str(directory), "recursive": True, "limit": 12}
    result = _dispatch_tool("list_dir_images", args)
    tool_result = {"name": "list_dir_images", "args": args, "result": result}
    markdown = _images_markdown_from_tool_results([tool_result], user_message)
    if markdown:
        return tool_result, markdown
    payload = _parse_list_dir_images_result(result)
    if payload is not None:
        is_french = any(term in (user_message or "").lower() for term in ("donne", "depuis", "dossier", "image", "montre"))
        label = payload.get("directory") or str(directory)
        empty = f"Aucune image trouvée dans `{label}`." if is_french else f"No images found in `{label}`."
        return tool_result, empty
    return tool_result, str(result)


def _deterministic_image_listing_fallback(user_message: str, workspace: str | Path) -> str | None:
    if not _is_folder_image_request(user_message):
        return None
    workspace_path = Path(workspace).expanduser().resolve()
    for hint in _extract_folder_hints(user_message):
        for directory in _resolve_candidate_dirs(workspace_path, hint):
            images = [
                path.resolve()
                for path in directory.rglob("*")
                if path.is_file()
                and path.suffix.lower() in _IMAGE_EXTENSIONS
                and not any(part.startswith(".") for part in path.parts)
            ]
            if images:
                return _render_image_listing(directory, sorted(images), workspace_path, user_message)
    return None


def _call_llm_raw(messages, model_id, tools=None, force_tool: bool = False):
    kwargs = {}
    if force_tool:
        kwargs["force_tool"] = True
    if _CURRENT_PROVIDER_MODE:
        kwargs["provider_mode"] = _CURRENT_PROVIDER_MODE
    if _CURRENT_PROVIDER_USER_ID:
        kwargs["provider_user_id"] = _CURRENT_PROVIDER_USER_ID
    if _CURRENT_LLAMA_BASE_URL:
        kwargs["llama_base_url"] = _CURRENT_LLAMA_BASE_URL
    if _CURRENT_LLAMA_BEARER_TOKEN:
        kwargs["llama_bearer_token"] = _CURRENT_LLAMA_BEARER_TOKEN
    if kwargs:
        return llm_mod.chat(messages, model_id, tools, **kwargs)
    return llm_mod.chat(messages, model_id, tools)


def _llm_call_raw(messages, model_id, tools, q):
    """Run raw llm.chat() in a thread and put result in queue."""
    try:
        q.put(('ok', _call_llm_raw(messages, model_id, tools)))
    except Exception as e:
        q.put(('err', e))


def _call_llm_guarded(messages, model_id, tools=None, force_tool: bool = False):
    _prepare_messages_for_llm(messages, model_id, _llm_call_raw)
    return _call_llm_raw(messages, model_id, tools, force_tool=force_tool)


def _llm_call(messages, model_id, tools, q):
    """Run context-guarded llm.chat() in a thread and put result in queue."""
    try:
        q.put(('ok', _call_llm_guarded(messages, model_id, tools)))
    except Exception as e:
        q.put(('err', e))


_TOOL_MODE_ALLOWLIST = {
    "chat_only": frozenset(),
    "chat_search": frozenset({"search_web", "search_and_read", "fetch_page"}),
}

PERSONA_BASE = (
    "You are a conversational assistant acting on behalf of a third party "
    "via WhatsApp. Stay strictly within the role described below. "
    "Reply concisely in the contact's language. "
    "Do not reveal that you are an AI unless directly asked. "
    "Do not access files, run shell commands, or generate images. "
    "If a request falls outside the role, say you'll get back to them."
)

# Chess (and future games) launch detector. Matches an explicit intent to PLAY,
# not to discuss rules — requires a play/launch verb next to the game noun so
# "explain the rules of chess" never opens the console. Desktop-only feature;
# WhatsApp can't render the frame, but the detector is channel-agnostic and the
# frontend simply ignores a game_launch event it can't display.
_GAME_CHESS_RE = re.compile(
    r"(?:"
    r"jou(?:er|ons|e|ez)\b.{0,24}\b(?:aux\s+)?(?:échecs?|echecs?|chess)"
    r"|(?:play|start|launch|open|begin|let'?s\s+play)\b.{0,24}\bchess"
    r"|(?:une\s+)?partie\s+(?:d['’]\s*)?(?:échecs?|echecs?|chess)"
    r"|chess\s+game"
    r"|cheeze\s+game"
    r"|(?:lance|ouvre|d[ée]marre)\b.{0,16}\b(?:les\s+)?(?:échecs?|echecs?|chess)"
    r")",
    re.I,
)


# Like chess: a bare topic mention ("what is an rpg") must NOT launch — only a
# clear start intent (launch verb near the game word, or an unambiguous phrase).
_GAME_RPG_RE = re.compile(
    r"(?:"
    r"(?:jou(?:er|ons|e|ez)|lance|ouvre|d[ée]marre|start|launch|play|begin|veu[xt])"
    r"\b.{0,24}\b"
    r"(?:jdr|rpg|aventure|donjon|dungeon|jeux?\s+de\s+r[ôo]les?|role[\s-]?play(?:ing)?)"
    r"|(?:une\s+)?(?:partie|campagne)\s+(?:de\s+)?(?:jdr|rpg)"
    r"|dungeon\s+crawl"
    r")",
    re.I,
)


# Like chess/rpg: only a clear start intent launches — a bare topic mention does
# not. Matches the RTS, its title "Iron Marsh", or the faction framing.
_GAME_RTS_RE = re.compile(
    r"(?:"
    r"(?:jou(?:er|ons|e|ez)|lance|ouvre|d[ée]marre|start|launch|play|begin|veu[xt])"
    r"\b.{0,24}\b"
    r"(?:rts|iron\s*marsh|strat[ée]gie\s+temps\s+r[ée]el|real[\s-]?time\s+strateg)"
    r"|(?:une\s+)?partie\s+(?:de\s+)?rts"
    r"|iron\s*marsh"
    r"|human\s+vs\.?\s+lizard"
    r")",
    re.I,
)


# Like chess/rpg/rts: only a clear start intent launches — a bare topic mention
# ("poker odds?") must not. Matches Texas Hold'em / poker with a play/launch verb,
# or unambiguous phrases ("partie de poker", "poker game").
_GAME_POKER_RE = re.compile(
    r"(?:"
    r"(?:jou(?:er|ons|e|ez)|lance|ouvre|d[ée]marre|start|launch|play|begin|open|veu[xt])"
    r"\b.{0,24}\b"
    r"(?:poker|texas\s*hold\s*'?\s*em|hold\s*'?\s*em)"
    r"|(?:une\s+)?partie\s+(?:de\s+)?poker"
    r"|poker\s+game"
    r"|texas\s*hold\s*'?\s*em"
    r")",
    re.I,
)


_GAME_SCRABBLE_RE = re.compile(
    r"(?:"
    r"(?:jou(?:er|ons|e|ez)|lance|ouvre|d[ée]marre|start|launch|play|begin|open|veu[xt])"
    r"\b.{0,24}\b"
    r"scrabble"
    r"|(?:une\s+)?partie\s+(?:de\s+)?scrabble"
    r"|scrabble\s+game"
    r"|\bscrabble\b"
    r")",
    re.I,
)


def _detect_game_launch(user_message: str) -> dict | None:
    """Return {"game": <id>} when the user clearly wants to start a playable game.

    Chess is checked before the others so a chess-specific phrase always wins."""
    msg = (user_message or "").strip()
    if not msg or len(msg) > 200:
        return None
    if _GAME_CHESS_RE.search(msg):
        return {"game": "chess"}
    if _GAME_POKER_RE.search(msg):
        return {"game": "poker"}
    if _GAME_SCRABBLE_RE.search(msg):
        return {"game": "scrabble"}
    if _GAME_RTS_RE.search(msg):
        return {"game": "rts"}
    if _GAME_RPG_RE.search(msg):
        return {"game": "rpg"}
    return None


def chat_stream(history: list[dict], user_message: str, model_id: str | None = None, image_model_id: str | None = None, image_size: str | None = None, session_id: str = "global", animal_id: str | None = None, video_model_id: str | None = None, provider_mode: str | None = None, provider_user_id: str | None = None, extra_system_instructions: str | None = None, tool_mode: str | None = None, context_folder: str | None = None, llama_base_url: str | None = None, llama_bearer_token: str | None = None, scheduled_run: bool = False):
    """Generator yielding SSE-ready dicts during agent execution."""
    global _CURRENT_WA_JID, _CURRENT_MODEL_ID, _CURRENT_TOOL_MODE, _CURRENT_CONTEXT_FOLDER, _CURRENT_PROVIDER_MODE, _CURRENT_PROVIDER_USER_ID, _CURRENT_LLAMA_BASE_URL, _CURRENT_LLAMA_BEARER_TOKEN
    _CURRENT_WA_JID = session_id[len("whatsapp:"):] if isinstance(session_id, str) and session_id.startswith("whatsapp:") else None
    _CURRENT_MODEL_ID = (model_id or "").strip() or None
    _CURRENT_TOOL_MODE = (tool_mode or "").strip() or None
    _CURRENT_CONTEXT_FOLDER = (context_folder or "").strip() or None
    _CURRENT_PROVIDER_MODE = (provider_mode or "").strip().lower() or None
    _CURRENT_PROVIDER_USER_ID = (provider_user_id or "").strip() or None
    _CURRENT_LLAMA_BASE_URL = (llama_base_url or "").strip() or None
    _CURRENT_LLAMA_BEARER_TOKEN = (llama_bearer_token or "").strip() or None
    _prep_t0 = time.time()
    _maybe_refresh_local_tools()
    intent = _detect_intent(user_message)
    yield {"event": "intent", "data": intent}

    # ── Planner-worker decomposition (MONKEY_DECOMPOSE=1) ───────────────────
    # Slice the request into parallel subtasks for small models, reduce.
    # Falls through to the normal loop when the planner says "not decomposable".
    try:
        from monkey import planner as _planner
        if _planner.should_attempt(intent):
            yield {"event": "thinking", "phase": "planning"}
            plan_obj = _planner.plan(user_message, _call_llm_guarded, model_id)
            if plan_obj:
                subs = plan_obj["subtasks"]
                yield {"event": "plan", "data": subs}
                yield {"event": "thinking", "phase": "fan_out", "workers": len(subs)}
                results = _planner.execute(subs, _run_subagent, context=user_message)
                for i, r in enumerate(results):
                    yield {"event": "subtask_done", "index": i, "task": r["task"], "ok": r["ok"]}
                if _planner.ok_ratio(results) >= _planner.MIN_OK_RATIO:
                    yield {"event": "thinking", "phase": "reducing"}
                    final = _planner.reduce(user_message, plan_obj.get("reducer") or "", results, _call_llm_guarded, model_id)
                    yield {"event": "done", "data": _maybe_humanize_for_wa(final)}
                    return
                # Too many subtasks failed — fall through to the normal loop
                # so the user still gets a usable answer.
                yield {"event": "planner_skip", "data": "low_ok_ratio"}
    except Exception as _e:
        # Planner is best-effort; on any failure fall through to the normal loop.
        yield {"event": "planner_skip", "data": str(_e)[:200]}

    # ── Small-talk short-circuit ────────────────────────────────────────────
    # Only PURE greetings/reactions bypass tools. Everything else keeps full agent capability.
    if _is_pure_small_talk(user_message):
        now = datetime.now()
        is_wa = bool(_CURRENT_WA_JID)
        if is_wa:
            mini_system = (
                f"{now.strftime('%A %d %B %Y, %H:%M')}. "
                "Reply naturally and briefly in the contact's language, as a human would on WhatsApp. "
                "Never reveal an internal name/codename (Monkey, Tigre, Vanilla, etc.). "
                "Never open with a self-introduction. No markdown, no meta. "
                "No tools, no plan. If you need a personal fact, ask the contact."
            )
        else:
            mini_system = (
                f"You are {persona_short(animal_id)}. {now.strftime('%A %d %B %Y, %H:%M')}. "
                "Reply naturally and briefly, in the user's language. "
                "No tools, no plan. If you need a personal fact, ask the user."
            )
        mini_msgs: list[dict] = [{"role": "system", "content": mini_system}] + history[-6:] + [{"role": "user", "content": user_message}]
        try:
            result = _call_llm_guarded(mini_msgs, model_id, [])
            final = (result.get("text") or "").strip() or "…"
        except Exception as e:
            final = f"error: {e}"
        yield {"event": "done", "data": _maybe_humanize_for_wa(final)}
        return

    # ── Game launch short-circuit ───────────────────────────────────────────
    # "play chess" → fire the launch_game tool and emit a game_launch event the
    # desktop frontend turns into a full-screen retro console (replaces the chat).
    # Deterministic + zero LLM: a weak 3B never has to reason about this. The tool
    # call is real (tool_start/tool_done) so it shows in the run trace.
    _game = _detect_game_launch(user_message)
    if _game is not None:
        _g = _game["game"]
        _g_args = {"game": _g}
        _g_result = f"OK: launched {_g}"
        _g_msg = {
            "chess": "Chess console on. White to move — your turn.",
            "rpg": "Adventure console booting. Pick your world and your hero.",
            "poker": "Poker table on. Heads-up Texas Hold'em — cards are dealt.",
            "scrabble": "Scrabble board on. Pick a language, then place your tiles.",
        }.get(_g, f"{_g} console on.")
        yield {"event": "tool_start", "name": "launch_game", "args": _g_args}
        yield {"event": "tool_done", "name": "launch_game", "args": _g_args, "output": _g_result}
        yield {"event": "game_launch", "game": _g}
        _persist_session(user_message, _g_msg, [{"name": "launch_game", "args": _g_args, "result": _g_result}])
        yield {"event": "done", "data": _g_msg}
        return

    yield {"event": "thinking", "phase": "scanning_workspace", "elapsed_ms": int((time.time() - _prep_t0) * 1000)}
    context_str, workspace = build_context()
    direct_image_reply = _deterministic_folder_image_reply(user_message, context_folder, workspace)
    if direct_image_reply is not None:
        tool_result, final = direct_image_reply
        yield {"event": "tool_start", "name": tool_result["name"], "args": tool_result["args"]}
        yield {"event": "tool_done", "name": tool_result["name"], "args": tool_result["args"], "output": tool_result["result"]}
        _persist_session(user_message, final, [tool_result])
        yield {"event": "done", "data": _maybe_humanize_for_wa(final)}
        return
    intent_rule = _INTENT_RULES.get(intent, _INTENT_RULES["search"])
    protocols = _select_protocols(intent, user_message, animal_id=animal_id)
    system = (SYSTEM_PROMPT
              .replace("{persona}", persona_identity(animal_id))
              .replace("{context}", context_str)
              .replace("{workspace}", str(workspace))
              .replace("{intent_rule}", intent_rule)
              .replace("{protocols}", protocols))
    live_wa_session = isinstance(session_id, str) and session_id.startswith("whatsapp:") and not scheduled_run
    if live_wa_session:
        system += "\n\n" + WHATSAPP_PROTOCOL
    persona_override = (extra_system_instructions or "").strip()
    if persona_override:
        persona_override = persona_override[:4000]
        system += "\n\n[PERSONA OVERRIDE]\n" + PERSONA_BASE + "\n\nROLE:\n" + persona_override
    # Persona system-prompt overlay: only for pro personas. Animals = no overlay
    # (they are "generalists" — cosmetic only). Pros inject a role guardrail block.
    try:
        from monkey.personas import pro_system_prompt as _persona_prompt, is_pro as _is_pro
        _persona_id = (animal_id or "").strip() or None
        _prof = _persona_prompt(_persona_id)
        if _prof:
            system += "\n\n[PROFESSIONAL PERSONA]\n" + _prof
    except Exception:
        _is_pro = lambda _x: False  # noqa: E731
        _persona_id = (animal_id or "").strip() or None
    yield {"event": "thinking", "phase": "selecting_skills", "elapsed_ms": int((time.time() - _prep_t0) * 1000)}
    skills_block = skills_mod.select_skills(user_message)
    if skills_block:
        system += "\n\n" + skills_block
    if image_model_id:
        system += f"\n\nImage model selected by the user: `{image_model_id}`. Use this model_id for all generate_image calls."
    if image_size:
        system += f"\n\nImage size selected by the user: `{image_size}`. Use this size for all generate_image calls (override the default)."
    if video_model_id:
        system += f"\n\nVideo model selected by the user: `{video_model_id}`. Use this model_id for all generate_video calls."
    # Register the active model for the browser's vision-based captcha solver.
    # Heuristic: image_model_id (likely multimodal) wins; otherwise main model.
    try:
        from monkey import browser as _br_mod
        _br_mod.set_vision_model(image_model_id or model_id)
    except Exception:
        pass
    # Eco-token KB auto-inject: top hits ranked by RRF (~1/(60+rank), so ~0.016
    # per matched signal). Threshold filters noise; results are already top-k so
    # the budget cap below is the real guard.
    # Captured separately so the lean pure-chat prompt swap below can re-append it
    # (overwriting `system` would otherwise drop the injected KB excerpts).
    _kb_suffix = ""
    try:
        from monkey import kb_store as _kbst
        if _kbst.size() > 0 and len(user_message.strip()) >= 8:
            _hits = _kbst.search(user_message, top_k=3)
            _good = [h for h in _hits if h.get("score", 0) >= 0.01]
            if _good:
                _budget = 1500
                _blocks: list[str] = []
                for h in _good:
                    snippet = (h.get("text") or "").strip()
                    if len(snippet) > 600:
                        snippet = snippet[:600] + "…"
                    src = h.get("source") or ""
                    title = h.get("title") or ""
                    label = title or src or "doc"
                    block = f"[{label}] {snippet}"
                    if sum(len(b) for b in _blocks) + len(block) > _budget:
                        break
                    _blocks.append(block)
                if _blocks:
                    _kb_suffix = (
                        "\n\n[KB CONTEXT] Relevant excerpts from the user's local knowledge base "
                        "(use these if pertinent, otherwise call kb_search for more):\n"
                        + "\n---\n".join(_blocks)
                    )
                    system += _kb_suffix
                    yield {"event": "kb_injected", "count": len(_blocks)}
    except Exception:
        pass
    packs = set(_select_packs(intent, user_message, session_id, scheduled_run=scheduled_run))
    # Pro persona RESTRICTION (intersection, not union): a specialized persona
    # trades breadth for focus — its toolset is capped at its declared packs
    # (+ core_min always). INVARIANTS preserved:
    #  - WhatsApp channel (_CURRENT_WA_JID truthy / "whatsapp:" session) keeps
    #    full parity (b1) — persona restriction is skipped.
    #  - tool_mode allowlist (chat_only / chat_search) is applied AFTER and
    #    always dominates — persona never re-opens a restricted mode.
    _is_wa_channel = live_wa_session
    if _is_pro(_persona_id) and not _is_wa_channel:
        try:
            from monkey.personas import pro_packs as _pro_packs
            restricted = set(_pro_packs(_persona_id))
            restricted.add("core_min")
            packs = restricted
        except Exception:
            pass
    # Pack catalog is already documented in expand_tools tool description — don't duplicate it in the system prompt.
    active_tools = _get_active_tools(model_id, frozenset(packs))
    if tool_mode in _TOOL_MODE_ALLOWLIST:
        allow = _TOOL_MODE_ALLOWLIST[tool_mode]
        active_tools = [t for t in active_tools if t["function"]["name"] in allow]
    # Forced first-tool policy. Two branches share the iter-1 force_tool=True path:
    #  - "web":    WA question that needs fresh external info → filter to search.
    #  - "action": clear action verb (schedule/recurring task) that small models
    #              like Ministral-3-3B otherwise ignore → filter to that tool.
    forced_first_tools = active_tools
    force_first_reason: str | None = None
    if tool_mode not in _TOOL_MODE_ALLOWLIST:
        if _should_force_web_tools(user_message, intent, session_id):
            forced_first_tools = _first_web_tools(active_tools)
            force_first_reason = "web"
        else:
            # Lean chat exposes ZERO tools (_CHAT_LEAN_TOOLS), so a clear action
            # intent ("show me red panda pictures", "note that I prefer teal",
            # "what do you remember about me") would otherwise fall through to a
            # plain answer. These tools are unambiguous, regex-gated action
            # intents — make them eligible for the forced-first single-tool path
            # even when hidden from the LLM list (def synthesized below). The
            # action-first prompt focuses the weak 3B on ONE call (no flail: it
            # can't loop on tools it isn't shown). recall_facts is also
            # deterministically dispatched in code. Web tools deliberately
            # EXCLUDED — _should_force_web_tools above is the only web path, so
            # the "no web unless user mentions it" rule stays intact.
            _action_names = _tool_names(active_tools) | _LEAN_FORCEABLE_ACTIONS
            _action_tool = _detect_action_tool(user_message, _action_names)
            if _action_tool:
                forced_first_tools = _subset_tools(active_tools, (_action_tool,))
                if not any(t["function"]["name"] == _action_tool for t in forced_first_tools):
                    # Deterministically-handled tool not in active set: synthesize
                    # its def so forced_first_tools[0] is the right tool (the
                    # _subset_tools fallback would otherwise return the lean set).
                    _syn = [t for t in (_COMPRESSED_TOOLS or []) if t["function"]["name"] == _action_tool]
                    if _syn:
                        forced_first_tools = _syn
                force_first_reason = "action"
    # Small-model focus path: when a concrete action is being forced, replace
    # the bloated 10k-char system prompt with a minimal action-first one. The
    # full prompt overwhelms 3B models (Ministral-3-3B via Ollama) into emitting
    # hallucinated prose that mimics tool output instead of real tool_calls.
    # Per-user directive 2026-05-26: "simplifier les prompts, le modèle est
    # capable, prouvé sur OpenRouter".
    if force_first_reason == "action":
        _forced_name = forced_first_tools[0]["function"]["name"] if forced_first_tools else ""
        system = _build_action_first_system(_forced_name, str(workspace), is_wa=live_wa_session)
    elif not active_tools and not force_first_reason:
        # Pure chat (lean pack resolved to ZERO tools, nothing forced): swap the
        # full agentic prompt for a minimal conversational one so the weak model
        # answers directly instead of emitting pseudo-tool text. See
        # _build_chat_direct_system / _CHAT_LEAN_TOOLS.
        system = _build_chat_direct_system(persona_identity(animal_id), context_str, is_wa=live_wa_session)
        if _kb_suffix:
            # Re-append KB excerpts dropped by the prompt swap — pure chat can then
            # answer straight from them without needing a (now hidden) kb_search.
            system += _kb_suffix
    messages: list[dict] = [{"role": "system", "content": system}] + history + [{"role": "user", "content": user_message}]
    force_first_tool = force_first_reason is not None
    force_web_tools = force_first_reason == "web"  # narrow alias: web-only nudge + alignment coercion
    if force_first_reason == "web":
        yield {"event": "tool_policy", "mode": "force_web_first"}
        messages.append({
            "role": "user",
            "content": (
                "[WHATSAPP WEB RULE] This request depends on external/current web information. "
                "Your first action MUST be a real web search tool call (`search_and_read` or `search_web`). "
                "Query MUST stay semantically aligned with the user's question. Do not answer from memory."
            ),
        })
    elif force_first_reason == "action":
        _forced_name = forced_first_tools[0]["function"]["name"] if forced_first_tools else ""
        yield {"event": "tool_policy", "mode": "force_action_first", "tool": _forced_name}
        messages.append({
            "role": "user",
            "content": (
                f"[ACTION RULE] Concrete action request. Your first response MUST call "
                f"`{_forced_name}` with parameters extracted from the user's message. "
                "Do not chat or ask for clarification — execute the action now."
            ),
        })
    all_tool_results: list[dict] = []

    # Deterministic schedule path: when force-action picked schedule_agent_task
    # and the user's wording is unambiguous (regex match on "toutes les N <unit>"
    # / "every N <unit>"), build the call ourselves and skip the LLM entirely.
    # Small models (Ministral-3-3B via Ollama) hallucinate fake tool output as
    # prose even with the minimal action prompt; deterministic dispatch is the
    # only reliable path for these models. Per-user directive 2026-05-26:
    # "simplifier, le modèle est capable, prouvé sur OpenRouter" — when it
    # isn't, sidestep it.
    if (
        force_first_reason == "action"
        and forced_first_tools
        and forced_first_tools[0]["function"]["name"] == "schedule_agent_task"
    ):
        _det_args = (
            _try_deterministic_schedule(user_message)
            or _try_deterministic_weekday_schedule(user_message)
            or _try_deterministic_weekly_schedule(user_message)
            or _try_deterministic_oneshot_schedule(user_message)
        )
        if _det_args is not None:
            yield {"event": "tool_start", "name": "schedule_agent_task", "args": _det_args}
            _det_result = _dispatch_tool("schedule_agent_task", _det_args)
            yield {"event": "tool_done", "name": "schedule_agent_task", "args": _det_args, "output": _det_result}
            all_tool_results.append({"name": "schedule_agent_task", "args": _det_args, "result": _det_result})
            if _det_result.startswith("OK:"):
                if live_wa_session:
                    _rec = _det_args.get("recurrence")
                    _when = f"({_rec}), premier passage {_det_args['scheduled_for']}" if _rec else f"le {_det_args['scheduled_for']}"
                    _final = f"Tâche enregistrée : « {_det_args['title']} » {_when}."
                else:
                    _final = _det_result
            else:
                _final = _det_result
            _persist_session(user_message, _final, all_tool_results)
            yield {"event": "done", "data": _final}
            return
    if force_first_reason == "web" and forced_first_tools and not (isinstance(session_id, str) and session_id.startswith("whatsapp:")):
        _forced_web_name = forced_first_tools[0]["function"]["name"]
        _det_args = None
        if _forced_web_name == "search_web":
            _det_args = _try_deterministic_search_web_args(user_message)
        elif _forced_web_name == "fetch_page":
            _det_args = _try_deterministic_fetch_page_args(user_message)
        elif _forced_web_name == "search_images":
            _det_args = _try_deterministic_search_images_args(user_message)
        if _det_args is not None:
            yield {"event": "tool_start", "name": _forced_web_name, "args": _det_args}
            _det_result = _dispatch_tool(_forced_web_name, _det_args)
            yield {"event": "tool_done", "name": _forced_web_name, "args": _det_args, "output": _det_result}
            all_tool_results.append({"name": _forced_web_name, "args": _det_args, "result": _det_result})
            _final = _finalize_direct_action_result(_forced_web_name, _det_result)
            _persist_session(user_message, _final, all_tool_results)
            yield {"event": "done", "data": _final}
            return
    if force_first_reason == "action" and forced_first_tools:
        _forced_action_name = forced_first_tools[0]["function"]["name"]
        _det_args = None
        if _forced_action_name == "run_command":
            _det_args = _try_deterministic_run_command_args(user_message, str(workspace))
        elif _forced_action_name == "list_dir":
            _det_args = _try_deterministic_list_dir_args(user_message, str(workspace))
        elif _forced_action_name == "glob_files":
            _det_args = _try_deterministic_glob_files_args(user_message, str(workspace))
        elif _forced_action_name == "recall_facts":
            _det_args = _try_deterministic_recall_facts_args(user_message)
        elif _forced_action_name == "search_web":
            _det_args = _try_deterministic_search_web_args(user_message)
        elif _forced_action_name == "fetch_page":
            _det_args = _try_deterministic_fetch_page_args(user_message)
        elif _forced_action_name == "http_request":
            _det_args = _try_deterministic_http_request_args(user_message)
        elif _forced_action_name == "search_images":
            _det_args = _try_deterministic_search_images_args(user_message)
        elif _forced_action_name == "skill_list":
            _det_args = _try_deterministic_skill_list_args(user_message)
        elif _forced_action_name == "generate_image":
            _det_args = _try_deterministic_generate_image_args(user_message)
        elif _forced_action_name == "set_plan":
            _det_args = _try_deterministic_set_plan_args(user_message)
        if _det_args is not None:
            yield {"event": "tool_start", "name": _forced_action_name, "args": _det_args}
            if _forced_action_name == "set_plan":
                _det_result = ""
                _steps, _current = _emit_deterministic_plan(_det_args)
                yield {"event": "tool_done", "name": _forced_action_name, "args": _det_args, "output": _det_result}
                yield {"event": "plan", "steps": _steps, "current": _current}
                all_tool_results.append({"name": _forced_action_name, "args": _det_args, "result": _det_result})
                _final = "Plan ready: " + " | ".join(f"{idx + 1}. {step}" for idx, step in enumerate(_steps))
            else:
                _det_result = _dispatch_tool(_forced_action_name, _det_args)
                yield {"event": "tool_done", "name": _forced_action_name, "args": _det_args, "output": _det_result}
                all_tool_results.append({"name": _forced_action_name, "args": _det_args, "result": _det_result})
                _final = _finalize_direct_action_result(_forced_action_name, _det_result)
            _persist_session(user_message, _final, all_tool_results)
            yield {"event": "done", "data": _final}
            return

    _plan_emitted = False  # track if set_plan was already shown to user
    _seen_tool_labels: list[str] = []  # accumulated distinct labels across iterations (for auto-plan)
    _audit_done = False    # at most one self-audit per task
    _audit_fail_count = 0  # cap audit retries — prevents nitpick spirals
    _terminal_audit_failure: list[str] = []
    text: str = ""

    # intent already detected + emitted before short-circuit
    _PER_STEP_BUDGET = {"orchestrate": 8, "code": 7, "browse": 4, "search": 3, "chat": 2}.get(intent, 5)
    _BASE_BUDGET = 6
    _expected_steps = 4
    _HARD_CAP_ITERS = 200
    _MIN_ITERS_BY_INTENT = {"code": 60, "orchestrate": 50, "browse": 30, "search": 20, "chat": 10}
    _floor = _MIN_ITERS_BY_INTENT.get(intent, 30)
    max_iters = min(_HARD_CAP_ITERS, max(_floor, _BASE_BUDGET + _expected_steps * _PER_STEP_BUDGET))
    extension_count = 0
    _MAX_EXTENSIONS = 2
    iters_in_step = 0
    current_step_idx = 0

    last_state_hash = ""
    from monkey.loop_detector import LoopDetector
    loop_det = LoopDetector()
    autoskill_count = 0
    nudged_signatures: set[str] = set()
    autoskilled_signatures: set[str] = set()
    MAX_AUTOSKILLS_PER_RUN = 2
    _last_regression_key: str | None = None  # throttle: only yield on transition
    _last_browser_phase_yielded = False
    _iter = 0
    strict_web_alignment = bool(_is_wa_channel or scheduled_run)

    # ── Checkpoint state ──────────────────────────────────────────────────
    import uuid as _uuid
    from monkey import checkpoint as _cp
    global _CURRENT_RUN_ID
    _CURRENT_RUN_ID = _uuid.uuid4().hex[:12]
    _written_files: set[str] = set()           # absolute paths touched by write/edit/append
    _snapshotted_build_indices: set[int] = set()
    _consec_red_after_green = 0
    _had_any_green_so_far = False
    _auto_restore_done = False
    _browser_phase_nudge_count = 0
    _auto_browser_probe_done = False
    _ship_gate_done = False
    def _decide_extension():
        """Ask LLM whether to extend the iteration budget given current gate issues + progress.
        Returns (extend: bool, reason: str, extra_iters: int)."""
        gate = _quality_gate(all_tool_results)
        # No gate issues left? → no need to extend, just exit
        if not gate:
            return False, "no_gate_issues_left", 0
        # Hard cap reached
        if max_iters >= _HARD_CAP_ITERS:
            return False, "hard_cap_reached", 0
        if extension_count >= _MAX_EXTENSIONS:
            return False, "extensions_exhausted", 0
        # Build progress signals
        build_runs_local = [r for r in all_tool_results if r["name"] == "run_command"]
        had_any_green = any("[exit=0]" in (r.get("result") or "") for r in build_runs_local)
        last_red_local = build_runs_local and "[exit=0]" not in (build_runs_local[-1].get("result") or "")[:200]
        progress_summary = (
            f"max_iters={max_iters}, used={_iter}, "
            f"tool_calls={len(all_tool_results)}, builds={len(build_runs_local)}, "
            f"had_green={had_any_green}, last_red={last_red_local}, "
            f"gate_issues={len(gate)}"
        )
        # LLM decision
        prompt = (
            "You are the arbiter of a dev agent hitting its iteration cap.\n"
            f"Progress: {progress_summary}\n"
            f"Remaining issues: {gate}\n"
            "Decide in strict JSON {\"extend\": true|false, \"reason\": str, \"extra\": int (10-30)}.\n"
            "Criteria: extend=true if close to convergence (had_green=true, ~1-3 minor issues); "
            "extend=false if drifting (last_red=true persistent across builds, gate>=4)."
        )
        try:
            out = _call_llm_guarded([{"role": "user", "content": prompt}], None)
            txt = (out.get("text") or out.get("content") or "").strip()
            m = re.search(r"\{.*\}", txt, re.S)
            if not m:
                return False, "decision_unparseable", 0
            d = json.loads(m.group(0))
            extend = bool(d.get("extend"))
            extra = max(10, min(30, int(d.get("extra", 15))))
            return extend, str(d.get("reason", ""))[:200], extra
        except Exception as e:
            return False, f"decision_error:{e}"[:200], 0
    while True:
        if _iter >= max_iters:
            extend, reason, extra = _decide_extension()
            yield {"event": "max_iters_decision", "extend": extend, "reason": reason,
                   "extra": extra, "extensions_used": extension_count, "max_extensions": _MAX_EXTENSIONS,
                   "iter": _iter, "max_iters": max_iters}
            if not extend:
                break
            extension_count += 1
            max_iters = min(_HARD_CAP_ITERS, max_iters + extra)
            messages.append({
                "role": "user",
                "content": (
                    f"[BUDGET EXTENDED +{extra}] max_iters = {max_iters} (reason: {reason}). "
                    "You are NEAR THE END. EXCLUSIVE focus on remaining audit issues. "
                    "No new feature, no refactor."
                ),
            })
            if _iter >= max_iters:
                break  # safety: extra<=0 edge
        _iter += 1
        iters_in_step += 1
        # Per-step iter cap: if a single step burns more than 2× the per-step budget,
        # force the agent to advance or wrap up rather than thrashing on one step.
        if _plan_emitted and iters_in_step > _PER_STEP_BUDGET * 2:
            messages.append({
                "role": "user",
                "content": (
                    f"[STEP BUDGET EXCEEDED] Step {current_step_idx} used {iters_in_step} iterations "
                    f"(budget = {_PER_STEP_BUDGET}). You MUST advance now: "
                    "either call `set_plan(..., current=N+1)` to move to the next step, "
                    "or deliver the final answer if all other steps are done. "
                    "No more retries on the current step."
                ),
            })
            iters_in_step = 0  # avoid re-injecting next iter
        # Refresh project state context (only if changed) so LLM never imagines missing modules.
        # Skip for non-code intents (search/browse): saves ~3500 chars per iter.
        state_block = _scan_project_state(workspace) if intent in ("code", "orchestrate") else ""
        if state_block and state_block != last_state_hash:
            last_state_hash = state_block
            # Replace previous state injection if present (avoid stacking duplicates)
            messages[:] = [m for m in messages if not (
                isinstance(m.get("content"), str) and m["content"].startswith("[ÉTAT PROJET")
            )]
            messages.append({"role": "user", "content": state_block})
        _refresh_now_in_messages(messages)
        synth_passes = _prepare_messages_for_llm(messages, model_id, _llm_call_raw)
        for _ in range(synth_passes):
            yield {"event": "thinking", "phase": "synthesis"}
        # Approx context size (tokens ≈ chars/4) for UI feedback
        _ctx_chars = sum(len(m.get("content") or "") if isinstance(m.get("content"), str) else 0 for m in messages)
        _ctx_tok_approx = _ctx_chars // 4
        yield {
            "event": "thinking",
            "phase": "calling_model",
            "model_id": model_id or "",
            "iter": _iter,
            "max_iters": max_iters,
            "context_tokens": _ctx_tok_approx,
            "num_tools": len(active_tools or []),
        }
        q = _queue.Queue()
        _llm_t0 = time.time()
        if force_first_tool and not all_tool_results:
            def _forced_first_call():
                try:
                    q.put(('ok', _call_llm_guarded(messages, model_id, forced_first_tools, force_tool=True)))
                except Exception as e:
                    q.put(('err', e))
            threading.Thread(target=_forced_first_call, daemon=True).start()
        else:
            threading.Thread(target=_llm_call, args=(messages, model_id, active_tools, q), daemon=True).start()
        elapsed = 0
        while elapsed < 300:
            try:
                status, value = q.get(timeout=3)
                break
            except _queue.Empty:
                elapsed += 3
                yield {
                    "event": "thinking",
                    "phase": "waiting_model",
                    "model_id": model_id or "",
                    "elapsed_ms": int((time.time() - _llm_t0) * 1000),
                    "iter": _iter,
                }
        else:
            yield {"event": "error", "data": "LLM call timeout (300s)"}
            return
        if status == 'err':
            # Surface the actual error (credits, auth, missing model, 5xx, etc.).
            # Don't crash the SSE stream — end cleanly so checkpoint survives.
            err_msg = str(value)
            yield {"event": "error", "data": err_msg}
            yield {"event": "done", "data": f"ERREUR: {err_msg}"}
            return
        result = value
        _usage = (result.get("usage") if isinstance(result, dict) else None) or {}
        if _usage:
            yield {
                "event": "usage",
                "prompt_tokens": int(_usage.get("prompt_tokens") or 0),
                "completion_tokens": int(_usage.get("completion_tokens") or 0),
                "elapsed_ms": int((time.time() - _llm_t0) * 1000),
                "model_id": model_id or "",
            }
        text: str = result.get("text") or ""
        tool_calls = result.get("tool_calls") or []

        if not tool_calls:
            inline_tool = _extract_inline_tool_call(text)
            if inline_tool is not None:
                fn_name, fn_args = inline_tool
                tool_calls = [{
                    "id": f"inline-{_iter}-{fn_name}",
                    "type": "function",
                    "function": {"name": fn_name, "arguments": json.dumps(fn_args, ensure_ascii=False)},
                }]
                text = ""

        # ── Tools forced after hallucination/fake-action detection ──────────
        # NOTE: this block must come BEFORE the `if not tool_calls:` guard so that
        # forced tool_calls fall through to the real executor below.
        if not tool_calls:
            text_lower = text.lower()
            refused = any(p in text_lower for p in _HALLUCINATION_PHRASES)
            # Also detect: model describes/promises action but calls no tool
            action_words = [
                "pdf", "file", "folder", "directory", "workspace",
                "generate", "create", "write", "read", "open", "list",
                "search", "browse", "navigate", "download", "fetch",
                "schedule", "remind", "plan", "skill", "remember", "note",
                "génér", "gener", "créé", "cree", "lis", "affiche", "liste",
                "rappelle", "planifie", "programme", "dessin", "draw", "paint",
            ]
            fake_action = not all_tool_results and any(w in text_lower for w in action_words)
            # Hallucinated image markdown: LLM emits ![..](URL/path) for an image
            # gen request without ever calling generate_image. Local FLUX never
            # produces http(s) URLs — any ![] in the text without a prior
            # generate_image tool result is fabricated. Skip the forced-retry
            # loop (which hangs for 300s with small models on tool_choice=required)
            # and call the tool deterministically.
            fake_image = (
                _is_image_gen_request(user_message)
                and not any(r.get("name") == "generate_image" for r in all_tool_results)
                and bool(re.search(r"!\[[^\]]*\]\s*\(", text))
            )
            if fake_image:
                gen_args = {"prompt": user_message}
                yield {"event": "tool_start", "name": "generate_image", "args": gen_args}
                gen_result = _dispatch_tool("generate_image", gen_args)
                yield {"event": "tool_done", "name": "generate_image", "args": gen_args, "output": gen_result}
                all_tool_results.append({"name": "generate_image", "args": gen_args, "result": gen_result})
                path_match = re.search(r"->\s*(\S+\.(?:png|jpg|jpeg|webp))", gen_result or "")
                final = f"![image]({path_match.group(1)})" if path_match else (gen_result or "ERREUR: image gen failed")
                _persist_session(user_message, final, all_tool_results)
                yield {"event": "done", "data": final}
                return
            if refused or fake_action:
                # Inject correction and force a tool call on retry
                # Keep the model's original prose: if the forced retry still
                # produces no tool call, this was a genuine conversational answer
                # that merely mentioned an action word (e.g. advice containing
                # "plan"/"search"/"create"). Returning it beats the dead-end
                # "did not use its tools" error.
                pre_retry_text = text
                retry_tools, retry_instruction = _forced_retry_plan(user_message, active_tools)
                messages.append({"role": "assistant", "content": text or ""})
                messages.append({
                    "role": "user",
                    "content": retry_instruction,
                })
                fq = _queue.Queue()
                def _forced_call(q=fq):
                    try:
                        q.put(('ok', _call_llm_guarded(messages, model_id, retry_tools, force_tool=True)))
                    except Exception as e:
                        q.put(('err', e))
                threading.Thread(target=_forced_call, daemon=True).start()
                elapsed = 0
                while elapsed < 300:
                    try:
                        fstatus, fvalue = fq.get(timeout=3)
                        break
                    except _queue.Empty:
                        elapsed += 3
                        yield {"event": "thinking"}
                else:
                    yield {"event": "error", "data": "LLM call timeout (300s)"}
                    return
                if fstatus == 'err':
                    raise fvalue
                text = fvalue.get("text") or ""
                tool_calls = fvalue.get("tool_calls") or []
                if not tool_calls:
                    if _is_image_gen_request(user_message):
                        gen_args = {"prompt": user_message}
                        yield {"event": "tool_start", "name": "generate_image", "args": gen_args}
                        gen_result = _dispatch_tool("generate_image", gen_args)
                        yield {"event": "tool_done", "name": "generate_image", "args": gen_args, "output": gen_result}
                        all_tool_results.append({"name": "generate_image", "args": gen_args, "result": gen_result})
                        path_match = re.search(r"->\s*(\S+\.(?:png|jpg|jpeg|webp))", gen_result or "")
                        final = f"![image]({path_match.group(1)})" if path_match else (gen_result or "ERREUR: image gen failed")
                        yield {"event": "done", "data": final}
                        return
                    fallback = _deterministic_image_listing_fallback(user_message, workspace)
                    if fallback:
                        yield {"event": "done", "data": fallback}
                        return
                    # No tool, no image: the forced retry was a false positive on
                    # a conversational answer. Return the model's original prose
                    # rather than a dead-end error — but route it through the same
                    # final post-processing (chart-as-code salvage, fabrication
                    # guard, image markdown) so a recharts/JSX dump here is still
                    # converted to a rendered rich block instead of leaking code.
                    salvaged = (pre_retry_text or text or "").strip()
                    if len(salvaged) >= 16 and not refused:
                        salvaged = _ensure_non_empty_final(
                            messages, user_message, model_id, salvaged, all_tool_results
                        )
                        _persist_session(user_message, salvaged, all_tool_results)
                        yield {"event": "done", "data": _maybe_humanize_for_wa(salvaged)}
                        return
                    yield {"event": "done", "data": "The model did not use its tools. Please rephrase the request."}
                    return
                # tool_calls is now populated — fall through to the executor block below

            else:
                # ── No hallucination: genuine end of task ─────────────────────

                non_trivial = [r for r in all_tool_results if r["name"] not in _TRIVIAL_TOOLS]

                # ── Deterministic gate: code-side enforcement before LLM audit ──
                # The LLM may convince itself to skip the runtime test — we force it here.
                gate_issues = _quality_gate(all_tool_results)
                if gate_issues:
                    # Deterministic gate ALWAYS blocks done, even if a prior audit
                    # passed — the build can break again after a successful audit.
                    _audit_done = False
                    _audit_fail_count = 0
                    _terminal_audit_failure = []
                    yield {"event": "audit", "status": "failed", "issues": gate_issues}
                    messages.append({"role": "assistant", "content": text or ""})
                    messages.append({
                        "role": "user",
                        "content": (
                            "QUALITY GATE FAILED (automatic code verification, non-negotiable):\n"
                            + "\n".join(f"- {i}" for i in gate_issues)
                            + "\nFix NOW by calling the missing tools based on project type: "
                            "run_command for CLI/script/build, "
                            "http_request for API. "
                            "open_file is NOT a runtime test (no observable output). Direct execution required."
                        ),
                    })
                    continue  # re-enter loop, don't mark _audit_done yet

                # ── Ship-gate: mandatory runtime probe for game projects ──
                # Before shipping, we EXECUTE the gameplay proof (not just check
                # that the agent did it). If the probe fails, we inject the results
                # and continue the loop. Cap: 1 ship-gate probe per run to avoid infinite loop.
                if (_is_game_project(all_tool_results)
                        and _had_any_green_so_far
                        and not _ship_gate_done):
                    _dist = _find_dist_html(_written_files)
                    if _dist:
                        _ship_gate_done = True
                        _url = "file://" + _dist
                        yield {"event": "ship_gate_probe", "url": _url}
                        for _pname, _pargs in [
                            ("browser_navigate", {"url": _url}),
                            ("browser_run_js", {"code": _PROBE_JS_STATE}),
                            ("browser_run_js", {"code": _PROBE_JS_INPUT}),
                        ]:
                            try:
                                yield {"event": "tool_start", "name": _pname,
                                       "args": _pargs, "ship_gate": True}
                                _pres = _dispatch_tool(_pname, _pargs)
                            except Exception as _pe:
                                _pres = f"ERREUR: ship-gate {_pname} failed: {_pe}"
                            yield {"event": "tool_done", "name": _pname,
                                   "result": _pres[:500], "ship_gate": True}
                            all_tool_results.append({"name": _pname, "args": _pargs, "result": _pres})
                        ok, fails = _evaluate_probe_results(all_tool_results)
                        yield {"event": "ship_gate_result", "ok": ok, "failures": fails}
                        if not ok:
                            _audit_done = False
                            _audit_fail_count = 0
                            _terminal_audit_failure = []
                            messages.append({"role": "assistant", "content": text or ""})
                            messages.append({
                                "role": "user",
                                "content": (
                                    "SHIP-GATE FAILED (automatic gameplay proof):\n"
                                    + "\n".join(f"- {f}" for f in fails)
                                    + "\nFix NOW. Build compiles but runtime is broken. "
                                    "Check: (1) `(window).__game = {app, player, scene}` exposed in main.ts, "
                                    "(2) `window.addEventListener('keydown',…)` handlers attached, "
                                    "(3) ticker runs and moves `player.x` based on `keys.ArrowRight`. "
                                    "Re-build after fix."
                                ),
                            })
                            continue

                # ── Self-audit: verify work quality before finishing ──────────
                if non_trivial and not _audit_done:
                    yield {"event": "audit", "status": "checking"}
                    # Build a structured summary of tool results for the LLM
                    results_summary = "\n".join(
                        f"- {r['name']}: {'OK' if r['result'].startswith('OK:') else 'ERREUR' if r['result'].startswith('ERREUR:') else r['result'][:120]}"
                        for r in non_trivial
                    )
                    base_criteria = (
                        "- Tools returned OK: (not ERREUR:)?\n"
                        "- Content complete, not empty/truncated?\n"
                        "- User's original request fully satisfied?\n"
                        "- Any plan step left incomplete?\n"
                        "- FABRICATION CHECK: does the assistant message present invented/synthetic/estimated/typical/average/placeholder values as if they were real data the user asked for? If yes → ok=false, issue=\"fabricated_data\".\n"
                        "- FINAL FORMAT CHECK: is the assistant's user-facing reply a raw JSON object or ```json``` fence (instead of prose + optional ```rich``` block)? If yes → ok=false, issue=\"final_reply_is_json\".\n"
                    )
                    code_criteria = (
                        "- Build/lint/typecheck (npm/tsc/cargo/go/pytest) run via run_command exit 0? Missing/failed → ok=false.\n"
                        "- Missing features, dead code, monolithic files, broken refs, over-engineering → ok=false.\n"
                        "- 2-4 user stories exercised end-to-end (run_command CLI, http_request API)? No → ok=false.\n"
                        "- Vague creative request: spec inferred via think() (stack, architecture, scope, stories)? No → ok=false.\n"
                        "- All quantitative features delivered (e.g. 8 levels = 8 levels)? Under-delivery → ok=false.\n"
                    )
                    criteria = base_criteria + (code_criteria if intent in ("code", "orchestrate") else "")
                    audit_prompt = (
                        "AUDIT — Reply JSON only: {\"ok\":true,\"issues\":[]} or {\"ok\":false,\"issues\":[...]}\n\n"
                        f"Tool results:\n{results_summary}\n\n"
                        f"Criteria:\n{criteria}"
                        "JSON ONLY."
                    )
                    _audit_msgs_idx = len(messages)
                    messages.append({"role": "assistant", "content": text or ""})
                    messages.append({"role": "user", "content": audit_prompt})
                    aq = _queue.Queue()
                    threading.Thread(target=_llm_call, args=(messages, model_id, [], aq), daemon=True).start()
                    elapsed = 0
                    while elapsed < 300:
                        try:
                            astatus, avalue = aq.get(timeout=3)
                            break
                        except _queue.Empty:
                            elapsed += 3
                            yield {"event": "thinking"}
                    else:
                        yield {"event": "error", "data": "LLM call timeout (300s)"}
                        return
                    if astatus == 'ok':
                        audit_text = avalue.get("text") or ""
                        audit_json: dict = {"ok": False, "issues": ["audit_unparseable"]}
                        try:
                            audit_json = json.loads(audit_text)
                        except Exception:
                            try:
                                start = audit_text.find('{')
                                end = audit_text.rfind('}') + 1
                                if start != -1 and end > start:
                                    audit_json = json.loads(audit_text[start:end])
                            except Exception:
                                pass
                        if not audit_json.get("ok", True):
                            _audit_fail_count += 1
                            issues = audit_json.get("issues", [])
                            issues = [str(i) for i in (issues or [])] or ["audit_unparseable"]
                            _terminal = _audit_fail_count >= 2
                            yield {"event": "audit", "status": "failed", "issues": issues, "terminal": _terminal}
                            if _audit_fail_count >= 2:
                                _audit_done = True
                                _terminal_audit_failure = issues
                                del messages[_audit_msgs_idx:]
                            else:
                                # Drop audit prompt + raw audit_text from history — keeping them
                                # trains the model to mimic audit JSON in its next reply.
                                del messages[_audit_msgs_idx:]
                                issues_str = "; ".join(
                                    i if isinstance(i, str)
                                    else (i.get("message") or i.get("issue") or json.dumps(i, ensure_ascii=False) if isinstance(i, dict) else str(i))
                                    for i in (issues or [])
                                )
                                messages.append({
                                    "role": "user",
                                    "content": (
                                        f"Audit issues: {issues_str}. ONE single correction, then FINALIZE. "
                                        "No extra set_plan. No massive re-extraction. "
                                        "If info is imperfect, present the best current result."
                                    ),
                                })
                                continue  # re-enter loop to fix
                        else:
                            _audit_fail_count = 0
                            _audit_done = True
                            _terminal_audit_failure = []
                            # Pop audit prompt so it doesn't pollute downstream retries / next turn.
                            del messages[_audit_msgs_idx:]
                            yield {"event": "audit", "status": "ok"}

                # Post-process: if model hallucinates inability despite successful tools, override
                text = _ensure_non_empty_final(messages, user_message, model_id, text, all_tool_results)
                if _terminal_audit_failure:
                    text = _format_terminal_audit_failure(text, _terminal_audit_failure)
                _persist_session(user_message, text, all_tool_results)
                yield {"event": "done", "data": _maybe_humanize_for_wa(text)}
                return

        # ── Real tool executor (handles both normal AND forced tool_calls) ───

        # Auto-inject plan if model skipped set_plan on first tool-using iteration
        has_set_plan = any(
            tc.get("function", {}).get("name") == "set_plan" for tc in tool_calls
        )
        if not _plan_emitted and not has_set_plan:
            for tc in tool_calls:
                name = tc.get("function", {}).get("name", "")
                label = _TOOL_STEP_LABELS.get(name)
                if label and label not in _seen_tool_labels:
                    _seen_tool_labels.append(label)
            if len(_seen_tool_labels) >= 2:
                auto_steps = _seen_tool_labels[:5] + ["Synthesize result"]
                yield {"event": "plan", "steps": auto_steps, "current": 0}
                _plan_emitted = True

        tool_messages: list[dict] = []
        for tc in tool_calls:
            fn_name: str = tc.get("function", {}).get("name", "")
            fn_args_raw = tc.get("function", {}).get("arguments", "{}")
            try:
                fn_args: dict = json.loads(fn_args_raw) if isinstance(fn_args_raw, str) else fn_args_raw
            except Exception:
                fn_args = {}
            _force_first_web = bool(force_web_tools and not all_tool_results)
            if strict_web_alignment or _force_first_web:
                fn_name, fn_args, _rewritten = _coerce_web_tool_call_alignment(
                    fn_name,
                    fn_args,
                    user_message,
                    strict_alignment=strict_web_alignment,
                    force_first=_force_first_web,
                )
                if _rewritten:
                    yield {
                        "event": "tool_query_rewritten",
                        "tool": fn_name,
                        "query": str(fn_args.get("query") or "")[:180],
                        "url": str(fn_args.get("url") or "")[:220],
                    }

            if fn_name == "expand_tools":
                requested = fn_args.get("categories") or []
                if isinstance(requested, str):
                    requested = [requested]
                requested = [str(c).strip() for c in requested if isinstance(c, (str, bytes))]
                added: list[str] = []
                rejected: list[str] = []
                # Pro personas restrict tools deliberately — expand_tools must NOT
                # let the LLM bypass that. WA channel keeps full parity (b1) and
                # is already exempt from the restriction upstream, so expand_tools
                # stays open there.
                _pro_locked = _is_pro(_persona_id) and not _is_wa_channel
                for cat in requested:
                    if _pro_locked:
                        rejected.append(cat)
                    elif cat in _LOADABLE_PACKS and cat not in packs:
                        packs.add(cat)
                        added.append(cat)
                    elif cat not in _LOADABLE_PACKS:
                        rejected.append(cat)
                # Re-derive active_tools for the next iteration.
                active_tools = _get_active_tools(model_id, frozenset(packs))
                forced_first_tools = active_tools
                force_web_tools = False
                force_first_tool = False
                yield {"event": "tool_start", "name": fn_name, "args": fn_args}
                if added:
                    tool_result = f"OK: loaded packs {added}. Active packs: {sorted(packs)}. Total tools now: {len(active_tools)}."
                elif rejected:
                    tool_result = f"ERREUR: unknown pack(s) {rejected}. Valid: {_LOADABLE_PACKS}."
                else:
                    tool_result = f"OK: no new packs to load. Active packs: {sorted(packs)}."
                yield {"event": "tool_done", "name": fn_name, "args": fn_args, "output": tool_result}
            elif fn_name == "set_plan":
                steps = fn_args.get("steps", [])
                # Hard cap: clamp to 6 milestones. Anything more is granular substeps
                # the LLM should merge.
                if isinstance(steps, list) and len(steps) > 6:
                    steps = steps[:6]
                current = int(fn_args.get("current", 0))
                # Recompute global budget — MONOTONIC for the budget only.
                if steps:
                    _expected_steps = max(_expected_steps, max(2, min(len(steps), 6)))
                    max_iters = min(_HARD_CAP_ITERS, max(max_iters, _BASE_BUDGET + _expected_steps * _PER_STEP_BUDGET))
                # Step transition resets per-step counter
                if current != current_step_idx:
                    current_step_idx = current
                    iters_in_step = 0
                yield {"event": "plan", "steps": steps, "current": current}
                _plan_emitted = True
                tool_result = ""
            else:
                # ── Pre-dispatch gate: deep-regression block on writes ──────
                _is_write = fn_name in ("write_file", "edit_file", "append_to_file")
                if _is_write and _consec_red_after_green >= 3 and _had_any_green_so_far:
                    snap = _cp.latest_snapshot(_CURRENT_RUN_ID)
                    snap_name = snap["_name"] if snap else "(none)"
                    target = (fn_args.get("path") or "").strip() if isinstance(fn_args, dict) else ""
                    yield {"event": "write_blocked_regression",
                           "consec_red": _consec_red_after_green,
                           "tool": fn_name, "target": target, "snapshot": snap_name}
                    yield {"event": "tool_start", "name": fn_name, "args": fn_args}
                    tool_result = (
                        f"ERREUR: write blocked — {_consec_red_after_green} consecutive red builds "
                        f"after a GREEN state. Piling up writes worsens the drift.\n"
                        f"REQUIRED: call `restore_last_green` NOW to revert to the last "
                        f"green snapshot ({snap_name}), then re-run `npm run build` before any new write.\n"
                        f"Otherwise: `list_green_checkpoints` to view history."
                    )
                    yield {"event": "tool_done", "name": fn_name, "args": fn_args, "output": tool_result}
                else:
                    # ── Approval gate: sensitive tools + dangerous shell patterns ──
                    _needs, _reason, _bypass = _approvals.needs_approval(fn_name, fn_args, session_id)
                    if _needs:
                        _title, _summary = _approvals.summarize_for_user(fn_name, fn_args)
                        _rid = _approvals.STORE.create_pending()
                        yield {"event": "approval_request", "id": _rid, "tool": fn_name,
                               "args": fn_args, "title": _title, "summary": _summary,
                               "reason": _reason, "bypass": _bypass}
                        _decision = _approvals.STORE.wait(_rid, timeout=300)
                        if _decision.get("decision") != "allow":
                            yield {"event": "tool_start", "name": fn_name, "args": fn_args}
                            tool_result = f"ERREUR: user denied execution ({_decision.get('reason') or 'denied'})"
                            yield {"event": "tool_done", "name": fn_name, "args": fn_args, "output": tool_result}
                        else:
                            if _decision.get("scope") == "session" and not _bypass:
                                _approvals.STORE.allow_session(session_id, fn_name)
                            yield {"event": "tool_start", "name": fn_name, "args": fn_args}
                            try:
                                tool_result = _dispatch_tool(fn_name, fn_args)
                            except TypeError as _te:
                                tool_result = f"ERREUR: invalid arguments for {fn_name}: {_te}"
                            except Exception as _ge:
                                tool_result = f"ERREUR: execution failed for {fn_name}: {_ge}"
                            yield {"event": "tool_done", "name": fn_name, "args": fn_args, "output": tool_result}
                    else:
                        yield {"event": "tool_start", "name": fn_name, "args": fn_args}
                        try:
                            tool_result = _dispatch_tool(fn_name, fn_args)
                        except TypeError as _te:
                            tool_result = f"ERREUR: invalid arguments for {fn_name}: {_te}"
                        except Exception as _ge:
                            tool_result = f"ERREUR: execution failed for {fn_name}: {_ge}"
                        yield {"event": "tool_done", "name": fn_name, "args": fn_args, "output": tool_result}

                # ── P7: record successful navigation for site memory ──
                if fn_name == "browser_navigate" and isinstance(fn_args, dict):
                    _url = (fn_args.get("url") or "").strip()
                    if _url:
                        _ok = isinstance(tool_result, str) and not tool_result.startswith("ERREUR:") \
                            and "Error:" not in (tool_result or "")[:40] \
                            and "blocked" not in (tool_result or "")[:120].lower()
                        try:
                            from monkey.site_memory import record_hit as _rh, classify_intent as _ci
                            _rh(animal_id, _ci(user_message), _url, _ok)
                        except Exception:
                            pass

                # ── Track written files (any write that succeeded or attempted) ──
                if _is_write and isinstance(fn_args, dict):
                    _wp = (fn_args.get("path") or "").strip()
                    if _wp:
                        from pathlib import Path as _P
                        try:
                            _wp_abs = str(_P(_wp).expanduser().resolve())
                        except Exception:
                            _wp_abs = _wp
                        _written_files.add(_wp_abs)

                # ── Track scaffold tools: their files bypass write_file but the
                # ship-gate / checkpoint mechanism keys off _written_files. Inject
                # the scaffold root so _find_dist_html walks from a real path.
                if fn_name in {"scaffold_game_2d", "scaffold_app_fullstack"} \
                        and isinstance(fn_args, dict) \
                        and isinstance(tool_result, str) and tool_result.startswith("OK:"):
                    _td = (fn_args.get("target_dir") or "").strip()
                    if _td:
                        from pathlib import Path as _P
                        try:
                            _td_abs = _P(_td).expanduser().resolve()
                        except Exception:
                            _td_abs = _P(_td)
                        for _seed in ("package.json", "index.html", "src/main.ts", "vite.config.ts"):
                            _written_files.add(str(_td_abs / _seed))

                # ── Snapshot on green build ──────────────────────────────────
                if fn_name == "run_command" and "[exit=0]" in (tool_result or "")[:300]:
                    cmd = ""
                    if isinstance(fn_args, dict):
                        cmd = (fn_args.get("command") or fn_args.get("cmd") or "").lower()
                    if any(k in cmd for k in (
                        "npm run build", "npm test", "npm run test", "tsc",
                        "vite build", "yarn build", "pnpm build",
                        "cargo build", "cargo check", "go build", "go test", "pytest",
                    )):
                        from pathlib import Path as _P
                        _files = [_P(p) for p in _written_files]
                        _bi = sum(1 for r in all_tool_results
                                  if r.get("name") == "run_command"
                                  and "[exit=0]" in (r.get("result") or "")[:300])
                        if _bi not in _snapshotted_build_indices:
                            try:
                                mf = _cp.snapshot_green(_CURRENT_RUN_ID, _bi, _files)
                                if mf:
                                    _snapshotted_build_indices.add(_bi)
                                    yield {"event": "checkpoint_saved",
                                           "build_idx": _bi,
                                           "files": len(mf.get("files", [])),
                                           "run_id": _CURRENT_RUN_ID}
                            except Exception as _ce:
                                yield {"event": "checkpoint_error", "error": str(_ce)[:200]}
                        _had_any_green_so_far = True
                        _consec_red_after_green = 0
                elif fn_name == "run_command":
                    cmd = ""
                    if isinstance(fn_args, dict):
                        cmd = (fn_args.get("command") or fn_args.get("cmd") or "").lower()
                    is_build = any(k in cmd for k in (
                        "npm run build", "npm test", "npm run test", "tsc",
                        "vite build", "yarn build", "pnpm build",
                        "cargo build", "cargo check", "go build", "go test", "pytest",
                    ))
                    if is_build and "[exit=0]" not in (tool_result or "")[:300] and _had_any_green_so_far:
                        _consec_red_after_green += 1

                # ── Auto-restore at >=5 consecutive reds after green ──────────
                if _had_any_green_so_far and _consec_red_after_green >= 5 and not _auto_restore_done:
                    try:
                        _red_count_at_restore = _consec_red_after_green
                        res = _cp.restore_last_green(_CURRENT_RUN_ID)
                        _auto_restore_done = True
                        yield {"event": "auto_restore_triggered",
                               "consec_red": _red_count_at_restore,
                               "result": res}
                        # Reset since we're back at green state
                        _consec_red_after_green = 0
                        messages.append({
                            "role": "user",
                            "content": (
                                f"[AUTO-RESTORE EXECUTED] {_red_count_at_restore} red builds after green "
                                f"— files have been restored to the last green checkpoint state "
                                f"({res.get('snapshot', '?')}, build #{res.get('build_idx', '?')}, "
                                f"{res.get('count', 0)} files).\n"
                                f"Restored: {res.get('restored', [])[:10]}\n"
                                f"REQUIRED: re-run `npm run build` NOW to confirm green, "
                                f"then advance step-by-step (1 edit → 1 build) instead of piling up. "
                                f"DO NOT redo the same series of writes that broke it."
                            ),
                        })
                    except Exception as _re:
                        yield {"event": "auto_restore_failed", "error": str(_re)[:200]}

                # Hot-inject newly created skill into current system prompt so the
                # agent can consult it immediately without a redundant skill_search.
                if fn_name == "skill_create" and tool_result.startswith("OK:"):
                    try:
                        from monkey import skills_store as _sst
                        new_name = (fn_args.get("name") or "").strip()
                        body = _sst.read_learned_content(_sst._slugify(new_name))
                        if body and isinstance(messages[0].get("content"), str):
                            messages[0]["content"] += "\n\n" + body
                    except Exception:
                        pass

                # Loop detection: nudge at 3 + auto-skill (HIGH_SIGNAL fires both same iter)
                state = loop_det.observe(fn_name, tool_result)
                from monkey.loop_detector import HIGH_SIGNAL_KINDS as _HSK
                _is_high_signal = state.kind in _HSK
                if state.looping and state.signature not in nudged_signatures and state.occurrences == 3:
                    nudged_signatures.add(state.signature)
                    yield {"event": "loop_detected", "signature": state.signature, "summary": state.summary[:200], "action": "nudge"}
                    try:
                        from monkey import skills_store as _sst
                        from monkey import kb_store as _kbst
                        skill_block = _sst.select_skills(state.summary[:500]) or ""
                        kb_hits = _kbst.search(state.summary[:500], top_k=3) or []
                    except Exception:
                        skill_block, kb_hits = "", []
                    kb_text = "\n\n".join(
                        f"--- KB hit (score {h.get('score',0)}, source {h.get('source','')[:80]}) ---\n{h.get('text','')[:800]}"
                        for h in kb_hits
                    )
                    extra = ""
                    if skill_block:
                        extra += f"\n\n[SKILLS PERTINENTS DÉJÀ EN BASE]\n{skill_block[:2500]}"
                    if kb_text:
                        extra += f"\n\n[KB VECTORIELLE — extraits]\n{kb_text[:2500]}"
                    if not extra:
                        extra = "\n\n(no existing skill/kb covers this topic — `skill_create` required if it persists)"

                    # Structured remediation directive for build_failed
                    remediation = ""
                    if state.kind == "run_command:build_failed":
                        tr_text = (tool_result or "")[:4000]
                        if "TS2339" in tr_text and ("rect" in tr_text or "beginFill" in tr_text or "Graphics" in tr_text):
                            remediation = (
                                "\n\n[MANDATORY REMEDIATION — Pixi v7/v8 mismatch]\n"
                                "STRICT sequence to execute NOW (no other tool in between):\n"
                                "1. `read_file('package.json')` to read the real `pixi.js` version.\n"
                                "2. EXPLICIT DECISION: if v7 → rewrite code with v7 API (`beginFill/drawRect/endFill`); "
                                "if v8 → keep chainable API (`.rect().fill()`); NEVER mix.\n"
                                "3. If you pick v8 but package.json is v7: "
                                "`run_command('npm install pixi.js@^8.0.0', cwd=<project>)`.\n"
                                "4. `edit_file` on EACH file using Graphics, in a single batch.\n"
                                "5. `run_command('npm run build', cwd=<project>)` — MUST return exit 0.\n"
                                "No write_file loops. No blind retries.\n"
                            )
                        elif "TS2339" in tr_text:
                            remediation = (
                                "\n\n[REMEDIATION — TS2339]\n"
                                "1. `read_file('package.json')` + `read_file('tsconfig.json')`.\n"
                                "2. Identify the version of the lib providing the missing type.\n"
                                "3. Either upgrade the lib or adapt the code to the installed API.\n"
                                "4. Rebuild — exit 0 required.\n"
                            )
                    nudge_content = (
                        f"[LOOP DETECTOR] You're repeating the same error class ({state.occurrences}× on `{state.signature}`). "
                        f"Summary: {state.summary[:300]}\n"
                        "→ STOP. Change approach now. Available knowledge below:"
                        f"{extra}{remediation}\n\n"
                        "Apply this info directly. DO NOT retry the same operation."
                    )
                    messages.append({"role": "user", "content": nudge_content})

                    # HIGH_SIGNAL: also promote skill content to system role (heavier weight)
                    if _is_high_signal and skill_block and isinstance(messages[0].get("content"), str):
                        marker = f"[HIGH_SIGNAL_SKILL:{state.kind}]"
                        if marker not in messages[0]["content"]:
                            messages[0]["content"] += (
                                f"\n\n{marker}\n"
                                f"Recurring error detected ({state.kind}). Skills to apply WITHOUT exception:\n"
                                f"{skill_block[:3000]}"
                            )

                # Auto-skill creation — independent of nudge so HIGH_SIGNAL fires both same iter
                _autoskill_thresh = 3 if _is_high_signal else 5
                _autoskill_ready = (
                    state.looping
                    and state.occurrences >= _autoskill_thresh
                    and state.signature not in autoskilled_signatures
                    and autoskill_count < MAX_AUTOSKILLS_PER_RUN
                )
                if _autoskill_ready:
                    autoskilled_signatures.add(state.signature)
                    autoskill_count += 1
                    try:
                        from monkey.tools import skills_tool
                        # Sanitize topic: strip filesystem paths, line:col refs, hex hashes
                        # so the web research isn't polluted by local user paths.
                        raw_topic = state.summary[:500] or fn_name
                        topic = re.sub(r"(?:/[^/\s'\"]+){2,}", "<PATH>", raw_topic)
                        topic = re.sub(r"\b[A-Z]:\\[^\s'\"]+", "<PATH>", topic)
                        topic = re.sub(r":\d+:\d+", "", topic)
                        topic = re.sub(r"\b[0-9a-f]{8,}\b", "", topic)
                        topic = re.sub(r"\s+", " ", topic).strip()[:300] or fn_name
                        slug = re.sub(r"[^a-z0-9]+", "-", topic.lower())[:40].strip("-") or "auto-skill"
                        slug = f"auto-{slug}-{state.signature[-6:]}"
                        queries = [topic, f"{topic} fix", f"{topic} solution stackoverflow"]
                        kw = [w.lower() for w in re.findall(r"[A-Za-z][A-Za-z0-9_]{2,}", topic)]
                        seen = set(); triggers = []
                        for w in kw:
                            if w in seen or w in {"the","and","not","for","with","this","that","type","property","does","exist"}:
                                continue
                            seen.add(w); triggers.append(w)
                            if len(triggers) >= 8:
                                break
                        if state.kind:
                            triggers.append(state.kind)
                        if len(triggers) < 5:
                            triggers.extend(["error", "fix", "stackoverflow", "debug", "build"][:5 - len(triggers)])
                        yield {"event": "skill_synthesizing", "signature": state.signature, "topic": topic[:200], "slug": slug, "triggers": triggers}
                        result = skills_tool.skill_create(
                            name=slug, topic=topic, triggers=triggers, research_queries=queries,
                        )
                        yield {"event": "skill_synthesized", "slug": slug, "result": result[:300] if isinstance(result, str) else str(result)[:300]}
                        messages.append({
                            "role": "user",
                            "content": (
                                f"[AUTO-SKILL] A new skill `{slug}` was just created via web research "
                                f"on your recurring problem. Call `skill_list` or `skill_search` to retrieve "
                                f"and apply it. Change your approach accordingly."
                            ),
                        })
                    except Exception as e:
                        yield {"event": "skill_synthesis_failed", "signature": state.signature, "error": str(e)[:200]}

            all_tool_results.append({"name": fn_name, "args": fn_args, "result": tool_result})
            if (
                force_first_reason == "action"
                and len(all_tool_results) == 1
                and fn_name in _DIRECT_ACTION_RETURN_TOOLS
            ):
                final = _finalize_direct_action_result(fn_name, tool_result)
                _persist_session(user_message, final, all_tool_results)
                yield {"event": "done", "data": _maybe_humanize_for_wa(final)}
                return

            try:
                args_str = json.dumps(fn_args, separators=(',', ':'), ensure_ascii=False)
            except Exception:
                args_str = str(fn_args)

            # Lossless cleaning: strip ANSI + dedupe consecutive identical lines.
            # No hard truncation — repeated noise is collapsed with explicit count.
            history_content = _clean_tool_result(tool_result)
            tool_messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id", ""),
                "content": history_content,
                "name": fn_name,
            })

        # NOTE: do NOT slim tool_calls arguments here — LLM sees its own outputs in history and would
        # recopy placeholders (e.g. `…[1029c]`) into subsequent write_file calls. Slimming happens later
        # in _compact_history() once messages exit the KEEP_LAST_FULL window.
        messages.append({"role": "assistant", "content": text or None, "tool_calls": tool_calls})
        messages.extend(tool_messages)
        real_tools = [tm for tm in tool_messages if tm["name"] != "set_plan"]
        if real_tools:
            # Lossless slim recap: full result sits in the adjacent tool message,
            # so this recap only needs to nudge the LLM about what just happened.
            # OK → name only. ERREUR → name + full error line (first line, deduped ws).
            # Other → name + first non-empty line.
            ok_names: list[str] = []
            err_parts: list[str] = []
            other_parts: list[str] = []
            for tm in real_tools:
                c = (tm.get("content") or "").strip()
                if c.startswith("OK:"):
                    ok_names.append(tm["name"])
                elif c.startswith("ERREUR:") or c.startswith("ERROR:") or c.startswith("Error"):
                    first = re.sub(r"\s+", " ", c.split("\n", 1)[0]).strip()
                    err_parts.append(f"{tm['name']}→{first}")
                else:
                    first_line = next((ln for ln in c.split("\n") if ln.strip()), "")
                    first_line = re.sub(r"\s+", " ", first_line).strip()
                    if first_line:
                        other_parts.append(f"{tm['name']}→{first_line[:200]}")
                    else:
                        ok_names.append(tm["name"])
            recap_bits: list[str] = []
            if err_parts:
                recap_bits.append("err: " + "; ".join(err_parts))
            if other_parts:
                recap_bits.append("out: " + "; ".join(other_parts))
            if ok_names:
                recap_bits.append("ok: " + ",".join(ok_names))
            tool_summary = " | ".join(recap_bits)
            # Force build/test after a streak of writes — otherwise the agent
            # writes 20+ files and stops without ever validating compilation.
            writes_streak = 0
            for r in reversed(all_tool_results):
                if r["name"] in ("write_file", "edit_file", "append_to_file"):
                    writes_streak += 1
                elif r["name"] in ("run_command", "browser_navigate", "browser_run_js"):
                    break
            build_nudge = ""
            if writes_streak >= 6:
                build_nudge = (
                    f"\n[MANDATORY BUILD CHECK] {writes_streak} consecutive file writes "
                    "without validation. Call `run_command` NOW with `npm run build` "
                    "(cwd = project root, not the parent). "
                    "Do not continue writing without a green build."
                )

            # Anti-regression: build was green at some point, and last build red.
            def _is_build_run(r):
                if r["name"] != "run_command":
                    return False
                cmd = ""
                if isinstance(r.get("args"), dict):
                    cmd = (r["args"].get("cmd") or r["args"].get("command") or "").lower()
                return any(k in cmd for k in ("npm run build", "tsc", "vite build", "yarn build", "pnpm build", "cargo build", "go build"))
            build_runs = [r for r in all_tool_results if _is_build_run(r)]
            had_green = False
            last_red = False
            green_idx = -1
            for i, r in enumerate(build_runs):
                out = (r.get("result") or "")[:4000]
                ec_match = re.search(r"\[exit=(\d+)\]", out)
                ec = int(ec_match.group(1)) if ec_match else (0 if "OK:" in out[:20] else 1)
                if ec == 0:
                    had_green = True
                    green_idx = i
                    last_red = False
                else:
                    last_red = True
            regression_nudge = ""
            in_regression = had_green and last_red and green_idx < len(build_runs) - 1
            regression_key = f"{green_idx}:{len(build_runs)}" if in_regression else None
            if in_regression:
                regression_nudge = (
                    "\n[REGRESSION DETECTED] Build was green, then you broke it. "
                    "STOP new writes. SIMPLE preferred option: "
                    "call `restore_last_green` to revert to the working state, "
                    "then advance 1 edit → 1 build. "
                    "Otherwise: read stderr, identify the diff via `read_file`, "
                    "and restore ONLY what breaks. No parallel refactor."
                )
                if regression_key != _last_regression_key:
                    yield {"event": "regression_detected", "green_at": green_idx, "total_builds": len(build_runs)}
                    _last_regression_key = regression_key
            else:
                _last_regression_key = None

            # Force browser phase once first build is green and no browser test yet.
            browser_phase_nudge = ""
            auto_probe_nudge = ""
            if had_green and not last_red:
                has_browser_nav = any(r["name"] == "browser_navigate" for r in all_tool_results)
                has_browser_js = any(r["name"] == "browser_run_js" for r in all_tool_results)
                if not has_browser_nav or not has_browser_js:
                    if not _last_browser_phase_yielded:
                        yield {"event": "browser_phase_required", "has_nav": has_browser_nav, "has_js": has_browser_js}
                        _last_browser_phase_yielded = True
                    _browser_phase_nudge_count += 1
                    # Auto-probe: nudge ignored ≥2 times AND game project AND dist html exists
                    dist_html = _find_dist_html(_written_files)
                    if _should_auto_browser_probe(
                            _browser_phase_nudge_count,
                            is_game_project=_is_game_project(all_tool_results),
                            dist_html=dist_html,
                            already_done=_auto_browser_probe_done):
                        _auto_browser_probe_done = True
                        url = "file://" + dist_html
                        yield {"event": "auto_browser_probe_triggered", "url": url,
                               "reason": f"game+green+no_js after {_browser_phase_nudge_count} nudge(s)"}
                        probe_steps = [
                            ("browser_navigate", {"url": url}),
                            ("browser_run_js", {"code": _PROBE_JS_STATE}),
                            ("browser_run_js", {"code": _PROBE_JS_INPUT}),
                        ]
                        for _pname, _pargs in probe_steps:
                            try:
                                yield {"event": "tool_start", "name": _pname,
                                       "args": _pargs, "auto_probe": True}
                                _pres = _dispatch_tool(_pname, _pargs)
                                yield {"event": "tool_done", "name": _pname,
                                       "result": _pres[:500], "auto_probe": True}
                                all_tool_results.append({"name": _pname, "args": _pargs, "result": _pres})
                            except Exception as _pe:
                                _pres = f"ERREUR: auto-probe {_pname} failed: {_pe}"
                                yield {"event": "tool_done", "name": _pname,
                                       "result": _pres, "auto_probe": True}
                                all_tool_results.append({"name": _pname, "args": _pargs, "result": _pres})
                        auto_probe_nudge = (
                            "\n[AUTO-PROBE EXECUTED] The system triggered browser_navigate + 2 browser_run_js "
                            "for you because you didn't test the runtime. Read the results above: "
                            "if `gameLoaded:false` or `canvas:0` or `moved:false`, fix it (expose `(window).__game`, "
                            "wire inputs to `window`, verify the scene mounts). "
                            "Otherwise deliver the final answer."
                        )
                else:
                    _last_browser_phase_yielded = False
                    _browser_phase_nudge_count = 0

            # Detect passive browser_run_js (no input simulation) — common audit blocker
            input_sim_nudge = ""
            js_calls = [r for r in all_tool_results if r["name"] == "browser_run_js"]
            if len(js_calls) >= 2:
                joined_js = " ".join(
                    str((r.get("args") or {}).get("code", ""))[:600] for r in js_calls
                ).lower()
                has_input_sim = any(k in joined_js for k in (
                    "keyboardevent", "dispatchevent", "keydown", "keyup",
                    "pointerevent", "mousedown", "touchstart",
                ))
                if not has_input_sim:
                    input_sim_nudge = (
                        "\n[MISSING GAMEPLAY PROOF] You called browser_run_js but didn't simulate input. "
                        "Audit fails until you execute:\n"
                        "  `const x0 = (window).__game?.player?.x ?? 0;`\n"
                        "  `window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',key:'ArrowRight'}));`\n"
                        "  `await new Promise(r=>setTimeout(r,300));`\n"
                        "  `window.dispatchEvent(new KeyboardEvent('keyup',{code:'ArrowRight',key:'ArrowRight'}));`\n"
                        "  `return { before: x0, after: (window).__game?.player?.x };`\n"
                        "`after` must differ from `before`. Without this: 'compiles' ≠ 'plays'."
                    )
                    browser_phase_nudge = (
                        "\n[MANDATORY BROWSER PHASE] Build green. BEFORE any new write, "
                        "you MUST validate the runtime: "
                        "1. `run_command npm run build` if not already done "
                        "2. `browser_navigate file://…/dist/index.html` "
                        "3. `browser_run_js` to verify `document.querySelectorAll('canvas').length>=1` "
                        "and `(window as any).__game?.app?.stage?.children?.length>0`. "
                        "No edit before these 3 steps. NOT `npm run preview`."
                    )
            # Single most-relevant nudge — priority: regression > auto_probe > input_sim > browser_phase > build.
            top_nudge = regression_nudge or auto_probe_nudge or input_sim_nudge or browser_phase_nudge or build_nudge
            # Boilerplate "continue immediately, no prose" lives in SYSTEM_PROMPT
            # rule 6 — no need to repeat each iter. Recap + critical nudge only.
            messages.append({
                "role": "user",
                "content": f"[{tool_summary}]" + top_nudge,
            })

    # Loop exited (either via decision phase declined extension, or hard cap)
    final_gate = _quality_gate(all_tool_results)
    if final_gate:
        yield {"event": "audit", "status": "failed", "issues": final_gate + [f"max_iters reached ({max_iters}) — not converged"]}
    final = _ensure_non_empty_final(messages, user_message, model_id, text, all_tool_results)
    _persist_session(user_message, final, all_tool_results)
    yield {"event": "done", "data": _maybe_humanize_for_wa(final)}


def chat(history: list[dict], user_message: str, model_id: str | None = None, animal_id: str | None = None) -> str:
    """Send a message, run tool loop, return final response text with [TOOL] markers."""
    _maybe_refresh_local_tools()
    context_str, workspace = build_context()
    intent = _detect_intent(user_message)
    intent_rule = _INTENT_RULES.get(intent, _INTENT_RULES["search"])
    protocols = _select_protocols(intent, user_message, animal_id=animal_id)
    system = (SYSTEM_PROMPT
              .replace("{persona}", persona_identity(animal_id))
              .replace("{context}", context_str)
              .replace("{workspace}", str(workspace))
              .replace("{intent_rule}", intent_rule)
              .replace("{protocols}", protocols))

    messages: list[dict] = [{"role": "system", "content": system}] + history + [{"role": "user", "content": user_message}]

    accumulated_markers: list[str] = []
    packs = _select_packs(intent, user_message, None)
    active_tools = _get_active_tools(model_id, packs)

    # Tool loop (max 5 iterations to cap tokens)
    for _ in range(5):
        _refresh_now_in_messages(messages)
        result = _call_llm_guarded(messages, model_id, active_tools)
        text: str = result.get("text") or ""
        tool_calls = result.get("tool_calls") or []

        if not tool_calls:
            # No tool calls — final response
            final = text
            if accumulated_markers:
                final = "\n".join(accumulated_markers) + ("\n" + text if text else "")
            return final

        # Dispatch each tool call and collect markers
        tool_messages: list[dict] = []
        for tc in tool_calls:
            fn_name: str = tc.get("function", {}).get("name", "")
            fn_args_raw = tc.get("function", {}).get("arguments", "{}")
            try:
                fn_args: dict = json.loads(fn_args_raw) if isinstance(fn_args_raw, str) else fn_args_raw
            except Exception:
                fn_args = {}

            tool_result = _dispatch_tool(fn_name, fn_args)

            try:
                args_str = json.dumps(fn_args, separators=(',', ':'), ensure_ascii=False)
            except Exception:
                args_str = str(fn_args)

            accumulated_markers.append(f"[TOOL: {fn_name} | {args_str}]\n{tool_result}\n[/TOOL]")
            tool_messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id", ""),
                "content": tool_result,
                "name": fn_name,
            })

        # Append assistant turn (with tool_calls) and tool results for next iteration
        messages.append({"role": "assistant", "content": text or None, "tool_calls": tool_calls})
        messages.extend(tool_messages)
        tool_summary = "; ".join(f"{tm['name']} → {tm['content'][:120]}" for tm in tool_messages)
        messages.append({
            "role": "user",
            "content": f"[Tool results: {tool_summary}] — Confirm now what was accomplished, without ever contradicting these results.",
        })

    # Max iterations reached — return what we have
    final = text
    if accumulated_markers:
        final = "\n".join(accumulated_markers) + ("\n" + text if text else "")
    return final
