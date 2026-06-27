import { useRef } from "react";
import type { ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";
import { Cluster } from "./Layout";
import { Modal } from "./Modal";

type ConfirmVariant = Exclude<ButtonVariant, "link">;

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  confirmVariant?: ConfirmVariant;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "ยกเลิก",
  confirmVariant = "primary",
  busy = false,
  onCancel,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={title}
      description={description}
      closeOnEsc={!busy}
      closeOnBackdrop={!busy}
      initialFocusRef={cancelRef}
      footer={
        <Cluster justify="end" gap={2}>
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={() => void onConfirm()}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </Cluster>
      }
    >
      {children}
    </Modal>
  );
}
