import type { ApiAuthMode } from "@/lib/api/client";

function originOf(value: string | undefined): string | null {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
}

export function resolveAuthHostMode(
  origin: string,
  adminWebBase: string | undefined,
  userWebBase: string | undefined,
): ApiAuthMode | null {
  const adminOrigin = originOf(adminWebBase);
  const userOrigin = originOf(userWebBase);
  if (adminOrigin === userOrigin) return null;
  if (origin === adminOrigin) return "admin";
  if (origin === userOrigin) return "user";
  return null;
}
