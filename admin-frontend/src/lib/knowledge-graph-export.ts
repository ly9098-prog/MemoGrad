import { escapeHtml, relationLabel } from "./knowledge-graph-utils";
import { initializeGraphExport } from "./knowledge-graph-export-runtime";

export type GraphExportFormat = "png" | "jpg" | "svg" | "html";

export type ExportGraphNode = {
  id: number;
  name: string;
  x?: number;
  y?: number;
  radius: number;
  color: string;
  isChapterRoot?: boolean;
};

export type ExportGraphLink = {
  source: number | { id?: string | number };
  target: number | { id?: string | number };
  relation_type: string;
  source_type?: string;
  confidence?: number;
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
const PADDING = 48;

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

function textWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((width, character) =>
    width + fontSize * (/[^\u0000-\u00ff]/u.test(character) ? 1 : 0.58), 0);
}

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of Array.from(text)) {
    if (line && (character === "\n" || textWidth(line + character, fontSize) > maxWidth)) {
      lines.push(line);
      line = "";
    }
    if (character !== "\n") line += character;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function safeColor(color: string): string {
  return /^#[\da-f]{6}$/i.test(color) ? color : "#7C93A5";
}

export function exportLinkCoordinates(
  source: { x: number; y: number; radius: number },
  target: { x: number; y: number; radius: number },
): [number, number, number, number] {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const length = Math.hypot(deltaX, deltaY) || 1;
  const start = Math.min(source.radius + 1, length / 2);
  const end = Math.min(target.radius + 3, length / 2);
  return [
    source.x + deltaX / length * start, source.y + deltaY / length * start,
    target.x - deltaX / length * end, target.y - deltaY / length * end,
  ];
}

export function buildKnowledgeGraphSvg(input: ExportGraphInput): string | null {
  const positioned = input.nodes.filter(
    (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
  );
  if (!positioned.length) return null;
  const sourceMinX = Math.min(...positioned.map((node) => node.x!));
  const sourceMinY = Math.min(...positioned.map((node) => node.y!));
  const spanX = Math.max(...positioned.map((node) => node.x!)) - sourceMinX;
  const spanY = Math.max(...positioned.map((node) => node.y!)) - sourceMinY;
  const scale = Math.min(1, 1600 / Math.max(spanX, spanY, 1));
  const nodes = positioned.map((node) => {
    const radius = (Number.isFinite(node.radius) ? Math.max(1, node.radius) : 6) * Math.max(0.65, scale);
    const fontSize = node.isChapterRoot ? 15 : 13;
    const lines = wrapText(node.name, fontSize, 150);
    return {
      ...node, radius, fontSize, lines,
      color: safeColor(node.color),
      x: (node.x! - sourceMinX) * scale,
      y: (node.y! - sourceMinY) * scale,
      labelWidth: Math.max(...lines.map((line) => textWidth(line, fontSize))),
    };
  });
  const minX = Math.min(...nodes.map((node) => node.x - Math.max(node.radius, node.labelWidth / 2)));
  const maxX = Math.max(...nodes.map((node) => node.x + Math.max(node.radius, node.labelWidth / 2)));
  const minY = Math.min(...nodes.map((node) => node.y - node.radius));
  const maxY = Math.max(...nodes.map((node) => node.y + node.radius + 12 + node.lines.length * 18));
  const width = Math.max(800, maxX - minX + PADDING * 2);
  const contentWidth = width - PADDING * 2;
  let headerY = 48;
  let header = "";
  for (const line of wrapText(input.title, 26, contentWidth)) {
    header += `<text x="48" y="${headerY}" font-size="26" font-weight="600" fill="#0F3A52">${escapeHtml(line)}</text>`;
    headerY += 34;
  }
  for (const line of wrapText(input.subtitle, 13, contentWidth)) {
    header += `<text x="48" y="${headerY}" font-size="13" fill="#52697A">${escapeHtml(line)}</text>`;
    headerY += 20;
  }
  let legendX = PADDING;
  headerY += 8;
  for (const cluster of input.clusters) {
    const label = `${cluster.label} · ${cluster.count}`;
    const lines = wrapText(label, 12, contentWidth - 24);
    const itemWidth = Math.max(...lines.map((line) => textWidth(line, 12))) + 36;
    if (legendX > PADDING && legendX + itemWidth > width - PADDING) {
      legendX = PADDING;
      headerY += 24;
    }
    header += `<circle cx="${legendX + 4}" cy="${headerY - 4}" r="4" fill="${safeColor(cluster.color)}"/>`;
    for (const [index, line] of lines.entries()) {
      header += `<text x="${legendX + 16}" y="${headerY + index * 18}" font-size="12" fill="#52697A">${escapeHtml(line)}</text>`;
    }
    legendX += itemWidth;
    if (lines.length > 1) { headerY += (lines.length - 1) * 18; }
  }
  const graphTop = headerY + 24;
  for (const node of nodes) {
    node.x += PADDING - minX + (width - PADDING * 2 - (maxX - minX)) / 2;
    node.y += graphTop + 24 - minY;
  }
  const height = graphTop + 24 + maxY - minY + PADDING;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const links = input.links
    .map((link) => {
      const source = nodeById.get(endpointId(link.source) ?? -1);
      const target = nodeById.get(endpointId(link.target) ?? -1);
      if (!source || !target) return "";
        const [x1, y1, x2, y2] = exportLinkCoordinates(source, target);
      const dash = link.source_type === "inferred" ? ' stroke-dasharray="5 4"' : "";
      const arrow = input.arrows ? ' marker-end="url(#kg-arrow)"' : "";
        const confidence = Number.isFinite(link.confidence)
          ? Math.max(0, Math.min(1, link.confidence ?? 0))
          : 0;
        const lineWidth = Number.isFinite(input.linkWidth) ? Math.max(0.6, input.linkWidth) : 0.72;
      return (
          `<line data-source="${source.id}" data-target="${target.id}" ` +
          `x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" ` +
          `stroke="${source.color}" stroke-opacity="${(0.2 + confidence * 0.3).toFixed(2)}" ` +
          `stroke-width="${lineWidth.toFixed(2)}"${dash}${arrow}>` +
          `<title>${escapeHtml(`${source.name} → ${target.name} · ${relationLabel(link.relation_type)} · ${Math.round(confidence * 100)}%`)}</title></line>`
      );
    })
    .join("");

    const nodeMarkup = nodes
    .map(
      (node) =>
          `<g data-node-id="${node.id}" data-x="${node.x.toFixed(2)}" data-y="${node.y.toFixed(2)}" ` +
          `data-radius="${node.radius.toFixed(2)}" data-label="${escapeHtml(node.name)}" ` +
          `transform="translate(${node.x.toFixed(2)} ${node.y.toFixed(2)})">` +
          `<title>${escapeHtml(node.name)}</title>` +
          `<circle cx="0" cy="0" r="${node.radius.toFixed(2)}" fill="${node.color}"/>` +
          `<text x="0" y="${(node.radius + 18).toFixed(2)}" text-anchor="middle" ` +
          `font-size="${node.fontSize}" font-weight="${node.isChapterRoot ? 600 : 500}" ` +
          `fill="#173342" stroke="#F7FAFC" stroke-width="3" stroke-linejoin="round" paint-order="stroke">` +
          node.lines.map((line, index) => `<tspan x="0" dy="${index ? 18 : 0}">${escapeHtml(line)}</tspan>`).join("") +
          `</text></g>`,
    )
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" ` +
      `viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" ` +
      `data-graph-viewbox="0 ${graphTop.toFixed(2)} ${width.toFixed(2)} ${(height - graphTop).toFixed(2)}" ` +
      `width="${width.toFixed(0)}" height="${height.toFixed(0)}" ` +
    `font-family='${FONT_FAMILY}'>` +
    `<title>${escapeHtml(input.title)}</title>` +
    `<desc>${escapeHtml(input.subtitle)}</desc>` +
    `<defs>` +
    `<pattern id="kg-dots" width="20" height="20" patternUnits="userSpaceOnUse">` +
    `<circle cx="1" cy="1" r="0.8" fill="rgba(37,99,138,0.14)"/></pattern>` +
    `<marker id="kg-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto">` +
    `<path d="M0,0 L6,3 L0,6 Z" fill="#7C93A5"/></marker>` +
    `</defs>` +
      `<g data-export-backdrop=""><rect width="${width.toFixed(2)}" height="${height.toFixed(2)}" fill="#F7FAFC"/>` +
      `<rect width="${width.toFixed(2)}" height="${height.toFixed(2)}" fill="url(#kg-dots)"/></g>` +
      `<g data-export-header="">${header}</g>` +
      `<g data-graph-content=""><g data-graph-links="">${links}</g>${nodeMarkup}</g>` +
    `</svg>`
  );
}

export function buildKnowledgeGraphHtml(
  svg: string,
    options: { title: string; subtitle: string; generatedAt?: Date; clusters?: ExportGraphCluster[] },
): string {
  const generatedAt = (options.generatedAt ?? new Date()).toLocaleString("zh-CN", {
    hour12: false,
  });
    const legend = (options.clusters ?? []).map((cluster) =>
      `<li><span style="background:${safeColor(cluster.color)}"></span>${escapeHtml(cluster.label)} · ${cluster.count}</li>`,
    ).join("");
  return (
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${escapeHtml(options.title)}</title><style>` +
      `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#F3F7FB;` +
      `font-family:${FONT_FAMILY};color:#173342}main{height:100dvh;min-height:420px;display:flex;flex-direction:column}` +
      `header{padding:20px 24px 16px;background:#fff;border-bottom:1px solid #D5E1EB;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap}` +
      `h1{font-size:20px;line-height:1.4;margin:0 0 4px;font-weight:600}p{margin:0;font-size:13px;color:#52697A}` +
      `.legend{display:flex;flex-wrap:wrap;gap:8px 16px;padding:0;margin:10px 0 0;list-style:none;font-size:12px;color:#52697A}.legend li{display:flex;align-items:center;gap:6px}.legend li span{width:7px;height:7px;border-radius:50%;flex:none}` +
      `.tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}button{height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;border:1px solid #D5E1EB;border-radius:8px;background:#fff;color:#173342;font:inherit;font-size:13px;cursor:pointer}` +
      `button:hover{background:#E1F0FA}button:disabled{opacity:.4;cursor:default}:focus-visible{outline:2px solid #25638A;outline-offset:3px}` +
      `button svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round}` +
      `output{min-width:54px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}.map{flex:1;min-height:200px;background:#F7FAFC;overflow:hidden;position:relative;touch-action:none}` +
      `.map>svg{display:block;width:100%;height:100%;cursor:grab;user-select:none}.map.is-dragging>svg{cursor:grabbing}` +
      `.map [data-export-header],.map [data-export-backdrop]{display:none}.map [data-node-id]{cursor:grab;transition:opacity .18s}.map line{transition:opacity .18s,stroke-opacity .18s}` +
      `.map .is-muted{opacity:.14}.map line.is-active{stroke-opacity:.95}.map [data-node-id]:focus-visible circle{stroke:#25638A;stroke-width:2}` +
      `footer{display:flex;justify-content:space-between;gap:8px;padding:10px 24px;border-top:1px solid #D5E1EB;font-size:12px;line-height:1.6;color:#52697A;flex-wrap:wrap}` +
      `::selection{background:#C9E2F5;color:#173342}@media(max-width:600px){header{padding:16px;gap:12px}h1{font-size:18px}footer{padding:10px 16px}.tools{width:100%}}` +
      `@media(prefers-reduced-motion:reduce){.map [data-node-id],.map line{transition:none}}` +
      `</style></head><body><main><header><div><h1>${escapeHtml(options.title)}</h1><p>${escapeHtml(options.subtitle)}</p>${legend ? `<ul class="legend" aria-label="颜色图例">${legend}</ul>` : ""}</div>` +
      `<div class="tools" aria-label="图谱工具"><button type="button" data-action="zoom-out" aria-label="缩小图谱"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>` +
      `<output id="kg-zoom" aria-label="缩放比例">100%</output>` +
      `<button type="button" data-action="zoom-in" aria-label="放大图谱"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button>` +
      `<button type="button" data-action="fit">适应画布</button><button type="button" data-action="reset">恢复布局</button></div></header>` +
      `<div id="kg-map" class="map" tabindex="0" role="region" aria-label="可拖动知识图谱" aria-describedby="kg-help">${svg}</div>` +
      `<footer><span id="kg-help">拖动空白平移，拖动节点调整布局，滚轮缩放。方向键移动，0 适应画布。</span>` +
      `<span id="kg-status" role="status" aria-live="polite">导出于 ${escapeHtml(generatedAt)}</span></footer></main>` +
      `<script>(${initializeGraphExport.toString()})(${exportLinkCoordinates.toString()});</script></body></html>`
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
