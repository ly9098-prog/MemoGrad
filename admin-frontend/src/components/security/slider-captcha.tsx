"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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

function messageFor(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "安全验证未完成，请稍后重试";
}

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
  const keyboardInputId = useId();
  const [challenge, setChallenge] = useState<SlideChallenge | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const challengeRef = useRef<SlideChallenge | null>(null);
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
    setError("");
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
      movesRef.current = [];
      startedAtRef.current = 0;
      setKeyboardOffset(next.thumb_x);
      setChallenge(next);
      setReady(true);
      return next;
    } catch (loadError) {
      if (!controller.signal.aborted && mountedRef.current) {
        setReady(false);
        setError(messageFor(loadError));
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

  const verifyPoint = useCallback(
    async (end: SlidePoint, reset?: () => void) => {
      if (!mountedRef.current) return;
      const current = challengeRef.current;
      if (!current) {
        setError("安全验证已失效，请刷新后重试");
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

      setError("");
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
        setError(messageFor(verifyError));
        reset?.();
        resetTrajectory();
      }
    },
    [onVerified, resetTrajectory, scaleX, scaleY, scope],
  );

  const handleConfirm = useCallback(
    (point: SlidePoint, reset: () => void) => {
      void verifyPoint(toImagePoint(point, scaleX, scaleY), reset);
    },
    [scaleX, scaleY, verifyPoint],
  );

  const handleMove = useCallback((x: number, y: number) => {
    if (!mountedRef.current) return;
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

  const refresh = useCallback(() => {
    verifyControllerRef.current?.abort();
    void request().catch(() => undefined);
  }, [request]);

  const verifyWithKeyboard = useCallback(() => {
    const current = challengeRef.current;
    if (!current) return;
    void verifyPoint({ x: keyboardOffset, y: current.thumb_y });
  }, [keyboardOffset, verifyPoint]);

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

  const thumbWidth = challenge?.thumb_width ?? 0;
  const maxOffset = Math.max(0, imageWidth - thumbWidth);

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
        <span className={styles.headingActions}>
          {!keyboardOpen ? (
            <span className={styles.hint}>拖动下方滑块对齐缺口</span>
          ) : null}
          <button
            type="button"
            className={styles.refresh}
            aria-label="换一张验证图片"
            title="换一张验证图片"
            disabled={!ready}
            onClick={refresh}
          >
            <RefreshCw aria-hidden="true" />
          </button>
          <button
            type="button"
            className={styles.keyboardToggle}
            aria-expanded={keyboardOpen}
            aria-controls={keyboardOpen ? keyboardInputId : undefined}
            onClick={() => {
              setKeyboardOpen((open) => !open);
              resetTrajectory();
            }}
          >
            {keyboardOpen ? "收起" : "键盘验证"}
          </button>
        </span>
      </div>

      <div ref={containerRef} className={styles.captchaArea}>
        {keyboardOpen ? (
          <div className={styles.keyboardPreviewWrap} id={keyboardInputId}>
            <div
              className={styles.keyboardPreview}
              style={{ width: displayWidth, height: displayHeight }}
            >
              {challenge ? (
                <>
                  {/* Data-URI CAPTCHA art must render unoptimized. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={challenge.image}
                    alt="验证码背景图"
                    width={displayWidth}
                    height={displayHeight}
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={challenge.thumb}
                    alt=""
                    className={styles.keyboardPiece}
                    style={{
                      left: Math.round(keyboardOffset * scaleX),
                      top: displayThumbY,
                      width: displayThumbWidth,
                      height: displayThumbHeight,
                    }}
                  />
                </>
              ) : null}
            </div>
            <div className={styles.keyboardPanel}>
              <label htmlFor={`${keyboardInputId}-input`}>拼图位置</label>
              <input
                id={`${keyboardInputId}-input`}
                type="range"
                min={0}
                max={maxOffset}
                step={1}
                value={keyboardOffset}
                aria-label="拼图水平位置"
                aria-describedby={`${keyboardInputId}-hint`}
                onChange={(event) => {
                  setKeyboardOffset(Number(event.target.value));
                  setError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    verifyWithKeyboard();
                  }
                }}
              />
              <span
                id={`${keyboardInputId}-hint`}
                className={styles.keyboardHint}
              >
                方向键移动，Enter 确认
              </span>
              <button
                type="button"
                className={styles.keyboardConfirm}
                disabled={!ready}
                onClick={verifyWithKeyboard}
              >
                确认位置
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.captcha}>
            <GoCaptcha.Slide
              key={challenge?.captcha_id ?? "empty"}
              data={data}
              config={config}
              events={events}
            />
          </div>
        )}
      </div>

      {error ? (
        <div className={styles.errorRow} role="alert">
          <p className={styles.error}>{error}</p>
          <button type="button" className={styles.retry} onClick={refresh}>
            重新加载验证
          </button>
        </div>
      ) : null}
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
