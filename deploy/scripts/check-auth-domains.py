#!/usr/bin/env python3
"""Read-only HTTPS checks for the four authentication hosts; never follows redirects."""

from __future__ import annotations

import argparse
import http.client
import json
import re
import ssl
from concurrent.futures import ThreadPoolExecutor
from typing import Any


def domain_name(value: str) -> str:
    domain = value.strip().lower().rstrip(".")
    label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    if len(domain) > 253 or not re.fullmatch(rf"{label}(?:\.{label})+", domain):
        raise argparse.ArgumentTypeError(
            "Provide a domain without a scheme, port or path"
        )
    return domain


def checks(domain: str) -> list[tuple[str, str, str, int, str | None]]:
    admin, api = f"admin.{domain}", f"api.{domain}"
    return [
        ("user_login", domain, "/account/login", 200, None),
        ("admin_login", admin, "/login", 200, None),
        ("api_has_no_frontend", api, "/", 404, None),
        (
            "www_canonical",
            f"www.{domain}",
            "/login?from=domain-check",
            301,
            f"https://{domain}/login?from=domain-check",
        ),
        ("user_auth_required", domain, "/api/v1/users/me", 401, None),
        ("admin_auth_required", admin, "/api/admin/v1/auth/me", 401, None),
        ("api_auth_required", api, "/api/v1/users/me", 401, None),
        ("user_blocks_admin_api", domain, "/api/admin/v1/auth/me", 404, None),
        ("admin_blocks_user_api", admin, "/api/v1/users/me", 404, None),
        ("api_blocks_admin_api", api, "/api/admin/v1/auth/me", 404, None),
        ("api_health", api, "/api/v1/health", 200, None),
        ("user_questions_auth_required", domain, "/api/admin/v1/questions", 401, None),
        (
            "user_subject_options_auth_required",
            domain,
            "/api/admin/v1/questions/subject-options",
            401,
            None,
        ),
        ("user_question_auth_required", domain, "/api/admin/v1/questions/1", 401, None),
        (
            "user_subjects_auth_required",
            domain,
            "/api/admin/v1/knowledge/subjects",
            401,
            None,
        ),
        ("user_graph_auth_required", domain, "/api/admin/v1/knowledge/graph", 401, None),
        ("user_blocks_export", domain, "/api/admin/v1/questions/export", 404, None),
        ("user_blocks_knowledge_status", domain, "/api/admin/v1/knowledge/status", 404, None),
    ]


def probe(
    case: tuple[str, str, str, int, str | None], timeout: float
) -> dict[str, Any]:
    name, host, path, expected, location = case
    result: dict[str, Any] = {
        "name": name,
        "host": host,
        "path": path,
        "expected_status": expected,
        "ok": False,
    }
    connection = http.client.HTTPSConnection(
        host, timeout=timeout, context=ssl.create_default_context()
    )
    try:
        connection.request(
            "GET", path, headers={"User-Agent": "MemoGrad-domain-preflight"}
        )
        response = connection.getresponse()
        result.update(status=response.status, tls_verified=True)
        result["ok"] = response.status == expected
        if location is not None:
            result["location_matches"] = response.getheader("Location") == location
            result["ok"] = result["ok"] and result["location_matches"]
    except ssl.SSLCertVerificationError:
        result["error"] = "tls_verification_failed"
    except TimeoutError:
        result["error"] = "timeout"
    except (OSError, http.client.HTTPException):
        result["error"] = "connection_failed"
    finally:
        connection.close()
    return result


def inspect_domains(domain: str, timeout: float = 5.0) -> dict[str, Any]:
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda case: probe(case, timeout), checks(domain)))
    return {
        "domain": domain,
        "ok": all(item["ok"] for item in results),
        "checks": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("domain", type=domain_name)
    parser.add_argument(
        "--timeout", type=float, default=5.0, help="Timeout per connection"
    )
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    result = inspect_domains(args.domain, args.timeout)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
