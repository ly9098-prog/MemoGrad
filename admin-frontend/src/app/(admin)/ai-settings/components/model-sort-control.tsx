"use client";

import { useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useOutsideClick } from "@/lib/use-outside-click";
import styles from "./model-workbench.module.css";

export function ModelSortControl({
  modelId,
  name,
  first,
  last,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  modelId: number;
  name: string;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  useOutsideClick(containerRef, open, () => setOpen(false), "pointerdown");

  return (
    <div
      ref={containerRef}
      className={styles.sortControl}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          handleRef.current?.focus();
        }
      }}
    >
      <button
        ref={handleRef}
        type="button"
        draggable
        disabled={first && last}
        className={styles.dragHandle}
        aria-label={`调整 ${name} 的顺序`}
        aria-describedby="model-order-help"
        aria-expanded={open}
        aria-controls={`model-sort-${modelId}`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        title="拖动排序，或点击调整位置"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            onMove(event.key === "ArrowUp" ? -1 : 1);
          }
        }}
        onDragStart={(event) => {
          setOpen(false);
          onDragStart(event);
        }}
        onDragEnd={onDragEnd}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      {open ? (
        <div id={`model-sort-${modelId}`} className={styles.sortPopover} role="group" aria-label={`移动 ${name}`}>
          <button type="button" onClick={() => onMove(-1)} disabled={first}>
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            上移
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={last}>
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            下移
          </button>
        </div>
      ) : null}
    </div>
  );
}
