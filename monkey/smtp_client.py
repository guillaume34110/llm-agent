"""SMTP send via Python stdlib `smtplib` + `email.message.EmailMessage`."""
from __future__ import annotations
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid, formatdate


def _build_message(*, from_addr: str, to: list[str], subject: str, body: str,
                   cc: list[str] | None = None, bcc: list[str] | None = None,
                   in_reply_to: str | None = None, references: str | None = None,
                   html: str | None = None) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references
    msg.set_content(body or "")
    if html:
        msg.add_alternative(html, subtype="html")
    return msg


def send(account: dict, password: str, *, to: list[str], subject: str,
         body: str, cc: list[str] | None = None, bcc: list[str] | None = None,
         in_reply_to: str | None = None, references: str | None = None,
         html: str | None = None) -> tuple[bool, str, bytes | None]:
    """Send via SMTP. Returns (ok, error, raw_bytes_for_imap_append)."""
    smtp_cfg = account["smtp"]
    host = smtp_cfg["host"]
    port = int(smtp_cfg["port"])
    socket_kind = (smtp_cfg.get("socket") or "SSL").upper()
    msg = _build_message(
        from_addr=account["email"], to=to, subject=subject, body=body,
        cc=cc, bcc=bcc, in_reply_to=in_reply_to, references=references, html=html,
    )
    recipients = list(to) + list(cc or []) + list(bcc or [])
    try:
        ctx = ssl.create_default_context()
        if socket_kind == "SSL":
            cli: smtplib.SMTP = smtplib.SMTP_SSL(host, port, context=ctx, timeout=30)
        else:
            cli = smtplib.SMTP(host, port, timeout=30)
            cli.ehlo()
            if socket_kind == "STARTTLS":
                cli.starttls(context=ctx)
                cli.ehlo()
        try:
            cli.login(account["email"], password)
            cli.send_message(msg, from_addr=account["email"], to_addrs=recipients)
        finally:
            try:
                cli.quit()
            except Exception:
                pass
        return (True, "", bytes(msg))
    except smtplib.SMTPAuthenticationError as e:
        return (False, f"auth: {e}", None)
    except Exception as e:
        return (False, str(e), None)
