import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

function token(name: string) {
  const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing color token: --${name}`);
  return match[1];
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("semantic color contrast", () => {
  it.each([
    ["foreground", "background"],
    ["foreground", "card"],
    ["muted-foreground", "background"],
    ["muted-foreground", "card"],
    ["muted-foreground", "muted"],
    ["accent-foreground", "accent"],
    ["primary-foreground", "primary"],
    ["success", "success-light"],
    ["success-foreground", "success"],
    ["warning-foreground", "warning-light"],
    ["destructive", "destructive-light"],
    ["destructive-foreground", "destructive"],
    ["destructive-foreground", "destructive-hover"],
  ])("%s on %s meets WCAG AA", (foreground, background) => {
    expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });
});
