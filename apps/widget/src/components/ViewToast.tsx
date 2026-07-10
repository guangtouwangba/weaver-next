import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

export function ViewToast({ viewToast, setViewToast, restoreProjectView }: { viewToast: { message: string; undoViewId?: string } | null; setViewToast: Dispatch<SetStateAction<{ message: string; undoViewId?: string } | null>>; restoreProjectView: (viewId: string) => void | Promise<void> }) {
  if (!viewToast) return null;
  return <div className="view-toast" role="status">
    <span>{viewToast.message}</span>
    {viewToast.undoViewId ? <button onClick={() => { void restoreProjectView(viewToast.undoViewId!); setViewToast(null); }}>Undo</button> : null}
    <button aria-label="Dismiss notification" onClick={() => setViewToast(null)}><X size={13} /></button>
  </div>;
}
