import type { ViewTheme } from "@weaver/contracts";

// Single source of truth for the two canvas themes. Both are near-monochrome with
// one blue accent (DESIGN.md). Light is authored as a neutral, cool-grey sibling
// of the dark ground — never a naive inversion, and never the old warm/green
// tapnow tint. Applied at render (useCanvasGraph / CanvasStage) so every board —
// existing or new — is normalised to the design palette regardless of what theme
// was stored, then persisted on the next theme toggle.
const PALETTE = {
  dark: {
    canvasBg: "#0a0a0a", pattern: "#3a3a3a", patternOpacity: 0.5,
    nodeFill: "#1f1f1f", nodeBorder: "rgba(255,255,255,0.10)", nodeText: "#fafafa",
    accent: "#1fa2dc", edge: "rgba(255,255,255,0.376)",
  },
  light: {
    // Cool neutral off-white ground; hairline borders; a slightly deeper blue so
    // the accent keeps contrast on white without becoming a second hue.
    canvasBg: "#f4f5f7", pattern: "#c7ccd3", patternOpacity: 0.55,
    nodeFill: "#ffffff", nodeBorder: "#e3e6ea", nodeText: "#171a1f",
    accent: "#1585bd", edge: "rgba(23,26,31,0.34)",
  },
} as const;

export function canvasThemeForMode(theme: ViewTheme, mode: "dark" | "light"): ViewTheme {
  const p = PALETTE[mode];
  const defaultNode = theme.nodeStyles.default;
  return {
    ...theme,
    canvas: {
      ...theme.canvas,
      mode,
      backgroundColor: p.canvasBg,
      pattern: "dots",
      patternGap: 20,
      patternSize: 1,
      patternColor: p.pattern,
      patternOpacity: p.patternOpacity,
    },
    nodeStyles: {
      ...theme.nodeStyles,
      default: { ...defaultNode, fill: p.nodeFill, borderColor: p.nodeBorder, textColor: p.nodeText, accentColor: p.accent },
    },
    edgeStyles: {
      ...theme.edgeStyles,
      default: { ...theme.edgeStyles.default, color: p.edge },
    },
  };
}

// Normalise a stored/base theme to the design palette for its own mode. Use at
// render so a board with a legacy warm/green theme still shows the redesign.
export function normalizeCanvasTheme<T extends ViewTheme | undefined>(theme: T): T {
  if (!theme) return theme;
  return canvasThemeForMode(theme, theme.canvas.mode === "light" ? "light" : "dark") as T;
}
