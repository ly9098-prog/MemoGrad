"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WorkspaceSelect, workspaceStyles as ws } from "./workspace";
import { apiRequest } from "@/lib/api/client";
import type { SyllabusCatalogItem } from "@/lib/api/types";
import { outlineLabel } from "@/lib/knowledge-outline";
import styles from "./knowledge-label-editor.module.css";

export function KnowledgeLabelEditor({
  item,
  parent,
  catalog,
  onClose,
  onSaved,
}: {
  item: SyllabusCatalogItem | null;
  parent?: SyllabusCatalogItem;
  catalog: SyllabusCatalogItem[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    subject_id: String(
      item?.subject_id ?? parent?.subject_id ?? catalog[0]?.subject_id ?? "",
    ),
    name: item?.name ?? "",
    description: item?.description ?? "",
    difficulty_level: String(item?.difficulty_level ?? 3),
    parent_knowledge_point_id: parent ? String(parent.knowledge_point_id) : "",
  });
  const subjects = [
    ...new Map(
      catalog.map((p) => [
        p.subject_id,
        { value: String(p.subject_id), label: p.subject_name },
      ]),
    ).values(),
  ];
  const selectedSubject =
    subjects.find((subject) => subject.value === form.subject_id)?.label ??
    "未选择科目";
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(
        `/knowledge/syllabus/catalog/knowledge-points${item ? `/${item.knowledge_point_id}` : ""}`,
        {
          method: item ? "PATCH" : "POST",
          exposeErrorDetail: true,
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            difficulty_level: Number(form.difficulty_level),
            ...(item
              ? {}
              : {
                  subject_id: Number(form.subject_id),
                  parent_knowledge_point_id:
                    Number(form.parent_knowledge_point_id) || null,
                }),
          }),
        },
      ),
    onSuccess: async () => {
      await onSaved();
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent
        className={`admin-content-theme ${ws.overlay} ${styles.dialog}`}
      >
        <DialogHeader className={styles.header}>
          <DialogTitle className={styles.title}>
            {item ? "编辑知识点标签" : "新增知识点标签"}
          </DialogTitle>
          <DialogDescription className={styles.description}>
            {item
              ? "更新目录中的显示信息，不影响已保存的考纲快照。"
              : "新标签保存后，可在当前草稿中纳入考纲范围。"}
          </DialogDescription>
          {item ? (
            <div className={styles.context} aria-label="标签位置">
              <span>{selectedSubject}</span>
              <i aria-hidden="true" />
              <span>
                {item.outline_path?.slice(1, -1).join(" / ") ||
                  item.chapter_name ||
                  "独立标签"}
              </span>
            </div>
          ) : null}
        </DialogHeader>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          {!item ? (
            <div className={styles.splitFields}>
              <label className={styles.field}>
                <span>科目</span>
                <WorkspaceSelect
                  aria-label="标签所属科目"
                  disabled={mutation.isPending}
                  clearable={false}
                  value={form.subject_id}
                  options={subjects}
                  onChange={(subject_id) =>
                    setForm((value) => ({
                      ...value,
                      subject_id,
                      parent_knowledge_point_id: "",
                    }))
                  }
                />
              </label>
              <label className={styles.field}>
                <span>父标签</span>
                <WorkspaceSelect
                  aria-label="父标签"
                  disabled={mutation.isPending}
                  value={form.parent_knowledge_point_id}
                  placeholder="作为独立节点"
                  onChange={(parent_knowledge_point_id) =>
                    setForm((value) => ({
                      ...value,
                      parent_knowledge_point_id,
                    }))
                  }
                  options={catalog
                    .filter(
                      (point) =>
                        String(point.subject_id) === form.subject_id &&
                        point.is_active !== false,
                    )
                    .map((point) => ({
                      value: String(point.knowledge_point_id),
                      label: (point.outline_path ?? [outlineLabel(point)]).join(
                        " / ",
                      ),
                    }))}
                />
              </label>
            </div>
          ) : null}
          <label className={styles.field}>
            <span>名称</span>
            <Input
              className={styles.control}
              aria-label="标签名称"
              required
              maxLength={128}
              value={form.name}
              disabled={mutation.isPending}
              onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>说明</span>
            <textarea
              aria-label="标签说明"
              className={styles.textarea}
              maxLength={4000}
              value={form.description}
              disabled={mutation.isPending}
              onChange={(e) =>
                setForm((v) => ({ ...v, description: e.target.value }))
              }
            />
          </label>
          <fieldset className={styles.field}>
            <legend>难度</legend>
            <div
              className={styles.difficulty}
              role="group"
              aria-label="标签难度"
            >
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  type="button"
                  aria-label={`难度 ${level} 级`}
                  aria-pressed={form.difficulty_level === String(level)}
                  disabled={mutation.isPending}
                  onClick={() =>
                    setForm((value) => ({
                      ...value,
                      difficulty_level: String(level),
                    }))
                  }
                >
                  {level}
                </button>
              ))}
            </div>
          </fieldset>
          {mutation.isError ? (
            <p role="alert" className={styles.error}>
              {mutation.error.message}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              type="button"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              取消
            </Button>
            <Button
              type="submit"
              disabled={
                mutation.isPending || !form.name.trim() || !form.subject_id
              }
            >
              {mutation.isPending ? "保存中…" : "保存标签"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
