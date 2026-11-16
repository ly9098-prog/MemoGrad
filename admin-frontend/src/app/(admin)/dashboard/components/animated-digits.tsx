"use client";

import { useEffect } from "react";
import styles from "../dashboard-workspace.module.css";

const seenValues = new Map<string, string>();

export function AnimatedDigits({
  value,
  baseDelay = 0,
  metricKey,
}: {
  value: string;
  baseDelay?: number;
  metricKey?: string;
}) {
  const shouldAnimate = metricKey === undefined || seenValues.get(metricKey) !== value;

  useEffect(() => {
    if (!metricKey) return;
    const digitCount = Array.from(value).filter((character) => /\d/.test(character)).length;
    const settleDelay = baseDelay + Math.max(0, digitCount - 1) * 35 + 820 + 120;
    const timer = window.setTimeout(() => seenValues.set(metricKey, value), settleDelay);
    return () => window.clearTimeout(timer);
  }, [baseDelay, metricKey, value]);

  let digitIndex = 0;
  return (
    <span className={styles.digitSequence} aria-hidden="true">
      {Array.from(value).map((character, characterIndex) => {
        if (!/\d/.test(character)) {
          return (
            <span key={`${character}-${characterIndex}`} className={styles.digitStatic}>
              {character}
            </span>
          );
        }
        const currentDigit = digitIndex;
        digitIndex += 1;
        return (
          <span
            key={`${character}-${characterIndex}`}
            className={styles.digitSlot}
            data-digit={character}
          >
            <span
              className={`${styles.animatedDigit}${shouldAnimate ? "" : ` ${styles.digitSettled}`}`}
              data-direction={currentDigit % 2 === 0 ? "top" : "bottom"}
              data-animate={shouldAnimate ? "true" : "false"}
              style={{ animationDelay: `${baseDelay + currentDigit * 35}ms` }}
            >
              {character}
            </span>
          </span>
        );
      })}
    </span>
  );
}
