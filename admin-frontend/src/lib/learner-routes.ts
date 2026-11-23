// Shared by navigation and login redirects. Keep editor routes out of this list.
export function isLearnerPath(pathname: string): boolean {
  if (["/dashboard", "/practice", "/mistakes", "/formulas"].includes(pathname))
    return true;
  return ["/questions", "/knowledge-graph", "/account"].some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}
