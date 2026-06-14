# Game-engine context — the fantasy console the agent authors for

This is the **authoring context** for the Monkey 8-bit maker: the spec the **agent reads**
when a user asks it to write or edit a game (cart). It is also the human reference for the
runtime. It defines the **limits**, the **draw/input API**, the **cart format**, and the
**rules the LLM must follow**. It is iso to PICO-8 where that helps and simpler everywhere
else (it's TypeScript-hosted, not a Lua VM — see [FEASIBILITY.md](FEASIBILITY.md)).

> Treat this file as the system-context block fed to the model before it emits cart code. If
> you change a limit or an API function in the runtime, update this file in the same pass.

---

## 1. Hard limits (the constraints that give it the 8-bit feel)

| Resource | Limit | Notes |
|---|---|---|
| Screen | **128 × 128 px** | origin top-left, `(0,0)`..`(127,127)` |
| Palette | **16 colours**, fixed indices `0..15` | indexed colour only; no RGB in cart code |
| Sprites | **256**, each **8 × 8 px**, ids `0..255` | stored in one 128×128 indexed buffer (the sheet) |
| Spritesheet | **128 × 128 px** = 16 × 16 sprites | sprite `n` at sheet cell `(n%16, n÷16)` |
| Map | **128 × 32 tiles** | each cell holds a sprite id `0..255` |
| Input | **6 buttons**: `0 ←  1 →  2 ↑  3 ↓  4 O  5 X` | one player in v1 |
| Tick | `_update()` + `_draw()` at **30 fps** (`_update60` → 60) | keep per-frame work small |
| Audio | **deferred in v1** | `sfx()`/`music()` are no-ops until the audio subsystem ships |

The fixed 16-colour palette (indices, canonical PICO-8 order):

```
0 black     1 dark-blue   2 dark-purple 3 dark-green
4 brown     5 dark-grey   6 light-grey  7 white
8 red       9 orange     10 yellow     11 green
12 blue    13 indigo     14 pink       15 peach
```

---

## 2. Program shape — the three callbacks

A cart is code that defines up to three globals. The runtime calls them; the cart never owns
the loop:

```ts
function _init() { /* once, before the first frame */ }
function _update() { /* game logic, once per tick (30/s) */ }
function _draw() { /* render, once per frame, after _update */ }
```

All three are optional. State lives in cart-scope variables. No frame is drawn until `_draw`
runs; clear the screen yourself (`cls()`), as PICO-8 does.

---

## 3. The API (the whitelist — the ONLY calls a cart may make)

Cart code may call **only** these. Anything else (no `window`, `fetch`, `import`, `eval`,
`document`, timers) — the sandbox rejects unknown identifiers before running.

### Graphics
| Fn | Signature | Does |
|---|---|---|
| `cls` | `cls(col=0)` | clear screen to colour |
| `pset` | `pset(x,y,col)` | set one pixel |
| `pget` | `pget(x,y) → col` | read a pixel |
| `line` | `line(x0,y0,x1,y1,col)` | line |
| `rect` | `rect(x0,y0,x1,y1,col)` | rectangle outline |
| `rectfill` | `rectfill(x0,y0,x1,y1,col)` | filled rectangle |
| `circ` | `circ(x,y,r,col)` | circle outline |
| `circfill` | `circfill(x,y,r,col)` | filled circle |
| `spr` | `spr(n,x,y,flipx=false,flipy=false)` | draw sprite `n` at `(x,y)` |
| `sspr` | `sspr(sx,sy,sw,sh,dx,dy,dw=sw,dh=sh)` | stretched sheet region |
| `map` | `map(cx,cy,sx,sy,cw,ch)` | draw a tilemap region; sprite `0` = empty |
| `mget` | `mget(cx,cy) → n` | read a map cell |
| `mset` | `mset(cx,cy,n)` | write a map cell |
| `print` | `print(s,x,y,col=7)` | text (built-in 3×5 font) |
| `pal` | `pal(from,to)` | remap a palette index for draws (reset: `pal()`) |
| `camera` | `camera(x=0,y=0)` | offset all subsequent draws |
| `fget`/`fset` | `fget(n,f?)` / `fset(n,f,v)` | sprite flag bits (collision tags) |

### Input
| Fn | Signature | Does |
|---|---|---|
| `btn` | `btn(i) → bool` | button `i` held this frame |
| `btnp` | `btnp(i) → bool` | button `i` pressed this frame (edge, with repeat) |

### Math / util (pure, sandbox-safe)
`flr ceil abs min max mid sqrt sin cos atan2 rnd(x) srand(s) sgn` — plus standard `Math`
is **not** exposed; use these. `rnd()`/`srand()` use the cart's seeded RNG so runs are
replayable (same discipline as the RPG's seeded streams).

### Audio (v1 = no-op stubs, keep calls in code)
`sfx(n,ch?)`, `music(n?)` — accepted, do nothing yet; cart stays forward-compatible.

---

## 4. Cart format (what gets saved — local-first JSON)

One serialisable object in `localStorage["monkey.carts"]` (an array of these). The server
never sees it.

```ts
interface Cart {
  id: string;            // uuid
  name: string;          // user-facing, also the spoken launch name
  code: string;          // the cart program (TS-subset / DSL) — what the LLM writes
  sheet: Uint8Array;     // 128*128 indexed-colour bytes (the spritesheet)  → base64 on disk
  flags: Uint8Array;     // 256 sprite-flag bytes
  map: Uint8Array;       // 128*32 sprite-id bytes (the tilemap)            → base64 on disk
  thumb?: string;        // last _draw frame, data-URL, for the library grid
  createdAt: number;
  updatedAt: number;
}
```

Export/import = this object as a file (a `.monkeycart` JSON, optionally a PICO-8-ish `.p8`
text export later). No server round-trip; sharing rides the existing client-side encrypted-
blob path if/when added.

---

## 5. Rules for the agent when authoring or editing a cart

The maker's text box streams the user's request **plus this context plus the current cart**
to the agent. The agent must:

1. **Emit only whitelisted API calls** (§3) and plain control flow. No host/DOM/network/
   timer access — it will be rejected by the sandbox and fail the run.
2. **Respect the limits** (§1): coordinates `0..127`, sprite ids `0..255`, map `128×32`,
   colours `0..15`. Don't allocate unbounded per-frame.
3. **Use the three callbacks** (§2); never write your own `while(true)` loop.
4. **Return a patch, not prose**: the new/edited `code`, and any sprite ops as explicit
   instructions the client applies to `sheet` (e.g. *"sprite 1 = an 8×8 player, colour 7 on
   transparent; sprite 2 = a coin, colour 10"*). The **client owns persistence and
   execution** — the agent proposes, the runtime disposes.
5. **Keep it small and seeded**: use `rnd/srand`, keep state in cart-scope vars, prefer the
   simplest thing that plays. The constraints are the point.
6. **Never touch app/meta state**: the agent may write *cart* logic, but a cart cannot read or
   change Monkey app state, other carts, the filesystem, or credits. The sandbox enforces it;
   the agent must not even try.

> **Boundary note (vs the RPG rule).** Elsewhere the LLM authors *only thematic strings*.
> In the **maker** the LLM authors **code + pixel data** — that is the feature. It is safe
> only because the cart is **sandboxed and local**. This widened boundary is intentional and
> is logged in FEASIBILITY.md §5/§7 as a new invariant to sign off.

---

## 6. Runtime ↔ agent ↔ launch (where this plugs in)

- **Launch** (deterministic, like chess): a `game_launch` verb opens the maker
  (`game="maker"`) or plays a saved cart (`game="cart"`, id resolved client-side by name).
  Wiring point: `monkey/agent.py` (`_detect_game_launch`), `desktop/src/api.ts`,
  `desktop/src/screens/AgentScreen.tsx` switch. See FEASIBILITY.md §2.
- **Author/edit**: the maker's text box → agent (this context + current cart) → patch →
  client applies + re-runs.
- **Play**: a generic `<CartConsole cartId>` loads a `Cart` and runs the loop; a generic
  `<MakerConsole>` hosts the editors + the text box. **One console pair serves every
  cart** — new games need no new component (the chess→generic upgrade in FEASIBILITY.md §2).

---

## 7. v1 vs later

- **v1 (build):** §1 limits, §2 callbacks, §3 graphics+input+math, §4 cart format, sprite +
  spritesheet + map editors, manual code editor, **text-to-cart**, project library, launch +
  authoring agent hookup. **Sandbox = Web Worker + whitelisted API** (FEASIBILITY.md §4).
- **Later:** audio (`sfx`/`music` made real — 4 ch / 64 SFX / 64 patterns), 2-player input,
  `.p8` import/export, cart sharing over the encrypted-blob path.
