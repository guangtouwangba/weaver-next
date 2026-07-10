import { BackendHealthView, BackendView } from "../../lib/api";

export function AgentRow({
  backend,
  health,
  onSelect,
  onTest
}: {
  backend: BackendView;
  health?: BackendHealthView;
  onSelect: () => void;
  onTest: () => void;
}) {
  const vendor = `${backend.provider[0]?.toUpperCase() ?? ""}${backend.provider.slice(1)} ${backend.kind === "cli_agent" ? "official CLI" : "provider"}`;
  return (
    <div className="agent-row">
      <button className="agent-icon" onClick={onSelect}>{backend.name.startsWith("Claude") ? "*" : backend.kind === "fake" ? "F" : ">_"}</button>
      <button className="agent-copy" onClick={onSelect}>
        <strong>{backend.name}</strong><span> - {vendor}</span><p>{backend.version}</p>
      </button>
      {backend.is_default ? <span className="mono-pill">DEFAULT</span> : <button onClick={onTest}>{health?.ok ? "OK" : "Test"}</button>}
    </div>
  );
}
