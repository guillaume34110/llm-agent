"""OSINT intel: domain, DNS, subdomains, wayback, email, phone.

Pure stdlib + python-whois + dnspython + phonenumbers + httpx (via _netcache).
Every outbound HTTP goes through _netcache so we're polite and cached.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from monkey.tools import _netcache

_DOMAIN_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$")
_EMAIL_RE = re.compile(r"^[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")


def _clean_domain(d: str) -> str:
    d = (d or "").strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = d.split("/", 1)[0]
    d = d.split(":", 1)[0]
    return d


def whois_lookup(domain: str) -> str:
    """WHOIS lookup via python-whois. Returns JSON {registrar, creation_date, expiration_date, name_servers, emails, status, raw_excerpt}."""
    d = _clean_domain(domain)
    if not _DOMAIN_RE.match(d):
        return f"ERREUR: invalid domain '{domain}'"
    try:
        import whois  # python-whois
        w = whois.whois(d)
    except Exception as e:
        return f"ERREUR: whois failed: {e}"

    def _fmt(v):
        if isinstance(v, list):
            return [str(x) for x in v if x is not None]
        if v is None:
            return None
        return str(v)

    out = {
        "domain": d,
        "registrar": _fmt(getattr(w, "registrar", None)),
        "creation_date": _fmt(getattr(w, "creation_date", None)),
        "expiration_date": _fmt(getattr(w, "expiration_date", None)),
        "updated_date": _fmt(getattr(w, "updated_date", None)),
        "name_servers": _fmt(getattr(w, "name_servers", None)),
        "emails": _fmt(getattr(w, "emails", None)),
        "status": _fmt(getattr(w, "status", None)),
        "org": _fmt(getattr(w, "org", None)),
        "country": _fmt(getattr(w, "country", None)),
    }
    return json.dumps({k: v for k, v in out.items() if v}, ensure_ascii=False, indent=2)


def dns_records(domain: str, types: list[str] | None = None) -> str:
    """DNS lookup for A/AAAA/MX/NS/TXT/CNAME/SOA. Returns JSON {type: [records]}."""
    d = _clean_domain(domain)
    if not _DOMAIN_RE.match(d):
        return f"ERREUR: invalid domain '{domain}'"
    wanted = [t.upper() for t in (types or ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA"])]
    try:
        import dns.resolver
    except Exception as e:
        return f"ERREUR: dnspython unavailable: {e}"
    resolver = dns.resolver.Resolver()
    resolver.timeout = 5
    resolver.lifetime = 8
    out: dict[str, list[str]] = {}
    for rt in wanted:
        try:
            ans = resolver.resolve(d, rt)
            out[rt] = [r.to_text() for r in ans]
        except Exception:
            continue
    if not out:
        return f"OK: no DNS records resolved for {d}"
    return json.dumps({"domain": d, "records": out}, ensure_ascii=False, indent=2)


def subdomain_enum(domain: str, max_results: int = 200) -> str:
    """Enumerate subdomains via crt.sh certificate transparency. Returns JSON {domain, count, subdomains}."""
    d = _clean_domain(domain)
    if not _DOMAIN_RE.match(d):
        return f"ERREUR: invalid domain '{domain}'"
    url = f"https://crt.sh/?q=%25.{d}&output=json"
    resp = _netcache.request("GET", url, timeout=20)
    if resp.get("status") != 200:
        return f"ERREUR: crt.sh status={resp.get('status')}"
    try:
        data = json.loads(resp.get("text") or "[]")
    except Exception as e:
        return f"ERREUR: crt.sh parse failed: {e}"
    subs: set[str] = set()
    for entry in data:
        name = entry.get("name_value") or ""
        for line in name.split("\n"):
            s = line.strip().lower().lstrip("*.")
            if s and s.endswith(d) and s != d:
                subs.add(s)
    sorted_subs = sorted(subs)[:max_results]
    return json.dumps({"domain": d, "count": len(sorted_subs), "subdomains": sorted_subs},
                      ensure_ascii=False, indent=2)


def wayback_snapshots(url: str, limit: int = 20) -> str:
    """List Wayback Machine snapshots for a URL via CDX API."""
    target = (url or "").strip()
    if not target:
        return "ERREUR: url required"
    api = f"http://web.archive.org/cdx/search/cdx?url={target}&output=json&limit={limit}&filter=statuscode:200"
    resp = _netcache.request("GET", api, timeout=20)
    if resp.get("status") != 200:
        return f"ERREUR: wayback CDX status={resp.get('status')}"
    try:
        rows = json.loads(resp.get("text") or "[]")
    except Exception as e:
        return f"ERREUR: wayback parse failed: {e}"
    if not rows or len(rows) < 2:
        return f"OK: no snapshots for {target}"
    header = rows[0]
    out = []
    for row in rows[1:]:
        rec = dict(zip(header, row))
        ts = rec.get("timestamp", "")
        original = rec.get("original", "")
        out.append({
            "timestamp": ts,
            "snapshot_url": f"https://web.archive.org/web/{ts}/{original}",
            "original": original,
            "mimetype": rec.get("mimetype", ""),
        })
    return json.dumps({"url": target, "count": len(out), "snapshots": out},
                      ensure_ascii=False, indent=2)


def gravatar_lookup(email: str) -> str:
    """Return public Gravatar profile (display name, location, avatar) for an email."""
    e = (email or "").strip().lower()
    if not _EMAIL_RE.match(e):
        return f"ERREUR: invalid email '{email}'"
    h = hashlib.md5(e.encode()).hexdigest()
    url = f"https://www.gravatar.com/{h}.json"
    resp = _netcache.request("GET", url, timeout=15)
    if resp.get("status") == 404:
        return json.dumps({"email": e, "hash": h, "found": False, "avatar_url": f"https://www.gravatar.com/avatar/{h}?d=404"},
                          ensure_ascii=False)
    if resp.get("status") != 200:
        return f"ERREUR: gravatar status={resp.get('status')}"
    try:
        data = json.loads(resp.get("text") or "{}")
    except Exception:
        data = {}
    entries = data.get("entry") or []
    prof = entries[0] if entries else {}
    out = {
        "email": e,
        "hash": h,
        "found": True,
        "display_name": prof.get("displayName"),
        "preferred_username": prof.get("preferredUsername"),
        "name": prof.get("name"),
        "location": prof.get("currentLocation"),
        "about": prof.get("aboutMe"),
        "urls": prof.get("urls"),
        "accounts": prof.get("accounts"),
        "avatar_url": f"https://www.gravatar.com/avatar/{h}",
        "profile_url": prof.get("profileUrl"),
    }
    return json.dumps({k: v for k, v in out.items() if v not in (None, [], {}, "")},
                      ensure_ascii=False, indent=2)


def hibp_password_check(password: str) -> str:
    """Check via HIBP k-anonymity (no auth) whether a password has been seen in breaches. Returns occurrence count."""
    if not password:
        return "ERREUR: password required"
    sha1 = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = sha1[:5], sha1[5:]
    resp = _netcache.request("GET", f"https://api.pwnedpasswords.com/range/{prefix}",
                             headers={"Add-Padding": "true"}, timeout=15, ttl=24 * 3600)
    if resp.get("status") != 200:
        return f"ERREUR: HIBP status={resp.get('status')}"
    for line in (resp.get("text") or "").splitlines():
        if ":" not in line:
            continue
        suf, cnt = line.strip().split(":", 1)
        if suf.upper() == suffix:
            try:
                c = int(cnt)
            except ValueError:
                c = 0
            return json.dumps({"pwned": True, "count": c}, ensure_ascii=False)
    return json.dumps({"pwned": False, "count": 0}, ensure_ascii=False)


def phone_parse(number: str, region: str = "FR") -> str:
    """Parse a phone number → country, carrier, region, valid, e164, national. Uses libphonenumber."""
    if not number:
        return "ERREUR: number required"
    try:
        import phonenumbers
        from phonenumbers import geocoder, carrier, timezone
    except Exception as e:
        return f"ERREUR: phonenumbers unavailable: {e}"
    try:
        n = phonenumbers.parse(number, region.upper() if region else None)
    except Exception as e:
        return f"ERREUR: parse failed: {e}"
    out = {
        "input": number,
        "valid": phonenumbers.is_valid_number(n),
        "possible": phonenumbers.is_possible_number(n),
        "country_code": n.country_code,
        "national_number": n.national_number,
        "e164": phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.E164),
        "international": phonenumbers.format_number(n, phonenumbers.PhoneNumberFormat.INTERNATIONAL),
        "region": phonenumbers.region_code_for_number(n),
        "location": geocoder.description_for_number(n, "en"),
        "carrier": carrier.name_for_number(n, "en"),
        "timezones": list(timezone.time_zones_for_number(n)),
        "type": str(phonenumbers.number_type(n)).split(".")[-1],
    }
    return json.dumps({k: v for k, v in out.items() if v not in (None, "", [])},
                      ensure_ascii=False, indent=2)


def http_headers(url: str) -> str:
    """HEAD-equivalent: fetch URL and return only response headers + status. Useful for tech-stack fingerprinting (Server, X-Powered-By, CSP, Set-Cookie)."""
    if not url:
        return "ERREUR: url required"
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    resp = _netcache.request("GET", url, timeout=15)
    if resp.get("status") == 0:
        return f"ERREUR: {resp.get('error', 'network')}"
    return json.dumps({"url": url, "status": resp.get("status"),
                       "headers": resp.get("headers", {})}, ensure_ascii=False, indent=2)
