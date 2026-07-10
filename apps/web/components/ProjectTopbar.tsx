import { ArrowDownToLine, ArrowRight, RefreshCw } from "lucide-react";
import { Screen, Voice } from "../lib/types";

export function ProjectTopbar({
  active,
  branchCount,
  nodeCount,
  onExport,
  onRegenerate,
  setScreen,
  voice
}: {
  active: "think" | "draft";
  branchCount?: number;
  nodeCount?: number;
  onExport?: () => void;
  onRegenerate?: () => void;
  setScreen: (screen: Screen) => void;
  voice?: Voice;
}) {
  return (
    <header className="project-topbar">
      <div>
        <h1>Subscription fatigue & independent media</h1>
        <p>{active === "think" ? `${nodeCount ?? 7} visible nodes - ${branchCount ?? 3} branches` : "Article - 119 words"}</p>
      </div>
      <div className="topbar-actions">
        <div className="segmented">
          <button className={active === "think" ? "active" : ""} onClick={() => setScreen("think")}>Think</button>
          <button className={active === "draft" ? "active" : ""} onClick={() => setScreen("draft")}>Draft</button>
        </div>
        {voice ? <span className="voice-indicator">VOICE <strong>{voice}</strong></span> : <span className="voice-indicator">VOICE <strong>Professional</strong></span>}
        {active === "think" ? (
          <button className="primary-button" onClick={() => setScreen("draft")}>Draft from branches <ArrowRight size={16} /></button>
        ) : (
          <>
            <button className="ghost-button" onClick={onRegenerate}><RefreshCw size={15} /> Regenerate</button>
            <button className="primary-button" onClick={onExport}><ArrowDownToLine size={16} /> Export .md</button>
          </>
        )}
      </div>
    </header>
  );
}
