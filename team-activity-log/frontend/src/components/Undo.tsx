import { Button, Snackbar } from "@mui/material";
import { useCallback, useState, type ReactNode } from "react";
import { NotifyContext, type Notify } from "./notify";

// §A4 "Undo instead of confirm": one quiet message with an Undo action for ~8 s.
// Also used for the rare error that needs surfacing (no action, shorter).

interface Notice {
  key: number;
  message: string;
  undo?: () => void;
}

export function UndoProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const notify = useCallback<Notify>((message, undo) => setNotice({ key: Date.now(), message, undo }), []);
  const close = () => setNotice(null);
  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        key={notice?.key}
        open={!!notice}
        onClose={(_, reason) => reason !== "clickaway" && close()}
        autoHideDuration={notice?.undo ? 8000 : 4000}
        message={notice?.message}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        action={
          notice?.undo ? (
            <Button
              color="primary"
              size="small"
              onClick={() => {
                notice.undo?.();
                close();
              }}
            >
              Undo
            </Button>
          ) : undefined
        }
      />
    </NotifyContext.Provider>
  );
}
