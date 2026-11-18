"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import s from "./import-dialog.module.css";

function ImageContents({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const element = image.current;
    if (!element) return;
    const url = URL.createObjectURL(file);
    element.src = url;
    return () => { element.removeAttribute("src"); URL.revokeObjectURL(url); };
  }, [file]);
  return <>
    <div className={s.toolbar}><span className={s.description}>{(file.size / 1024 / 1024).toFixed(1)} MB</span><div className={s.toolbarActions}>
      <Button variant="secondary" aria-label="缩小图片" disabled={zoom <= .5} onClick={() => setZoom((value) => Math.max(.5, value - .25))}><Minus className="h-4 w-4" aria-hidden="true" /></Button>
      <span className={s.zoomValue} role="status">{Math.round(zoom * 100)}%</span>
      <Button variant="secondary" aria-label="放大图片" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + .25))}><Plus className="h-4 w-4" aria-hidden="true" /></Button>
      <Button variant="ghost" onClick={() => setZoom(1)}><RotateCcw className="h-4 w-4" aria-hidden="true" />适应窗口</Button>
    </div></div>
    <div className={s.imageBody}><div className={s.imageStage} style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- local File URL, revoked when the preview closes */}
      <img ref={image} alt={file.name} />
    </div></div>
  </>;
}

export function ImportImagePreview({ file, onClose }: { file: File | null; onClose: () => void }) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <Dialog open={file !== null} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className={s.dialog}
    onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
    onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus({ preventScroll: true }); }}>
    <header className={s.header}><DialogTitle className={s.title}>{file?.name || "图片预览"}</DialogTitle><DialogDescription className={s.description}>原始图片</DialogDescription></header>
    {file ? <ImageContents key={`${file.name}-${file.lastModified}`} file={file} /> : null}
  </DialogContent></Dialog>;
}
