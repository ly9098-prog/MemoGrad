"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Same scroll owner and reduced-motion behavior as the exam detail workbench. */
export function ScrollToTop() {
  const anchor = useRef<HTMLSpanElement>(null);
  const container = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const owner = anchor.current?.closest("main");
    if (!owner) return;
    container.current = owner;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        setVisible(owner.scrollTop > 320);
        frame = 0;
      });
    };
    update();
    owner.addEventListener("scroll", update, { passive: true });
    return () => {
      owner.removeEventListener("scroll", update);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <>
      <span ref={anchor} hidden />
      {visible
        ? createPortal(
            <Button
              className="admin-content-theme fixed bottom-6 right-6 z-40 gap-2"
              variant="secondary"
              onClick={() =>
                container.current?.scrollTo({
                  top: 0,
                  behavior: matchMedia("(prefers-reduced-motion: reduce)")
                    .matches
                    ? "auto"
                    : "smooth",
                })
              }
              aria-label="返回页面顶部"
            >
              <ArrowUp size={16} aria-hidden="true" />
              返回顶部
            </Button>,
            document.body,
          )
        : null}
    </>
  );
}
