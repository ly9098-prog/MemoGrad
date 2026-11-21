"use client";

import { useEffect, useState } from "react";
import styles from "@/app/(auth)/login/login.module.css";

export function ResendCodeButton({
  seconds,
  busy,
  onResend,
}: {
  seconds: number;
  busy: boolean;
  onResend: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    let timer = window.setTimeout(function tick() {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(next);
      if (next > 0) timer = window.setTimeout(tick, 1000);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [seconds]);

  return (
    <button
      type="button"
      className={styles.resendButton}
      disabled={busy || remaining > 0}
      onClick={onResend}
    >
      {remaining > 0 ? `${remaining} 秒后可重发` : "重新发送"}
    </button>
  );
}
