import type { ViewTheme } from "@weaver/contracts";

export function canvasThemeForMode(theme: ViewTheme, mode: "dark" | "light"): ViewTheme {
  const dark = mode === "dark";
  const defaultNode = theme.nodeStyles.default;
  return {
    ...theme,
    canvas: {
      ...theme.canvas,
      mode,
      // Dark values follow the TapNow Canvas design system: a near-black media
      // plane so colorful content is the only focal color.
      backgroundColor: dark ? "#0a0a0a" : "#f2f3ed",
      pattern: "dots",
      patternGap: 20,
      patternSize: 1,
      patternColor: dark ? "#3a3a3a" : "#aeb5aa",
      patternOpacity: dark ? 0.5 : 0.42,
    },
    nodeStyles: {
      ...theme.nodeStyles,
      default: {
        ...defaultNode,
        fill: dark ? "#1f1f1f" : "#fbfbf6",
        borderColor: dark ? "rgba(255,255,255,0.1)" : "#cbd0c6",
        textColor: dark ? "#fafafa" : "#20231f",
      },
    },
    edgeStyles: {
      ...theme.edgeStyles,
      default: {
        ...theme.edgeStyles.default,
        color: dark ? "rgba(255,255,255,0.376)" : "#7e867c",
      },
    },
  };
}
