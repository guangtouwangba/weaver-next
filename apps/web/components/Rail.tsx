import { FileText, Grid2X2, GitBranch, Settings2 } from "lucide-react";
import { Screen } from "../lib/types";

export function Rail({ screen, setScreen }: { screen: Screen; setScreen: (screen: Screen) => void }) {
  const nav = [
    { id: "workspace" as Screen, icon: Grid2X2, label: "Workspace" },
    { id: "think" as Screen, icon: GitBranch, label: "Thinking tree" },
    { id: "draft" as Screen, icon: FileText, label: "Draft" }
  ];

  return (
    <aside className="rail">
      <button className="logo" onClick={() => setScreen("workspace")} aria-label="Weaver home">W</button>
      <div className="rail-nav">
        {nav.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className={`rail-button ${screen === item.id ? "active" : ""}`} onClick={() => setScreen(item.id)} title={item.label} aria-label={item.label}>
              <Icon size={18} />
            </button>
          );
        })}
      </div>
      <div className="rail-bottom">
        <button className={`rail-button ${screen === "settings" ? "active" : ""}`} onClick={() => setScreen("settings")} title="Settings" aria-label="Settings">
          <Settings2 size={18} />
        </button>
        <button className="avatar" aria-label="Account">JL</button>
      </div>
    </aside>
  );
}
