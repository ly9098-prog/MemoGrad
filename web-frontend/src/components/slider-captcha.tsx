"use client";

import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import styles from "@/styles/slider-captcha.module.css";

type SliderChallenge = {
  captcha_id: string;
  background_image: string;
  puzzle_image: string;
  width: number;
  height: number;
  piece_size: number;
  piece_y: number;
  expires_in: number;
};

type SliderTicket = {
  ticket: string;
  expires_in: number;
};

type TrajectoryPoint = {
  x: number;
  y: number;
  t: number;
};

type DragState = {
  pointerId: number | null;
  pointerX: number;
  startedAt: number;
  trajectory: TrajectoryPoint[];
};

type SliderCaptchaProps = {
  onVerified: (ticket: string) => void;
  onCancel: () => void;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function messageFor(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "安全验证未完成，请稍后重试";
}

export function SliderCaptcha({ onVerified, onCancel }: SliderCaptchaProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const latestOffsetRef = useRef(0);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const verifyingRef = useRef(false);
  const [challenge, setChallenge] = useState<SliderChallenge | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");

  const fetchChallenge = useCallback(
    () => apiRequest<SliderChallenge>("/auth/captcha/slider/start", {
      method: "POST",
    }),
    [],
  );

  const loadChallenge = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    verifyingRef.current = false;
    setLoading(true);
    setVerifying(false);
    setDragging(false);
    setChallenge(null);
    setOffset(0);
    latestOffsetRef.current = 0;
    dragRef.current = null;
    setError("");
    try {
      const response = await fetchChallenge();
      if (mountedRef.current && seq === requestSeqRef.current) setChallenge(response);
    } catch (loadError) {
      if (mountedRef.current && seq === requestSeqRef.current) setError(messageFor(loadError));
    } finally {
      if (mountedRef.current && seq === requestSeqRef.current) setLoading(false);
    }
  }, [fetchChallenge]);

  useEffect(() => {
    mountedRef.current = true;
    const seq = ++requestSeqRef.current;
    void fetchChallenge()
      .then((response) => {
        if (mountedRef.current && seq === requestSeqRef.current) setChallenge(response);
      })
      .catch((loadError: unknown) => {
        if (mountedRef.current && seq === requestSeqRef.current) setError(messageFor(loadError));
      })
      .finally(() => {
        if (mountedRef.current && seq === requestSeqRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
    };
  }, [fetchChallenge]);

  function retainPoint(trajectory: TrajectoryPoint[], point: TrajectoryPoint) {
    // Downsample intermediate points while preserving the initial position.
    if (trajectory.length >= 64) {
      const retained = trajectory.filter((_, index) => index === 0 || index % 2 === 1);
      trajectory.splice(0, trajectory.length, ...retained);
    }
    trajectory.push(point);
  }

  function appendPoint(clientY: number, drag: DragState) {
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const point = {
      x: Math.round(latestOffsetRef.current),
      y: Math.round(clientY - bounds.top),
      t: Math.round(performance.now() - drag.startedAt),
    };
    const previous = drag.trajectory.at(-1);
    if (!previous || Math.abs(previous.x - point.x) >= 2 || point.t - previous.t >= 80) {
      retainPoint(drag.trajectory, point);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!challenge || loading || verifyingRef.current || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      startedAt: performance.now(),
      trajectory: [{ x: 0, y: Math.round(event.clientY - event.currentTarget.getBoundingClientRect().top), t: 0 }],
    };
    latestOffsetRef.current = 0;
    setOffset(0);
    setDragging(true);
    setError("");
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !challenge || !bounds || bounds.width <= 0) return;
    const scale = challenge.width / bounds.width;
    const maximum = challenge.width - challenge.piece_size;
    const nextOffset = Math.round(clamp((event.clientX - drag.pointerX) * scale, 0, maximum));
    latestOffsetRef.current = nextOffset;
    setOffset(nextOffset);
    appendPoint(event.clientY, drag);
  }

  function cancelDrag() {
    if (!dragRef.current) return;
    dragRef.current = null;
    latestOffsetRef.current = 0;
    setDragging(false);
    setOffset(0);
  }

  function cancelChallenge() {
    requestSeqRef.current += 1;
    mountedRef.current = false;
    onCancel();
  }

  async function verifyCurrentOffset() {
    const drag = dragRef.current;
    if (!challenge || !drag || verifyingRef.current) return;
    dragRef.current = null;
    setDragging(false);
    const trajectory = [...drag.trajectory];
    const finalPoint = {
      x: Math.round(latestOffsetRef.current),
      y: trajectory.at(-1)?.y ?? 0,
      t: Math.round(performance.now() - drag.startedAt),
    };
    retainPoint(trajectory, finalPoint);
    if (latestOffsetRef.current < 8 || finalPoint.t < 180) {
      latestOffsetRef.current = 0;
      setOffset(0);
      setError("请慢慢拖动滑块对齐缺口");
      return;
    }
    const seq = requestSeqRef.current;
    verifyingRef.current = true;
    setVerifying(true);
    setError("");
    try {
      const response = await apiRequest<SliderTicket>("/auth/captcha/slider/verify", {
        method: "POST",
        body: JSON.stringify({
          captcha_id: challenge.captcha_id,
          offset: Math.round(latestOffsetRef.current),
          trajectory,
        }),
      });
      if (mountedRef.current && seq === requestSeqRef.current) onVerified(response.ticket);
    } catch (verifyError) {
      if (!mountedRef.current || seq !== requestSeqRef.current) return;
      setError(messageFor(verifyError));
      setOffset(0);
      latestOffsetRef.current = 0;
    } finally {
      if (mountedRef.current && seq === requestSeqRef.current) {
        verifyingRef.current = false;
        setVerifying(false);
      }
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    appendPoint(event.clientY, drag);
    void verifyCurrentOffset();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!challenge || loading || verifyingRef.current) return;
    const maximum = challenge.width - challenge.piece_size;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (!dragRef.current) {
        dragRef.current = { pointerId: null, pointerX: 0, startedAt: performance.now(), trajectory: [{ x: 0, y: 0, t: 0 }] };
      }
      const step = event.shiftKey ? 12 : 4;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextOffset = clamp(latestOffsetRef.current + direction * step, 0, maximum);
      latestOffsetRef.current = nextOffset;
      retainPoint(dragRef.current.trajectory, { x: nextOffset, y: 0, t: Math.round(performance.now() - dragRef.current.startedAt) });
      setOffset(nextOffset);
      setError("");
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void verifyCurrentOffset();
    }
  }

  const maximum = challenge ? challenge.width - challenge.piece_size : 1;
  const progress = clamp(offset / maximum, 0, 1);
  const disabled = loading || verifying;

  return (
    <section className={styles.root} aria-labelledby="user-slider-captcha-title" aria-busy={disabled}>
      <div className={styles.heading}>
        <span className={styles.title} id="user-slider-captcha-title"><ShieldCheck aria-hidden="true" />安全验证</span>
        <button type="button" className={styles.refresh} onClick={() => void loadChallenge()} disabled={disabled} aria-label="刷新安全验证">
          <RefreshCw aria-hidden="true" />
        </button>
      </div>
      {loading ? (
        <div className={styles.placeholder}><Loader2 aria-hidden="true" />正在生成验证图片</div>
      ) : challenge ? (
        <>
          <div
            className={styles.image}
            style={{
              aspectRatio: `${challenge.width} / ${challenge.height}`,
              backgroundImage: `url("${challenge.background_image}")`,
            }}
            aria-hidden="true"
          >
            <span
              className={styles.piece}
              style={{
                left: `${(offset / challenge.width) * 100}%`,
                top: `${(challenge.piece_y / challenge.height) * 100}%`,
                width: `${(challenge.piece_size / challenge.width) * 100}%`,
                height: `${(challenge.piece_size / challenge.height) * 100}%`,
                backgroundImage: `url("${challenge.puzzle_image}")`,
              }}
            />
          </div>
          <div
            ref={trackRef}
            className={styles.track}
            data-dragging={dragging || undefined}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label="拖动滑块对齐图片缺口"
            aria-valuemin={0}
            aria-valuemax={maximum}
            aria-valuenow={Math.round(offset)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={cancelDrag}
            onLostPointerCapture={cancelDrag}
            onKeyDown={handleKeyDown}
          >
            <span className={styles.fill} style={{ width: `${progress * 100}%` }} />
            <span className={styles.handle} style={{ left: `calc(${progress * 100}% - ${progress * 28}px)` }}>
              {verifying ? <Loader2 className={styles.spin} aria-hidden="true" /> : <span aria-hidden="true">→</span>}
            </span>
            <span className={styles.hint}>{verifying ? "正在验证" : dragging ? "松开完成验证" : "拖动滑块完成拼图"}</span>
          </div>
        </>
      ) : null}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button type="button" className={styles.cancel} onClick={cancelChallenge}>取消</button>
    </section>
  );
}
