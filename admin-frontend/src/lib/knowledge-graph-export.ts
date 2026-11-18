import { escapeHtml } from "./knowledge-graph-utils";

export type GraphExportFormat = "png" | "jpg" | "svg" | "html";

export type ExportGraphNode = {
  id: number;
  name: string;
  x?: number;
  y?: number;
  radius: number;
  color: string;
};

export type ExportGraphLink = {
  source: number | { id?: string | number };
  target: number | { id?: string | number };
  relation_type: string;
  source_type?: string;
  confidence: number;
};

export type ExportGraphCluster = {
  label: string;
  color: string;
  count: number;
};

export type ExportGraphInput = {
  title: string;
  subtitle: string;
  nodes: ExportGraphNode[];
  links: ExportGraphLink[];
  clusters: ExportGraphCluster[];
  linkWidth: number;
  arrows: boolean;
};

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
const LABEL_FONT_SIZE = 11;
const LABEL_GAP = 13;
const PADDING_X = 48;
const PADDING_TOP = 86;
const PADDING_BOTTOM = 48;

function endpointId(value: ExportGraphLink["source"]): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = value?.id;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function labelWidth(name: string): number {
  return Math.max(28, name.length * LABEL_FONT_SIZE);
}

export function buildKnowledgeGraphSvg(input: ExportGraphInput): string | null {
  const nodes = input.nodes.filter(
    (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
  );
  if (!nodes.length) return null;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const x = node.x as number;
    const y = node.y as number;
    const halfLabel = labelWidth(node.name) / 2;
    minX = Math.min(minX, x - Math.max(node.radius, halfLabel));
    maxX = Math.max(maxX, x + Math.max(node.radius, halfLabel));
    minY = Math.min(minY, y - node.radius);
    maxY = Math.max(maxY, y + node.radius + LABEL_GAP + LABEL_FONT_SIZE * 0.6);
  }

  const x = minX - PADDING_X;
  const y = minY - PADDING_TOP;
  const width = maxX - minX + PADDING_X * 2;
  const height = maxY - minY + PADDING_TOP + PADDING_BOTTOM;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const legendWidth = input.clusters.reduce(
    (total, cluster) => total + labelWidth(cluster.label) + 42,
    0,
  );
  const fittedWidth = Math.max(width, legendWidth + PADDING_X * 2);

  const legend = input.clusters.reduce<{ markup: string; cursor: number }>(
    (accumulator, cluster) => {
      const itemX = x + PADDING_X + accumulator.cursor;
      const itemWidth = labelWidth(cluster.label) + 42;
      accumulator.markup +=
        `<circle cx="${itemX + 4}" cy="${y + PADDING_TOP - 16}" r="4" fill="${escapeHtml(cluster.color)}"/>` +
        `<text x="${itemX + 14}" y="${y + PADDING_TOP - 12}" font-size="10" fill="#5C7180">` +
        `${escapeHtml(cluster.label)} · ${cluster.count}</text>`;
      accumulator.cursor += itemWidth;
      return accumulator;
    },
    { markup: "", cursor: 0 },
  );

  const links = input.links
    .map((link) => {
      const source = nodeById.get(endpointId(link.source) ?? -1);
      const target = nodeById.get(endpointId(link.target) ?? -1);
      if (!source || !target) return "";
      const dash = link.source_type === "inferred" ? ' stroke-dasharray="5 4"' : "";
      const arrow = input.arrows ? ' marker-end="url(#kg-arrow)"' : "";
      return (
        `<line x1="${(source.x as number).toFixed(1)}" y1="${(source.y as number).toFixed(1)}" ` +
        `x2="${(target.x as number).toFixed(1)}" y2="${(target.y as number).toFixed(1)}" ` +
        `stroke="${escapeHtml(source.color)}" ` +
        `stroke-opacity="${Math.min(0.5, 0.14 + link.confidence * 0.3).toFixed(2)}" ` +
        `stroke-width="${Math.max(0.4, input.linkWidth).toFixed(2)}"${dash}${arrow}/>`
      );
    })
    .join("");

  const circles = nodes
    .map(
      (node) =>
        `<circle cx="${(node.x as number).toFixed(1)}" cy="${(node.y as number).toFixed(1)}" ` +
        `r="${node.radius.toFixed(2)}" fill="${escapeHtml(node.color)}"/>`,
    )
    .join("");

  const labels = nodes
    .map(
      (node) =>
        `<text x="${(node.x as number).toFixed(1)}" ` +
        `y="${((node.y as number) + node.radius + LABEL_GAP).toFixed(1)}" ` +
        `text-anchor="middle" font-size="${LABEL_FONT_SIZE}" font-weight="600" ` +
        `fill="#173342" stroke="#F7FAFC" stroke-width="3" paint-order="stroke">` +
        `${escapeHtml(node.name)}</text>`,
    )
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" ` +
    `viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${fittedWidth.toFixed(1)} ${height.toFixed(1)}" ` +
    `width="${fittedWidth.toFixed(0)}" height="${height.toFixed(0)}" ` +
    `font-family='${FONT_FAMILY}'>` +
    `<title>${escapeHtml(input.title)}</title>` +
    `<desc>${escapeHtml(input.subtitle)}</desc>` +
    `<defs>` +
    `<pattern id="kg-dots" width="20" height="20" patternUnits="userSpaceOnUse">` +
    `<circle cx="1" cy="1" r="0.8" fill="rgba(37,99,138,0.14)"/></pattern>` +
    `<marker id="kg-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto">` +
    `<path d="M0,0 L6,3 L0,6 Z" fill="#7C93A5"/></marker>` +
    `</defs>` +
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${fittedWidth.toFixed(1)}" height="${height.toFixed(1)}" fill="#F7FAFC"/>` +
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${fittedWidth.toFixed(1)}" height="${height.toFixed(1)}" fill="url(#kg-dots)"/>` +
    `<text x="${(x + PADDING_X).toFixed(1)}" y="${(y + 38).toFixed(1)}" font-size="20" font-weight="600" fill="#0F3A52">` +
    `${escapeHtml(input.title)}</text>` +
    `<text x="${(x + PADDING_X).toFixed(1)}" y="${(y + 58).toFixed(1)}" font-size="11" fill="#5C7180">` +
    `${escapeHtml(input.subtitle)}</text>` +
    legend.markup +
    links +
    circles +
    labels +
    `</svg>`
  );
}

export function buildKnowledgeGraphHtml(
  svg: string,
  options: { title: string; subtitle: string; generatedAt?: Date },
): string {
  const generatedAt = (options.generatedAt ?? new Date()).toLocaleString("zh-CN", {
    hour12: false,
  });
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${escapeHtml(options.title)}</title><style>` +
    `:root{color-scheme:light}body{margin:0;padding:28px;background:#eaf2f8;` +
    `font-family:${FONT_FAMILY};color:#173342}` +
    `main{max-width:1680px;margin:0 auto;background:#f7fafc;border:1px solid #d5e1eb;` +
    `border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(37,99,138,.12)}` +
    `svg{display:block;width:100%;height:auto}` +
    `footer{max-width:1680px;margin:12px auto 0;font-size:12px;color:#5C7180}` +
    `</style></head><body><main>${svg}</main>` +
    `<footer>${escapeHtml(options.subtitle)} · 导出于 ${escapeHtml(generatedAt)}</footer>` +
    `</body></html>`
  );
}

export function graphExportFilename(
  subjectCode: string,
  format: GraphExportFormat,
  date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const safeCode = subjectCode.replace(/[^a-zA-Z0-9_-]/g, "") || "graph";
  return `knowledge-graph-${safeCode}-${stamp}.${format}`;
}
