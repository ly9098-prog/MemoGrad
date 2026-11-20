"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import SliderCaptchaBase, {
  type ActionType,
  CurrentTargetType,
  type VerifyParam,
} from "rc-slider-captcha";
import { RotateCw, ShieldCheck } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { buildSliderVerification } from "./slider-captcha-geometry";
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

type SliderCaptchaProps = {
  onVerified: (ticket: string) => void;
  onCancel: () => void;
};

const RENDER_WIDTH = 280;
const RENDER_HEIGHT = 140;
const RENDER_PIECE_SIZE = 42;
const RENDER_PIECE_LEFT = 12;
const RENDER_MAX_OFFSET = RENDER_WIDTH - RENDER_PIECE_SIZE - RENDER_PIECE_LEFT;

function messageFor(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "安全验证未完成，请稍后重试";
}

export function SliderCaptcha({ onVerified, onCancel }: SliderCaptchaProps) {
  const keyboardInputId = useId();
  const challengeRef = useRef<SliderChallenge | null>(null);
  const actionRef = useRef<ActionType | undefined>(undefined);
  const mountedRef = useRef(false);
  const requestControllerRef = useRef<AbortController | null>(null);
  const verifyControllerRef = useRef<AbortController | null>(null);
  const interactionCancelledRef = useRef(false);
  const [pieceTop, setPieceTop] = useState(0);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    // rc-slider-captcha's mount effect runs twice in React 19 Strict Mode and
    // leaves the final status at Loading. Deferring one request also lets the
    // replay cleanup cancel its first timer before it can consume a challenge.
    const timer = window.setTimeout(() => actionRef.current?.refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      mountedRef.current = false;
      requestControllerRef.current?.abort();
      verifyControllerRef.current?.abort();
    };
  }, []);

  const request = useCallback(async () => {
    if (!mountedRef.current) {
      throw new DOMException("Captcha request cancelled", "AbortError");
    }
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    setReady(false);
    setError("");
    try {
      const challenge = await apiRequest<SliderChallenge>(
        "/auth/captcha/slider/start",
        {
          method: "POST",
          skipRefresh: true,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted || !mountedRef.current) {
        throw new DOMException("Captcha request cancelled", "AbortError");
      }
      challengeRef.current = challenge;
      setReady(true);
      setPieceTop(
        Math.round(
          (challenge.piece_y / challenge.height) * RENDER_HEIGHT,
        ),
      );
      return {
        bgUrl: challenge.background_image,
        puzzleUrl: challenge.puzzle_image,
      };
    } catch (loadError) {
      if (!controller.signal.aborted && mountedRef.current) {
        setReady(false);
        setError(messageFor(loadError));
      }
      throw loadError;
    }
  }, []);

  const verify = useCallback(
    async (data: VerifyParam) => {
      if (!mountedRef.current) {
        throw new DOMException("Captcha verification cancelled", "AbortError");
      }
      if (interactionCancelledRef.current) {
        interactionCancelledRef.current = false;
        const cancelled = new DOMException(
          "Captcha gesture cancelled",
          "AbortError",
        );
        setError("操作已取消，请重新拖动");
        throw cancelled;
      }
      const challenge = challengeRef.current;
      if (!challenge) {
        const unavailable = new Error("安全验证已失效，请刷新后重试");
        setError(unavailable.message);
        throw unavailable;
      }

      const verification = buildSliderVerification(data, challenge, {
        width: RENDER_WIDTH,
        height: RENDER_HEIGHT,
        pieceLeft: RENDER_PIECE_LEFT,
      });
      const controller = new AbortController();
      verifyControllerRef.current?.abort();
      verifyControllerRef.current = controller;

      setError("");
      try {
        const response = await apiRequest<SliderTicket>(
          "/auth/captcha/slider/verify",
          {
            method: "POST",
            skipRefresh: true,
            signal: controller.signal,
            body: JSON.stringify({
              captcha_id: challenge.captcha_id,
              offset: verification.offset,
              trajectory: verification.trajectory,
            }),
          },
        );
        if (controller.signal.aborted || !mountedRef.current) {
          throw new DOMException("Captcha verification cancelled", "AbortError");
        }
        onVerified(response.ticket);
      } catch (verifyError) {
        if (!controller.signal.aborted && mountedRef.current) {
          setError(messageFor(verifyError));
        }
        throw verifyError;
      }
    },
    [onVerified],
  );

  const verifyWithKeyboard = useCallback(() => {
    interactionCancelledRef.current = false;
    const trail: VerifyParam["trail"] = keyboardOffset > 0
      ? [[0, 0], [Math.round(keyboardOffset / 2), 0], [keyboardOffset, 0]]
      : [[0, 0], [0, 0]];
    void verify({
      x: keyboardOffset,
      y: 0,
      sliderOffsetX: keyboardOffset,
      duration: 600,
      trail,
      targetType: CurrentTargetType.Puzzle,
      errorCount: 0,
    }).catch(() => undefined);
  }, [keyboardOffset, verify]);

  const retryVerification = useCallback(() => {
    if (!mountedRef.current) return;
    interactionCancelledRef.current = false;
    setError("");
    actionRef.current?.refresh(true);
  }, []);

  return (
    <section
      className={styles.root}
      data-keyboard-mode={keyboardOpen || undefined}
      aria-labelledby="user-slider-captcha-title"
      aria-busy={!ready}
    >
      <div className={styles.heading}>
        <span className={styles.title} id="user-slider-captcha-title">
          <ShieldCheck aria-hidden="true" />
          安全验证
        </span>
        <span className={styles.headingActions}>
          {!keyboardOpen ? (
            <span className={styles.hint}>拖动拼图对齐缺口</span>
          ) : null}
          <button
            type="button"
            className={styles.keyboardToggle}
            aria-expanded={keyboardOpen}
            aria-controls={keyboardInputId}
            onClick={() => setKeyboardOpen((open) => !open)}
          >
            {keyboardOpen ? "收起" : "键盘验证"}
          </button>
        </span>
      </div>

      <div
        onPointerDownCapture={() => {
          interactionCancelledRef.current = false;
        }}
        onPointerCancelCapture={() => {
          interactionCancelledRef.current = true;
        }}
        onTouchStartCapture={() => {
          interactionCancelledRef.current = false;
        }}
        onTouchCancelCapture={() => {
          interactionCancelledRef.current = true;
        }}
      >
        <SliderCaptchaBase
          className={styles.captcha}
          actionRef={actionRef}
          autoRequest={false}
          autoRefreshOnError={false}
          request={request}
          onVerify={verify}
          bgSize={{ width: RENDER_WIDTH, height: RENDER_HEIGHT }}
          puzzleSize={{
            width: RENDER_PIECE_SIZE,
            height: RENDER_PIECE_SIZE,
            left: RENDER_PIECE_LEFT,
            top: pieceTop,
          }}
          styles={{
            puzzleImg: keyboardOpen
              ? { transform: `translate3d(${keyboardOffset}px, 0, 0)` }
              : undefined,
          }}
          tipText={{
            default: "向右拖动滑块完成验证",
            loading: "正在生成验证图片",
            moving: "松开完成验证",
            verifying: "正在验证",
            success: "验证通过",
            error: "验证失败，请重试",
          }}
          tipIcon={{
            default: <ShieldCheck aria-hidden="true" />,
            refresh: <RotateCw aria-hidden="true" />,
          }}
        />
      </div>

      {keyboardOpen ? (
        <div className={styles.keyboardPanel}>
          <label htmlFor={keyboardInputId}>拼图位置</label>
          <input
            id={keyboardInputId}
            type="range"
            min={0}
            max={RENDER_MAX_OFFSET}
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
          <span id={`${keyboardInputId}-hint`} className={styles.keyboardHint}>
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
      ) : null}

      {error ? (
        <div className={styles.errorRow} role="alert">
          <p className={styles.error}>{error}</p>
          <button
            type="button"
            className={styles.retry}
            onClick={retryVerification}
          >
            重新加载验证
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className={styles.cancel}
        onClick={() => {
          interactionCancelledRef.current = true;
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
