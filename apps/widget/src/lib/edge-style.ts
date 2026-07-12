// Resolves how a typed edge is drawn. DESIGN.md § Line: every relationship type
// has a factory (semantic) default; a per-edge layout override may change it for
// the current View only. Default routing is straight — steadier and more regular
// than a curve, with more stable routing; curves are an explicit manual choice.

export type EdgeLineStyle = "solid" | "dashed";
export type EdgeArrows = "none" | "forward" | "both";
export type EdgeRouting = "straight" | "bezier" | "orthogonal" | "bundled";

export type EdgeVisual = { lineStyle: EdgeLineStyle; arrows: EdgeArrows; routing: EdgeRouting; muted: boolean };

type SemanticDefault = { lineStyle: EdgeLineStyle; arrows: EdgeArrows; routing: EdgeRouting; muted?: boolean };

// Factory styles keyed by relationship type. Unknown types fall back to FALLBACK.
const SEMANTIC_EDGE_DEFAULTS: Record<string, SemanticDefault> = {
  "relates-to": { lineStyle: "solid", arrows: "forward", routing: "straight" },
  "has-attribute": { lineStyle: "solid", arrows: "forward", routing: "straight" },
  association: { lineStyle: "solid", arrows: "none", routing: "straight" },
  // References/citations are quiet, undirected context: dashed, muted, no arrow.
  reference: { lineStyle: "dashed", arrows: "none", routing: "straight", muted: true },
  "context-reference": { lineStyle: "dashed", arrows: "none", routing: "straight", muted: true },
};

const FALLBACK: SemanticDefault = { lineStyle: "solid", arrows: "forward", routing: "straight" };

export function semanticEdgeDefault(semanticType?: string): SemanticDefault {
  return (semanticType ? SEMANTIC_EDGE_DEFAULTS[semanticType] : undefined) ?? FALLBACK;
}

export type EdgeOverride = { lineStyle?: EdgeLineStyle; arrows?: EdgeArrows; routing?: EdgeRouting };

// Precedence: per-edge layout override → relationship-type semantic default.
// `muted` is a property of the type (references stay quiet even when overridden
// to solid), so it is never taken from the override.
export function resolveEdgeVisual(semanticType: string | undefined, override?: EdgeOverride): EdgeVisual {
  const base = semanticEdgeDefault(semanticType);
  return {
    lineStyle: override?.lineStyle ?? base.lineStyle,
    arrows: override?.arrows ?? base.arrows,
    routing: override?.routing ?? base.routing,
    muted: base.muted ?? false,
  };
}
