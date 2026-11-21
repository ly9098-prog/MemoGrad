const ADMIN_HOME = "/dashboard";
const LEARNER_HOME = "/questions";

function normalizeHost(value: string | null | undefined): string {
  const raw = value?.split(",")[0]?.trim().toLowerCase();
  if (!raw) return "";

  try {
    const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return url.hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

/**
 * Resolve the landing route for the shared Web build.
 *
 * The Admin host keeps the operational dashboard. Any other host is treated as
 * the ordinary-user site and lands on the question browser. When the Admin host
 * is not configured, keep the historical Admin default instead of guessing.
 */
export function resolveHomePath(
  requestHost: string | null | undefined,
  adminHost: string | null | undefined,
): string {
  const expectedAdminHost = normalizeHost(adminHost);
  if (!expectedAdminHost) return ADMIN_HOME;

  return normalizeHost(requestHost) === expectedAdminHost
    ? ADMIN_HOME
    : LEARNER_HOME;
}
