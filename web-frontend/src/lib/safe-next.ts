export function safeUserNext(value: string | null | undefined): string {
  const candidate = String(value || "/").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  if (candidate.includes("\\") || candidate.length > 2048) return "/";
  if (/[\x00-\x1F]/.test(candidate)) return "/";
  return candidate;
}

export function safeGithubLoginNext(value: string | null | undefined): string {
  return safeUserNext(value);
}
