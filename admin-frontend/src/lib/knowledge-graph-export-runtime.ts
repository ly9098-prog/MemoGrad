type ExportPoint = { x: number; y: number; radius: number };

export function initializeGraphExport(
  linkCoordinates: (source: ExportPoint, target: ExportPoint) => number[],
): void {
  const host = document.querySelector<HTMLElement>("#kg-map");
  const svg = host?.querySelector<SVGSVGElement>("svg");
  if (!host || !svg) return;
  const stage = host;
  const canvas = svg;
  const status = document.querySelector<HTMLElement>("#kg-status");
  const output = document.querySelector<HTMLOutputElement>("#kg-zoom");
  const initialStatus = status?.textContent ?? "";
  const groups = Array.from(canvas.querySelectorAll<SVGGElement>("[data-node-id]"));
  const lines = Array.from(canvas.querySelectorAll<SVGLineElement>("line[data-source]"));
  const points = new Map(groups.map((group) => [group.dataset.nodeId!, {
    group, x: Number(group.dataset.x), y: Number(group.dataset.y), radius: Number(group.dataset.radius),
  }]));
  const edgesByNode = new Map<string, SVGLineElement[]>();
  for (const line of lines) {
    for (const id of [line.dataset.source!, line.dataset.target!]) {
      const edges = edgesByNode.get(id) ?? [];
      edges.push(line);
      edgesByNode.set(id, edges);
    }
  }
  for (const group of groups) {
    group.setAttribute("tabindex", "0");
    group.setAttribute("role", "button");
    group.setAttribute("aria-label", `${group.dataset.label}，可拖动或用方向键移动`);
  }
  canvas.setAttribute("role", "group");
  let selected: string | null = null;
  let drag: { pointer: number; node: string | null; x: number; y: number; clientX: number; clientY: number } | null = null;
  let frame: number | null = null;

  function fittedView() {
    const bounds = canvas.querySelector<SVGGElement>("[data-graph-content]")?.getBBox();
    const fallback = (canvas.dataset.graphViewbox ?? "0 0 800 600").split(" ").map(Number);
    const content = bounds && bounds.width > 0 ? {
      x: bounds.x - 40, y: bounds.y - 40, width: bounds.width + 80, height: bounds.height + 80,
    } : { x: fallback[0], y: fallback[1], width: fallback[2], height: fallback[3] };
    const aspect = stage.clientWidth / Math.max(stage.clientHeight, 1);
    const width = Math.max(content.width, content.height * aspect);
    const height = width / Math.max(aspect, 0.1);
    return { x: content.x + (content.width - width) / 2, y: content.y + (content.height - height) / 2, width, height };
  }
  let home = fittedView();
  let view = { x: home.x, y: home.y, width: home.width, height: home.height };

  function drawView() {
    canvas.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
    const zoom = home.width / view.width;
    if (output) output.value = `${Math.round(zoom * 100)}%`;
    for (const action of ["zoom-in", "zoom-out"]) {
      const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
      if (button) button.disabled = action === "zoom-in" ? zoom >= 8 - 0.001 : zoom <= 0.25 + 0.001;
    }
  }

  function worldPoint(clientX: number, clientY: number) {
    const point = canvas.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transform = canvas.getScreenCTM();
    return transform ? point.matrixTransform(transform.inverse()) : point;
  }

  function updateEdge(line: SVGLineElement) {
    const source = points.get(line.dataset.source!);
    const target = points.get(line.dataset.target!);
    if (!source || !target) return;
    const coordinates = linkCoordinates(source, target);
    for (const [index, attribute] of ["x1", "y1", "x2", "y2"].entries()) {
      line.setAttribute(attribute, String(coordinates[index]));
    }
  }

  function moveNode(id: string, x: number, y: number) {
    const node = points.get(id);
    if (!node) return;
    node.x = x;
    node.y = y;
    node.group.setAttribute("transform", `translate(${x} ${y})`);
    for (const edge of edgesByNode.get(id) ?? []) updateEdge(edge);
  }

  function highlight(id: string | null) {
    const neighbors = new Set(id ? [id] : []);
    for (const line of id ? edgesByNode.get(id) ?? [] : []) {
      neighbors.add(line.dataset.source!);
      neighbors.add(line.dataset.target!);
    }
    for (const [key, node] of points) node.group.classList.toggle("is-muted", id != null && !neighbors.has(key));
    for (const line of lines) {
      const active = line.dataset.source === id || line.dataset.target === id;
      line.classList.toggle("is-active", active);
      line.classList.toggle("is-muted", id != null && !active);
    }
    if (status) status.textContent = id ? points.get(id)?.group.dataset.label ?? "" : initialStatus;
  }

  function zoomBy(factor: number, anchor = { x: view.x + view.width / 2, y: view.y + view.height / 2 }) {
    const current = home.width / view.width;
    const next = Math.max(0.25, Math.min(8, current * factor));
    const ratio = current / next;
    view = {
      x: anchor.x + (view.x - anchor.x) * ratio,
      y: anchor.y + (view.y - anchor.y) * ratio,
      width: view.width * ratio, height: view.height * ratio,
    };
    drawView();
  }

  function renderDrag() {
    frame = null;
    if (!drag) return;
    const point = worldPoint(drag.clientX, drag.clientY);
    if (drag.node) moveNode(drag.node, point.x - drag.x, point.y - drag.y);
    else {
      view.x += drag.x - point.x;
      view.y += drag.y - point.y;
      drawView();
    }
  }

  function endDrag() {
    if (frame != null) cancelAnimationFrame(frame);
    renderDrag();
    const pointer = drag?.pointer;
    drag = null;
    stage.classList.remove("is-dragging");
    if (pointer != null && stage.hasPointerCapture(pointer)) stage.releasePointerCapture(pointer);
    highlight(selected);
  }

  function fit() {
    home = fittedView();
    view = { x: home.x, y: home.y, width: home.width, height: home.height };
    drawView();
  }

  function targetNode(target: EventTarget | null) {
    return target instanceof Element ? target.closest<SVGGElement>("[data-node-id]") : null;
  }

  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    const group = targetNode(event.target);
    const node = group ? points.get(group.dataset.nodeId!) : null;
    const point = worldPoint(event.clientX, event.clientY);
    selected = group?.dataset.nodeId ?? null;
    highlight(selected);
    (group ?? stage).focus({ preventScroll: true });
    drag = {
      pointer: event.pointerId, node: selected,
      x: point.x - (node?.x ?? 0), y: point.y - (node?.y ?? 0),
      clientX: event.clientX, clientY: event.clientY,
    };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-dragging");
    event.preventDefault();
  });
  stage.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.clientX = event.clientX;
    drag.clientY = event.clientY;
    if (frame == null) frame = requestAnimationFrame(renderDrag);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    stage.addEventListener(name, (event: PointerEvent) => {
      if (event.pointerId === drag?.pointer) endDrag();
    });
  }
  stage.addEventListener("pointerover", (event) => {
    if (!drag) highlight(targetNode(event.target)?.dataset.nodeId ?? selected);
  });
  stage.addEventListener("pointerleave", () => { if (!drag) highlight(selected); });
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (drag) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
    zoomBy(Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.0015), worldPoint(event.clientX, event.clientY));
  }, { passive: false });
  stage.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const group = targetNode(event.target);
    const id = group?.dataset.nodeId;
    const node = id ? points.get(id) : null;
    const distance = event.shiftKey ? 40 : 10;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-distance, 0], ArrowRight: [distance, 0], ArrowUp: [0, -distance], ArrowDown: [0, distance],
    };
    const direction = directions[event.key];
    if (direction) {
      if (node && id) { selected = id; moveNode(id, node.x + direction[0], node.y + direction[1]); highlight(id); }
      else { view.x += direction[0] * view.width / 400; view.y += direction[1] * view.height / 400; drawView(); }
    } else if (event.key === "+" || event.key === "=") zoomBy(1.25);
    else if (event.key === "-") zoomBy(0.8);
    else if (event.key === "0") fit();
    else if (event.key === "Escape") { endDrag(); selected = null; highlight(null); }
    else if (id && (event.key === "Enter" || event.key === " ")) { selected = selected === id ? null : id; highlight(selected); }
    else return;
    event.preventDefault();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-action]")) {
    button.addEventListener("click", () => {
      if (button.dataset.action === "zoom-in") zoomBy(1.25);
      else if (button.dataset.action === "zoom-out") zoomBy(0.8);
      else if (button.dataset.action === "fit") fit();
      else if (button.dataset.action === "reset") {
        endDrag();
        for (const [id, node] of points) moveNode(id, Number(node.group.dataset.x), Number(node.group.dataset.y));
        selected = null;
        highlight(null);
        fit();
      }
    });
  }
  new ResizeObserver(() => {
    const centerX = view.x + view.width / 2;
    view.width = view.height * stage.clientWidth / Math.max(stage.clientHeight, 1);
    view.x = centerX - view.width / 2;
    home = fittedView();
    drawView();
  }).observe(stage);
  drawView();
}
