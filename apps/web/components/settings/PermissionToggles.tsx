import type { PermissionSet } from "../../lib/api";

type PermissionTogglesProps = {
  permissions?: PermissionSet;
  onToggle: (key: keyof PermissionSet) => void;
};

export function PermissionToggles({ permissions, onToggle }: PermissionTogglesProps) {
  return (
    <div className="permission-grid">
      <PermissionToggle
        label="Auto-run read-only"
        active={Boolean(permissions?.auto_run_readonly)}
        onClick={() => onToggle("auto_run_readonly")}
      />
      <PermissionToggle
        label="Allow file edits"
        active={Boolean(permissions?.allow_file_edits)}
        onClick={() => onToggle("allow_file_edits")}
      />
      <PermissionToggle
        label="Network access"
        active={Boolean(permissions?.network_access)}
        onClick={() => onToggle("network_access")}
      />
    </div>
  );
}

function PermissionToggle({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`permission-toggle ${active ? "active" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <span className={`mini-switch ${active ? "on" : ""}`} />
    </button>
  );
}
