"""IMAP client wrapping Python stdlib `imaplib` + `email`.

Connection model: short-lived. Open on demand, sync incrementally by UID,
close. No long-running socket — Tauri restarts the sidecar freely.

Sync strategy: UIDVALIDITY-checked, UIDNEXT-incremental. Persist `last_uid`
per account in `mail_account.last_uid`. Reset to 0 on UIDVALIDITY change.
"""
from __future__ import annotations
import email
import email.policy
import imaplib
import re
import ssl
import time
from email.utils import getaddresses, parsedate_to_datetime
from typing import Any

# IMAP body cap (raw fetch). Anything larger gets its body truncated downstream.
MAX_BODY_BYTES = 100 * 1024


def _q(mailbox: str) -> str:
    """Quote an IMAP mailbox name. Required when name contains spaces or
    special chars (e.g. '[Gmail]/Tous les messages'). imaplib only auto-quotes
    for `select()`; raw `uid()` args must be quoted by the caller, otherwise
    the server returns `BAD` parsing the space as a token separator."""
    if not mailbox:
        return '""'
    if mailbox.startswith('"') and mailbox.endswith('"'):
        return mailbox
    escaped = mailbox.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _connect(host: str, port: int, socket_kind: str) -> imaplib.IMAP4:
    socket_kind = (socket_kind or "SSL").upper()
    if socket_kind == "SSL":
        ctx = ssl.create_default_context()
        return imaplib.IMAP4_SSL(host, int(port), ssl_context=ctx, timeout=30)
    cli = imaplib.IMAP4(host, int(port), timeout=30)
    if socket_kind == "STARTTLS":
        ctx = ssl.create_default_context()
        cli.starttls(ssl_context=ctx)
    return cli


def test_login(host: str, port: int, socket_kind: str, email_addr: str,
               password: str) -> tuple[bool, str]:
    sk = (socket_kind or "SSL").upper()
    ctx = f"{host}:{port} [{sk}] user={email_addr} pwd_len={len(password)}"
    try:
        cli = _connect(host, port, sk)
    except Exception as e:
        return (False, f"connect failed ({ctx}): {e}")
    try:
        try:
            cli.login(email_addr, password)
        except imaplib.IMAP4.error as e:
            return (False, f"LOGIN refused ({ctx}): {e}")
        try:
            typ, _ = cli.select("INBOX", readonly=True)
            if typ != "OK":
                return (False, f"SELECT INBOX failed ({ctx})")
        except imaplib.IMAP4.error as e:
            return (False, f"SELECT failed ({ctx}): {e}")
        return (True, "")
    finally:
        try:
            cli.logout()
        except Exception:
            pass


def _decode(s: Any) -> str:
    if s is None:
        return ""
    if isinstance(s, bytes):
        try:
            return s.decode("utf-8", errors="replace")
        except Exception:
            return s.decode("latin-1", errors="replace")
    return str(s)


def _extract_addrs(header_val: str) -> list[str]:
    if not header_val:
        return []
    try:
        pairs = getaddresses([header_val])
        return [a for _, a in pairs if a]
    except Exception:
        return []


def _extract_body(msg: email.message.Message) -> tuple[str, str, bool]:
    """Return (text, html, has_attachments)."""
    text_parts: list[str] = []
    html_parts: list[str] = []
    has_attach = False
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = (part.get("Content-Disposition") or "").lower()
            if "attachment" in disp or part.get_filename():
                has_attach = True
                continue
            if ctype == "text/plain":
                try:
                    text_parts.append(part.get_content())
                except Exception:
                    payload = part.get_payload(decode=True) or b""
                    text_parts.append(_decode(payload))
            elif ctype == "text/html":
                try:
                    html_parts.append(part.get_content())
                except Exception:
                    payload = part.get_payload(decode=True) or b""
                    html_parts.append(_decode(payload))
    else:
        try:
            content = msg.get_content()
        except Exception:
            content = _decode(msg.get_payload(decode=True) or b"")
        if msg.get_content_type() == "text/html":
            html_parts.append(content)
        else:
            text_parts.append(content)

    text = "\n\n".join(p.strip() for p in text_parts if p).strip()
    html = "\n".join(html_parts).strip()

    # Fallback: derive text from HTML if no plain part
    if not text and html:
        text = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.S | re.I)
        text = re.sub(r"<script[^>]*>.*?</script>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()

    if len(text) > MAX_BODY_BYTES:
        text = text[:MAX_BODY_BYTES]
    if len(html) > MAX_BODY_BYTES * 4:
        html = html[: MAX_BODY_BYTES * 4]
    return (text, html, has_attach)


def _parse_message(raw: bytes, uid: int, flags_str: str) -> dict | None:
    try:
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception:
        return None
    subject = _decode(msg.get("Subject") or "")
    from_h = _decode(msg.get("From") or "")
    to_h = _decode(msg.get("To") or "")
    cc_h = _decode(msg.get("Cc") or "")
    message_id = _decode(msg.get("Message-Id") or msg.get("Message-ID") or "")
    in_reply = _decode(msg.get("In-Reply-To") or "")
    refs = _decode(msg.get("References") or "")
    thread_id = (refs.split()[0] if refs else "") or in_reply or message_id
    date_h = msg.get("Date")
    try:
        dt = parsedate_to_datetime(date_h) if date_h else None
        date_ts = int(dt.timestamp() * 1000) if dt else int(time.time() * 1000)
    except Exception:
        date_ts = int(time.time() * 1000)
    body_text, body_html, has_attach = _extract_body(msg)
    flags = []
    for f in re.findall(r"\\\w+", flags_str or ""):
        flags.append(f)
    return {
        "uid": int(uid),
        "messageId": message_id.strip("<>"),
        "inReplyTo": in_reply.strip("<>"),
        "threadId": thread_id.strip("<>"),
        "from": from_h,
        "to": _extract_addrs(to_h),
        "cc": _extract_addrs(cc_h),
        "subject": subject,
        "bodyText": body_text,
        "bodyHtml": body_html,
        "hasAttachments": has_attach,
        "flags": flags,
        "dateTs": date_ts,
        "sizeBytes": len(raw),
    }


_UIDFLAG_RE = re.compile(rb"UID (\d+).*?FLAGS \(([^)]*)\)", re.S)


def _iter_fetch_responses(data: list) -> list[tuple[int, str, bytes]]:
    """Walk an imaplib BODY.PEEK[] FETCH response into (uid, flags_str, raw_bytes)."""
    out: list[tuple[int, str, bytes]] = []
    for item in data:
        if not isinstance(item, tuple) or len(item) < 2:
            continue
        header, payload = item[0], item[1]
        if not isinstance(header, (bytes, bytearray)):
            continue
        m = _UIDFLAG_RE.search(header)
        if not m:
            # Try permissive — UID and FLAGS may be reordered by server
            m_uid = re.search(rb"UID (\d+)", header)
            m_flags = re.search(rb"FLAGS \(([^)]*)\)", header)
            if not m_uid:
                continue
            uid = int(m_uid.group(1))
            flags_str = m_flags.group(1).decode("ascii", errors="ignore") if m_flags else ""
        else:
            uid = int(m.group(1))
            flags_str = m.group(2).decode("ascii", errors="ignore")
        if not isinstance(payload, (bytes, bytearray)):
            continue
        out.append((uid, flags_str, bytes(payload)))
    return out


def sync_inbox(account: dict, password: str, *,
               max_messages: int = 200,
               last_uid: int = 0) -> dict:
    """Fetch new messages since `last_uid`. Returns:
        { ok, error, fetched: int, messages: [parsed], new_last_uid }
    """
    imap_cfg = account["imap"]
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
    except Exception as e:
        return {"ok": False, "error": f"connect: {e}", "fetched": 0, "messages": [], "new_last_uid": last_uid}
    try:
        try:
            cli.login(account["email"], password)
        except imaplib.IMAP4.error as e:
            return {"ok": False, "error": f"login: {e}", "fetched": 0, "messages": [], "new_last_uid": last_uid}

        typ, _ = cli.select("INBOX", readonly=False)
        if typ != "OK":
            return {"ok": False, "error": "SELECT INBOX failed", "fetched": 0, "messages": [], "new_last_uid": last_uid}

        # UID search for new messages
        search_term = f"{last_uid + 1}:*" if last_uid > 0 else "ALL"
        typ, data = cli.uid("SEARCH", None, "UID", search_term) if last_uid > 0 else cli.uid("SEARCH", None, "ALL")
        if typ != "OK":
            return {"ok": False, "error": "SEARCH failed", "fetched": 0, "messages": [], "new_last_uid": last_uid}
        uids_raw = (data[0] or b"").split()
        uids = [int(u) for u in uids_raw if u.isdigit() and int(u) > last_uid]
        uids.sort()
        # Take the newest `max_messages`
        if len(uids) > max_messages:
            uids = uids[-max_messages:]
        if not uids:
            return {"ok": True, "error": "", "fetched": 0, "messages": [], "new_last_uid": last_uid}

        messages: list[dict] = []
        new_last = last_uid
        # Fetch in chunks of 25 to keep responses small
        for i in range(0, len(uids), 25):
            chunk = uids[i:i + 25]
            uid_set = ",".join(str(u) for u in chunk)
            typ, fetched = cli.uid("FETCH", uid_set, "(UID FLAGS BODY.PEEK[])")
            if typ != "OK":
                continue
            for uid, flags_str, raw in _iter_fetch_responses(fetched):
                parsed = _parse_message(raw, uid, flags_str)
                if parsed:
                    messages.append(parsed)
                if uid > new_last:
                    new_last = uid

        return {
            "ok": True,
            "error": "",
            "fetched": len(messages),
            "messages": messages,
            "new_last_uid": new_last,
        }
    finally:
        try:
            cli.close()
        except Exception:
            pass
        try:
            cli.logout()
        except Exception:
            pass


def set_flag(account: dict, password: str, uid: int, flag: str, *,
             remove: bool = False, folder: str = "INBOX") -> tuple[bool, str]:
    imap_cfg = account["imap"]
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
        cli.login(account["email"], password)
        cli.select(folder)
        op = "-FLAGS" if remove else "+FLAGS"
        typ, _ = cli.uid("STORE", str(uid), op, f"({flag})")
        return (typ == "OK", "" if typ == "OK" else "STORE failed")
    except Exception as e:
        return (False, str(e))
    finally:
        try:
            cli.logout()
        except Exception:
            pass


_HDR_FETCH = "(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)])"


def fetch_envelopes(account: dict, password: str, *, folder: str = "INBOX",
                    max_messages: int = 2000, newest_first: bool = True) -> dict:
    """Lightweight server-side scan: fetch UID/FLAGS/headers (no body) for
    classification. Used by mail_clean_inbox so it works on full mailboxes
    (1000s of messages) without depending on the local SQLite cache.

    Returns {ok, error, total, messages: [{uid, from, subject, dateTs, flags}]}.
    """
    imap_cfg = account["imap"]
    started = time.time()
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
        cli.login(account["email"], password)
        typ, _ = cli.select(folder, readonly=True)
        if typ != "OK":
            return {"ok": False, "error": f"SELECT {folder} failed", "total": 0, "messages": []}
        typ, data = cli.uid("SEARCH", None, "ALL")
        if typ != "OK":
            return {"ok": False, "error": "SEARCH ALL failed", "total": 0, "messages": []}
        uids_raw = (data[0] or b"").split()
        uids = [int(u) for u in uids_raw if u.isdigit()]
        uids.sort()
        total = len(uids)
        if newest_first:
            uids = list(reversed(uids))
        uids = uids[:max(1, int(max_messages))]
        out: list[dict] = []
        for i in range(0, len(uids), 50):
            chunk = uids[i:i + 50]
            uid_set = ",".join(str(u) for u in chunk)
            typ, fetched = cli.uid("FETCH", uid_set, _HDR_FETCH)
            if typ != "OK":
                continue
            for uid, flags_str, raw in _iter_fetch_responses(fetched):
                try:
                    msg = email.message_from_bytes(raw, policy=email.policy.default)
                except Exception:
                    continue
                date_ts = 0
                try:
                    dt = parsedate_to_datetime(msg.get("Date", ""))
                    if dt:
                        date_ts = int(dt.timestamp() * 1000)
                except Exception:
                    pass
                from_h = _decode(msg.get("From", ""))
                subject = _decode(msg.get("Subject", ""))
                flags = [f for f in flags_str.split() if f]
                out.append({
                    "uid": uid, "from": from_h, "subject": subject,
                    "dateTs": date_ts, "flags": flags,
                })
        return {"ok": True, "error": "", "total": total, "messages": out,
                "elapsedMs": int((time.time() - started) * 1000)}
    except Exception as e:
        return {"ok": False, "error": str(e), "total": 0, "messages": []}
    finally:
        try:
            cli.close()
        except Exception:
            pass
        try:
            cli.logout()
        except Exception:
            pass


def copy_to(account: dict, password: str, uid: int, dest_folder: str, *,
            folder: str = "INBOX") -> tuple[bool, str]:
    """COPY a message to dest_folder without removing it from `folder`.
    On non-Gmail IMAP this is the additive "label" equivalent."""
    imap_cfg = account["imap"]
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
        cli.login(account["email"], password)
        cli.select(folder)
        typ, _ = cli.uid("COPY", str(uid), _q(dest_folder))
        return (typ == "OK", "" if typ == "OK" else "COPY failed")
    except Exception as e:
        return (False, str(e))
    finally:
        try:
            cli.logout()
        except Exception:
            pass


def gmail_labels(account: dict, password: str, uid: int, labels: list[str], *,
                 remove: bool = False, folder: str = "INBOX") -> tuple[bool, str]:
    """Add or remove Gmail X-GM-LABELS on a message UID. Labels stay additive
    so the message remains in INBOX unless `\\Inbox` is explicitly removed."""
    if not labels:
        return (False, "no labels")
    imap_cfg = account["imap"]
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
        cli.login(account["email"], password)
        cli.select(folder)
        op = "-X-GM-LABELS" if remove else "+X-GM-LABELS"
        quoted = " ".join(f'"{l}"' if " " in l or "/" in l else l for l in labels)
        typ, _ = cli.uid("STORE", str(uid), op, f"({quoted})")
        return (typ == "OK", "" if typ == "OK" else "STORE X-GM-LABELS failed")
    except Exception as e:
        return (False, str(e))
    finally:
        try:
            cli.logout()
        except Exception:
            pass


def move_to(account: dict, password: str, uid: int, dest_folder: str, *,
            folder: str = "INBOX") -> tuple[bool, str]:
    imap_cfg = account["imap"]
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
        cli.login(account["email"], password)
        cli.select(folder)
        # MOVE if supported, otherwise COPY + STORE \Deleted + EXPUNGE
        try:
            typ, _ = cli.uid("MOVE", str(uid), _q(dest_folder))
            if typ == "OK":
                return (True, "")
        except Exception:
            pass
        typ, _ = cli.uid("COPY", str(uid), _q(dest_folder))
        if typ != "OK":
            return (False, "COPY failed")
        cli.uid("STORE", str(uid), "+FLAGS", "(\\Deleted)")
        cli.expunge()
        return (True, "")
    except Exception as e:
        return (False, str(e))
    finally:
        try:
            cli.logout()
        except Exception:
            pass


_LIST_RE = re.compile(rb'^\((?P<flags>[^)]*)\)\s+"?(?P<delim>[^"\s]+)"?\s+"?(?P<name>.+?)"?$')


def list_folders(account: dict, password: str) -> tuple[list[dict], str]:
    """Return [{name, flags, special_use}] for the account's mailbox tree.

    Special-use is the RFC 6154 flag without leading backslash, e.g. "Sent",
    "Trash", "Archive", "All", "Junk", "Drafts". Empty when none.
    """
    imap_cfg = account["imap"]
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
        cli.login(account["email"], password)
        typ, data = cli.list()
        if typ != "OK":
            return ([], "LIST failed")
        out: list[dict] = []
        for raw in data or []:
            if isinstance(raw, (bytes, bytearray)):
                line = bytes(raw)
            else:
                continue
            m = _LIST_RE.match(line)
            if not m:
                continue
            flags_raw = m.group("flags").decode("ascii", errors="ignore")
            name = m.group("name").decode("utf-8", errors="replace")
            flags = [f for f in flags_raw.split() if f]
            special = ""
            for f in flags:
                bare = f.lstrip("\\")
                if bare in ("Sent", "Trash", "Archive", "All", "Junk", "Drafts", "Important", "Flagged"):
                    special = bare
                    break
            out.append({"name": name, "flags": flags, "special_use": special})
        return (out, "")
    except Exception as e:
        return ([], str(e))
    finally:
        try:
            cli.logout()
        except Exception:
            pass


def detect_special_folders(account: dict, password: str) -> dict:
    """Return {archive, sent, trash, junk, drafts} folder names, best-effort.

    Falls back to common guesses (Gmail style first) when SPECIAL-USE flags are
    absent.
    """
    folders, _err = list_folders(account, password)
    by_special: dict[str, str] = {}
    names = [f["name"] for f in folders]
    for f in folders:
        if f["special_use"]:
            by_special[f["special_use"]] = f["name"]

    def pick(special: str, *candidates: str) -> str:
        if special in by_special:
            return by_special[special]
        lookup = {n.lower(): n for n in names}
        for c in candidates:
            if c.lower() in lookup:
                return lookup[c.lower()]
        return ""

    # Gmail-style server: presence of \All flag means "archive" must remove the
    # INBOX label, which is done by MOVE to [Gmail]/All Mail (any user-named
    # "Archive" folder on Gmail is a regular label and does NOT unfile from
    # INBOX). Detect via \All SPECIAL-USE or hostname.
    has_all = "All" in by_special
    archive_name = ""
    if has_all:
        archive_name = by_special["All"]
    elif "Archive" in by_special:
        archive_name = by_special["Archive"]
    else:
        archive_name = pick("Archive", "[Gmail]/All Mail", "All Mail", "Archive", "Archives", "Archive Mail")

    return {
        "archive": archive_name,
        "all": by_special.get("All") or pick("All", "[Gmail]/All Mail", "All Mail"),
        "sent": pick("Sent", "[Gmail]/Sent Mail", "Sent", "Sent Items", "Envoyés", "INBOX.Sent"),
        "trash": pick("Trash", "[Gmail]/Trash", "Trash", "Deleted Items", "Corbeille", "INBOX.Trash"),
        "junk": pick("Junk", "[Gmail]/Spam", "Spam", "Junk", "Pourriel", "INBOX.Spam"),
        "drafts": pick("Drafts", "[Gmail]/Drafts", "Drafts", "Brouillons", "INBOX.Drafts"),
        "isGmail": has_all,
    }


def move_many(account: dict, password: str, moves: list[dict], *,
              folder: str = "INBOX") -> dict:
    """Batch-move messages in a single IMAP session.

    `moves` = [{uid:int, dest:str}, ...]. Returns
    {ok:int, errors:[{uid,dest,error}], elapsedMs:int}.
    """
    started = time.time()
    if not moves:
        return {"ok": 0, "errors": [], "elapsedMs": 0}
    imap_cfg = account["imap"]
    ok_count = 0
    errors: list[dict] = []
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
    except Exception as e:
        return {"ok": 0, "errors": [{"uid": 0, "dest": "", "error": f"connect: {e}"}], "elapsedMs": int((time.time() - started) * 1000)}
    try:
        try:
            cli.login(account["email"], password)
        except imaplib.IMAP4.error as e:
            return {"ok": 0, "errors": [{"uid": 0, "dest": "", "error": f"login: {e}"}], "elapsedMs": int((time.time() - started) * 1000)}
        try:
            cli.select(folder)
        except imaplib.IMAP4.error as e:
            return {"ok": 0, "errors": [{"uid": 0, "dest": "", "error": f"select {folder}: {e}"}], "elapsedMs": int((time.time() - started) * 1000)}

        # Group by destination to batch UID MOVE per dest folder
        by_dest: dict[str, list[int]] = {}
        for m in moves:
            try:
                uid = int(m["uid"]); dest = str(m["dest"])
            except Exception:
                continue
            if not dest:
                continue
            by_dest.setdefault(dest, []).append(uid)

        for dest, uids in by_dest.items():
            for i in range(0, len(uids), 50):
                chunk = uids[i:i + 50]
                uid_set = ",".join(str(u) for u in chunk)
                moved = False
                qd = _q(dest)
                try:
                    typ, resp = cli.uid("MOVE", uid_set, qd)
                    if typ == "OK":
                        ok_count += len(chunk)
                        moved = True
                except Exception as e:
                    last_err = str(e)
                else:
                    last_err = "" if moved else (resp[0].decode("utf-8", "replace") if resp and resp[0] else "MOVE failed")
                if moved:
                    continue
                # Fallback COPY + STORE \Deleted + EXPUNGE (no MOVE support)
                try:
                    typ, resp = cli.uid("COPY", uid_set, qd)
                except Exception as e:
                    typ = "BAD"
                    last_err = str(e)
                if typ != "OK":
                    err_detail = last_err or (resp[0].decode("utf-8", "replace") if resp and resp[0] else "COPY failed")
                    for u in chunk:
                        errors.append({"uid": u, "dest": dest, "error": err_detail})
                    continue
                cli.uid("STORE", uid_set, "+FLAGS", "(\\Deleted)")
                try:
                    cli.expunge()
                except Exception:
                    pass
                ok_count += len(chunk)
        return {"ok": ok_count, "errors": errors, "elapsedMs": int((time.time() - started) * 1000)}
    finally:
        try:
            cli.logout()
        except Exception:
            pass


def append_sent(account: dict, password: str, raw_bytes: bytes,
                folder: str = "Sent") -> tuple[bool, str]:
    """Append a sent message to the Sent folder so it shows up across clients."""
    imap_cfg = account["imap"]
    try:
        cli = _connect(imap_cfg["host"], imap_cfg["port"], imap_cfg.get("socket") or "SSL")
        cli.login(account["email"], password)
        typ, _ = cli.append(folder, "(\\Seen)", imaplib.Time2Internaldate(time.time()), raw_bytes)
        return (typ == "OK", "" if typ == "OK" else "APPEND failed")
    except Exception as e:
        return (False, str(e))
    finally:
        try:
            cli.logout()
        except Exception:
            pass
