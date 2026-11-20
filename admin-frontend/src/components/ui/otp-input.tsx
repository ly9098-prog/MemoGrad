"use client";

import type { Ref } from "react";
import {
  OTPInput,
  REGEXP_ONLY_DIGITS,
  type SlotProps,
} from "input-otp";
import styles from "./otp-input.module.css";

type OtpInputProps = {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  ariaLabel?: string;
  theme?: "dark" | "light";
};

function OtpSlot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div
      className={styles.slot}
      data-active={isActive || undefined}
      data-filled={char !== null || undefined}
    >
      <span>{char ?? ""}</span>
      {hasFakeCaret ? <span className={styles.caret} aria-hidden="true" /> : null}
    </div>
  );
}

export function OtpInput({
  id,
  name,
  value,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  required = false,
  inputRef,
  ariaLabel,
  theme = "dark",
}: OtpInputProps) {
  return (
    <OTPInput
      ref={inputRef}
      id={id}
      name={name}
      value={value}
      onChange={onChange}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      containerClassName={`${styles.container} ${
        theme === "light" ? styles.light : ""
      }`}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      pushPasswordManagerStrategy="increase-width"
      render={({ slots }) => (
        <div className={styles.slots} aria-hidden="true">
          {slots.map((slot, index) => (
            <OtpSlot key={index} {...slot} />
          ))}
        </div>
      )}
    />
  );
}
