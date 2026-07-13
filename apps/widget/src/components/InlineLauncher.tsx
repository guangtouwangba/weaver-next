import { Maximize2 } from "lucide-react";

export function InlineLauncher({ projectTitle, status, labels, onOpen }: {
  projectTitle?: string;
  status: string;
  labels: { currentSpace: string; spaceFallback: string; brandSubtitle: string; reopen: string; collapsed: string; hint: string };
  onOpen: () => void;
}) {
  return <main className="inline-entry" aria-label="Weaver">
    <header>
      <div className="inline-brand"><span>W</span><div><strong>Weaver</strong><small>{labels.brandSubtitle}</small></div></div>
      <div className="inline-context"><span>{labels.currentSpace}</span><strong>{projectTitle || labels.spaceFallback}</strong><i data-live="true" /></div>
      <button className="inline-open" type="button" onClick={onOpen}><Maximize2 size={15} />{labels.reopen}</button>
    </header>
    <div className="inline-reopen-copy">
      <div className="inline-reopen-mark">W</div>
      <strong>{projectTitle || labels.spaceFallback}</strong>
      <p>{labels.collapsed}</p>
    </div>
    <footer><span>{status}</span><span>{labels.hint}</span></footer>
  </main>;
}
