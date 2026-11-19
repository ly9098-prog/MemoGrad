"use client";

import { useEffect } from "react";
import { AccountHome } from "@/components/account-home";
import { LoginWorkspace } from "@/components/login-workspace";
import { useUserAuth } from "@/lib/auth-store";

export default function HomePage() {
  const user = useUserAuth((state) => state.user);
  const bootstrapped = useUserAuth((state) => state.bootstrapped);
  const bootstrap = useUserAuth((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (!bootstrapped) {
    return (
      <main className="boot-screen" role="status">
        <span>正在恢复 MemoGrad 账号</span>
      </main>
    );
  }

  if (user) return <AccountHome />;

  return <LoginWorkspace />;
}
