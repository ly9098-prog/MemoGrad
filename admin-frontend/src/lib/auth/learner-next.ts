const LEARNER_ROOTS = ["/questions", "/knowledge-graph", "/account"];

export function safeLearnerNext(value: string | null | undefined): string {
  const candidate = String(value || "/questions").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/questions";
  if (candidate.includes("\\") || candidate.length > 2048) return "/questions";
  if (/[\x00-\x1F]/.test(candidate)) return "/questions";
  const path = candidate.split("?", 1)[0].split("#", 1)[0];
  return LEARNER_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  )
    ? candidate
    : "/questions";
}
