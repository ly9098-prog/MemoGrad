"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { SecuritySettings } from "@/components/security-settings";
import { useUserAuth } from "@/lib/auth-store";

export default function SettingsPage() {
  const router = useRouter();
  const user = useUserAuth((state) => state.user);
  const bootstrapped = useUserAuth((state) => state.bootstrapped);
  const bootstrap = useUserAuth((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (bootstrapped && !user) router.replace("/");
  }, [bootstrapped, router, user]);

  if (!bootstrapped) {
    return (
      <main className="boot-screen" data-user-auth-shell role="status">
        <span>正在恢复账号安全设置</span>
      </main>
    );
  }
  if (!user) return null;
  return <SecuritySettings />;
}
