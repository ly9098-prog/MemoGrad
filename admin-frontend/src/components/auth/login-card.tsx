"use client";

import type { PointerEvent, ReactNode } from "react";
import styles from "@/app/(auth)/login/login.module.css";

function updateCardTilt(event: PointerEvent<HTMLDivElement>) {
  if (
    event.pointerType !== "mouse"
    || !window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches
  ) return;
  const card = event.currentTarget;
  const bounds = (card.parentElement ?? card).getBoundingClientRect();
  const horizontal = Math.max(0, Math.min(1, (event.clientX - bounds.left) / card.offsetWidth));
  const vertical = Math.max(0, Math.min(1, (event.clientY - bounds.top) / card.offsetHeight));
  card.style.setProperty("--login-rotate-x", `${(0.5 - vertical) * 16}deg`);
  card.style.setProperty("--login-rotate-y", `${(horizontal - 0.5) * 20}deg`);
  card.style.setProperty("--login-pointer-x", `${horizontal * 100}%`);
  card.style.setProperty("--login-pointer-y", `${vertical * 100}%`);
}

function resetCardTilt(event: PointerEvent<HTMLDivElement>) {
  event.currentTarget.style.removeProperty("--login-rotate-x");
  event.currentTarget.style.removeProperty("--login-rotate-y");
  event.currentTarget.style.removeProperty("--login-pointer-x");
  event.currentTarget.style.removeProperty("--login-pointer-y");
}

export function LoginCard({
  titleId,
  children,
  support,
  className = "",
}: {
  titleId: string;
  children: ReactNode;
  support?: ReactNode;
  className?: string;
}) {
  return (
    <div className={styles.stage}>
      <div className={styles.cardTilt} onPointerMove={updateCardTilt} onPointerLeave={resetCardTilt}>
        <div className={styles.cardGlow} aria-hidden="true" />
        <div className={styles.edgeLights} aria-hidden="true">
          <span className={styles.edgeTop} /><span className={styles.edgeRight} />
          <span className={styles.edgeBottom} /><span className={styles.edgeLeft} />
        </div>
        <section className={`${styles.card} ${className}`} aria-labelledby={titleId}>
          {children}
        </section>
      </div>
      {support}
    </div>
  );
}
