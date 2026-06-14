"""Web tools: search and fetch pages.

Default routing: stealth browser first, httpx fallback only for pure JSON/API
endpoints or when the browser is unavailable. Every browser call goes through
the persistent event loop in monkey._browser_loop, never asyncio.run().
"""
import json
import re
import os
import httpx
from bs4 import BeautifulSoup

from monkey._browser_loop import run as _run
from monkey.tools import _netcache

MAX_CHARS = 12000

# TLD → (Google gl, Google hl, DDG kl, Bing cc)
_TLD_LOCALE = {
    "th": ("th", "th", "th-th", "TH"),
    "co.th": ("th", "th", "th-th", "TH"),
    "cn": ("cn", "zh-CN", "cn-zh", "CN"),
    "com.cn": ("cn", "zh-CN", "cn-zh", "CN"),
    "jp": ("jp", "ja", "jp-jp", "JP"),
    "co.jp": ("jp", "ja", "jp-jp", "JP"),
    "kr": ("kr", "ko", "kr-kr", "KR"),
    "co.kr": ("kr", "ko", "kr-kr", "KR"),
    "br": ("br", "pt-BR", "br-pt", "BR"),
    "com.br": ("br", "pt-BR", "br-pt", "BR"),
    "pt": ("pt", "pt-PT", "pt-pt", "PT"),
    "ru": ("ru", "ru", "ru-ru", "RU"),
    "de": ("de", "de", "de-de", "DE"),
    "es": ("es", "es", "es-es", "ES"),
    "com.ar": ("ar", "es", "ar-es", "AR"),
    "com.mx": ("mx", "es", "mx-es", "MX"),
    "cl": ("cl", "es", "cl-es", "CL"),
    "it": ("it", "it", "it-it", "IT"),
    "co.uk": ("uk", "en-GB", "uk-en", "GB"),
    "fr": ("fr", "fr", "fr-fr", "FR"),
    "be": ("be", "fr", "be-fr", "BE"),
    "ca": ("ca", "en", "ca-en", "CA"),
    "ch": ("ch", "de", "ch-de", "CH"),
    "vn": ("vn", "vi", "vn-vi", "VN"),
    "id": ("id", "id", "id-id", "ID"),
    "in": ("in", "en", "in-en", "IN"),
}


# Stopwords multi-langues (FR/EN/ES/DE/IT/PT) — courts mots-vides à éliminer
# avant l'envoi au moteur. On garde nombres, mots Capitalisés et tokens techniques.
_STOPWORDS = frozenset({
    # English
    "a","an","the","is","are","was","were","be","been","being","do","does","did",
    "i","you","he","she","it","we","they","me","my","your","his","her","our","their",
    "this","that","these","those","what","which","who","whom","whose","when","where","why","how",
    "and","or","but","if","then","so","than","as","of","at","by","for","with","about","against",
    "between","into","through","during","before","after","above","below","to","from","up","down",
    "in","out","on","off","over","under","again","further","once","there","here",
    "all","any","both","each","few","more","most","other","some","such","no","nor","not",
    "only","own","same","very","can","will","just","should","now","does","could","would","may",
    "have","has","had","having","please","using","use","make","made","get","got","want","need",
    # French
    "le","la","les","un","une","des","de","du","au","aux","ce","cet","cette","ces","mon","ma","mes",
    "ton","ta","tes","son","sa","ses","notre","nos","votre","vos","leur","leurs",
    "je","tu","il","elle","nous","vous","ils","elles","on","moi","toi","lui","eux","soi","y","en",
    "et","ou","mais","donc","or","ni","car","que","qui","quoi","dont","où","quand","comment","pourquoi",
    "est","sont","être","était","étaient","sera","seront","ai","as","a","avons","avez","ont",
    "avoir","fait","faire","faut","peut","peux","pouvez","peuvent","doit","dois","doivent",
    "dans","sur","sous","pour","par","avec","sans","vers","chez","entre","contre","depuis","pendant",
    "pas","plus","moins","aussi","très","trop","bien","mal","ici","là","y","si","oui","non",
    "se","ne","me","te","ce","s","c","l","d","n","j","m","t","qu","jusqu","lorsqu","puisqu","quoiqu",
    "tout","tous","toute","toutes","quel","quelle","quels","quelles","tel","telle","tels","telles",
    "stp","svp","merci",
    # Spanish
    "el","los","las","una","unos","unas","del","al","mi","tu","su","sus","nuestro","vuestro",
    "yo","tú","él","ella","nosotros","vosotros","ellos","ellas","me","te","se","lo","le",
    "y","o","pero","porque","cuando","donde","como","qué","quién","cuál","cómo","por","para",
    "es","son","ser","fue","sido","está","están","ha","han","hay","muy","más","menos","sí",
    "que","cómo","cuándo","dónde","por qué",
    # German
    "der","die","das","den","dem","des","ein","eine","einer","eines","einen","einem",
    "ich","du","er","sie","es","wir","ihr","mich","dich","sich","mir","dir","ihm","ihn","ihnen",
    "und","oder","aber","weil","wenn","wann","wo","wie","warum","was","wer","wen","wem",
    "ist","sind","war","waren","sein","habe","hat","haben","hatte","hatten","wird","werden",
    "auf","in","an","zu","von","mit","bei","aus","für","über","unter","durch","gegen","ohne",
    "nicht","auch","sehr","mehr","weniger","ja","nein","bitte",
    # Italian
    "il","lo","la","i","gli","le","un","uno","una","del","della","dello","dei","degli","delle",
    "io","tu","lui","lei","noi","voi","loro","mi","ti","ci","vi","si",
    "e","o","ma","perché","quando","dove","come","chi","cosa","quale",
    "è","sono","era","erano","essere","ho","hai","ha","abbiamo","avete","hanno",
    "di","a","da","in","con","su","per","tra","fra","non","più","meno","molto","sì",
    # Portuguese
    "o","os","as","um","uns","umas","do","dos","das","ao","aos","à","às","pelo","pela",
    "eu","tu","ele","ela","nós","vós","eles","elas","me","te","se","lhe","lhes",
    "e","ou","mas","porque","quando","onde","como","quem","qual","que","por","para",
    "é","são","era","eram","ser","tenho","tem","temos","têm","há",
    "em","de","com","sem","sobre","entre","contra","muito","mais","menos","sim","não","obrigado",
})

# Tokens techniques toujours conservés (cas-insensible)
_TECH_KEEP = frozenset({
    "npm","npx","pnpm","yarn","pip","cargo","git","docker","curl","bash","zsh","sh",
    "react","vue","angular","svelte","nextjs","nuxt","node","deno","bun","python","rust","go",
    "java","kotlin","swift","ruby","php","scala","elixir","haskell","clojure","dart","flutter",
    "tauri","electron","wasm","cuda","gpu","cpu","ram","ssd","api","sdk","cli","gui","ui","ux",
    "css","html","sql","json","yaml","toml","xml","csv","pdf","png","jpg","jpeg","webp","svg",
    "mp3","mp4","wav","ogg","flac","mkv","mov","avi","webm","zip","tar","gz",
    "ios","android","macos","windows","linux","unix","arm","x86","m1","m2","m3","m4",
    "ssh","ftp","http","https","tcp","udp","dns","tls","ssl","oauth","jwt","saml","ldap",
    "aws","gcp","azure","s3","ec2","lambda","kubernetes","k8s","docker","helm","terraform",
    "postgres","postgresql","mysql","mariadb","sqlite","mongodb","redis","kafka","rabbitmq",
    "pgvector","embeddings","llm","gpt","claude","sonnet","opus","haiku","openai","anthropic",
    "tsx","jsx","ts","js","py","rs","go","sh","md","env",
})


def _rewrite_query(query: str, max_tokens: int = 8) -> str:
    """Transform a natural-language question into keyword search query.

    Rules:
    - Preserve quoted phrases and site: operators verbatim.
    - Drop stopwords (FR/EN/ES/DE/IT/PT).
    - Keep numbers, capitalized words (proper nouns), tech tokens, tokens with digits/symbols.
    - Cap at max_tokens keyword tokens.
    - Strip terminal punctuation (?!.,;).
    - If rewrite collapses to <2 tokens, return original query.
    """
    if not query or not query.strip():
        return query
    raw = query.strip()

    # Extract & protect quoted phrases and site:/filetype: operators
    protected: list[str] = []
    def _stash(m: re.Match) -> str:
        protected.append(m.group(0))
        return f" __P{len(protected)-1}__ "
    work = re.sub(r'"[^"]+"', _stash, raw)
    work = re.sub(r'\b(?:site|filetype|inurl|intitle|intext|ext):\S+', _stash, work)

    # Tokenize on whitespace + light punctuation (keep internal . - _ / for tech tokens)
    tokens = re.findall(r"[^\s,;:!?(){}\[\]<>]+", work)

    kept: list[str] = []
    for tok in tokens:
        # Restore placeholder later, keep as-is now
        if re.match(r"__P\d+__", tok):
            kept.append(tok)
            continue
        # Strip surrounding punctuation
        clean = tok.strip(".,;:!?'\"`")
        if not clean:
            continue
        low = clean.lower()
        # Always keep: tech token, has digit, has uppercase letter (proper noun / acronym),
        # contains . / - _ (likely tech identifier), quoted operator
        is_tech = low in _TECH_KEEP
        has_digit = bool(re.search(r"\d", clean))
        has_upper = any(c.isupper() for c in clean)
        has_sep = bool(re.search(r"[./\-_]", clean)) and len(clean) >= 3
        if is_tech or has_digit or has_upper or has_sep:
            kept.append(clean)
            continue
        # Drop stopwords
        if low in _STOPWORDS:
            continue
        # Drop very short fragments (1-2 chars) that survived stopword pass
        if len(clean) <= 2:
            continue
        kept.append(clean)

    # Restore protected segments
    out: list[str] = []
    for tok in kept:
        m = re.match(r"__P(\d+)__", tok)
        if m:
            out.append(protected[int(m.group(1))])
        else:
            out.append(tok)

    # Cap, dedupe preserving order (case-insensitive)
    seen: set[str] = set()
    deduped: list[str] = []
    for t in out:
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(t)
        if len(deduped) >= max_tokens:
            break

    if len(deduped) < 2:
        return raw  # too aggressive, keep original
    return " ".join(deduped)


def _shrink_query(query: str) -> str:
    """Aggressive retry rewrite: keep only the 3-4 rarest tokens (capitalized, tech, digits)."""
    rewritten = _rewrite_query(query, max_tokens=4)
    # If shrink == rewrite, force a more aggressive cut
    tokens = rewritten.split()
    if len(tokens) <= 4:
        return rewritten
    # Prefer tokens with digit/uppercase/tech
    priority = [t for t in tokens if re.search(r"\d", t) or any(c.isupper() for c in t) or t.lower() in _TECH_KEEP]
    rest = [t for t in tokens if t not in priority]
    return " ".join((priority + rest)[:4])


def _detect_locale(query: str):
    """Extract TLD from `site:X.tld` clause. Returns (gl, hl, kl, cc) or None."""
    m = re.search(r"site:[^\s]*?\.([a-z]{2,3}(?:\.[a-z]{2,3})?)", query, re.IGNORECASE)
    if not m:
        return None
    tld = m.group(1).lower()
    return _TLD_LOCALE.get(tld) or _TLD_LOCALE.get(tld.split(".")[-1])

# Sites where browser-first is essential (anti-bot, JS-rendered)
_BROWSER_FIRST = re.compile(
    r"(twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|"
    r"reddit\.com|quora\.com|medium\.com|substack\.com|"
    r"cloudflare|datadome|akamai)",
    re.IGNORECASE,
)


def _html_to_text(html: str, max_chars: int = MAX_CHARS) -> str:
    """Trafilatura primary, BeautifulSoup fallback."""
    try:
        import trafilatura
        extracted = trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            favor_recall=True,
        )
        if extracted and len(extracted) > 200:
            return extracted[:max_chars]
    except Exception:
        pass
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "iframe"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)[:max_chars]


def _is_api_url(url: str) -> bool:
    """Heuristic: looks like a JSON/REST API endpoint."""
    if re.search(r"\.(json|xml|rss|atom)(\?|$)", url, re.IGNORECASE):
        return True
    if "/api/" in url or url.endswith("/api"):
        return True
    return False


# JSON keys typically useless to the LLM: SDK plumbing, hyperlinks, internal ids.
_JSON_NOISE_KEYS = frozenset({
    "_links", "_meta", "__typename", "links", "self", "href", "etag",
    "cursor", "next_cursor", "prev_cursor", "page_token", "next_page_token",
    "request_id", "x-request-id", "trace_id", "span_id", "debug",
    "schema", "@context", "@type", "@id",
})


def _strip_json_noise(obj):
    """Recursively drop empty values and known-noise keys. Preserves data."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in _JSON_NOISE_KEYS:
                continue
            cleaned = _strip_json_noise(v)
            if cleaned is None or cleaned == "" or cleaned == [] or cleaned == {}:
                continue
            out[k] = cleaned
        return out
    if isinstance(obj, list):
        return [_strip_json_noise(x) for x in obj if x is not None and x != "" and x != {} and x != []]
    return obj


def _format_json(data, max_chars: int) -> str:
    """Compact-serialize JSON. If over budget, strip noise. If still over, truncate
    list values from the tail and append a __truncated__ marker so callers can detect it.
    Budget is bumped 4x for JSON since structure is intolerant to mid-value truncation."""
    budget = max(max_chars * 4, 48000)
    compact = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(compact) <= budget:
        return compact
    stripped = _strip_json_noise(data)
    compact2 = json.dumps(stripped, ensure_ascii=False, separators=(",", ":"))
    if len(compact2) <= budget:
        return compact2
    # Last resort: truncate top-level list/dict tail-wise, append marker.
    if isinstance(stripped, list):
        # Binary-search a slice that fits.
        lo, hi = 0, len(stripped)
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if len(json.dumps(stripped[:mid], ensure_ascii=False, separators=(",", ":"))) <= budget - 80:
                lo = mid
            else:
                hi = mid - 1
        truncated = stripped[:lo]
        return json.dumps({"__truncated__": True, "__kept__": lo, "__total__": len(stripped), "data": truncated},
                          ensure_ascii=False, separators=(",", ":"))
    # Dict: keep what fits; if a value is a too-large list, truncate it tail-wise.
    if isinstance(stripped, dict):
        kept = {}
        truncated_keys: list[str] = []
        for k, v in stripped.items():
            candidate = {**kept, k: v}
            if len(json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))) <= budget - 120:
                kept = candidate
                continue
            if isinstance(v, list) and v:
                lo, hi = 0, len(v)
                while lo < hi:
                    mid = (lo + hi + 1) // 2
                    trial = {**kept, k: v[:mid]}
                    if len(json.dumps(trial, ensure_ascii=False, separators=(",", ":"))) <= budget - 120:
                        lo = mid
                    else:
                        hi = mid - 1
                if lo > 0:
                    kept = {**kept, k: v[:lo]}
                    truncated_keys.append(f"{k}:{lo}/{len(v)}")
                    break
            break
        return json.dumps({"__truncated__": True, "__kept__": truncated_keys, "data": kept},
                          ensure_ascii=False, separators=(",", ":"))
    return compact2[:budget] + '...__truncated__'


def _httpx_fetch(url: str, max_chars: int) -> str:
    try:
        url = url.strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        resp = _netcache.request("GET", url, timeout=15)
        if resp.get("status") == 0:
            return f"Error fetching {url}: {resp.get('error', 'network')}"
        status = resp["status"]
        ct = resp.get("headers", {}).get("content-type", "")
        text = resp.get("text", "")
        if status in (403, 429, 503):
            return f"BLOCKED:http_{status}"
        if "json" in ct:
            try:
                return _format_json(json.loads(text), max_chars)
            except Exception:
                return text[:max_chars]
        if "text" not in ct:
            return f"Skipped (non-text): {url}"
        return _html_to_text(text, max_chars)
    except Exception as e:
        return f"Error fetching {url}: {e}"


def _browser_fetch_api(url: str, max_chars: int) -> str:
    """Browser fallback for API/JSON URLs (anti-bot, Cloudflare-protected, etc).
    Stealth nav, extract <pre> body or page text, retry JSON parse + format."""
    try:
        from monkey.browser import get_browser
        browser = get_browser()
        res = _run(browser.safe_navigate(url, max_chars=max_chars * 4), timeout=60)
        if res.get("blocked"):
            return f"BLOCKED:{res['blocked']}"
        text = (res.get("text") or "").strip()
        if not text:
            return f"Error fetching {url}: empty browser response"
        # Try JSON parse (browsers wrap JSON responses in <pre>, text already extracted).
        try:
            return _format_json(json.loads(text), max_chars)
        except Exception:
            return text[:max_chars * 4]
    except Exception as e:
        return f"Error fetching {url}: browser fallback failed: {e}"


def fetch_page(url: str, max_chars: int = MAX_CHARS) -> str:
    """Fetch URL and return clean text content. Browser-first for HTML pages."""
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    # Pure API endpoints → httpx (faster, no JS needed), browser fallback if blocked.
    if _is_api_url(url):
        result = _httpx_fetch(url, max_chars)
        if result.startswith(("BLOCKED", "Error fetching", "Skipped")):
            alt = _browser_fetch_api(url, max_chars)
            if not alt.startswith(("BLOCKED", "Error fetching")):
                return alt
            return result if len(result) >= len(alt) else alt
        return result

    # HTML pages → browser first (stealth), httpx as last resort
    try:
        from monkey.browser import get_browser
        browser = get_browser()
        res = _run(browser.safe_navigate(url, max_chars=max_chars), timeout=60)
        if res.get("blocked"):
            # Block detected, try httpx with realistic headers
            alt = _httpx_fetch(url, max_chars)
            if not alt.startswith(("BLOCKED", "Error", "Skipped")):
                return alt
            return f"BLOCKED:{res['blocked']} (httpx fallback also failed)"
        text = res.get("text") or ""
        if len(text) >= 100:
            return text
        # Browser returned thin content, try httpx
        alt = _httpx_fetch(url, max_chars)
        return alt if len(alt) > len(text) else text
    except Exception:
        # Browser unavailable → fall back to httpx
        return _httpx_fetch(url, max_chars)


_SEARCH_HOSTS = re.compile(
    r"^https?://(?:[a-z0-9-]+\.)*"
    r"(?:google|bing|duckduckgo|yahoo|qwant|ecosia|startpage|brave|yandex|baidu)\."
    r"[a-z.]+/(?:search|html)?",
    re.IGNORECASE,
)


def _rewrite_search_url(url: str) -> str:
    """If URL targets a search engine, rewrite the q= param via _rewrite_query."""
    if not _SEARCH_HOSTS.match(url):
        return url
    try:
        from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
        parts = urlparse(url)
        qs = parse_qsl(parts.query, keep_blank_values=True)
        if not qs:
            return url
        new_qs = []
        changed = False
        for k, v in qs:
            if k.lower() == "q" and v:
                nv = _rewrite_query(v)
                if nv != v:
                    changed = True
                new_qs.append((k, nv))
            else:
                new_qs.append((k, v))
        if not changed:
            return url
        return urlunparse(parts._replace(query=urlencode(new_qs, doseq=True)))
    except Exception:
        return url


def browser_navigate(url: str) -> dict:
    """Navigate with stealth browser, returns { url, title, text, blocked, error }."""
    from monkey.browser import get_browser
    browser = get_browser()
    url = _rewrite_search_url(url)
    return _run(browser.safe_navigate(url), timeout=90)


# -----------------------------------------------------------------------------
# Anti-parasite filters (Phase 1): domain blocklist + token-overlap relevance
# gate. Off-context spam ("how to fix your mac", "réparer android") leaks in
# because (a) generic platform words trigger SEO repair farms, (b) we returned
# whatever the SERP scraper produced. These helpers run on every parsed result
# list before it leaves the module.
# -----------------------------------------------------------------------------

# Known SEO / repair / "best top 10" farms that flood low-quality clickbait
# whenever a query touches a platform name. Match is on registered domain
# (last 2-3 labels), case-insensitive. Extend conservatively.
_SPAM_DOMAINS = frozenset({
    # FR repair / astuces farms
    "commentcamarche.net", "malekal.com", "astuces-pratiques.fr",
    "astuces-aide-informatique.info", "funinformatique.com",
    "01net.com", "tomsguide.fr",
    # generic "fix your X" / cleaner farms
    "softonic.com", "wikihow.com", "wikihow.fr",
    "iboysoft.com", "macpaw.com", "cleanmymac.com",
    "easeus.com", "minitool.com", "iolo.com", "auslogics.com",
    "appletoolbox.com", "fonepaw.com", "wondershare.com",
    "drfone.wondershare.com", "tenorshare.com", "imobie.com",
    "pcrisk.com", "fortect.com", "outbyte.com", "reimage.com",
    "advanced-pc-care.com", "systweak.com", "softwarekeep.com",
    "fixwin.com", "techisours.com", "techbout.com",
})


def _registered_domain(host: str) -> str:
    """Return last 2 labels (or 3 for known cc2nd TLDs)."""
    parts = host.lower().lstrip(".").split(".")
    if len(parts) < 2:
        return ""
    # crude cc2nd handling
    if len(parts) >= 3 and parts[-2] in {"co", "com", "org", "gov", "net", "ac"} and len(parts[-1]) == 2:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def _is_spam_domain(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or ""
        if not host:
            return False
        rd = _registered_domain(host)
        if rd in _SPAM_DOMAINS:
            return True
        # Also catch full host matches (subdomain spam like fr.softonic.com)
        host = host.lower()
        for d in _SPAM_DOMAINS:
            if host == d or host.endswith("." + d):
                return True
        return False
    except Exception:
        return False


# Tokens too generic to count as relevance signal on their own. Sharing only
# one of these between query and result is NOT enough to keep the result.
_AMBIGUOUS_TOKENS = frozenset({
    "mac", "macos", "windows", "android", "ios", "linux", "pc", "iphone",
    "ipad", "samsung", "google", "apple", "microsoft",
    "m1", "m2", "m3", "m4",  # weak when alone; strong when paired
})

_TOKEN_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)


def _query_tokens(query: str) -> set[str]:
    if not query:
        return set()
    raw = _TOKEN_RE.findall(query.lower())
    return {t for t in raw if t not in _STOPWORDS and len(t) >= 2}


def _result_tokens(r: dict) -> set[str]:
    text = f"{r.get('title') or ''} {r.get('snippet') or ''}"
    raw = _TOKEN_RE.findall(text.lower())
    return {t for t in raw if t not in _STOPWORDS and len(t) >= 2}


def _has_min_overlap(qt: set[str], rt: set[str]) -> bool:
    """Require enough query tokens in the result to call it relevant.

    Rules:
      - 0 query tokens → gate disabled (return True, only blocklist applies).
      - Common tokens that are AMBIGUOUS (mac, windows…) count as 0.5; concrete
        tokens count as 1. Need score ≥ 1.0 if query has ≥2 concrete tokens,
        else ≥ 0.5 (i.e. at least one concrete OR one ambiguous match).
    """
    if not qt:
        return True
    common = qt & rt
    if not common:
        return False
    concrete_q = qt - _AMBIGUOUS_TOKENS
    concrete_hits = len(common - _AMBIGUOUS_TOKENS)
    ambiguous_hits = len(common & _AMBIGUOUS_TOKENS)
    score = concrete_hits + 0.5 * ambiguous_hits
    threshold = 1.0 if len(concrete_q) >= 2 else 0.5
    return score >= threshold


def _filter_results(query: str, results: list[dict]) -> list[dict]:
    """Drop spam domains, malformed entries, and off-context results.

    Preserves order of kept items.
    """
    if not results:
        return []
    qt = _query_tokens(query)
    out: list[dict] = []
    for r in results:
        if not isinstance(r, dict):
            continue
        if r.get("error"):
            continue
        url = r.get("url") or ""
        if not url:
            continue
        if _is_spam_domain(url):
            continue
        rt = _result_tokens(r)
        if not _has_min_overlap(qt, rt):
            continue
        out.append(r)
    return out


def _parse_ddg_html(html: str, max_results: int) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for r in soup.select(".result")[:max_results * 2]:
        title_el = r.select_one(".result__title")
        url_el = r.select_one(".result__url")
        snippet_el = r.select_one(".result__snippet")
        if title_el and url_el:
            href = url_el.get_text(strip=True)
            if href and not href.startswith("http"):
                href = "https://" + href
            results.append({
                "title": title_el.get_text(strip=True),
                "url": href,
                "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
            })
        if len(results) >= max_results:
            break
    return results


def _search_via_browser(query: str, max_results: int = 5) -> list[dict]:
    """DuckDuckGo HTML SERP via stealth browser. No Google (captcha-prone)."""
    try:
        from monkey.browser import get_browser
        from urllib.parse import quote_plus, urlparse, parse_qs, unquote
        browser = get_browser()

        async def _go_ddg(url: str, settle_ms: int = 800) -> str:
            await browser._ensure_started()
            await browser._page.goto(url, wait_until="domcontentloaded", timeout=20000)
            try:
                await browser._handle_walls()
            except Exception:
                pass
            await browser._page.wait_for_timeout(settle_ms)
            try:
                await browser._page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass
            return await browser._page.content()

        async def _current_url() -> str:
            try:
                return browser._page.url or ""
            except Exception:
                return ""

        def _unwrap_uddg(href: str) -> str:
            if not href:
                return ""
            if href.startswith("//"):
                href = "https:" + href
            try:
                parsed = urlparse(href)
                if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l/"):
                    qs = parse_qs(parsed.query)
                    target = qs.get("uddg", [""])[0]
                    if target:
                        return unquote(target)
            except Exception:
                pass
            return href

        def _parse_ddg(html: str) -> list[dict]:
            soup = BeautifulSoup(html, "html.parser")
            out: list[dict] = []
            for block in soup.select("div.result, div.web-result")[: max_results * 3]:
                a = block.select_one("a.result__a, h2 a[href]")
                if not a:
                    continue
                href = _unwrap_uddg(a.get("href", ""))
                if not href.startswith("http") or "duckduckgo.com" in href:
                    continue
                snip = block.select_one(".result__snippet, .result-snippet")
                out.append({
                    "title": a.get_text(strip=True),
                    "url": href,
                    "snippet": snip.get_text(" ", strip=True) if snip else "",
                })
                if len(out) >= max_results:
                    break
            return out

        def _is_blocked(html: str, url: str) -> bool:
            u = (url or "").lower()
            if "anomaly" in u or "captcha" in u:
                return True
            h = (html or "").lower()
            return any(k in h for k in (
                "anomaly detection", "unusual traffic", "are you a robot",
                "g-recaptcha", "verify you are human",
            ))

        rewritten = _rewrite_query(query)
        q = quote_plus(rewritten)
        loc = _detect_locale(query)
        _gl, _hl, kl, _cc = loc if loc else (None, "en", "us-en", "US")
        kl_param = f"&kl={kl}" if kl else ""
        url = f"https://html.duckduckgo.com/html/?q={q}{kl_param}"

        last_err: str | None = None
        for attempt in range(3):
            try:
                settle = 800 + attempt * 1200
                html_d = _run(_go_ddg(url, settle_ms=settle), timeout=30 + attempt * 10)
                cur_url = _run(_current_url(), timeout=3)
                results = _parse_ddg(html_d)
                if results:
                    return results
                if _is_blocked(html_d, cur_url):
                    async def _wait_and_reread():
                        await browser._page.wait_for_timeout(3000 + attempt * 2000)
                        try:
                            await browser._handle_walls()
                        except Exception:
                            pass
                        await browser._page.wait_for_timeout(1000)
                        return await browser._page.content()
                    html2 = _run(_wait_and_reread(), timeout=20)
                    r2 = _parse_ddg(html2)
                    if r2:
                        return r2
                    last_err = "ddg_blocked"
                    continue
                last_err = "ddg_empty_serp"
            except Exception as e:
                last_err = f"ddg_error: {e}"

        return [{
            "error": f"ddg_unavailable: {last_err or 'unknown'}",
            "url": url,
            "hint": "DuckDuckGo returned no results or is blocked. Retry later or reformulate.",
        }]
    except Exception as e:
        return [{"error": f"browser_search_failed: {e}"}]


def search_web(query: str, max_results: int = 5) -> list[dict]:
    """Search via stealth browser (DuckDuckGo HTML). No paid API.

    Post-filter: drops known SEO/repair domains and off-context results whose
    title+snippet share too few tokens with the user's query.
    """
    rewritten = _rewrite_query(query)
    # Over-fetch to absorb post-filter losses.
    fetch_n = max(max_results * 2, max_results + 4)
    results = _search_via_browser(rewritten, fetch_n)
    filtered = _filter_results(query, results)
    if len(filtered) >= max(2, max_results // 2):
        return filtered[:max_results]
    # Retry with shrunk query if thin
    shrunk = _shrink_query(query)
    if shrunk and shrunk != rewritten:
        results2 = _search_via_browser(shrunk, fetch_n)
        filtered2 = _filter_results(query, results2)
        if len(filtered2) >= len(filtered):
            filtered = filtered2
    if filtered:
        return filtered[:max_results]
    # DuckDuckGo only — surface whatever _search_via_browser returned
    # (typically a ddg_unavailable error).
    return results[:max_results] if results else [{"error": "ddg_no_results"}]


def search_and_read(query: str, max_pages: int = 3) -> str:
    """Search + read top pages via stealth browser. Concatenates clean content."""
    _PER_PAGE = 2200
    parts: list[str] = []

    results = search_web(query, max_pages + 2)
    urls = [r["url"] for r in results if r.get("url") and not r.get("error")]

    for u in urls[:max_pages + 2]:
        if len(parts) >= max_pages:
            break
        content = fetch_page(u, _PER_PAGE)
        if (content
            and not content.startswith(("Error", "Skipped", "BLOCKED"))
            and len(content) > 150):
            parts.append(f"### {u}\n{content}")

    # Wikipedia fallback
    if len(parts) < max_pages:
        try:
            stop = {"what","is","are","was","the","a","an","of","in","on","at","to","for",
                    "que","est","ce","le","la","les","un","une","des","comment","pourquoi"}
            wiki_q = "_".join(
                w for w in query.replace("?", "").split()
                if len(w) > 2 and w.lower() not in stop
            )[:60]
            if wiki_q:
                resp = httpx.get(
                    f"https://en.wikipedia.org/api/rest_v1/page/summary/{wiki_q}",
                    timeout=6,
                    headers={"User-Agent": "MonkeyAgent/1.0"},
                )
                d = resp.json()
                if d.get("extract") and len(d["extract"]) > 80:
                    parts.append(f"### Wikipedia\n{d['extract']}")
        except Exception:
            pass

    if parts:
        return "\n\n---\n\n".join(parts)
    return f"Aucun résultat pour: {query}. Essaie fetch_page avec une URL spécifique."


def http_request(url: str, method: str = "GET", headers: dict | None = None,
                 body: str | None = None, json_body: dict | None = None) -> str:
    """Generic HTTP request. Returns status + response body."""
    try:
        url = url.strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        req_headers = dict(headers or {})
        payload = json_body if json_body is not None else body
        resp = _netcache.request(method, url, headers=req_headers, body=payload, timeout=20)
        if resp.get("status") == 0:
            return f"Error: {resp.get('error', 'network')}"
        ct = resp.get("headers", {}).get("content-type", "")
        raw = resp.get("text", "")
        if "json" in ct:
            try:
                data = json.loads(raw)
                text = json.dumps(data, ensure_ascii=False, indent=2)[:8000]
            except Exception:
                text = raw[:8000]
        else:
            text = raw[:8000]
        return f"HTTP {resp['status']}\n{text}"
    except Exception as e:
        return f"Error: {e}"


def search_images(query: str, max_results: int = 5) -> list[dict]:
    """Search images via DuckDuckGo image JSON API.

    Returns list of {title, image, thumbnail, source, width, height} dicts.
    DDG endpoint is stable, returns direct CDN image URLs, no scraping needed.
    """
    try:
        rewritten = _rewrite_query(query)
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Referer": "https://duckduckgo.com/",
        }
        with httpx.Client(headers=headers, timeout=15, follow_redirects=True) as client:
            # Step 1: get the vqd token from the search page
            r1 = client.get("https://duckduckgo.com/", params={"q": rewritten, "iax": "images", "ia": "images"})
            m = re.search(r'vqd=["\']?([\d-]+)["\']?', r1.text)
            if not m:
                # alternate token format
                m = re.search(r'vqd=([\d-]+)&', r1.text)
            if not m:
                return [{"error": "vqd_token_not_found"}]
            vqd = m.group(1)
            # Step 2: call the i.js endpoint
            r2 = client.get(
                "https://duckduckgo.com/i.js",
                params={"l": "us-en", "o": "json", "q": rewritten, "vqd": vqd, "f": ",,,", "p": "1"},
            )
            data = r2.json()
            results = data.get("results", [])[:max_results]
            return [{
                "title": (r.get("title") or "")[:200],
                "image": r.get("image"),
                "thumbnail": r.get("thumbnail"),
                "source": r.get("url"),
                "width": r.get("width"),
                "height": r.get("height"),
            } for r in results if r.get("image")]
    except Exception as e:
        return [{"error": f"search_images_failed: {e}"}]


def download_file(url: str, path: str) -> str:
    """Download a binary file from URL to local path."""
    try:
        from monkey.tools.files import _resolve
        url = url.strip()
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        p = _resolve(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        dl_headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        }
        with httpx.stream("GET", url, timeout=60, follow_redirects=True, headers=dl_headers) as resp:
            resp.raise_for_status()
            with open(p, "wb") as f:
                for chunk in resp.iter_bytes(chunk_size=65536):
                    f.write(chunk)
        size = p.stat().st_size
        size_str = f"{size} B" if size < 1024 else f"{size/1024:.1f} KB" if size < 1024**2 else f"{size/1024**2:.1f} MB"
        return f"OK: téléchargé → {p} ({size_str})"
    except Exception as e:
        return f"Error: {e}"


# --- Browser tool wrappers (all via persistent event loop) ----------
def browser_get_text(selector: str = "") -> str:
    from monkey.browser import get_browser
    return _run(get_browser().get_text(selector or "body", 0), timeout=30)


def browser_get_clean_text(max_chars: int = 0) -> str:
    """Main content of current page (trafilatura + noise-stripped fallback)."""
    from monkey.browser import get_browser
    return _run(get_browser().get_clean_text(max_chars or 0), timeout=30)


def browser_get_links(limit: int = 30) -> str:
    from monkey.browser import get_browser
    return _run(get_browser().get_links(limit), timeout=30)


def browser_click(selector: str) -> str:
    from monkey.browser import get_browser
    return _run(get_browser().click(selector), timeout=30)


def browser_fill(selector: str, value: str) -> str:
    from monkey.browser import get_browser
    return _run(get_browser().fill(selector, value), timeout=60)


def browser_scroll(direction: str = "down", amount: int = 500) -> str:
    from monkey.browser import get_browser
    return _run(get_browser().scroll(direction, amount), timeout=30)


def browser_scroll_to_bottom(max_rounds: int = 20, stable_rounds: int = 3) -> str:
    from monkey.browser import get_browser
    return _run(get_browser().scroll_to_bottom(max_rounds=max_rounds, stable_rounds=stable_rounds), timeout=90)


def browser_paginate(direction: str = "next") -> str:
    from monkey.browser import get_browser
    return _run(get_browser().paginate(direction), timeout=30)


def browser_run_js(code: str) -> str:
    from monkey.browser import get_browser
    return _run(get_browser().run_js(code), timeout=30)


def browser_screenshot() -> str:
    from monkey.browser import get_browser
    return _run(get_browser().screenshot(), timeout=30)


def browser_solve_captcha(model_id: str = "") -> str:
    """Solve a Google reCAPTCHA image challenge using a vision LLM.

    If model_id is empty, uses the vision model registered by the agent.
    Returns "OK: ..." on success, otherwise a diagnostic string.
    """
    from monkey.browser import get_browser, get_vision_model
    mid = model_id or get_vision_model() or ""
    if not mid:
        return "error: no vision model selected — open ModelPicker and pick a model with 👁 vision capability"
    return _run(get_browser().solve_recaptcha(mid), timeout=180)


def browser_wait_for(selector: str = "", timeout_ms: int = 10000) -> str:
    from monkey.browser import get_browser
    return _run(get_browser().wait_for(selector, timeout_ms), timeout=(timeout_ms / 1000) + 5)


def browser_navigate_back() -> str:
    from monkey.browser import get_browser
    return _run(get_browser().navigate_back(), timeout=20)


def browser_current_url() -> str:
    from monkey.browser import get_browser
    return _run(get_browser().current_url(), timeout=10)
