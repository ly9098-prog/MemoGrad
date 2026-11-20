import re
import unicodedata

_ATOM = r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+"
_LOCAL_PART = re.compile(rf"^{_ATOM}(?:\.{_ATOM})*$")
_DOMAIN_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def normalize_email(value: str) -> str:
    """Return a conservative, case-normalized email address.

    The local part is not collapsed for provider-specific aliases (dots or
    plus tags). Unicode domains are converted to IDNA; domains are lowercased.
    """
    compact = unicodedata.normalize("NFKC", str(value or "")).strip()
    if compact.count("@") != 1 or len(compact) > 254:
        raise ValueError("请输入有效的邮箱地址")
    local, domain = compact.rsplit("@", 1)
    if not local or not domain or len(local) > 64 or not _LOCAL_PART.fullmatch(local):
        raise ValueError("请输入有效的邮箱地址")
    try:
        ascii_domain = domain.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        raise ValueError("请输入有效的邮箱地址") from exc
    labels = ascii_domain.split(".")
    if len(labels) < 2 or any(not _DOMAIN_LABEL.fullmatch(label) for label in labels):
        raise ValueError("请输入有效的邮箱地址")
    normalized = f"{local}@{ascii_domain}"
    if len(normalized) > 254:
        raise ValueError("请输入有效的邮箱地址")
    return normalized
