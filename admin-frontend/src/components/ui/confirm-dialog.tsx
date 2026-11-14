"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  /** Prevent submission while inline validation is incomplete. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const loadingRef = useRef(loading);

  useEffect(() => {
    onCancelRef.current = onCancel;
    loadingRef.current = loading;
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loadingRef.current) onCancelRef.current();
      }}
    >
      <DialogContent
        ref={dialogRef}
        showCloseButton={false}
        data-confirm-dialog="true"
        onEscapeKeyDown={(event) => {
          if (loadingRef.current) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (loadingRef.current) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          previousFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const content = dialogRef.current;
          const preferred = content?.querySelector<HTMLElement>("[autofocus]");
          event.preventDefault();
          (preferred ?? content)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (previousFocusRef.current?.isConnected) {
            event.preventDefault();
            previousFocusRef.current.focus();
          }
        }}
      >
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        {children ? <div className="mt-4">{children}</div> : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
          <Button
            className={cn(loading && "cursor-wait")}
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
          >
            {loading ? "处理中..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
