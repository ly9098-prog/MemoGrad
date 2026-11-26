export type SlidePoint = {
  x: number;
  y: number;
};

export type SlideMove = {
  x: number;
  y: number;
  t: number;
};

export type SlideVerification = {
  x: number;
  y: number;
  trajectory: SlideMove[];
};

const MAX_TRAJECTORY_POINTS = 64;
const MIN_TRAJECTORY_DURATION_MS = 300;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sampleTrajectory(points: SlideMove[]) {
  if (points.length <= MAX_TRAJECTORY_POINTS) return points;
  return Array.from({ length: MAX_TRAJECTORY_POINTS }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (points.length - 1)) / (MAX_TRAJECTORY_POINTS - 1),
    );
    return points[sourceIndex];
  });
}

/**
 * Convert a point measured in rendered display pixels back to challenge-image
 * pixels. The caller must pass the positive scale factors derived from the
 * rendered image dimensions.
 */
export function toImagePoint(
  point: SlidePoint,
  scaleX: number,
  scaleY: number,
): SlidePoint {
  return { x: point.x / scaleX, y: point.y / scaleY };
}

/**
 * Build the verification payload for a go-captcha slide challenge.
 *
 * All coordinates must already be in challenge-image pixels; the component
 * converts the rendered tile position back from its responsive display size
 * before calling this helper. The trajectory keeps the published tile origin
 * as the first point and the reported point as the last.
 */
export function buildSliderVerification({
  start,
  end,
  moves,
  width,
  height,
}: {
  start: SlidePoint;
  end: SlidePoint;
  moves: SlideMove[];
  width: number;
  height: number;
}): SlideVerification {
  const endX = clamp(Math.round(end.x), 0, width);
  const endY = clamp(Math.round(end.y), 0, height);
  const startX = clamp(Math.round(start.x), 0, width);
  const startY = clamp(Math.round(start.y), 0, height);

  const raw: SlideMove[] = [
    { x: startX, y: startY, t: 0 },
    ...moves.map((move) => ({
      x: clamp(Math.round(move.x), 0, width),
      y: clamp(Math.round(move.y), 0, height),
      t: Math.max(0, Math.round(move.t)),
    })),
    {
      x: endX,
      y: endY,
      t: Math.max(MIN_TRAJECTORY_DURATION_MS, Math.round(moves.at(-1)?.t ?? 0)),
    },
  ];

  let previousTime = 0;
  const monotonic = raw.map((point) => {
    const t = Math.max(previousTime, point.t);
    previousTime = t;
    return { ...point, t };
  });

  return {
    x: endX,
    y: endY,
    trajectory: sampleTrajectory(monotonic),
  };
}
