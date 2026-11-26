"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GoCaptcha from "go-captcha-react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { apiRequest, type ApiScope } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import {
  buildSliderVerification,
  toImagePoint,
  type SlideMove,
  type SlidePoint,
} from "./slider-captcha-geometry";
import styles from "./slider-captcha.module.css";

type SlideChallenge = {
  captcha_id: string;
  image: string;
  thumb: string;
  width: number;
  height: number;
  thumb_width: number;
  thumb_height: number;
  thumb_x: number;
  thumb_y: number;
  expires_in: number;
};

type SlideTicket = {
  ticket: string;
  expires_in: number;
};

export type SliderCaptchaPurpose =
  | "login"
  | "register"
  | "activate"
  | "recover";

type SliderCaptchaProps = {
  onVerified: (ticket: string) => void;
  onCancel: () => void;
  purpose: SliderCaptchaPurpose;
  email: string;
  scope?: ApiScope;
};

const EMPTY_SLIDE_DATA = {
  image: "",
  thumb: "",
  thumbX: 0,
  thumbY: 0,
  thumbWidth: 0,
  thumbHeight: 0,
};

// Aliyun/Tencent-style slider feedback: failures are reported inside the
// slider bar and the handle returns to the start, instead of a separate
// error panel. The challenge is refreshed automatically after repeated
// failures (the server allows three attempts per challenge).
type SliderFeedback = "verifying" | "failed" | "expired" | "rate" | "network" | null;

const MAX_CHALLENGE_ATTEMPTS = 2;

const FEEDBACK_TEXT: Record<Exclude<SliderFeedback, null>, string> = {
  verifying: "正在验证…",
  failed: "验证失败，请重新拖动",
  expired: "验证失败，已刷新图片",
  rate: "操作过于频繁，请稍后重试",
  network: "网络异常，请刷新后重试",
};

function abortError(message: string) {
  return new DOMException(message, "AbortError");
}

export function SliderCaptcha({
  onVerified,
  onCancel,
  purpose,
  email,
  scope = "admin",
}: SliderCaptchaProps) {
  const [challenge, setChallenge] = useState<SlideChallenge | null>(null);
  const [ready, setReady] = useState(false);
  const [feedback, setFeedback] = useState<SliderFeedback>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const challengeRef = useRef<SlideChallenge | null>(null);
  const attemptsRef = useRef(0);
  const issuedAtRef = useRef(0);
  const movesRef = useRef<SlideMove[]>([]);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderWidthRef = useRef(0);
  const [renderWidth, setRenderWidth] = useState(0);
  const requestControllerRef = useRef<AbortController | null>(null);
  const verifyControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      if (width > 0 && width !== renderWidthRef.current) {
        renderWidthRef.current = width;
        setRenderWidth(width);
        movesRef.current = [];
        startedAtRef.current = 0;
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const request = useCallback(async () => {
    if (!mountedRef.current) {
      throw abortError("Captcha request cancelled");
    }
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    setReady(false);
    setLoadFailed(false);
    // A manual reload clears transient feedback; the "expired" notice stays
    // until the next drag because it explains the refreshed image.
    setFeedback((current) => (current === "expired" ? current : null));
    try {
      const next = await apiRequest<SlideChallenge>(
        "/auth/captcha/slider/start",
        {
          method: "POST",
          scope,
          skipRefresh: true,
          exposeErrorDetail: true,
          signal: controller.signal,
          body: JSON.stringify({ purpose, email: email.trim() }),
        },
      );
      if (controller.signal.aborted || !mountedRef.current) {
        throw abortError("Captcha request cancelled");
      }
      challengeRef.current = next;
      attemptsRef.current = 0;
      issuedAtRef.current = Date.now();
      movesRef.current = [];
      startedAtRef.current = 0;
      setChallenge(next);
      setReady(true);
      return next;
    } catch (loadError) {
      if (!controller.signal.aborted && mountedRef.current) {
        setReady(false);
        setLoadFailed(true);
      }
      throw loadError;
    }
  }, [email, purpose, scope]);

  useEffect(() => {
    mountedRef.current = true;
    // Defer one tick so React 19 Strict Mode's first effect cleanup can cancel
    // the request before it consumes an issued challenge.
    const timer = window.setTimeout(() => {
      void request().catch(() => undefined);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      mountedRef.current = false;
      requestControllerRef.current?.abort();
      verifyControllerRef.current?.abort();
    };
  }, [request]);

  const resetTrajectory = useCallback(() => {
    movesRef.current = [];
    startedAtRef.current = 0;
  }, []);

  const imageWidth = challenge?.width ?? 300;
  const imageHeight = challenge?.height ?? 220;
  const scale = renderWidth > 0 ? Math.min(1, renderWidth / imageWidth) : 1;
  const displayWidth = Math.max(1, Math.round(imageWidth * scale));
  const displayHeight = Math.max(1, Math.round(imageHeight * scale));
  const scaleX = displayWidth / imageWidth;
  const scaleY = displayHeight / imageHeight;

  const refresh = useCallback(() => {
    verifyControllerRef.current?.abort();
    void request().catch(() => undefined);
  }, [request]);

  const verifyPoint = useCallback(
    async (end: SlidePoint, reset?: () => void) => {
      if (!mountedRef.current) return;
      const current = challengeRef.current;
      if (!current) {
        setFeedback("expired");
        refresh();
        reset?.();
        return;
      }

      const verification = buildSliderVerification({
        start: { x: current.thumb_x, y: current.thumb_y },
        end,
        moves: movesRef.current.map((move) => ({
          ...toImagePoint(move, scaleX, scaleY),
          t: move.t,
        })),
        width: current.width,
        height: current.height,
      });
      const controller = new AbortController();
      verifyControllerRef.current?.abort();
      verifyControllerRef.current = controller;

      setFeedback("verifying");
      try {
        const response = await apiRequest<SlideTicket>(
          "/auth/captcha/slider/verify",
          {
            method: "POST",
            scope,
            skipRefresh: true,
            exposeErrorDetail: true,
            signal: controller.signal,
            body: JSON.stringify({
              captcha_id: current.captcha_id,
              x: verification.x,
              y: verification.y,
              trajectory: verification.trajectory,
            }),
          },
        );
        if (controller.signal.aborted || !mountedRef.current) return;
        onVerified(response.ticket);
      } catch (verifyError) {
        if (controller.signal.aborted || !mountedRef.current) return;
        const status = verifyError instanceof ApiError ? verifyError.status : null;
        const expired = Date.now() > issuedAtRef.current + current.expires_in * 1000;
        reset?.();
        resetTrajectory();
        if (status === 429) {
          setFeedback("rate");
          return;
        }
        if (status === null || status === 0 || status >= 500) {
          setFeedback("network");
          return;
        }
        attemptsRef.current += 1;
        // Keep the same image for the first retry, then refresh: the server
        // invalidates a challenge after three failed attempts.
        if (expired || attemptsRef.current >= MAX_CHALLENGE_ATTEMPTS) {
          setFeedback("expired");
          refresh();
          return;
        }
        setFeedback("failed");
      }
    },
    [onVerified, refresh, resetTrajectory, scaleX, scaleY, scope],
  );

  const handleConfirm = useCallback(
    (point: SlidePoint, reset: () => void) => {
      void verifyPoint(toImagePoint(point, scaleX, scaleY), reset);
    },
    [scaleX, scaleY, verifyPoint],
  );

  const handleMove = useCallback((x: number, y: number) => {
    if (!mountedRef.current) return;
    setFeedback((current) =>
      current === null || current === "verifying" ? current : null,
    );
    const now = performance.now();
    if (startedAtRef.current === 0) startedAtRef.current = now;
    movesRef.current.push({
      x: Math.round(x),
      y: Math.round(y),
      t: Math.round(now - startedAtRef.current),
    });
    if (movesRef.current.length > 128) {
      movesRef.current.splice(1, 1);
    }
  }, []);

  const displayThumbWidth = challenge
    ? Math.max(1, Math.round(challenge.thumb_width * scaleX))
    : 0;
  const displayThumbHeight = challenge
    ? Math.max(1, Math.round(challenge.thumb_height * scaleY))
    : 0;
  const displayThumbX = challenge
    ? Math.round(challenge.thumb_x * scaleX)
    : 0;
  const displayThumbY = challenge
    ? Math.round(challenge.thumb_y * scaleY)
    : 0;

  const data = useMemo(
    () =>
      challenge
        ? {
            image: challenge.image,
            thumb: challenge.thumb,
            thumbX: displayThumbX,
            thumbY: displayThumbY,
            thumbWidth: displayThumbWidth,
            thumbHeight: displayThumbHeight,
          }
        : EMPTY_SLIDE_DATA,
    [
      challenge,
      displayThumbHeight,
      displayThumbWidth,
      displayThumbX,
      displayThumbY,
    ],
  );

  const config = useMemo(
    () => ({
      width: displayWidth,
      height: displayHeight,
      thumbWidth: displayThumbWidth,
      thumbHeight: displayThumbHeight,
      verticalPadding: 0,
      horizontalPadding: 0,
      showTheme: false,
      title: "安全验证",
      iconSize: 20,
    }),
    [displayHeight, displayThumbHeight, displayThumbWidth, displayWidth],
  );

  const events = useMemo(
    () => ({
      move: handleMove,
      refresh,
      close: onCancel,
      confirm: handleConfirm,
    }),
    [handleConfirm, handleMove, onCancel, refresh],
  );

  const feedbackText = feedback
    ? FEEDBACK_TEXT[feedback]
    : "向右拖动滑块填充拼图";
  const errorTone =
    feedback === "failed" ||
    feedback === "expired" ||
    feedback === "rate" ||
    feedback === "network";

  return (
    <section
      className={styles.root}
      aria-labelledby="admin-slider-captcha-title"
      aria-busy={!ready}
    >
      <div className={styles.heading}>
        <span className={styles.title} id="admin-slider-captcha-title">
          <ShieldCheck aria-hidden="true" />
          安全验证
        </span>
        <button
          type="button"
          className={styles.refresh}
          aria-label="换一张验证图片"
          title="换一张验证图片"
          disabled={!ready && !loadFailed}
          onClick={refresh}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </div>

      <div ref={containerRef} className={styles.captchaArea}>
        {loadFailed ? (
          <div className={styles.captcha}>
            <button
              type="button"
              className={styles.loadRetry}
              style={{ width: displayWidth, height: displayHeight }}
              onClick={refresh}
            >
              <RefreshCw aria-hidden="true" />
              <span>加载失败，点击重试</span>
            </button>
          </div>
        ) : (
          <div
            className={styles.captcha}
            data-error={errorTone ? "true" : undefined}
          >
            <span
              className={styles.sliderStatus}
              data-tone={errorTone ? "error" : "idle"}
              role="status"
              aria-live="polite"
            >
              {feedbackText}
            </span>
            <GoCaptcha.Slide
              key={challenge?.captcha_id ?? "empty"}
              data={data}
              config={config}
              events={events}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        className={styles.cancel}
        onClick={() => {
          requestControllerRef.current?.abort();
          verifyControllerRef.current?.abort();
          onCancel();
        }}
      >
        取消验证
      </button>
    </section>
  );
}
