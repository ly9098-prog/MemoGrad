export type TrendPoint = { x: number; y: number | null };

function coordinate(point: { x: number; y: number }) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function segmentPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  const slopes = points.slice(1).map((point, index) =>
    (point.y - points[index].y) / (point.x - points[index].x),
  );
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0;
    if (index === points.length - 1) return slopes[index - 1];
    const previous = slopes[index - 1];
    const next = slopes[index];
    if (previous * next <= 0) return 0;
    return 2 / (1 / previous + 1 / next);
  });
  let path = `M${coordinate(points[0])}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const thirdWidth = (current.x - previous.x) / 3;
    const lower = Math.min(previous.y, current.y);
    const upper = Math.max(previous.y, current.y);
    const bound = (value: number) => Math.max(lower, Math.min(upper, value));
    path += ` C${coordinate({ x: previous.x + thirdWidth, y: bound(previous.y + tangents[index - 1] * thirdWidth) })}`;
    path += ` ${coordinate({ x: current.x - thirdWidth, y: bound(current.y - tangents[index] * thirdWidth) })} ${coordinate(current)}`;
  }
  return path;
}

export function getTrendPaths(points: TrendPoint[], baseline: number) {
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ x: point.x, y: point.y });
    }
  }
  if (current.length) segments.push(current);
  return {
    line: segments.map(segmentPath).join(" "),
    area: segments.filter((segment) => segment.length > 1).map((segment) =>
      `${segmentPath(segment)} L${coordinate({ x: segment.at(-1)!.x, y: baseline })} L${coordinate({ x: segment[0].x, y: baseline })} Z`,
    ).join(" "),
  };
}

export function getTrendScale(peak: number, fractional = false) {
  const target = peak > 0 ? peak * 1.08 : fractional ? 1 : 4;
  const roughStep = target / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const factor = [1, 2, 2.5, 5, 10].find((value) => value * magnitude >= roughStep) ?? 10;
  const step = fractional ? factor * magnitude : Math.max(1, Math.ceil(factor * magnitude));
  const intervals = Math.ceil(target / step);
  const ceiling = step * intervals;
  return { ceiling, ticks: Array.from({ length: intervals + 1 }, (_, index) => index * step) };
}
