"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createSpringSamples, prefersReducedMotion, type SpringConfig } from "@/lib/motion/spring";

const ENTRANCE_SPRING: SpringConfig = {
  stiffness: 305,
  damping: 26,
  mass: 1,
  duration: 520,
  samples: 31,
};
const MAX_STAGGER_DELAY_MS = 420;

// Animation 4: reuse one sampled spring for every row; WAAPI drives only
// opacity/transform, with no React render or JavaScript frame loop.
const ENTRANCE_KEYFRAMES = createSpringSamples(16, 0, ENTRANCE_SPRING).map(({ offset, value }) => ({
  offset,
  opacity: Math.min(1, offset * 5.2),
  transform: `translate3d(0, ${value}px, 0)`,
}));

type StaggeredEntranceOptions = {
  ready?: boolean;
  staggerMs?: number;
  itemCount?: number;
  animationKey?: string | number | null;
};

/**
 * Applies the staggered spring to the direct children of an existing element.
 * Pages can attach this ref to semantic containers such as tbody, ul, or a
 * list region without adding invalid wrapper elements.
 */
export function useStaggeredEntrance<T extends HTMLElement>({
  ready = true,
  staggerMs = 68,
  itemCount = 0,
  animationKey = null,
}: StaggeredEntranceOptions = {}) {
  const rootRef = useRef<T>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !ready || prefersReducedMotion()) return;
    const items = Array.from(root.children).filter(
      (item): item is HTMLElement => item instanceof HTMLElement,
    );
    const animations = items
      .filter((item) => typeof item.animate === "function")
      .map((item, index) => {
        const animation = item.animate(ENTRANCE_KEYFRAMES, {
          duration: ENTRANCE_SPRING.duration,
          delay: Math.min(index * staggerMs, MAX_STAGGER_DELAY_MS),
          easing: "linear",
          // Apply the hidden start during stagger delay, then relinquish all
          // styles on finish (no permanent transformed containing block).
          fill: "backwards",
        });
        animation.onfinish = () => animation.cancel();
        return animation;
      });

    return () => animations.forEach((animation) => animation.cancel());
  }, [animationKey, itemCount, ready, staggerMs]);

  return rootRef;
}

/**
 * Applies a short spring entrance to each direct child while leaving the
 * wrapper out of the layout via `display: contents`. Existing page markup and
 * semantics stay intact.
 */
export function StaggeredEntrance({
  children,
  ready = true,
  staggerMs = 68,
  itemCount = 0,
  animationKey = null,
}: {
  children: ReactNode;
  ready?: boolean;
  staggerMs?: number;
  itemCount?: number;
  animationKey?: string | number | null;
}) {
  const rootRef = useStaggeredEntrance<HTMLDivElement>({
    ready,
    staggerMs,
    itemCount,
    animationKey,
  });

  return (
    <div ref={rootRef} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
