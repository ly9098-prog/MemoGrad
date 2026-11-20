import type { VerifyParam } from "rc-slider-captcha";

type ChallengeGeometry = {
  width: number;
  height: number;
};

type RenderGeometry = {
  width: number;
  height: number;
  pieceLeft: number;
};

const MAX_TRAJECTORY_POINTS = 64;

function sampleTrail(trail: VerifyParam["trail"]) {
  if (trail.length <= MAX_TRAJECTORY_POINTS) {
    return trail.map((point, index) => ({ point, sourceIndex: index }));
  }
  return Array.from({ length: MAX_TRAJECTORY_POINTS }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (trail.length - 1)) / (MAX_TRAJECTORY_POINTS - 1),
    );
    return { point: trail[sourceIndex], sourceIndex };
  });
}

export function buildSliderVerification(
  data: Pick<VerifyParam, "x" | "duration" | "trail">,
  challenge: ChallengeGeometry,
  render: RenderGeometry,
) {
  const scaleX = challenge.width / render.width;
  const scaleY = challenge.height / render.height;
  const offset = Math.round((data.x + render.pieceLeft) * scaleX);
  const trail = data.trail.length ? data.trail : [[0, 0]] as VerifyParam["trail"];
  const start = trail[0] ?? [0, 0];
  const end = trail.at(-1) ?? start;
  const pointerDistance = end[0] - start[0];
  const lastIndex = Math.max(1, trail.length - 1);

  return {
    offset,
    trajectory: sampleTrail(trail).map(({ point: [clientX, clientY], sourceIndex }) => {
      const progress = pointerDistance > 0
        ? (clientX - start[0]) / pointerDistance
        : sourceIndex / lastIndex;
      return {
        x: Math.round(progress * offset),
        y: Math.round((clientY - start[1]) * scaleY),
        t: Math.round((sourceIndex / lastIndex) * data.duration),
      };
    }),
  };
}
