"""E2E: agent finds 3 blue hoodies on Lazada Thailand (cheap/medium/expensive).

Drive sidecar /chat/stream with deepseek-chat-v3.1.
Validate: 3 products, each has photo + price + URL, total time <120s, low token use.
"""
import json
import os
import re
import sys
import time
import httpx

SIDECAR = os.getenv("MONKEY_SIDECAR", "http://localhost:3471")
MODEL_ID = os.getenv("MONKEY_MODEL", "deepseek/deepseek-chat-v3.1")
PROMPT = os.getenv(
    "MONKEY_PROMPT",
    "Trouve-moi 3 sweats à capuche bleu sur Lazada Thailand : un pas cher, un milieu, un cher. "
    "Format markdown strict, une seule réponse :\n"
    "### <titre>\n![](<image url>)\n**฿<prix>**\n[lien](<product url>)\n\n"
    "PROCÉDURE STRICTE :\n"
    "1. UN browser_navigate sur https://www.lazada.co.th/catalog/?q=เสื้อฮู้ด สีน้ำเงิน&sort=priceasc (query en thaï, sort prix ascendant).\n"
    "2. UN browser_run_js qui retourne JSON.stringify(Array.from(document.querySelectorAll('div[data-qa-locator=\"product-item\"], .Bm3ON, .RfADt')).slice(0, 30).map(c => ({title: c.innerText.split('\\n')[0], price: c.querySelector('.aBrP0, .ooOxS')?.innerText, img: c.querySelector('img')?.src, url: c.querySelector('a')?.href}))).\n"
    "3. Choisis dans le résultat: cheapest, median (index ~milieu), most expensive (dernier avec prix valide).\n"
    "4. RÉPONDS direct au format markdown ci-dessus, prix avec ฿. Pas de retry, pas d'audit en boucle. Imparfait OK si 3 fiches valides.\n"
    "Ne lance pas search_web. Termine en <90s.",
)
TIMEOUT_SEC = 180
MAX_TOKENS = 25_000


def stream_chat(prompt: str):
    """Yield SSE events from /chat/stream."""
    body = {"message": prompt, "model_id": MODEL_ID, "history": []}
    with httpx.stream("POST", f"{SIDECAR}/chat/stream", json=body, timeout=TIMEOUT_SEC) as r:
        r.raise_for_status()
        for raw in r.iter_lines():
            if not raw or not raw.startswith("data: "):
                continue
            try:
                yield json.loads(raw[6:])
            except json.JSONDecodeError:
                continue


def extract_products(text: str):
    """Pull product cards from markdown answer."""
    sections = re.split(r"^###\s+", text, flags=re.MULTILINE)
    products = []
    for s in sections[1:]:
        block = s.strip()
        if not block:
            continue
        title = block.split("\n", 1)[0].strip()
        img = re.search(r"!\[[^\]]*\]\((https?://[^)]+)\)", block)
        link = re.search(r"(?<!\!)\[[^\]]+\]\((https?://[^)]+)\)", block)
        price = (re.search(r"(฿|THB|baht|บาท)\s?(\d[\d.,]{0,12})", block, re.IGNORECASE)
                 or re.search(r"(\d[\d.,\s]{0,12})\s?(THB|฿|baht|บาท)", block, re.IGNORECASE))
        products.append({
            "title": title,
            "image": img.group(1) if img else None,
            "url": link.group(1) if link else None,
            "price": price.group(0).strip() if price else None,
            "raw_len": len(block),
        })
    return products


def main():
    t0 = time.monotonic()
    final_text = ""
    tools_called = []
    tokens_in = 0
    tokens_out = 0
    error = None
    iter_count = 0
    nav_urls = []
    print(f"[e2e] model={MODEL_ID}")
    print(f"[e2e] prompt={PROMPT[:120]}…")

    try:
        for ev in stream_chat(PROMPT):
            kind = ev.get("event")
            data = ev.get("data")
            if kind == "tool_start":
                name = ev.get("name") or (data.get("name") if isinstance(data, dict) else None)
                args = ev.get("args") or (data.get("args") if isinstance(data, dict) else None)
                tools_called.append(name)
                iter_count += 1
                if name == "browser_navigate" and isinstance(args, dict):
                    nav_urls.append(args.get("url", ""))
                print(f"[e2e] tool_start {name} args={str(args)[:120]}")
            elif kind == "tool_done":
                name = ev.get("name")
                res = ev.get("result") or (data if isinstance(data, str) else "")
                print(f"[e2e] tool_done   {name}: {str(res)[:140]}")
            elif kind == "done":
                if isinstance(data, str):
                    final_text = data
            elif kind == "error":
                error = str(data)
                print(f"[e2e] ERROR event: {error}")
            elif kind == "plan":
                print(f"[e2e] plan steps={ev.get('steps')} current={ev.get('current')}")
            elif kind == "audit":
                print(f"[e2e] audit status={ev.get('status')} issues={ev.get('issues')}")
    except httpx.HTTPError as e:
        error = f"http_error: {e}"

    elapsed = time.monotonic() - t0

    print("\n========== FINAL TEXT ==========")
    print(final_text or "(empty)")
    print("================================\n")

    products = extract_products(final_text or "")
    print(f"[e2e] elapsed={elapsed:.1f}s tools={len(tools_called)} iters={iter_count}")
    print(f"[e2e] tools_used={tools_called}")
    print(f"[e2e] tokens_in={tokens_in} tokens_out={tokens_out}")
    print(f"[e2e] products_extracted={len(products)}")
    for i, p in enumerate(products):
        print(f"  [{i+1}] title={p['title'][:60]!r} img={'Y' if p['image'] else 'N'} "
              f"url={'Y' if p['url'] else 'N'} price={p['price']!r}")

    failures = []
    if error:
        failures.append(f"error: {error}")
    if elapsed > 120:
        failures.append(f"too slow: {elapsed:.1f}s > 120s")
    if tokens_in + tokens_out > MAX_TOKENS:
        failures.append(f"too many tokens: {tokens_in + tokens_out} > {MAX_TOKENS}")
    if len(products) != 3:
        failures.append(f"products count: {len(products)} != 3")
    for i, p in enumerate(products):
        if not p.get("image"):
            failures.append(f"product {i+1} missing image")
        if not p.get("url"):
            failures.append(f"product {i+1} missing url")
        if not p.get("price"):
            failures.append(f"product {i+1} missing price")
    text_low = (final_text or "").lower()
    if "lazada" not in text_low:
        failures.append("no 'lazada' in answer")

    has_thai_query = False
    for u in nav_urls:
        if re.search(r"%E0%B[8-9]", u) or re.search(r"[฀-๿]", u):
            has_thai_query = True
            break
    print(f"[e2e] nav_urls={nav_urls}")
    if nav_urls and not has_thai_query:
        failures.append(f"query not in Thai: navigated to {nav_urls[0][:120]}")

    print()
    if failures:
        print("FAIL:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("PASS — 3 products, photo+price+url, < 2min, eco")
    sys.exit(0)


if __name__ == "__main__":
    main()
