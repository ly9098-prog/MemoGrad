"use client";

import {
  type FormEvent,
  useCallback,
  useRef,
  useState,
} from "react";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { ResendCodeButton } from "@/components/auth/resend-code-button";
import { SliderCaptcha } from "@/components/security/slider-captcha";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/ui/otp-input";
import type { ApiScope } from "@/lib/api/client";
import styles from "@/app/(auth)/login/login.module.css";

export type EmailOtpStartResult = {
  challenge_id: string;
  resend_after: number;
};

type EmailOtpLoginFormProps<TVerify> = {
  idPrefix: string;
  emailLabel: string;
  emailPlaceholder?: string;
  codeLabel?: string;
  startLabel?: string;
  noteText?: string;
  codeSentMessage?: string;
  scope: ApiScope;
  active: boolean;
  disabled?: boolean;
  ensureConsent?: (resume: () => void) => boolean;
  start: (input: {
    email: string;
    captchaTicket: string;
  }) => Promise<EmailOtpStartResult>;
  verify: (input: {
    challengeId: string;
    code: string;
  }) => Promise<TVerify>;
  onVerified: (response: TVerify) => void | Promise<void>;
  formatError: (error: unknown) => string;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
};

export function EmailOtpLoginForm<TVerify>({
  idPrefix,
  emailLabel,
  emailPlaceholder = "name@example.com",
  codeLabel = "6 位邮箱验证码",
  startLabel = "发送登录验证码",
  noteText = "验证码仅用于本次登录，请勿转发给他人。",
  codeSentMessage = "验证码已发送，5 分钟内有效。请勿转发给他人。",
  scope,
  active,
  disabled = false,
  ensureConsent,
  start,
  verify,
  onVerified,
  formatError,
  onError,
  onInfo,
  onBusyChange,
}: EmailOtpLoginFormProps<TVerify>) {
  const emailInputId = `${idPrefix}-email`;
  const codeInputId = `${idPrefix}-email-code`;
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");
  const [resendAfter, setResendAfter] = useState(0);
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [busy, setBusyState] = useState(false);
  const autoSubmittedCodeRef = useRef("");
  const emailCodeSent = Boolean(challengeId);
  const formDisabled = disabled || busy;

  const setBusy = useCallback(
    (value: boolean) => {
      setBusyState(value);
      onBusyChange?.(value);
    },
    [onBusyChange],
  );

  function openCaptcha() {
    if (formDisabled || captchaOpen) return;
    if (!email.trim()) {
      onError(`请输入${emailLabel}`);
      return;
    }
    setCaptchaOpen(true);
  }

  function requestCode() {
    if (formDisabled || captchaOpen) return;
    if (ensureConsent && !ensureConsent(openCaptcha)) return;
    openCaptcha();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formDisabled || captchaOpen) return;
    if (emailCodeSent) {
      void verifyCode();
      return;
    }
    requestCode();
  }

  async function handleCaptchaVerified(ticket: string) {
    setCaptchaOpen(false);
    setBusy(true);
    try {
      const response = await start({
        email: email.trim(),
        captchaTicket: ticket,
      });
      setChallengeId(response.challenge_id);
      setResendAfter(response.resend_after);
      setCode("");
      setSentEmail(email.trim());
      autoSubmittedCodeRef.current = "";
      onInfo(codeSentMessage);
    } catch (submitError) {
      onError(formatError(submitError));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(submittedCode = code) {
    if (formDisabled || submittedCode.length !== 6 || !challengeId) return;
    setBusy(true);
    try {
      const response = await verify({
        challengeId,
        code: submittedCode,
      });
      await onVerified(response);
    } catch (submitError) {
      autoSubmittedCodeRef.current = "";
      onError(formatError(submitError));
    } finally {
      setBusy(false);
    }
  }

  function resetEmailChallenge() {
    setChallengeId("");
    setCode("");
    autoSubmittedCodeRef.current = "";
  }

  return (
    <>
      <form
        className={`${styles.form} ${styles.emailForm}`}
        onSubmit={handleSubmit}
        inert={!active}
        aria-hidden={!active}
        aria-busy={busy}
      >
        <div className={styles.field}>
          <label htmlFor={emailInputId}>{emailLabel}</label>
          <div className={styles.inputShell}>
            <Mail className={styles.fieldIcon} aria-hidden="true" />
            <Input
              id={emailInputId}
              variant="ghost"
              className={styles.input}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={emailPlaceholder}
              required
              disabled={formDisabled || captchaOpen || emailCodeSent}
            />
          </div>
        </div>
        <div className={styles.field}>
          <div className={styles.fieldLabel}>
            <label htmlFor={codeInputId}>{codeLabel}</label>
            {emailCodeSent ? (
              <span className={styles.fieldMeta} title={sentEmail}>
                {busy ? (
                  <>
                    <Loader2 className={styles.spinner} aria-hidden="true" />
                    正在验证
                  </>
                ) : (
                  <>已发送至 {sentEmail}</>
                )}
              </span>
            ) : null}
          </div>
          <OtpInput
            id={codeInputId}
            name={codeInputId}
            value={code}
            onChange={(value) => {
              setCode(value);
              if (!emailCodeSent || value.length !== 6) return;
              const submission = `${challengeId}:${value}`;
              if (autoSubmittedCodeRef.current === submission) return;
              autoSubmittedCodeRef.current = submission;
              void verifyCode(value);
            }}
            disabled={formDisabled || captchaOpen || !emailCodeSent}
            required
          />
        </div>
        {emailCodeSent ? (
          <div className={`${styles.otpActions} ${styles.otpActionsWithNote}`}>
            <button
              type="button"
              className={styles.backButton}
              disabled={formDisabled}
              onClick={resetEmailChallenge}
            >
              修改邮箱
            </button>
            <ResendCodeButton
              key={challengeId}
              seconds={resendAfter}
              busy={formDisabled}
              onResend={requestCode}
            />
            <span className={styles.otpFootnote}>
              <ShieldCheck aria-hidden="true" />
              {noteText}
            </span>
          </div>
        ) : (
          <button
            type="submit"
            className={styles.submit}
            disabled={formDisabled || captchaOpen || !email.trim()}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <Loader2 className={styles.spinner} aria-hidden="true" />
                <span>正在发送</span>
              </>
            ) : (
              <>
                <span>{startLabel}</span>
                <Mail aria-hidden="true" />
              </>
            )}
          </button>
        )}
      </form>
      <Dialog open={captchaOpen} onOpenChange={setCaptchaOpen}>
        <DialogContent
          className={styles.captchaDialog}
          overlayClassName={styles.loginDialogOverlay}
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">完成安全验证</DialogTitle>
          <DialogDescription className="sr-only">
            拖动滑块，将拼图移到图片缺口处。
          </DialogDescription>
          <SliderCaptcha
            scope={scope}
            purpose="login"
            email={email.trim()}
            onCancel={() => setCaptchaOpen(false)}
            onVerified={(ticket) => void handleCaptchaVerified(ticket)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
