import { useEffect, useState } from "react";
import {
  BackendHealthView,
  BackendView,
  PermissionSet,
  fetchBackends,
  testBackendHealth,
  updateBackend
} from "../lib/api";

export function useSettingsScreen() {
  const [backends, setBackends] = useState<BackendView[]>([]);
  const [selectedId, setSelectedId] = useState("backend_codex");
  const [health, setHealth] = useState<Record<string, BackendHealthView>>({});
  const [settingsStatus, setSettingsStatus] = useState<"loading" | "live" | "offline">("loading");

  useEffect(() => {
    void loadBackends();
  }, []);

  async function loadBackends() {
    try {
      const nextBackends = await fetchBackends();
      setBackends(nextBackends);
      setSelectedId(nextBackends.find((backend) => backend.is_default)?.id ?? nextBackends[0]?.id ?? "backend_codex");
      setSettingsStatus("live");
    } catch {
      setBackends([]);
      setSettingsStatus("offline");
    }
  }

  async function setDefaultBackend(backendId: string) {
    const updated = await updateBackend(backendId, { is_default: true });
    setBackends((current) => current.map((backend) => ({ ...backend, is_default: backend.id === updated.id })));
    setSelectedId(updated.id);
  }

  async function testBackend(backendId: string) {
    const result = await testBackendHealth(backendId);
    setHealth((current) => ({ ...current, [backendId]: result }));
  }

  async function togglePermission(backend: BackendView, key: keyof PermissionSet) {
    const permissions: PermissionSet = backend.permissions ?? {
      auto_run_readonly: false,
      allow_file_edits: false,
      network_access: false
    };
    const updatedPermissions = {
      ...permissions,
      [key]: !permissions[key]
    };
    const updated = await updateBackend(backend.id, { permissions: updatedPermissions });
    setBackends((current) => current.map((item) => item.id === backend.id ? updated : item));
  }

  const selected = backends.find((backend) => backend.id === selectedId) ?? backends[0];
  const defaultBackend = backends.find((backend) => backend.is_default);

  return {
    backends,
    selectedId,
    setSelectedId,
    health,
    settingsStatus,
    loadBackends,
    setDefaultBackend,
    testBackend,
    togglePermission,
    selected,
    defaultBackend
  };
}
