export function SourceCard({ icon, title, meta, cites, expanded = false }: { icon: string; title: string; meta: string; cites: string; expanded?: boolean }) {
  return (
    <div className={`source-card ${expanded ? "expanded" : ""}`}>
      <div className="source-row">
        <span className="source-icon">{icon}</span>
        <div><strong>{title}</strong><p>{meta}</p></div>
        <span className="cite-pill">{cites}</span>
      </div>
      {expanded ? <div className="quote-block">The binding constraint on media is no longer money but waking hours.<br /><br />Every new subscription competes not with a wallet but with sleep.</div> : null}
    </div>
  );
}
