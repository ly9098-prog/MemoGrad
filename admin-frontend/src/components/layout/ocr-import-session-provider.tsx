"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createOcrImportSession } from "@/lib/imports/ocr-import-session";

const OcrImportContext = createContext<ReturnType<typeof createOcrImportSession> | null>(null);

export function OcrImportSessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session] = useState(() => createOcrImportSession((key) => {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }));
  useEffect(() => session.dispose, [session]);

  return <OcrImportContext.Provider value={session}>{children}</OcrImportContext.Provider>;
}

export function useOcrImportSession() {
  const session = useContext(OcrImportContext);
  if (!session) throw new Error("OCR import requires an authenticated admin session");
  return session;
}
