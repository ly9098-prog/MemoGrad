"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginWorkspace } from "@/components/login-workspace";
import { useUserAuth } from "@/lib/auth-store";
import { safeUserNext } from "@/lib/safe-next";

export default function LoginPage() {
  const router = useRouter();
  const user = useUserAuth((state) => state.user);
  const bootstrapped = useUserAuth((state) => state.bootstrapped);
  const bootstrap = useUserAuth((state) => state.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!bootstrapped || !user) return;
    router.replace(
      safeUserNext(new URLSearchParams(window.location.search).get("next")),
    );
  }, [bootstrapped, router, user]);

  return <LoginWorkspace />;
}
