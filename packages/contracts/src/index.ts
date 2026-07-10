import type { components } from "../generated/openapi.gen";
export type { paths, components, operations } from "../generated/openapi.gen";
export type { ApiPaths, HttpMethod, JsonBody, JsonResponse } from "../generated/client.gen";
export type { ErrorCode } from "../generated/errors.gen";

export type BackendHealthView = components["schemas"]["BackendHealthView"];
export type BackendView = components["schemas"]["BackendView"];
export type BranchContext = components["schemas"]["BranchContext"];
export type DraftCitation = components["schemas"]["DraftCitation"];
export type DraftGenerateRequest = components["schemas"]["DraftGenerateRequest"];
export type DraftView = components["schemas"]["DraftView"];
export type ExportView = components["schemas"]["ExportView"];
export type FeatureFlags = components["schemas"]["FeatureFlags"];
export type ForestView = components["schemas"]["ForestView"];
export type ForkProposal = components["schemas"]["ForkProposal"];
export type MetaView = components["schemas"]["MetaView"];
export type PermissionSet = components["schemas"]["PermissionSet"];
export type ProjectCreate = components["schemas"]["ProjectCreate"];
export type ProjectStatus = ProjectSummary["status"];
export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type PromoteQuickNoteResponse = components["schemas"]["PromoteQuickNoteResponse"];
export type QuickNoteCreate = components["schemas"]["QuickNoteCreate"];
export type QuickNoteView = components["schemas"]["QuickNoteView"];
export type ThoughtNodeView = components["schemas"]["NodeView"];
export * from "./space.js";
export * from "./layout.js";
export * from "./visual.js";

export class WeaverApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor({ code, message, status, details }: { code: string; message: string; status: number; details?: unknown }) {
    super(message);
    this.name = "WeaverApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toApiError(status: number, payload: unknown): WeaverApiError {
  const detail = typeof payload === "object" && payload && "detail" in payload ? (payload as { detail?: unknown }).detail : undefined;
  if (typeof detail === "string") {
    const [code] = detail.split(":", 1);
    return new WeaverApiError({ code: code || "UNKNOWN_ERROR", message: detail, status });
  }
  if (typeof detail === "object" && detail && "code" in detail) {
    const error = detail as { code?: unknown; message?: unknown; details?: unknown };
    return new WeaverApiError({
      code: typeof error.code === "string" ? error.code : "UNKNOWN_ERROR",
      message: typeof error.message === "string" ? error.message : "Unknown Weaver API error",
      status,
      details: error.details,
    });
  }
  return new WeaverApiError({ code: "UNKNOWN_ERROR", message: "Unknown Weaver API error", status, details: payload });
}
