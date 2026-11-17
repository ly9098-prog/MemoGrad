"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function BodyPortal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? children : createPortal(children, document.body);
}
