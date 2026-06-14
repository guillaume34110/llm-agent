"""Tool result protocol — shared prefix constants and helpers."""

OK_PREFIX = "OK:"
ERR_PREFIX = "ERREUR:"


def ok(message: str) -> str:
    return f"{OK_PREFIX} {message}"


def err(message: str) -> str:
    return f"{ERR_PREFIX} {message}"


def is_ok(result: str) -> bool:
    return result.startswith(OK_PREFIX)


def is_err(result: str) -> bool:
    return result.startswith(ERR_PREFIX)


def status_label(result: str) -> str:
    """Return 'OK', 'ERREUR', or first 120 chars of result."""
    if is_ok(result):
        return "OK"
    if is_err(result):
        return "ERREUR"
    return result[:120]
