import { useState, type ReactNode } from "react";

export type ConfirmState = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({ state, onClose }: { state: ConfirmState | null; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  if (!state) return null;
  return (
    <div className="dx-modal-overlay" onClick={() => !working && onClose()}>
      <div className="dx-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h3 className="dx-modal-title">{state.title}</h3>
        <div className="dx-modal-body">{state.body}</div>
        <div className="dx-modal-actions">
          <button className="btn btn-sm" disabled={working} onClick={onClose}>Cancel</button>
          <button
            className={`btn btn-sm ${state.danger ? "btn-danger" : "btn-primary"}`}
            disabled={working}
            onClick={async () => {
              setWorking(true);
              try {
                await state.onConfirm();
                onClose();
              } finally {
                setWorking(false);
              }
            }}
          >
            {working ? "Working…" : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
