export type SpringConfig = {
  stiffness: number;
  damping: number;
  mass: number;
  duration: number;
  samples?: number;
};

type SpringSample = {
  offset: number;
  value: number;
};

export const PRESS_SPRING: SpringConfig = {
  stiffness: 560,
  damping: 26,
  mass: 1,
  duration: 440,
  samples: 30,
};

export function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Creates sampled keyframes from an under-damped spring equation.
 * Sampling avoids browser-specific spring easing and keeps the same physical
 * response in Chromium, Firefox and Safari through the standard WAAPI.
 */
export function createSpringSamples(
  from: number,
  to: number,
  config: SpringConfig,
): SpringSample[] {
  const distance = to - from;
  const sampleCount = Math.max(4, config.samples ?? 32);
  const angularFrequency = Math.sqrt(config.stiffness / config.mass);
  const dampingRatio = config.damping / (2 * Math.sqrt(config.stiffness * config.mass));

  if (dampingRatio >= 1) {
    return Array.from({ length: sampleCount + 1 }, (_, index) => {
      const offset = index / sampleCount;
      const eased = 1 - Math.exp(-6 * offset);
      return { offset, value: from + distance * eased };
    });
  }

  const dampedFrequency = angularFrequency * Math.sqrt(1 - dampingRatio ** 2);
  const sample = (offset: number) => {
    const time = config.duration / 1000 * offset;
    const envelope = Math.exp(-dampingRatio * angularFrequency * time);
    const wave = Math.cos(dampedFrequency * time)
      + (dampingRatio * angularFrequency / dampedFrequency) * Math.sin(dampedFrequency * time);
    return from + distance * (1 - envelope * wave);
  };

  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const offset = index / sampleCount;
    return {
      offset,
      value: index === sampleCount ? to : sample(offset),
    };
  });
}

function scaleKeyframes(
  from: number,
  to: number,
  config: SpringConfig,
): Keyframe[] {
  return createSpringSamples(from, to, config).map(({ offset, value }) => ({
    offset,
    // Individual scale composes with the caller's translate/rotate/transform.
    scale: String(value),
  }));
}

export function animateScale(
  element: HTMLElement,
  from: number,
  to: number,
  config: SpringConfig,
  { clearOnFinish = false }: { clearOnFinish?: boolean } = {},
) {
  if (prefersReducedMotion() || typeof element.animate !== "function") return null;

  const animation = element.animate(scaleKeyframes(from, to, config), {
    duration: config.duration,
    easing: "linear",
    fill: "both",
  });

  // Hold the press until release; cancel a finished release to expose the
  // original CSS/inline scale without writing or erasing caller styles.
  if (clearOnFinish) animation.onfinish = () => animation.cancel();

  return animation;
}
