"use client";

import { useId, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { CustomCheckbox } from "@/components/ui/custom-checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiRequest } from "@/lib/api/client";
import type { SyllabusCatalogItem } from "@/lib/api/types";
import {
  buildKnowledgeTree,
  outlineLabel,
  type KnowledgeBranch,
} from "@/lib/knowledge-outline";
import styles from "./knowledge-catalog-tree.module.css";

type Item = SyllabusCatalogItem;
type Branch = KnowledgeBranch<Item>;
type TreeProps = {
  items: Item[];
  selected: Set<number>;
  editable: boolean;
  canWrite: boolean;
  busy: boolean;
  initiallyOpen: boolean;
  onSelect: (ids: number[], checked: boolean) => void;
  onAdd: (parent: Item) => void;
  onEdit: (item: Item) => void;
  onSaved: () => Promise<unknown>;
};

function branchItems(branch: Branch): Item[] {
  return [branch.item, ...branch.children.flatMap(branchItems)];
}

function CatalogBranch({
  branch,
  controls,
  onDelete,
  onToggleActive,
  level = 0,
}: {
  branch: Branch;
  controls: TreeProps;
  onDelete: (item: Item) => void;
  onToggleActive: (item: Item) => void;
  level?: number;
}) {
  const [open, setOpen] = useState(controls.initiallyOpen);
  const childrenId = useId();
  const { item, children } = branch;
  const name = outlineLabel(item);
  const active = item.is_active !== false;
  const eligible = branchItems(branch).filter((p) => p.is_active !== false);
  const selectedCount = eligible.filter((p) =>
    controls.selected.has(p.knowledge_point_id),
  ).length;
  const checked = eligible.length > 0 && selectedCount === eligible.length;
  const mixed = selectedCount > 0 && !checked;
  const selectedSelf = controls.selected.has(item.knowledge_point_id);
  const actions = [
    {
      label: `添加子标签 ${name}`,
      Icon: Plus,
      run: () => controls.onAdd(item),
      disabled: !active,
    },
    {
      label: `编辑标签 ${name}`,
      Icon: Pencil,
      run: () => controls.onEdit(item),
    },
    {
      label: `删除标签 ${name}`,
      Icon: Trash2,
      run: () => onDelete(item),
      danger: true,
    },
    {
      label: `${active ? "禁用" : "启用"}标签 ${name}`,
      Icon: Power,
      run: () => onToggleActive(item),
    },
  ];
  return (
    <li className={styles.knowledgeBranch}>
      <div
        className={styles.knowledgeNode}
        data-root={level === 0}
        data-disabled={!active}
        data-selected={selectedSelf}
        data-excluded={!controls.editable && !selectedSelf ? "true" : undefined}
        title={!controls.editable && !selectedSelf ? "未纳入当前版本" : undefined}
      >
        {children.length ? (
          <button
            type="button"
            className={styles.knowledgeDisclosure}
            aria-label={`${open ? "收起" : "展开"}${name}`}
            aria-expanded={open}
            aria-controls={childrenId}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={open ? "rotate-90" : ""}
            />
          </button>
        ) : (
          <span className={styles.knowledgeLeaf} aria-hidden="true" />
        )}
        {controls.editable ? (
          <CustomCheckbox
            checked={checked}
            indeterminate={mixed}
            disabled={controls.busy || !active}
            aria-label={children.length ? `选择${name}及下级标签` : `选择${name}`}
            title={
              children.length
                ? "选择或取消此标签及当前目录显示的下级标签"
                : "选择或取消此标签"
            }
            className={styles.knowledgeCheckbox}
            onCheckedChange={(value) =>
              controls.onSelect(
                eligible.map((p) => p.knowledge_point_id),
                value,
              )
            }
          />
        ) : (
          <span aria-hidden="true" />
        )}
        <div className={styles.knowledgeNodeLabel}>
          <strong>{name}</strong>
          <small>
            {!active
              ? "已禁用"
              : children.length
                ? `${branchItems(branch).length - 1} 个下级标签`
                : `难度 ${item.difficulty_level}`}
          </small>
        </div>
        {controls.canWrite ? (
          <div
            className={styles.knowledgeActions}
            role="group"
            aria-label={`${name}的标签操作`}
          >
            {actions.map(({ label, Icon, run, disabled, danger }) => (
              <button
                key={label}
                type="button"
                title={label}
                aria-label={label}
                data-danger={danger}
                disabled={controls.busy || disabled}
                onClick={run}
              >
                <Icon size={14} strokeWidth={1.6} aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {children.length ? (
        <ul id={childrenId} className={styles.knowledgeChildren} hidden={!open}>
          {children.map((child) => (
            <CatalogBranch
              key={child.item.knowledge_point_id}
              branch={child}
              controls={controls}
              onDelete={onDelete}
              onToggleActive={onToggleActive}
              level={level + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function KnowledgeCatalogTree(props: TreeProps) {
  const roots = useMemo(() => buildKnowledgeTree(props.items), [props.items]);
  const [deleting, setDeleting] = useState<Item | null>(null);
  const mutation = useMutation({
    mutationFn: ({
      item,
      action,
    }: {
      item: Item;
      action: "delete" | "toggle";
    }) =>
      apiRequest(
        `/knowledge/syllabus/catalog/knowledge-points/${item.knowledge_point_id}`,
        {
          method: action === "delete" ? "DELETE" : "PATCH",
          exposeErrorDetail: true,
          ...(action === "toggle"
            ? {
                body: JSON.stringify({ is_active: item.is_active === false }),
              }
            : {}),
        },
      ),
    onSuccess: async () => {
      await props.onSaved();
      setDeleting(null);
    },
  });
  const controls = { ...props, busy: props.busy || mutation.isPending };
  return (
    <>
      {mutation.isError && !deleting ? (
        <p role="alert" className={styles.knowledgeError}>
          {mutation.error.message}
        </p>
      ) : null}
      <ul className={styles.knowledgeTree} aria-label="知识点标签目录">
        {roots.map((branch) => (
          <CatalogBranch
            key={branch.item.knowledge_point_id}
            branch={branch}
            controls={controls}
            onDelete={(item) => {
              mutation.reset();
              setDeleting(item);
            }}
            onToggleActive={(item) =>
              mutation.mutate({ item, action: "toggle" })
            }
          />
        ))}
      </ul>
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`删除「${deleting ? outlineLabel(deleting) : ""}」？`}
        description="仅可删除没有子节点且未被题目、考纲或学习记录引用的标签。已有引用时请使用禁用。"
        confirmText="确认删除标签"
        danger
        loading={mutation.isPending}
        onCancel={() => {
          mutation.reset();
          setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting) mutation.mutate({ item: deleting, action: "delete" });
        }}
      >
        {mutation.isError ? (
          <p role="alert" className={styles.knowledgeError}>
            {mutation.error.message}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
