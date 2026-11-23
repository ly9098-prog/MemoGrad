import { isLearnerPath } from "../learner-routes";
import { DASHBOARD_PATH } from "../home-route";

export function safeLearnerNext(value: string | null | undefined): string {
  const candidate = String(value || DASHBOARD_PATH).trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return DASHBOARD_PATH;
  if (candidate.includes("\\") || candidate.length > 2048) return DASHBOARD_PATH;
  if (/[\x00-\x1F]/.test(candidate)) return DASHBOARD_PATH;
  const path = candidate.split("?", 1)[0].split("#", 1)[0];
  return isLearnerPath(path)
    ? candidate
    : DASHBOARD_PATH;
}
