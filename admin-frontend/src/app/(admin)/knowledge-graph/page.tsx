"use client";

import "./knowledge-graph.css";
import KnowledgeGraphWorkspace from "./graph-workspace";
import { useAuthStore } from "@/lib/auth/auth-store";

export default function KnowledgeGraphPage() {
  const accessMode = useAuthStore((state) => state.accessMode);
  return (
    <KnowledgeGraphWorkspace
      readOnly={accessMode === "user"}
      apiBasePath="/knowledge"
    />
  );
}
