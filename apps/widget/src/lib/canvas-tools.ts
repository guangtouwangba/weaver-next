import type { CanvasNode } from "./canvas-model";

export type CanvasTool = "select" | "pan" | "note" | "connect" | "frame";
export type Alignment = "left" | "center-x" | "right" | "top" | "center-y" | "bottom";

export function alignNodes(nodes: CanvasNode[], alignment: Alignment): CanvasNode[] {
  if (nodes.length < 2) return nodes;
  const left = Math.min(...nodes.map((node) => node.position.x));
  const right = Math.max(...nodes.map((node) => node.position.x + Number(node.measured?.width ?? node.width ?? node.style?.width ?? 0)));
  const top = Math.min(...nodes.map((node) => node.position.y));
  const bottom = Math.max(...nodes.map((node) => node.position.y + Number(node.measured?.height ?? node.height ?? node.style?.height ?? 0)));
  return nodes.map((node) => {
    const width = Number(node.measured?.width ?? node.width ?? node.style?.width ?? 0);
    const height = Number(node.measured?.height ?? node.height ?? node.style?.height ?? 0);
    const position = { ...node.position };
    if (alignment === "left") position.x = left;
    if (alignment === "center-x") position.x = (left + right - width) / 2;
    if (alignment === "right") position.x = right - width;
    if (alignment === "top") position.y = top;
    if (alignment === "center-y") position.y = (top + bottom - height) / 2;
    if (alignment === "bottom") position.y = bottom - height;
    return { ...node, position };
  });
}

export function distributeNodes(nodes: CanvasNode[], axis: "horizontal" | "vertical"): CanvasNode[] {
  if (nodes.length < 3) return nodes;
  const sorted = [...nodes].sort((a, b) => axis === "horizontal" ? a.position.x - b.position.x : a.position.y - b.position.y);
  const start = axis === "horizontal" ? sorted[0].position.x : sorted[0].position.y;
  const end = axis === "horizontal" ? sorted.at(-1)!.position.x : sorted.at(-1)!.position.y;
  const step = (end - start) / (sorted.length - 1);
  return sorted.map((node, index) => ({ ...node, position: axis === "horizontal" ? { ...node.position, x: start + step * index } : { ...node.position, y: start + step * index } }));
}

export function offsetForPaste(index: number) { return 32 * Math.max(1, index); }
