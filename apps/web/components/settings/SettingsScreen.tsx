import { ChevronDown, Loader2, RefreshCw, Zap } from "lucide-react";
import { useSettingsScreen } from "../../hooks/useSettingsScreen";
import { fallbackBackends } from "../../lib/fallback-data";
import { ApiStatus } from "../../lib/api";
import { PermissionToggles } from "./PermissionToggles";
import { SettingRow } from "./SettingRow";
import { AgentRow } from "./AgentRow";

export function SettingsScreen({ apiStatus, isTesting, onTest }: { apiStatus: ApiStatus; isTesting: boolean; onTest: () => void }) {
  const {
    backends,
    health,
    settingsStatus,
    loadBackends,
    setDefaultBackend,
    testBackend,
    togglePermission,
    selected,
    defaultBackend,
    setSelectedId
  } = useSettingsScreen();

  return (
    <section className="settings-page">
      <p className="eyebrow">SETTINGS</p>
      <h1>Project & model</h1>
      <section className="settings-card">
        <h2>Model</h2>
        <p>Used for branch answers and draft generation.</p>
        <SettingRow title="Reasoning model" description="Drives forking, merge detection, gap-finding.">
          <button className="select-button">{defaultBackend?.name ?? "No backend"} <ChevronDown size={13} /></button>
        </SettingRow>
        <SettingRow title="Context isolation per branch" description="Each branch only inherits its ancestor lineage.">
          <button className="toggle on" aria-label="Context isolation on"><span /></button>
        </SettingRow>
      </section>
      <section className="settings-card">
        <div className="settings-heading">
          <div><h2>Coding agents <span className="mono-pill">{backends.length || 4} detected</span> <span className={`connection-pill ${settingsStatus}`}>{settingsStatus === "live" ? "api live" : settingsStatus === "loading" ? "syncing" : "offline sample"}</span></h2><p>Weaver found these CLIs on your machine. Connect one to run agentic tasks straight from a branch.</p></div>
          <button className="ghost-button" onClick={() => void loadBackends()}><RefreshCw size={15} /> Rescan</button>
        </div>
        {(backends.length ? backends : fallbackBackends()).map((backend) => (
          backend.id === selected?.id ? (
            <div className="agent-expanded" key={backend.id}>
              <AgentRow backend={backend} health={health[backend.id]} onSelect={() => setSelectedId(backend.id)} onTest={() => void testBackend(backend.id)} />
              <SettingRow title="Model" description='Model list comes from this CLI. "Default" keeps the CLI own setting.'>
                <span className="live-pill">{health[backend.id]?.ok ? `${health[backend.id]?.latency_ms}ms` : "Live from CLI"}</span>
              </SettingRow>
              <button className="wide-select">{backend.model} <ChevronDown size={13} /></button>
              <label>Reasoning effort</label>
              <button className="wide-select">Default <ChevronDown size={13} /></button>
              {backend.kind === "cli_agent" ? (
                <PermissionToggles permissions={backend.permissions} onToggle={(key) => void togglePermission(backend, key)} />
              ) : null}
              <div className="agent-actions">
                <button onClick={() => void setDefaultBackend(backend.id)}>{backend.is_default ? "Default backend" : "Set as default"}</button>
                <button onClick={onTest} className={apiStatus.ok ? "ok" : ""}>
                  {isTesting ? <Loader2 size={15} className="spin" /> : <Zap size={15} />}
                  {apiStatus.label}
                </button>
              </div>
              {health[backend.id] ? <p className="health-line">{health[backend.id].detail}</p> : null}
            </div>
          ) : (
            <AgentRow key={backend.id} backend={backend} health={health[backend.id]} onSelect={() => setSelectedId(backend.id)} onTest={() => void testBackend(backend.id)} />
          )
        ))}
        {!backends.length && settingsStatus === "offline" ? (
          <div className="outline-empty">Backend API offline. The screen is showing the prototype sample state.</div>
        ) : null}
      </section>
    </section>
  );
}
