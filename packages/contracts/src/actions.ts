import { z } from "zod";
import { canvasContextSnapshotSchema, nodeContentSchema } from "./space.js";
import { layoutOperationSchema } from "./layout.js";

const workspace = { workspaceDir: z.string().min(1) } as const;
const catalogBase = { ...workspace, projectId: z.string().min(1), baseCatalogRevision: z.number().int().nonnegative() } as const;

export const catalogActionSchema = z.discriminatedUnion("action", [
  z.object({ ...workspace, action: z.literal("create_project"), title: z.string().min(1), goal: z.string().optional(), scenePackId: z.string().min(1) }),
  z.object({ ...workspace, action: z.literal("create_project_from_template"), title: z.string().min(1), goal: z.string().optional(), scenePackId: z.string().min(1), templateId: z.string().min(1), version: z.string().optional() }),
  z.object({ ...workspace, action: z.literal("create_view_from_template"), projectId: z.string().min(1), templateId: z.string().min(1), version: z.string().optional(), viewName: z.string().optional(), baseGraphRevision: z.number().int().nonnegative(), leaseId: z.string().optional(), bindingRevision: z.number().int().positive().optional() }),
  z.object({ ...catalogBase, action: z.literal("duplicate_view"), viewId: z.string().min(1), name: z.string().optional() }),
  z.object({ ...catalogBase, action: z.literal("rename_view"), viewId: z.string().min(1), name: z.string().min(1) }),
  z.object({ ...catalogBase, action: z.literal("pin_view"), viewId: z.string().min(1), pinned: z.boolean().optional() }),
  z.object({ ...catalogBase, action: z.literal("reorder_views"), viewIds: z.array(z.string().min(1)) }),
  z.object({ ...catalogBase, action: z.literal("set_default_view"), viewId: z.string().min(1) }),
  z.object({ ...catalogBase, action: z.literal("trash_view"), viewId: z.string().min(1), fallbackViewId: z.string().optional() }),
  z.object({ ...catalogBase, action: z.literal("restore_view"), viewId: z.string().min(1) }),
  z.object({ ...catalogBase, action: z.literal("purge_view"), viewId: z.string().min(1) }),
]);

const graphEdit = { ...workspace, projectId: z.string().min(1), baseGraphRevision: z.number().int().nonnegative() } as const;
export const canvasActionSchema = z.discriminatedUnion("action", [
  z.object({ ...workspace, action: z.literal("claim"), snapshot: canvasContextSnapshotSchema }),
  z.object({ ...workspace, action: z.literal("sync"), snapshot: canvasContextSnapshotSchema }),
  z.object({ ...workspace, action: z.literal("switch"), leaseId: z.string().min(1), bindingRevision: z.number().int().positive(), projectId: z.string().min(1), viewId: z.string().min(1) }),
  z.object({ ...workspace, action: z.literal("create_node"), projectId: z.string().min(1), viewId: z.string().min(1), semanticType: z.string().min(1), title: z.string().min(1), content: nodeContentSchema, x: z.number().optional(), y: z.number().optional() }),
  z.object({ ...graphEdit, action: z.literal("update_node"), nodeId: z.string().min(1), title: z.string().optional(), semanticType: z.string().optional(), content: nodeContentSchema.optional() }),
  z.object({ ...graphEdit, action: z.literal("archive_node"), nodeId: z.string().min(1) }),
  z.object({ ...graphEdit, action: z.literal("attach_asset"), nodeId: z.string().min(1), assetId: z.string().min(1), role: z.enum(["embedded", "cover"]) }),
  z.object({ ...graphEdit, action: z.literal("enrich_link"), nodeId: z.string().min(1) }),
  z.object({ ...workspace, action: z.literal("layout_operations"), projectId: z.string().min(1), viewId: z.string().min(1), baseLayoutRevision: z.number().int().nonnegative(), operations: z.array(layoutOperationSchema) }),
  z.object({ ...workspace, action: z.literal("revert_layout"), projectId: z.string().min(1), viewId: z.string().min(1) }),
]);

const task = { ...workspace, taskId: z.string().min(1) } as const;
export const taskActionSchema = z.discriminatedUnion("action", [
  z.object({ ...task, action: z.literal("start") }), z.object({ ...task, action: z.literal("progress"), note: z.string().min(1).max(280) }),
  z.object({ ...task, action: z.literal("continue"), dispatchKey: z.string().min(1), expectedTaskRevision: z.number().int().nonnegative() }),
  z.object({ ...task, action: z.literal("complete") }), z.object({ ...task, action: z.literal("fail"), message: z.string().optional() }), z.object({ ...task, action: z.literal("cancel") }),
]);

const layoutReviewActionSchema = z.object({ ...workspace, resource: z.literal("layout_run"), action: z.enum(["preview", "apply", "reject", "revert"]), id: z.string().min(1).optional(), candidateId: z.string().min(1).optional(), projectId: z.string().min(1).optional(), viewId: z.string().min(1).optional() });
export const reviewActionSchema = z.discriminatedUnion("resource", [
  z.object({ ...workspace, resource: z.literal("changeset"), action: z.enum(["preview", "apply", "reject", "revert"]), id: z.string().min(1) }),
  layoutReviewActionSchema,
]).superRefine((value, context) => {
  if (value.resource !== "layout_run") return;
  if (value.action === "revert") {
    if (!value.projectId) context.addIssue({ code: "custom", message: "projectId required", path: ["projectId"] });
    if (!value.viewId) context.addIssue({ code: "custom", message: "viewId required", path: ["viewId"] });
  } else if (!value.id) context.addIssue({ code: "custom", message: "id required", path: ["id"] });
  if (value.action === "apply" && !value.candidateId) context.addIssue({ code: "custom", message: "candidateId required", path: ["candidateId"] });
});
