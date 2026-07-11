import type { LayoutDocument, LayoutPlan, NodeLayout } from "@weaver/contracts";
import type { NormalizedConstraints } from "./types.js";

/**
 * Distill a LayoutPlan's constraint list into the typed subset the semantic
 * cluster layout consumes: emphasis (hub override), group (forced clusters),
 * separation (must-split pairs), direction, spacing, and fixed/pinned obstacles.
 * Every other constraint type is intentionally ignored (documented in the
 * capabilities tool). Pure and order-stable.
 */
export function normalizeConstraints(plan: LayoutPlan, current: LayoutDocument): NormalizedConstraints {
  const emphasisIds: string[] = [];
  const groups: Array<{ label: string; nodeIds: string[] }> = [];
  const separations: Array<[string, string]> = [];
  const fixedIds = new Set<string>();
  let spacingMultiplier = 1;

  for (const constraint of plan.constraints) {
    switch (constraint.type) {
      case "emphasis":
        for (const id of constraint.nodeIds) if (!emphasisIds.includes(id)) emphasisIds.push(id);
        break;
      case "group":
        if (constraint.nodeIds.length) groups.push({ label: typeof constraint.value === "string" ? constraint.value : "", nodeIds: [...constraint.nodeIds] });
        break;
      case "separation":
        // Every distinct pair among the constrained nodes must land in different clusters.
        for (let i = 0; i < constraint.nodeIds.length; i += 1) {
          for (let j = i + 1; j < constraint.nodeIds.length; j += 1) separations.push([constraint.nodeIds[i], constraint.nodeIds[j]]);
        }
        break;
      case "spacing":
        if (typeof constraint.value === "number" && constraint.value > 0) spacingMultiplier = constraint.value;
        break;
      case "pin":
      case "preserve-position":
        for (const id of constraint.nodeIds) fixedIds.add(id);
        break;
      default:
        break;
    }
  }

  if (plan.preserve.pinnedNodes) {
    for (const [nodeId, node] of Object.entries(current.nodes) as Array<[string, NodeLayout]>) {
      if (node.pinned) fixedIds.add(nodeId);
    }
  }

  return {
    emphasisIds,
    groups: groups.sort((a, b) => a.label.localeCompare(b.label)),
    separations,
    direction: plan.direction ?? current.config.direction,
    spacingMultiplier,
    fixedIds,
    preserveManualGroups: plan.preserve.manualGroups,
  };
}
