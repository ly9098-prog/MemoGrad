type AdminFooterVariant = "default" | "auth";

export function AdminFooter({ variant = "default" }: { variant?: AdminFooterVariant }) {
  const isAuth = variant === "auth";

  return (
    <footer
      className={
        isAuth
          ? "px-5 py-5 sm:px-8"
          : "border-t border-border bg-card/85 px-4 py-5 backdrop-blur-xl lg:px-8"
      }
    >
      <div
        className={`mx-auto flex max-w-7xl flex-col items-center justify-center gap-1 text-center text-xs leading-5 sm:flex-row sm:gap-3 ${
          isAuth ? "text-muted-foreground" : "text-muted-foreground/70"
        }`}
      >
        <span>© {new Date().getFullYear()} MemoGrad</span>
        <span className={`hidden h-3 w-px sm:block ${isAuth ? "bg-border" : "bg-border"}`} />
        <a
          className={`font-medium transition ${
            isAuth ? "text-muted-foreground hover:text-primary" : "hover:text-accent-foreground"
          }`}
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noreferrer"
        >
          桂ICP备2026003057号-1
        </a>
      </div>
    </footer>
  );
}
