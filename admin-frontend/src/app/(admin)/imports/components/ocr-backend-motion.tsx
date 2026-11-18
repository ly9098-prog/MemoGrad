import type { OcrBackendState } from "@/lib/imports/ocr-backend-state";
import { cn } from "@/lib/utils";

export function OcrBackendMotion({
  state,
  progress,
  compact = false,
}: {
  state: OcrBackendState;
  progress?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn("v2-ocr-motion", compact && "v2-ocr-motion-compact")}
      data-phase={state.phase}
      role="status"
      aria-live="polite"
      title={`${state.title} · ${state.detail}`}
    >
      <span className="v2-ocr-route" aria-hidden="true">
        <span>HTTPX</span>
        <i />
        <span>CPU</span>
      </span>
      <span className="v2-ocr-copy">
        <strong>{state.title}</strong>
        {!compact ? <small>{state.detail}</small> : null}
      </span>
      {progress && !compact ? <span className="v2-ocr-progress">{progress}</span> : null}
    </div>
  );
}
