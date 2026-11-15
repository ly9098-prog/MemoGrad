"use client";

import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api/client";
import type { FormulaCategoryNode } from "@/components/formulas/formula-category-picker";

type Props = {
  parentNode: FormulaCategoryNode | null; // null = create subject
  onClose: () => void;
};

export function FormulaCategoryDialog({ parentNode, onClose }: Props) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  // Determine node_type based on parent
  const nodeType = !parentNode
    ? "subject"
    : parentNode.node_type === "subject"
      ? "chapter"
      : parentNode.node_type === "chapter"
        ? "group"
        : null; // group can't have children

  const title = !parentNode
    ? "新建科目"
    : parentNode.node_type === "subject"
      ? `新建章节（属于：${parentNode.name}）`
      : parentNode.node_type === "chapter"
        ? `新建分组（属于：${parentNode.name}）`
        : "";

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!code.trim()) throw new Error("请填写编码");
      if (!name.trim()) throw new Error("请填写名称");

      return apiRequest("/formulas/categories", {
        method: "POST",
        body: JSON.stringify({
          parent_id: parentNode?.id ?? null,
          code: code.trim(),
          name: name.trim(),
          node_type: nodeType,
          exam_scope: parentNode?.exam_scope || "math2",
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-formula-categories"] });
      onClose();
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "创建失败");
    },
  });

  const handleSubmit = useCallback(() => {
    setError("");
    createMutation.mutate();
  }, [createMutation]);

  if (!nodeType) {
    // group can't have children
    return null;
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="admin-content-theme max-w-md">
        <DialogHeader className="pr-8">
          <DialogTitle className="font-sans text-lg font-bold">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            创建公式分类节点并设置编码和名称。
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="formula-category-code" className="text-xs font-semibold text-muted-foreground">编码（英文）*</label>
            <Input
              id="formula-category-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例如：chapter1_limits"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="formula-category-name" className="text-xs font-semibold text-muted-foreground">名称 *</label>
            <Input
              id="formula-category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：函数、极限与连续"
            />
          </div>

          <div className="inline-flex items-center gap-1.5 rounded-lg border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <span className="font-semibold">类型：</span>
            {nodeType === "subject" ? "科目" : nodeType === "chapter" ? "章节" : "分组"}
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              <Save className="h-3.5 w-3.5" />
              {createMutation.isPending ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
