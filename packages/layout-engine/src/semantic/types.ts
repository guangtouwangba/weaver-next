import type { LayoutDirection } from "@weaver/contracts";

/** A detected semantic cluster. `hubId` is the prominent member (enlarged, centered). */
export interface Cluster {
  id: string;
  label: string;
  memberIds: string[];
  hubId?: string;
  /** The single graph-wide center node stands alone at the macro center, rendered
   * without a heavy group box (isCenter). */
  isCenter?: boolean;
  /** Whether the hub is genuinely dominant (center, emphasized, or strictly
   * higher degree than its clustermates) — only then is it enlarged. A flat
   * cluster where every member has equal degree enlarges no one. */
  hubProminent?: boolean;
}

/** `plan.constraints` distilled into the subset the semantic layout actually honors. */
export interface NormalizedConstraints {
  emphasisIds: string[];
  groups: Array<{ label: string; nodeIds: string[] }>;
  separations: Array<[string, string]>;
  direction: LayoutDirection;
  spacingMultiplier: number;
  fixedIds: Set<string>;
  preserveManualGroups: boolean;
}

export type MicroVariant = "radial" | "rows";
export type MacroVariant = "force" | "grid";
