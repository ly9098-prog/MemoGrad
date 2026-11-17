"use client";

import { useEffect, useState } from "react";
import styles from "../dashboard-workspace.module.css";

const seenValues = new Map<string, string>();

type AnimationDecision = {
  metricKey?: string;
  value: string;
  shouldAnimate: boolean;
};

function resolveAnimationDecision(metricKey: string | undefined, value: string): AnimationDecision {
  return {
    metricKey,
    value,
    shouldAnimate: metricKey === undefined || seenValues.get(metricKey) !== value,
  };
}

export function AnimatedDigits({
  value,
  baseDelay = 0,
  metricKey,
}: {
  value: string;
  baseDelay?: number;
  metricKey?: string;
}) {
  const [decision, setDecision] = useState<AnimationDecision>(() =>
    resolveAnimationDecision(metricKey, value),
  );
  let currentDecision = decision;
  if (decision.metricKey !== metricKey || decision.value !== value) {
    currentDecision = resolveAnimationDecision(metricKey, value);
    setDecision(currentDecision);
  }

  useEffect(() => {
    if (!metricKey) return;
    seenValues.set(metricKey, value);
  }, [metricKey, value]);

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
              className={`${styles.animatedDigit}${currentDecision.shouldAnimate ? "" : ` ${styles.digitSettled}`}`}
              data-direction={currentDigit % 2 === 0 ? "top" : "bottom"}
              data-animate={currentDecision.shouldAnimate ? "true" : "false"}
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
