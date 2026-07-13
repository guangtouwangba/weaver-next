import type React from "react";

export type CanvasViewport = { x: number; y: number; zoom: number };

export type CanvasNode<Data = Record<string, unknown>> = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: Data;
  style?: React.CSSProperties;
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
  selected?: boolean;
  draggable?: boolean;
  selectable?: boolean;
  connectable?: boolean;
};

export type CanvasEdge<Data = Record<string, unknown>> = {
  id: string;
  type?: string;
  source: string;
  target: string;
  label?: React.ReactNode;
  data?: Data;
  style?: React.CSSProperties;
  selected?: boolean;
  sourceHandle?: string;
  targetHandle?: string;
};

export type CanvasNodeProps<Data> = { id: string; data: Data; selected: boolean };
