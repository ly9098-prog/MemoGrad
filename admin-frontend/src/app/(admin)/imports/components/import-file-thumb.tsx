"use client";

import { Image as ImageIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Renders a local image thumbnail for a queued File. The object URL is assigned
 * to the <img> inside the effect and revoked on cleanup, so React strict-mode
 * remounts never hand a revoked URL to the browser and long batches do not leak
 * blob handles.
 */
export function ImportFileThumb({
  file,
  className,
}: {
  file: File;
  className?: string;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isImage = file.type.startsWith("image/");

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !file.type.startsWith("image/")) return;

    const url = URL.createObjectURL(file);
    img.src = url;

    return () => {
      img.removeAttribute("src");
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <div className={cn("ice-thumb", className)} aria-hidden="true">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- object URL for a local File, not an optimizable remote asset
        <img ref={imgRef} alt="" />
      ) : (
        <span className="grid h-full w-full place-items-center text-[var(--v2-ink3)]">
          <ImageIcon className="h-4 w-4" strokeWidth={1.7} />
        </span>
      )}
    </div>
  );
}
