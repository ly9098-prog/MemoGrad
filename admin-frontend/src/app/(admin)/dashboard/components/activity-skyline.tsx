"use client";

import { Box, Grid2X2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { DashboardDailyPoint } from "@/lib/api/types";
import { AnimatedDigits } from "./animated-digits";
import { buildActivityModel, type ActivityMetric } from "./activity-model";
import styles from "../dashboard-workspace.module.css";

type View = "2d" | "3d";
type Point = [number, number];
type Face = { points: Point[]; cell: number; shade: number };
type Engine = { setView: (view: View) => void; reset: () => void };
const PALETTE = ["#e7edf0", "#c5dce7", "#87b4cb", "#4e8eaf", "#246589"];
const ease = (value: number) => value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function subscribePointer(callback: () => void) {
  const query = window.matchMedia(POINTER_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function contains(points: Point[], pointerX: number, pointerY: number) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [currentX, currentY] = points[index];
    const [previousX, previousY] = points[previous];
    if ((currentY > pointerY) !== (previousY > pointerY) && pointerX < (previousX - currentX) * (pointerY - currentY) / (previousY - currentY) + currentX) inside = !inside;
  }
  return inside;
}

export function ActivitySkyline({
  data, from, to, loading, error,
}: {
  data?: DashboardDailyPoint[];
  from: string;
  to: string;
  loading: boolean;
  error?: boolean;
}) {
  const [metric, setMetric] = useState<ActivityMetric>("questions_new");
  const [view, setView] = useState<View>("3d");
  const [active, setActive] = useState<number | null>(null);
  const [canvasUnavailable, setCanvasUnavailable] = useState(false);
  const finePointer = useSyncExternalStore(subscribePointer, () => window.matchMedia(POINTER_QUERY).matches, () => false);
  const model = useMemo(() => buildActivityModel(data ?? [], from, to, metric), [data, from, to, metric]);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const lastViewRef = useRef<View>("3d");
  const enteredRef = useRef(false);
  const selected = active == null ? null : model.cells[active];
  const unit = metric === "questions_new" ? "题" : "批次";
  const hasData = model.coveredDays > 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || !hasData) return;
    const context = canvas.getContext("2d");
    if (!context) {
      const frame = requestAnimationFrame(() => setCanvasUnavailable(true));
      return () => cancelAnimationFrame(frame);
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target = lastViewRef.current === "3d" ? 1 : 0;
    let progress = reduce.matches || enteredRef.current ? target : 0;
    let width = 0;
    let height = 0;
    let yaw = 0;
    let elevation = 0;
    let yawGoal = 0;
    let elevationGoal = 0;
    let activeIndex: number | null = null;
    let faces: Face[] = [];
    let frame = 0;
    let lastTime = 0;
    let visible = false;
    let drag: { id: number; x: number; y: number; yaw: number; elevation: number; moved: boolean } | null = null;

    const draw = () => {
      if (!width || !height) return;
      const morph = ease(progress);
      const angle = (Math.PI / 5.5 + yaw) * morph;
      const tilt = Math.PI / 2 + ((Math.PI / 5.4 + elevation) - Math.PI / 2) * morph;
      const project = (worldX: number, worldY: number, altitude: number): Point => [
        worldX * Math.cos(angle) - worldY * Math.sin(angle),
        (worldX * Math.sin(angle) + worldY * Math.cos(angle)) * Math.sin(tilt) - altitude * Math.cos(tilt),
      ];
      const raw: Face[] = [];
      const order = model.cells.map((cell, index) => ({ cell, index }))
        .filter(({ cell }) => cell.inRange)
        .sort((first, second) => (first.cell.week - second.cell.week) * Math.sin(angle) + (first.cell.day - second.cell.day) * Math.cos(angle));
      for (const { cell, index } of order) {
        const offset = 0.1 - morph * 0.04;
        const left = cell.week + offset;
        const top = cell.day + offset;
        const right = cell.week + 1 - offset;
        const bottom = cell.day + 1 - offset;
        const wave = clamp((progress - cell.week / Math.max(1, model.weeks - 1) * 0.32 - cell.day / 6 * 0.06) / 0.62, 0, 1);
        const rise = 1 - (1 - wave) ** 3;
        const high = cell.count && model.peak > 0 ? 0.2 + (cell.count / model.peak) ** 0.72 * 6.5 : 0.12;
        const altitude = high * rise;
        const backLeft = project(left, top, altitude);
        const backRight = project(right, top, altitude);
        const frontRight = project(right, bottom, altitude);
        const frontLeft = project(left, bottom, altitude);
        if (morph > 0.005) {
          raw.push({ cell: index, shade: 0.18, points: [project(left, bottom, 0), project(right, bottom, 0), frontRight, frontLeft] });
          raw.push({ cell: index, shade: 0.32, points: [project(right, top, 0), project(right, bottom, 0), frontRight, backRight] });
        }
        raw.push({ cell: index, shade: 0, points: [backLeft, backRight, frontRight, frontLeft] });
      }
      const coordinates = raw.flatMap((face) => face.points);
      const minX = Math.min(...coordinates.map(([horizontal]) => horizontal));
      const maxX = Math.max(...coordinates.map(([horizontal]) => horizontal));
      const minY = Math.min(...coordinates.map(([, vertical]) => vertical));
      const maxY = Math.max(...coordinates.map(([, vertical]) => vertical));
      const scale = Math.min((width - 28) / Math.max(1, maxX - minX), (height - 44) / Math.max(1, maxY - minY));
      const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
      const offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale;
      const toScreen = ([horizontal, vertical]: Point): Point => [offsetX + horizontal * scale, offsetY + vertical * scale];
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      faces = raw.map((face) => ({ ...face, points: face.points.map(toScreen) }));
      for (const face of faces) {
        const cell = model.cells[face.cell];
        context.beginPath();
        face.points.forEach(([horizontal, vertical], index) => index === 0 ? context.moveTo(horizontal, vertical) : context.lineTo(horizontal, vertical));
        context.closePath();
        context.fillStyle = cell.count == null ? "#f2f4f6" : PALETTE[cell.level];
        context.fill();
        if (face.shade > 0) {
          context.fillStyle = `rgba(18, 48, 64, ${face.shade})`;
          context.fill();
        }
        if (face.cell === activeIndex) {
          context.strokeStyle = "#173f56";
          context.lineWidth = 1.5;
          context.stroke();
        }
      }
      context.fillStyle = "#536b7b";
      context.font = `11px ${getComputedStyle(stage).fontFamily}`;
      context.textAlign = "left";
      const months = new Set<string>();
      let previousEdge = -Infinity;
      for (const cell of model.cells) {
        if (!cell.inRange || months.has(cell.date.slice(0, 7))) continue;
        months.add(cell.date.slice(0, 7));
        const [labelX, labelY] = toScreen(project(cell.week, 7.8, 0));
        const label = `${Number(cell.date.slice(5, 7))}月`;
        const labelWidth = context.measureText(label).width;
        if (labelX < previousEdge || labelX + labelWidth > width - 4) continue;
        context.fillText(label, labelX, Math.min(height - 4, labelY + 12));
        previousEdge = labelX + labelWidth + 8;
      }
    };

    const tick = (now: number) => {
      frame = 0;
      const elapsed = Math.min(50, now - lastTime);
      lastTime = now;
      progress = reduce.matches ? target : progress + clamp(target - progress, -elapsed / 1300, elapsed / 1300);
      const smoothing = reduce.matches ? 1 : 1 - Math.exp(-elapsed / 90);
      yaw += (yawGoal - yaw) * smoothing;
      elevation += (elevationGoal - elevation) * smoothing;
      if (Math.abs(yawGoal - yaw) < 0.0001) yaw = yawGoal;
      if (Math.abs(elevationGoal - elevation) < 0.0001) elevation = elevationGoal;
      draw();
      if (visible && (progress !== target || yaw !== yawGoal || elevation !== elevationGoal)) frame = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (frame || !visible) return;
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      width = stage.clientWidth;
      height = stage.clientHeight;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      draw();
    };
    const select = (index: number | null) => {
      if (index === activeIndex) return;
      activeIndex = index;
      setActive(index);
      draw();
    };
    const hit = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      return [...faces].reverse().find((face) => contains(face.points, event.clientX - bounds.left, event.clientY - bounds.top))?.cell ?? null;
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      if (target === 1 && event.pointerType === "mouse") {
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: yawGoal, elevation: elevationGoal, moved: false };
        canvas.setPointerCapture(event.pointerId);
      }
    };
    const pointerMove = (event: PointerEvent) => {
      if (drag && event.pointerId === drag.id && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) {
        drag.moved = true;
        yawGoal = clamp(drag.yaw + (event.clientX - drag.x) * 0.005, -0.35, 0.65);
        elevationGoal = clamp(drag.elevation + (event.clientY - drag.y) * 0.003, -0.22, 0.4);
        select(null);
        kick();
      } else if (!drag?.moved && event.pointerType === "mouse") select(hit(event));
    };
    const pointerUp = (event: PointerEvent) => {
      if (!drag?.moved) select(hit(event));
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      drag = null;
    };
    const pointerLeave = () => { if (!drag) select(null); };
    const pointerCancel = () => { drag = null; select(null); };
    const reset = () => { yawGoal = 0; elevationGoal = 0; kick(); };
    const keyDown = (event: KeyboardEvent) => {
      const first = model.cells.findIndex((cell) => cell.inRange);
      const last = model.cells.length - 1;
      const moves: Record<string, number> = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 };
      if (event.key === "Escape") { select(null); return; }
      if (event.key === "Home" || event.key === "End" || event.key in moves) {
        event.preventDefault();
        const next = event.key === "Home" ? first : event.key === "End" ? last : activeIndex == null ? last : activeIndex + moves[event.key];
        select(clamp(next, first, last));
      }
    };
    engineRef.current = {
      setView(next) { target = next === "3d" ? 1 : 0; if (target === 0) reset(); kick(); },
      reset,
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) { enteredRef.current = true; kick(); }
      else { cancelAnimationFrame(frame); frame = 0; }
    });
    visibility.observe(stage);
    resize();
    reduce.addEventListener("change", kick);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointerleave", pointerLeave);
    canvas.addEventListener("pointercancel", pointerCancel);
    canvas.addEventListener("keydown", keyDown);
    canvas.addEventListener("blur", pointerLeave);
    canvas.addEventListener("dblclick", reset);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility.disconnect();
      reduce.removeEventListener("change", kick);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("keydown", keyDown);
      canvas.removeEventListener("blur", pointerLeave);
      canvas.removeEventListener("dblclick", reset);
      engineRef.current = null;
    };
  }, [model, hasData]);

  useEffect(() => {
    lastViewRef.current = view;
    engineRef.current?.setView(view);
  }, [view, model]);

  return (
    <section className={styles.activityPanel} aria-labelledby="dashboard-activity-title">
      <header className={styles.panelHeader}>
        <div><h2 id="dashboard-activity-title">题库生长轨迹</h2><p className={styles.panelSubtitle}>近一年 · 每一格是一天，每一次新增都留下刻度</p></div>
        <div className={styles.segmented} role="group" aria-label="活动图视角">
          <button type="button" aria-pressed={view === "2d"} onClick={() => setView("2d")} aria-label="切换为 2D 热力图"><Grid2X2 size={14} />2D</button>
          <button type="button" aria-pressed={view === "3d"} onClick={() => setView("3d")} aria-label="切换为 3D 活动图"><Box size={14} />3D</button>
        </div>
      </header>
      <div className={styles.activityTopline}>
        <div className={styles.activityTotal}>
          <strong aria-label={hasData ? model.total.toLocaleString("zh-CN") : "--"}>
            {hasData ? <AnimatedDigits value={model.total.toLocaleString("zh-CN")} metricKey={`activity:${metric}`} /> : "--"}
          </strong><span>{unit}新增</span>
        </div>
        <div className={styles.textSwitch} role="group" aria-label="活动统计内容">
          <button type="button" aria-pressed={metric === "questions_new"} onClick={() => { setMetric("questions_new"); setActive(null); }}>新增题目</button>
          <button type="button" aria-pressed={metric === "imports_new"} onClick={() => { setMetric("imports_new"); setActive(null); }}>导入批次</button>
        </div>
      </div>
      {loading && !hasData ? <div className={styles.activityState} role="status">正在读取年度活动记录</div> : !hasData ? (
        <div className={styles.activityState} role={error ? "alert" : "status"}>{error ? "活动记录加载失败，请刷新重试" : "暂无活动记录，新增题目后可在这里查看"}</div>
      ) : (
        <>
          <div ref={stageRef} className={styles.skylineStage} data-view={view}>
            <canvas ref={canvasRef} className={styles.skylineCanvas} tabIndex={0} role="img" aria-label={`近一年${metric === "questions_new" ? "新增题目" : "导入批次"}，${model.coveredDays}天记录。使用方向键逐日查看，Home 和 End 跳到首尾日期`} aria-describedby="dashboard-activity-selection" />
            <div id="dashboard-activity-selection" className={styles.skylineReadout} aria-live="polite" aria-atomic="true">
              {selected?.inRange ? <><span>{selected.date}</span><strong>{selected.count == null ? "未返回数据" : `${selected.count.toLocaleString("zh-CN")} ${unit}`}</strong></> : <><span>{from} — {to}</span><span>按上海自然日统计</span></>}
            </div>
            {canvasUnavailable ? <p className={styles.canvasFallback}>当前浏览器无法显示活动图，请展开下方每日记录</p> : null}
          </div>
          <div className={styles.activityFoot}>
            <span><strong>{model.activeDays}</strong> 天有新增<span className={styles.activityDivider}>/</span>单日最高 <strong>{model.peak.toLocaleString("zh-CN")}</strong> {unit}{model.peakDate ? ` · ${model.peakDate.slice(5)}` : ""}</span>
            <div className={styles.heatLegend} aria-label="颜色由浅到深表示每日新增数量由少到多"><span>少</span>{PALETTE.map((color) => <i key={color} style={{ backgroundColor: color }} />)}<span>多</span></div>
          </div>
          <div className={styles.activityHint}>
            <span>{finePointer ? view === "3d" ? "拖动旋转 · 双击复位 · 方向键查看日期" : "悬停或点按查看日期 · 方向键逐日浏览" : "点按查看日期 · 可切换 2D 查看每日密度"}</span>
            {view === "3d" && finePointer ? <button type="button" onClick={() => engineRef.current?.reset()} aria-label="复位活动图视角"><RotateCcw size={13} />复位</button> : null}
          </div>
          {error ? <p className={styles.inlineWarning} role="status">更新失败，当前保留上次读取的活动记录</p> : null}
          {model.coveredDays < 365 ? <p className={styles.inlineWarning}>已返回 {model.coveredDays} 天记录；未返回的日期不计为 0</p> : null}
          <details className={styles.dataDisclosure}><summary>查看每日记录</summary><div className={styles.activityTable}><table><caption className="sr-only">年度活动每日记录</caption><thead><tr><th>日期</th><th>新增{unit === "题" ? "题目" : "导入"}</th></tr></thead><tbody>{model.cells.filter((cell) => cell.inRange).map((cell) => <tr key={cell.date}><th scope="row">{cell.date}</th><td>{cell.count == null ? "未返回数据" : `${cell.count.toLocaleString("zh-CN")} ${unit}`}</td></tr>)}</tbody></table></div></details>
        </>
      )}
    </section>
  );
}
