# Feasibility report — a PICO-8-like maker, agent-driven, inside Monkey Quest

**Goal (verbatim intent):** an editor that *looks like PICO-8* — **same limitations but
simpler** because it's TS (or another lang) — **plus a text input so the LLM can be used
for everything**. Iso-functional with PICO-8: **sprite editor, map editor, spritesheet,
code/runtime**, the whole thing **wired to the agent**. Designed carts must then be
**callable from the agent exactly like chess / poker / scrabble** are today. We also need a
**project listing** to manage / edit them.

This is a **report + audit**, not implementation. It (a) pins the real PICO-8 spec from the
web, (b) maps the *existing* agent↔game wiring in this repo so the new system bolts onto it,
(c) rates every piece on a **difficulty table** ("iso but super simple"), (d) designs the
agent connection and the project listing, (e) flags the pillars we must not break.

---

## 1. PICO-8 spec — the iso target (web-grounded)

| Axis | PICO-8 | Source |
|---|---|---|
| Display | **128 × 128 px** | lexaloffle.com/pico-8.php |
| Palette | **16 fixed colours** | lexaloffle.com/pico-8.php |
| Sprites | **256 sprites, 8 × 8 px** (sheet shares memory with the map) | lexaloffle.com/pico-8.php, pico-8.fandom |
| Spritesheet | **128 × 128 px** (= 16 × 16 sprites) | derived from 256×8×8 |
| Map / tilemap | **128 × 32 tiles** (top half overlaps sprite mem 0–127) | lexaloffle.com/pico-8.php |
| Sound | **4 channels**, **64 SFX**, **64 music patterns** | lexaloffle.com manual |
| Code | **P8 Lua**, **8192 tokens**, **15616 B compressed** | lexaloffle BBS, itch threads |
| Cart | **32 KB** (.p8 / .p8.png) | lexaloffle.com/pico-8.php |
| Input | **6 buttons** (←→↑↓ + O + X) × up to 2 players | lexaloffle manual |
| Editors | **code · sprite · map · SFX · music** (5 built-in tabs) | lexaloffle.com/pico-8.php |
| Runtime | callbacks `_init` / `_update` (or `_update60`) / `_draw`; ~4 M vm inst/s | lexaloffle manual |

**The point of the limits** is creative constraint + portability: a cart is a *single tiny
file* anyone can run. We keep the *spirit* (small, fixed palette, 8×8 tiles, single-file
cart) but **drop the parts that exist only because PICO-8 is a Lua VM in a sandbox** (token
counting, compression budget, custom bytecode). In TS we don't need them.

---

## 2. How games are wired to the agent **today** (audit baseline)

Already-shipped path — the new maker must reuse it, not reinvent it:

```
user: "play chess"
  └─ monkey/agent.py:4716  _detect_game_launch()   regex, ZERO llm, deterministic
        ├─ yields tool_start / tool_done  name="launch_game"  args={game}
        └─ yields  {event:"game_launch", game:"chess"}
  └─ desktop/src/api.ts:357   passes game_launch through the SSE stream
  └─ desktop/src/screens/AgentScreen.tsx:350
        setActiveGame("chess")
        └─ render switch (line 548+):  activeGame==="chess" → <ChessConsole onExit=…/>
```

Facts that matter for the design:

- **Five games exist**: `chess`, `poker`, `scrabble`, `rts`, `rpg`. Each = a
  `desktop/src/game/<name>/` logic folder (`engine.ts` / `state.ts` / `types.ts`) **+** a
  `desktop/src/components/<Name>Console.tsx` full-screen view.
- **Launch is a hard-coded triple**: a regex in `agent.py`, a string id on the
  `game_launch` event, a `case` in the AgentScreen switch. Adding a game = touch all three.
- **It's deterministic, no LLM** — a weak 3B never has to reason to start a game. Good: a
  *maker* launch ("open the editor", "edit my platformer") can be just as deterministic.
- **Each game is 100 % client-side** (localStorage), the server sees nothing — exactly the
  local-first invariant the maker must also honour.

**Implication for "callable like chess":** a built cart should *not* need its own regex +
switch case forever. Instead generalise the triple **once**:
- one new launch verb `play_cart <id>` / `open_maker [id]`,
- one generic `<CartConsole cartId=…>` that loads any saved project and runs it,
- one generic `<MakerConsole>` (the editor shell).

After that, a *new* user-made game is just a **new row in localStorage**, callable by name
through the same single path — no code change per cart. That is the unlock.

---

## 3. "Iso but super simple" — the difficulty table

Difficulty **1 = trivial … 5 = hard**. "Iso?" = can we match PICO-8's capability.
Effort is the honest build cost given this repo already has React + a game-console pattern.

| # | Component | PICO-8 has | Our simplest iso form | Diff | Iso? | Why this difficulty |
|---|---|---|---|:--:|:--:|---|
| 1 | **Palette + canvas runtime** | 128² / 16 col / `_draw` loop | `<canvas>` 128², fixed 16-col LUT, `requestAnimationFrame` calling `update/draw` | **1** | ✅ full | Pure 2D canvas. No VM. A weekend. |
| 2 | **Draw API** (`cls spr print pset rect line map btn`) | full | ~20 TS functions over an ImageData/offscreen canvas | **2** | ✅ full | Mechanical; each fn is a few lines. The contract the LLM codes against. |
| 3 | **Sprite editor** | 256×8×8, 16-col, fill/flip/copy | grid painter → `Uint8Array(128*128)` indexed colour; pencil/fill/pick | **2** | ✅ full | A colour-index grid + click-paint. Known UI. |
| 4 | **Spritesheet view** | 16×16 sprite atlas | the same 128² buffer shown whole; click a cell to edit it | **2** | ✅ full | Same buffer as #3, just zoomed-out + selection. |
| 5 | **Map / tilemap editor** | 128×32 tiles | `Uint8Array(128*32)` of sprite ids; stamp tiles from the sheet | **3** | ✅ full | Two-pane (sheet picker + map canvas) + pan/zoom. RTS map code here is precedent. |
| 6 | **Code editor (manual)** | Lua + token meter | a `<textarea>`/CodeMirror of **TS** (or a tiny Lua-ish DSL) | **2** | ⚠ different lang | Easy to host; *hard to sandbox safely* (see #11). |
| 7 | **★ Text-to-cart (LLM)** | — (PICO-8 has none) | prompt box → agent writes/edits the cart's code + can paint sprites | **3** | ➕ beyond | **The headline feature.** Leverages the existing agent. Drops the human-code-editor to optional. |
| 8 | **Input** | 6 buttons ×2P | keyboard/touch → `btn(i)`/`btnp(i)` bitfield | **1** | ✅ full | Trivial event→bitmask. |
| 9 | **Persistence / cart format** | .p8 single file | one JSON `Cart{ id,name,code,sheet,map,meta }` in localStorage | **2** | ✅ simpler | One serialisable object. local-first, no server. |
| 10 | **Agent launch hookup** | — | generalise the chess triple → `play_cart`/`open_maker` + generic consoles | **3** | ➕ beyond | One-time plumbing in agent.py + api.ts + AgentScreen. Then free per cart. |
| 11 | **Safe code execution** | Lua sandbox (free) | run untrusted TS/JS without leaking host (Tauri!) | **4** | ⚠ risk | The real hard part. Options below. Must not `eval` in the app context. |
| 12 | **Project listing / manager** | cart browser (SPLORE) | a grid screen: list/rename/duplicate/delete/export, "Edit"/"Play" | **2** | ✅ full | CRUD over the localStorage cart list. UI like the RPG world-vignette picker. |
| 13 | **SFX editor** | 64 SFX, 4 ch | WebAudio: pitch/instrument/volume per step | **4** | ⚠ partial | Doable but its own subsystem; defer to v2. |
| 14 | **Music tracker** | 64 patterns | chain SFX into patterns | **5** | ⚠ partial | Hardest, lowest ROI. Defer to v2/never. |

**Read of the table:** the *visual + data + run* half of PICO-8 (rows 1–5, 8, 9, 12) is
**low difficulty and fully iso** — canvas, indexed-colour buffers, CRUD. The two genuine
risks are **#11 safe execution** (security, not features) and the **audio rows 13–14**
(separable, deferrable). The one place we go **beyond** PICO-8 is **#7 text-to-cart**, and
it's what makes "super simple": the user can skip the code editor entirely and *describe*
the game.

### MVP cut line

> **Ship v1 = rows 1,2,3,4,5,6,7,8,9,10,12.** That is a complete, agent-driven, iso visual
> fantasy-console maker with project management. **Defer 13,14 (audio)** behind a "coming
> soon" tab. **Resolve 11 (sandbox) before any cart is shareable** — for purely *local* author-
> and-play it's lower risk, but decide it up front, not after.

---

## 4. The sandbox decision (row 11 — the only true blocker)

We run **user/LLM-authored code** that we did not write. In a Tauri app, naive `eval` or `new
Function` runs with the renderer's privileges (and the agent has filesystem/command tools in
this repo). Pick one, in order of recommendation:

1. **Constrained API + interpreted mini-language (recommended for v1).** The cart code only
   ever calls our ~20 draw/input functions. Don't expose `window`, `fetch`, `import`. Run it
   via a **Web Worker** with no network/DOM, message-passing the draw calls back. The LLM
   targets a *tiny* surface, which also makes it author *better* code.
2. **QuickJS / wasmoon (Lua) in WASM.** True PICO-8 fidelity (real Lua), fully sandboxed,
   heavier dep. Good if "must be Lua" matters. Higher cost, slower iteration.
3. **Raw `new Function` in a Worker** — only acceptable because a Worker has no DOM/host
   access; still must strip `fetch`/`importScripts`. Fastest to build, thinnest safety
   margin. Acceptable for **local-only, never-shared** carts; **not** for any cart that could
   arrive from another user (P2P) — that path needs option 1 or 2.

**Verdict:** v1 = **option 1** (Worker + whitelisted API, language = TS-subset *or* a small
DSL). It's the smallest attack surface, the easiest target for the LLM, and keeps the
"super simple" promise. Revisit Lua-in-WASM only if fidelity demands it.

---

## 5. Agent connection — how "the LLM is used for everything"

Three distinct agent touchpoints. All reuse the existing SSE/tool plumbing.

**A. Launch (deterministic, like chess).** Add to `monkey/agent.py:_detect_game_launch`
(or a sibling) the verbs: *"open the maker / game editor"* → `game_launch game="maker"`;
*"play my <name>"* / *"edit <name>"* → `game_launch game="cart" cartId=<resolved>`. The id is
resolved client-side against the localStorage project list (the server must stay content-
blind — it can't know cart names). Cleanest: the **launch verb is generic**, the desktop
matches the spoken name to a saved cart locally.

**B. Authoring (the headline).** Inside the maker, a **text box** streams a request to the
agent with the **current cart as context** (see ENGINE-CONTEXT.md — that doc *is* the system
context the agent reads). The agent replies with a **patch**: new/edited `code`, and/or
sprite ops ("paint sprite 3 as a red potion"). The client **applies and re-runs** — same
client-owns-the-result discipline as the RPG (LLM proposes strings/code, client owns
persistence + execution). Editing existing carts = the same channel with a diff.

**C. Play.** Once authored, the cart is callable by name through path **A** — *exactly* the
chess parity the user asked for, but with **zero new per-cart code** because the console is
generic.

> **Pillar guard:** the LLM authors **code + pixel data** here (a maker is literally
> "LLM writes the game"), which is broader than the RPG rule "LLM authors only strings". That
> is fine **because the cart is sandboxed and local** — but the boundary moves, so state it:
> the agent may emit cart code/sprites; it may **not** touch app state, the filesystem, or
> the network *through* a cart. Enforced by the row-11 sandbox, not by trust.

---

## 6. Project listing / management (the "gérer / éditer" ask)

A `<MakerLibrary>` screen, modelled on the RPG's custom-world vignette picker
(`SetupView`/`ExpeditionPicker` already do exactly this for worlds):

- **Store:** `localStorage["monkey.carts"]` → `Cart[]` (`{id,name,thumb,code,sheet,map,
  updatedAt}`). Same local-first pattern as `loadWorlds/saveWorld/deleteWorld` in
  `rpg/state.ts`. Server stores nothing.
- **Grid of cart cards**: thumbnail (last `_draw` frame), name, updated date.
- **Per card:** ▶ Play (→ generic CartConsole) · ✎ Edit (→ Maker on that cart) · ⧉ Duplicate
  · ✎ Rename · 🗑 Delete · ⤓ Export (download the JSON/.p8-style file) · ⤒ Import.
- **"New cart"** → empty maker. **Agent entry:** "list my games", "open my platformer",
  "make a new shmup" all route through the same launch verb.

CRUD difficulty **2** — it's list state + localStorage, no new concepts.

---

## 7. Risks & non-regression

| Risk | Severity | Mitigation |
|---|---|---|
| Untrusted cart code escapes sandbox (esp. P2P-shared carts) | **High** | Row-11 option 1/2; never `eval` in renderer; Worker, no host APIs |
| LLM emits app/host calls inside a cart | High | Whitelisted API only; reject unknown identifiers before run |
| "Client-owns-numbers" looks violated (LLM writes logic) | Med | Re-scope the pillar for the maker: cart logic is sandboxed+local, app/meta numbers still client-only. Record as new invariant. |
| Audio scope creep (rows 13–14) stalls v1 | Med | Hard cut: ship silent v1, audio later |
| Per-cart launch bloats agent.py with regex | Med | Generic `play_cart`/`open_maker` verb; name resolution client-side |
| Server tempted to store carts | Low | Forbidden — local-first; export/import + (later) the existing encrypted-blob share path |

**Pillars honoured:** local-first ✅ (localStorage, server blind) · no pay-to-win ✅ (a maker
sells nothing; cosmetic-only stays untouched) · LLM+procedural-at-player's-whim ✅ (this *is*
that, maximised) · client-owns-numbers ⚠ **re-scoped** (logged above, needs sign-off).

---

## 8. Verdict

**Feasible, and a strong fit.** The hard parts of a fantasy console (a Lua VM, token budgets,
compression) are exactly the parts we **delete** by being TS + agent-driven. What remains —
canvas, indexed-colour buffers, tile maps, CRUD — is **low difficulty and already has
precedent in this repo** (RTS maps, RPG world persistence, the game-console launch pattern).

- **Genuinely hard:** one thing — **safe execution of untrusted code** (#11). Decide the
  sandbox first.
- **Deferrable:** audio (#13–14).
- **The multiplier:** **text-to-cart** (#7) + the **generic launch** (#10) together deliver
  the exact "designed games callable like chess/poker" the user wants, with no per-game code.

**Recommended v1 scope:** rows 1–10 + 12, Worker-sandboxed whitelisted API, language a
TS-subset (or tiny DSL), silent. Agent does launch (deterministic) + authoring (streamed
patch). Project library = a localStorage CRUD screen. Estimated as the *small* end of a
game-console feature because every primitive already exists here.

The companion **ENGINE-CONTEXT.md** is the spec/system-context the agent reads to author
carts (API surface, limits, cart JSON shape) — start there to implement.

---

### Sources
- [PICO-8 — lexaloffle](https://www.lexaloffle.com/pico-8.php)
- [PICO-8 Manual](https://www.lexaloffle.com/dl/docs/pico-8_manual.html)
- [PICO-8 Wiki — Save / limits (Fandom)](https://pico-8.fandom.com/wiki/Save)
- [Compressed size limit thread (lexaloffle BBS)](https://www.lexaloffle.com/bbs/?tid=3205)
- [Code limit options (itch.io)](https://itch.io/t/1132437/code-limit-options)
