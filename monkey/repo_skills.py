"""Curated registry of GitHub repos / external libs the agent should reuse
instead of reinventing.

Each entry is a "repo skill" with:
  - name        : kebab-case slug used by tools
  - repo        : "owner/name" or full URL
  - category    : high-level bucket
  - install     : shell snippet that brings it into the current project
  - usage       : minimal-working-example pattern (short, copy-pasteable)
  - when_to_use : one-liner trigger description
  - triggers    : keywords for matching against user requests
  - license     : SPDX-ish hint (MIT, CC0, ...)
  - notes       : gotchas / version pinning

The list is intentionally short and curated. Add via PR, not via runtime LLM
"""
from __future__ import annotations

REPO_SKILLS: list[dict] = [
    # ── Web / app templates ──────────────────────────────────────────────────
    {
        "name": "vite-react-template",
        "repo": "vitejs/vite (template react-ts)",
        "category": "web-template",
        "install": "npm create vite@latest <project> -- --template react-ts && cd <project> && npm install",
        "usage": "Edit src/App.tsx ; npm run dev ; npm run build",
        "when_to_use": "User asks for a React/TS web app from scratch.",
        "triggers": ["react", "vite", "spa", "web app", "frontend", "dashboard"],
        "license": "MIT",
        "notes": "Use --template vanilla-ts / svelte-ts / vue-ts for variants.",
    },
    {
        "name": "phaser-game-template",
        "repo": "phaserjs/template-vite-ts",
        "category": "game-template",
        "install": "git clone https://github.com/phaserjs/template-vite-ts <project> && cd <project> && npm install",
        "usage": "Scene file in src/scenes/Game.ts ; npm run dev opens at :8080",
        "when_to_use": "User asks for a 2D web game (arcade/platformer/puzzle).",
        "triggers": ["phaser", "game", "platformer", "arcade", "shoot", "2d game"],
        "license": "MIT",
        "notes": "Phaser 3.80+. For Pixi prefer the seeded vite-typescript-pixi-game-scaffold skill.",
    },
    {
        "name": "shadcn-ui",
        "repo": "shadcn-ui/ui",
        "category": "ui-components",
        "install": "npx shadcn@latest init ; npx shadcn@latest add button card dialog",
        "usage": "import { Button } from '@/components/ui/button'",
        "when_to_use": "Need polished React components (buttons, dialogs, tables) in a Tailwind project.",
        "triggers": ["shadcn", "ui kit", "components", "button", "dialog", "tailwind component"],
        "license": "MIT",
        "notes": "Requires Tailwind. Components are copied into your repo, not installed.",
    },
    {
        "name": "tailwindcss",
        "repo": "tailwindlabs/tailwindcss",
        "category": "styling",
        "install": "npm i -D tailwindcss @tailwindcss/vite ; add plugin to vite.config ; @import 'tailwindcss' in main.css",
        "usage": "<div class='flex gap-2 p-4 bg-zinc-900 text-white rounded-xl'>",
        "when_to_use": "Any time styling is needed in a web project.",
        "triggers": ["css", "style", "tailwind", "design", "responsive"],
        "license": "MIT",
        "notes": "v4 uses @tailwindcss/vite plugin, no postcss config needed.",
    },

    # ── Game assets ──────────────────────────────────────────────────────────
    {
        "name": "lpc-spritesheet-generator",
        "repo": "liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator",
        "category": "game-assets",
        "install": "git clone https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator <dir>",
        "usage": "Open index.html in browser ; pick body/clothes/weapon ; export PNG sheet",
        "when_to_use": "Need a 2D RPG character spritesheet (walk/attack/cast frames).",
        "triggers": ["sprite", "character", "rpg", "lpc", "spritesheet", "pixel art character", "walk cycle"],
        "license": "CC-BY-SA / GPL (mixed, see README per asset)",
        "notes": "Static site — can be served locally for offline use. Credit attribution required.",
    },
    {
        "name": "kenney-assets",
        "repo": "kenney.nl (CC0 asset packs)",
        "category": "game-assets",
        "install": "Download pack from https://kenney.nl/assets ; unzip into project /public/assets",
        "usage": "<img src='/assets/platformer-kit/PNG/tile_01.png'>",
        "when_to_use": "Need free placeholder/production game art (tilesets, UI, sfx).",
        "triggers": ["kenney", "asset pack", "tileset", "placeholder art", "free game art", "cc0"],
        "license": "CC0 (public domain)",
        "notes": "No attribution required. Many genres available.",
    },

    # ── Audio ────────────────────────────────────────────────────────────────
    {
        "name": "zzfx",
        "repo": "KilledByAPixel/ZzFX",
        "category": "audio",
        "install": "npm i zzfx  (or copy zzfx.min.js, ~1KB)",
        "usage": "import { zzfx } from 'zzfx' ; zzfx(...[,,1675,,.06,.24,1,1.82,,,837,.06])  // jump",
        "when_to_use": "Need procedural SFX (jump, hit, coin, explosion) without audio assets.",
        "triggers": ["sfx", "sound effect", "audio", "jump sound", "8bit sound", "chiptune", "zzfx"],
        "license": "MIT",
        "notes": "Designer at https://killedbyapixel.github.io/ZzFX/ — copy the param array.",
    },
    {
        "name": "tone-js",
        "repo": "Tonejs/Tone.js",
        "category": "audio",
        "install": "npm i tone",
        "usage": "import * as Tone from 'tone' ; const synth = new Tone.Synth().toDestination() ; synth.triggerAttackRelease('C4','8n')",
        "when_to_use": "Need musical synthesis, sequencing, or interactive audio in a web app.",
        "triggers": ["tone.js", "synth", "music", "midi", "sequencer", "web audio"],
        "license": "MIT",
        "notes": "Audio context must be started after user gesture (Tone.start()).",
    },

    # ── 3D / graphics ────────────────────────────────────────────────────────
    {
        "name": "three-js",
        "repo": "mrdoob/three.js",
        "category": "3d",
        "install": "npm i three @types/three",
        "usage": "import * as THREE from 'three' ; scene = new THREE.Scene() ; renderer = new THREE.WebGLRenderer() ; cube = new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial({color:0xff00ff}))",
        "when_to_use": "User asks for 3D scene, 3D viewer, model loader, WebGL.",
        "triggers": ["3d", "three.js", "webgl", "model viewer", "gltf", "scene"],
        "license": "MIT",
        "notes": "For React, prefer @react-three/fiber.",
    },

    # ── Utilities ────────────────────────────────────────────────────────────
    {
        "name": "markitdown",
        "repo": "microsoft/markitdown",
        "category": "data-parsing",
        "install": "pip install markitdown[all]",
        "usage": "from markitdown import MarkItDown ; md = MarkItDown().convert('file.pdf').text_content",
        "when_to_use": "Parse PDF/DOCX/XLSX/PPTX/HTML/audio into clean markdown for LLM ingestion.",
        "triggers": ["pdf", "docx", "xlsx", "parse document", "extract text", "markdown convert"],
        "license": "MIT",
        "notes": "Replaces ad-hoc pdfplumber/python-docx pipelines.",
    },
    {
        "name": "playwright",
        "repo": "microsoft/playwright",
        "category": "browser-automation",
        "install": "npm i -D @playwright/test ; npx playwright install chromium",
        "usage": "import { chromium } from 'playwright' ; browser = await chromium.launch() ; page = await browser.newPage() ; await page.goto(url)",
        "when_to_use": "Scrape JS-rendered sites, run end-to-end browser tests, automate web flows.",
        "triggers": ["scrape", "headless", "browser automation", "e2e", "playwright", "puppeteer"],
        "license": "Apache-2.0",
        "notes": "Heavier than fetch; use only when JS rendering is required.",
    },
    {
        "name": "game-2d-ts-toolkit",
        "repo": "local-template (monkey/templates/game_2d_ts.py)",
        "category": "game-template",
        "install": "scaffold_game_2d(target_dir='/abs/path/to/new-project', kit='platformer')",
        "usage": "Use scaffold_game_2d with kit ∈ {platformer, metroidvania, topdown-rpg, shmup, puzzle}. Then: cd <project> && npm install && npm run build ; browser_navigate file:///ABS/PATH/dist/index.html",
        "when_to_use": "Any 2D game request. 5 kits cover Gameboy/GBA/SNES/NES genres: platformer (Mario/Megaman side-scroller w/ gravity), metroidvania (Symphony/Hollow Knight — rooms + ability gates + boss), topdown-rpg (Zelda/Pokémon — grid 4-way + NPCs + dialogue + turn-based combat), shmup (1942/Gradius — vertical scroll + waves + bullet patterns), puzzle (Tetris — falling blocks + line clear). Shared engine: Camera, Input (KB/touch/pad), Audio (ZzFX SFX), Music, Save, FSM, HUD, Particles, Health, Combat, Inventory, Dialog, Bullets, GridMovement, Quest, Sequencer, TurnBattle. AGENT.md at every dir for LLM tuning.",
        "triggers": ["2d game", "platformer", "metroidvania", "rpg", "shmup", "shoot em up", "puzzle", "tetris", "zelda", "pokemon", "mario", "arcade", "phaser", "game template", "jeu 2d", "plateforme", "gameboy", "snes", "nes", "gba"],
        "license": "MIT",
        "notes": "Don't use repo_skill_install — call scaffold_game_2d tool directly with absolute target_dir + kit. After scaffold, tune via src/config.ts; add levels in src/levels/; never edit src/engine/ unless adding a new transverse helper. Pick kit from user intent: side-scroll w/ gravity → platformer; explore + abilities → metroidvania; top-down + NPCs/combat → topdown-rpg; vertical bullet hell → shmup; grid blocks → puzzle.",
    },
    {
        "name": "agent-sprite-forge",
        "repo": "0x0funky/agent-sprite-forge",
        "category": "game-assets",
        "install": "git clone https://github.com/0x0funky/agent-sprite-forge <dir> && cd <dir> && npm install",
        "usage": "Configure provider key ; run forge CLI with prompt → outputs sprite frames",
        "when_to_use": "AI-generate character/object sprite sheets from a text prompt.",
        "triggers": ["sprite forge", "ai sprite", "generate sprite", "sprite prompt", "agent-sprite"],
        "license": "see repo",
        "notes": "Uses external image-gen API; check the project README for current providers.",
    },

    # ── Web frameworks / fullstack ──────────────────────────────────────────
    {
        "name": "nextjs",
        "repo": "vercel/next.js",
        "category": "web-template",
        "install": "npx create-next-app@latest <project> --ts --tailwind --app --eslint",
        "usage": "app/page.tsx ; npm run dev opens at :3000",
        "when_to_use": "Fullstack React app with SSR/RSC, file-based routing, API routes.",
        "triggers": ["next.js", "nextjs", "ssr", "rsc", "server components", "fullstack react"],
        "license": "MIT",
        "notes": "Defaults to App Router. For SPA-only prefer vite-react-template.",
    },
    {
        "name": "sveltekit",
        "repo": "sveltejs/kit",
        "category": "web-template",
        "install": "npx sv create <project> ; cd <project> ; npm install",
        "usage": "src/routes/+page.svelte ; npm run dev",
        "when_to_use": "Svelte fullstack app, lighter than Next.js, fast builds.",
        "triggers": ["svelte", "sveltekit", "svelte 5", "runes"],
        "license": "MIT",
    },
    {
        "name": "astro",
        "repo": "withastro/astro",
        "category": "web-template",
        "install": "npm create astro@latest <project>",
        "usage": "src/pages/*.astro — content-first islands architecture",
        "when_to_use": "Marketing site, blog, docs site, mostly-static content with selective JS.",
        "triggers": ["astro", "static site", "blog", "marketing site", "docs site"],
        "license": "MIT",
    },
    {
        "name": "remotion",
        "repo": "remotion-dev/remotion",
        "category": "video",
        "install": "npx create-video@latest <project>",
        "usage": "Compose videos as React components ; npx remotion render src/index.ts MyComp out.mp4",
        "when_to_use": "Programmatic video generation (data-driven, MoGraph, automation).",
        "triggers": ["video", "render video", "mp4", "motion graphics", "remotion"],
        "license": "non-commercial OK / paid for company use",
    },

    # ── State / data ────────────────────────────────────────────────────────
    {
        "name": "tanstack-query",
        "repo": "TanStack/query",
        "category": "data-fetching",
        "install": "npm i @tanstack/react-query",
        "usage": "useQuery({ queryKey:['todos'], queryFn:()=>fetch('/api/todos').then(r=>r.json()) })",
        "when_to_use": "Async server-state caching/syncing in React (replaces useEffect+fetch boilerplate).",
        "triggers": ["react-query", "tanstack", "data fetching", "cache", "swr"],
        "license": "MIT",
    },
    {
        "name": "zustand",
        "repo": "pmndrs/zustand",
        "category": "state",
        "install": "npm i zustand",
        "usage": "const useStore = create((set)=>({count:0, inc:()=>set(s=>({count:s.count+1}))}))",
        "when_to_use": "Simple global state in React without Redux boilerplate.",
        "triggers": ["zustand", "state management", "global state", "store", "redux alternative"],
        "license": "MIT",
    },
    {
        "name": "zod",
        "repo": "colinhacks/zod",
        "category": "validation",
        "install": "npm i zod",
        "usage": "const User = z.object({ id:z.string().uuid(), age:z.number().int().min(0) }) ; User.parse(data)",
        "when_to_use": "Runtime validation + TS type inference for API/form/env input.",
        "triggers": ["zod", "validation", "schema", "type safety", "yup", "joi"],
        "license": "MIT",
    },
    {
        "name": "drizzle-orm",
        "repo": "drizzle-team/drizzle-orm",
        "category": "database",
        "install": "npm i drizzle-orm ; npm i -D drizzle-kit",
        "usage": "const users = pgTable('users', { id:serial('id').primaryKey(), name:text('name') }) ; db.select().from(users)",
        "when_to_use": "TypeScript SQL ORM (Postgres/MySQL/SQLite) with strong types and migrations.",
        "triggers": ["drizzle", "orm", "sql", "postgres", "sqlite", "prisma alternative"],
        "license": "Apache-2.0",
    },

    # ── AI / LLM ────────────────────────────────────────────────────────────
    {
        "name": "vercel-ai-sdk",
        "repo": "vercel/ai",
        "category": "llm",
        "install": "npm i ai @ai-sdk/anthropic @ai-sdk/openai",
        "usage": "import { generateText } from 'ai' ; const { text } = await generateText({ model: anthropic('claude-sonnet-4-6'), prompt:'...' })",
        "when_to_use": "Multi-provider LLM calls with streaming, tool use, structured output in TS.",
        "triggers": ["llm sdk", "vercel ai", "stream chat", "ai sdk", "openai sdk", "anthropic sdk"],
        "license": "Apache-2.0",
    },
    {
        "name": "litellm",
        "repo": "BerriAI/litellm",
        "category": "llm",
        "install": "pip install litellm",
        "usage": "from litellm import completion ; completion(model='anthropic/claude-sonnet-4-6', messages=[{'role':'user','content':'hi'}])",
        "when_to_use": "Unified Python interface to 100+ LLM providers, drop-in OpenAI-compatible.",
        "triggers": ["litellm", "llm proxy", "multi provider", "openai compatible"],
        "license": "MIT",
    },
    {
        "name": "ollama",
        "repo": "ollama/ollama",
        "category": "llm",
        "install": "brew install ollama ; ollama pull llama3.2",
        "usage": "ollama run llama3.2 ; or HTTP at http://localhost:11434/api/generate",
        "when_to_use": "Run local open-source LLMs (Llama, Qwen, Gemma, Mistral) with one command.",
        "triggers": ["ollama", "local llm", "llama", "offline llm", "self-hosted llm"],
        "license": "MIT",
    },
    {
        "name": "transformers-js",
        "repo": "huggingface/transformers.js",
        "category": "ml",
        "install": "npm i @huggingface/transformers",
        "usage": "import { pipeline } from '@huggingface/transformers' ; const c = await pipeline('sentiment-analysis')",
        "when_to_use": "Run HF models in the browser/Node (embeddings, classification, ASR) without backend.",
        "triggers": ["transformers", "huggingface", "embedding", "client side ml", "wasm ml"],
        "license": "Apache-2.0",
    },

    # ── Desktop / Mobile ────────────────────────────────────────────────────
    {
        "name": "tauri",
        "repo": "tauri-apps/tauri",
        "category": "desktop",
        "install": "npm create tauri-app@latest <project>",
        "usage": "src-tauri/src/main.rs (Rust backend) + src/ (web frontend)",
        "when_to_use": "Lightweight cross-platform desktop app (smaller/faster than Electron).",
        "triggers": ["tauri", "desktop app", "electron alternative", "rust desktop"],
        "license": "MIT/Apache-2.0",
    },
    {
        "name": "expo",
        "repo": "expo/expo",
        "category": "mobile",
        "install": "npx create-expo-app@latest <project>",
        "usage": "app/index.tsx (Expo Router) ; npx expo start",
        "when_to_use": "Cross-platform iOS/Android app from React Native with managed workflow.",
        "triggers": ["mobile app", "react native", "ios", "android", "expo"],
        "license": "MIT",
    },

    # ── Charts / dataviz ────────────────────────────────────────────────────
    {
        "name": "recharts",
        "repo": "recharts/recharts",
        "category": "dataviz",
        "install": "npm i recharts",
        "usage": "<LineChart data={data} width={500} height={300}><XAxis dataKey='x'/><YAxis/><Line dataKey='y'/></LineChart>",
        "when_to_use": "Quick declarative charts in React (line/bar/area/pie).",
        "triggers": ["chart", "graph", "dataviz", "recharts", "plot react"],
        "license": "MIT",
    },
    {
        "name": "d3",
        "repo": "d3/d3",
        "category": "dataviz",
        "install": "npm i d3 @types/d3",
        "usage": "import * as d3 from 'd3' ; d3.select('svg').selectAll('circle').data(arr).join('circle')",
        "when_to_use": "Custom/complex dataviz beyond what charting libs offer.",
        "triggers": ["d3", "dataviz custom", "svg", "force graph"],
        "license": "ISC",
    },

    # ── Animation / motion ──────────────────────────────────────────────────
    {
        "name": "framer-motion",
        "repo": "motiondivision/motion",
        "category": "animation",
        "install": "npm i motion",
        "usage": "import { motion } from 'motion/react' ; <motion.div animate={{x:100}} transition={{duration:0.4}}>",
        "when_to_use": "Declarative animations + gestures in React (page transitions, micro-interactions).",
        "triggers": ["framer motion", "animation", "transition", "gesture", "motion"],
        "license": "MIT",
    },
    {
        "name": "gsap",
        "repo": "greensock/GSAP",
        "category": "animation",
        "install": "npm i gsap",
        "usage": "import { gsap } from 'gsap' ; gsap.to('.box', { x:200, rotation:360, duration:1 })",
        "when_to_use": "High-performance timeline animations, scroll-triggered effects, complex sequences.",
        "triggers": ["gsap", "scroll animation", "timeline animation", "scrolltrigger"],
        "license": "Standard 'No Charge' (free for most uses)",
    },

    # ── Editors / 3D content ────────────────────────────────────────────────
    {
        "name": "react-three-fiber",
        "repo": "pmndrs/react-three-fiber",
        "category": "3d",
        "install": "npm i three @react-three/fiber @react-three/drei",
        "usage": "<Canvas><mesh><boxGeometry/><meshStandardMaterial color='hotpink'/></mesh><OrbitControls/></Canvas>",
        "when_to_use": "Build three.js scenes declaratively in React with hooks.",
        "triggers": ["r3f", "react three fiber", "drei", "react 3d"],
        "license": "MIT",
    },
    {
        "name": "monaco-editor",
        "repo": "microsoft/monaco-editor",
        "category": "editor",
        "install": "npm i @monaco-editor/react",
        "usage": "import Editor from '@monaco-editor/react' ; <Editor height='400px' defaultLanguage='typescript'/>",
        "when_to_use": "Embed VS Code editor in a web app (code playground, IDE-like UI).",
        "triggers": ["code editor", "monaco", "vscode editor", "syntax highlight", "code playground"],
        "license": "MIT",
    },
    {
        "name": "tldraw",
        "repo": "tldraw/tldraw",
        "category": "canvas",
        "install": "npm i tldraw",
        "usage": "import { Tldraw } from 'tldraw' ; import 'tldraw/tldraw.css' ; <Tldraw/>",
        "when_to_use": "Embed an infinite whiteboard/diagram canvas in a React app.",
        "triggers": ["whiteboard", "tldraw", "canvas drawing", "diagram", "miro alternative"],
        "license": "Free for non-commercial / paid for commercial",
    },
    {
        "name": "excalidraw",
        "repo": "excalidraw/excalidraw",
        "category": "canvas",
        "install": "npm i @excalidraw/excalidraw",
        "usage": "import { Excalidraw } from '@excalidraw/excalidraw' ; <Excalidraw/>",
        "when_to_use": "Hand-drawn-style whiteboard component.",
        "triggers": ["excalidraw", "sketch board", "hand drawn", "diagram sketch"],
        "license": "MIT",
    },

    # ── Backend / infra ─────────────────────────────────────────────────────
    {
        "name": "hono",
        "repo": "honojs/hono",
        "category": "backend",
        "install": "npm create hono@latest <project>",
        "usage": "const app = new Hono() ; app.get('/', c => c.text('hi')) ; export default app",
        "when_to_use": "Ultra-fast TS web framework that runs on Node, Bun, Deno, Workers, Lambda.",
        "triggers": ["hono", "fastify", "express alternative", "edge api", "cloudflare workers"],
        "license": "MIT",
    },
    {
        "name": "fastapi",
        "repo": "fastapi/fastapi",
        "category": "backend",
        "install": "pip install 'fastapi[standard]'",
        "usage": "from fastapi import FastAPI ; app = FastAPI() ; @app.get('/') def r(): return {'ok':True}",
        "when_to_use": "Python REST API with auto OpenAPI/validation (Pydantic).",
        "triggers": ["fastapi", "python api", "rest python", "uvicorn"],
        "license": "MIT",
    },

    # ── Search / kb ─────────────────────────────────────────────────────────
    {
        "name": "fuse-js",
        "repo": "krisk/Fuse",
        "category": "search",
        "install": "npm i fuse.js",
        "usage": "const fuse = new Fuse(items, { keys:['title','body'] }) ; fuse.search('query')",
        "when_to_use": "Lightweight fuzzy search in-browser (no backend, <10KB).",
        "triggers": ["fuzzy search", "fuse.js", "client side search", "autocomplete"],
        "license": "Apache-2.0",
    },
    {
        "name": "lancedb",
        "repo": "lancedb/lancedb",
        "category": "vector-db",
        "install": "pip install lancedb  (or npm i @lancedb/lancedb)",
        "usage": "db = lancedb.connect('./.lance') ; t = db.create_table('docs', data=[{'vec':[..],'text':'hi'}])",
        "when_to_use": "Embedded vector DB (file-based, no server) for RAG/local KB.",
        "triggers": ["vector db", "lancedb", "rag", "embedding store", "chroma alternative"],
        "license": "Apache-2.0",
    },

    # ── Image / video processing ────────────────────────────────────────────
    {
        "name": "sharp",
        "repo": "lovell/sharp",
        "category": "image",
        "install": "npm i sharp",
        "usage": "sharp('in.jpg').resize(800).webp({ quality:80 }).toFile('out.webp')",
        "when_to_use": "Server-side image resize/convert/compress in Node.",
        "triggers": ["sharp", "image resize", "webp", "thumbnail", "image processing"],
        "license": "Apache-2.0",
    },
    {
        "name": "ffmpeg-wasm",
        "repo": "ffmpegwasm/ffmpeg.wasm",
        "category": "video",
        "install": "npm i @ffmpeg/ffmpeg @ffmpeg/util",
        "usage": "Run ffmpeg cmds in browser/Node — see repo README for full example.",
        "when_to_use": "Run ffmpeg in browser/Node without native binary (transcode, trim, gif).",
        "triggers": ["ffmpeg", "video convert", "transcode", "gif from video", "wasm video"],
        "license": "MIT",
    },

    # ── Dev tooling ─────────────────────────────────────────────────────────
    {
        "name": "biome",
        "repo": "biomejs/biome",
        "category": "tooling",
        "install": "npm i -D --save-exact @biomejs/biome ; npx biome init",
        "usage": "npx biome check --write .   # lint+format JS/TS in one tool",
        "when_to_use": "Replace ESLint+Prettier with one fast Rust tool.",
        "triggers": ["biome", "lint", "format", "eslint alternative", "prettier alternative"],
        "license": "MIT",
    },
    {
        "name": "ruff",
        "repo": "astral-sh/ruff",
        "category": "tooling",
        "install": "pip install ruff   (or: uv tool install ruff)",
        "usage": "ruff check . ; ruff format .",
        "when_to_use": "Fast Python linter+formatter (replaces flake8/black/isort).",
        "triggers": ["ruff", "python lint", "python format", "black", "flake8"],
        "license": "MIT",
    },
    {
        "name": "uv",
        "repo": "astral-sh/uv",
        "category": "tooling",
        "install": "curl -LsSf https://astral.sh/uv/install.sh | sh",
        "usage": "uv init <project> ; uv add httpx ; uv run python main.py",
        "when_to_use": "Fast Python package/project manager (replaces pip/poetry/pyenv/virtualenv).",
        "triggers": ["uv", "python package", "pip alternative", "poetry alternative", "pyenv"],
        "license": "MIT/Apache-2.0",
    },

    # ── Crawl / scrape ──────────────────────────────────────────────────────
    {
        "name": "crawlee",
        "repo": "apify/crawlee",
        "category": "scraping",
        "install": "npx crawlee create <project>",
        "usage": "import { PlaywrightCrawler } from 'crawlee' ; new PlaywrightCrawler({ requestHandler }).run([url])",
        "when_to_use": "Robust large-scale crawling with queue, retries, proxy rotation.",
        "triggers": ["crawler", "crawlee", "scraping framework", "queue scraper"],
        "license": "Apache-2.0",
    },
    {
        "name": "trafilatura",
        "repo": "adbar/trafilatura",
        "category": "scraping",
        "install": "pip install trafilatura",
        "usage": "import trafilatura ; html = trafilatura.fetch_url(url) ; text = trafilatura.extract(html)",
        "when_to_use": "Extract main article text from any web page (cleaner than BeautifulSoup).",
        "triggers": ["article extract", "readability", "trafilatura", "web text", "boilerplate removal"],
        "license": "Apache-2.0",
    },
]


def by_name(name: str) -> dict | None:
    for r in REPO_SKILLS:
        if r["name"] == name:
            return r
    return None


def all_names() -> list[str]:
    return [r["name"] for r in REPO_SKILLS]


def search(query: str, top_k: int = 5) -> list[tuple[float, dict]]:
    """Naive keyword scoring over triggers + name + when_to_use."""
    q = (query or "").lower().strip()
    if not q:
        return []
    qtokens = [t for t in q.replace(",", " ").split() if t]
    scored: list[tuple[float, dict]] = []
    for r in REPO_SKILLS:
        hay = " ".join([
            r["name"], r["category"], r["when_to_use"],
            " ".join(r.get("triggers", [])),
        ]).lower()
        score = 0.0
        for t in qtokens:
            if t in hay:
                score += 1.0
        for trig in r.get("triggers", []):
            if trig in q:
                score += 1.5
        if score > 0:
            scored.append((score, r))
    scored.sort(key=lambda x: -x[0])
    return scored[:top_k]


def render_card(r: dict) -> str:
    """Render a repo skill as a [SKILL ...] markdown card compatible with skills_store."""
    triggers = ", ".join(r.get("triggers", []))
    notes = r.get("notes", "")
    return f"""[SKILL {r['name']} — {r['when_to_use']}]

REPO: {r['repo']}
CATEGORY: {r['category']}
LICENSE: {r.get('license','?')}

INSTALL
```sh
{r['install']}
```

USAGE (minimal example)
```
{r['usage']}
```

WHEN TO USE
- {r['when_to_use']}
- Triggers: {triggers}
{("- Notes: " + notes) if notes else ""}

PROCÉDURE
1. Avant d'écrire du code from scratch sur ce sujet, vérifie que ce repo couvre le besoin.
2. Lance INSTALL dans le cwd du projet.
3. Adapte USAGE au cas d'usage user.
4. Si la lib ne suffit pas, étends-la — ne la réimplémente pas.

SOURCES:
- https://github.com/{r['repo']}
"""
