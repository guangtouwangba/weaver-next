import { getScenePack } from "@weaver/scene-packs";
import { getVisualTemplate } from "@weaver/visual-templates";
import { track } from "./workspace-registry.js";
import { result, type MutateWithStore } from "./tool-runtime.js";

/**
 * Single source of truth for TEMPLATE-BASED project creation, shared by the
 * model-facing `weaver_create_project` (its optional `template` branch) and the
 * still-registered widget tool `weaver_create_project_from_visual_template`
 * (app-only), so the two surfaces never drift. Reproduces the exact store call,
 * chat-binding handling (leaseId/bindingRevision → switch vs open binding) and
 * payload shape of the original template handler.
 */
export type CreateProjectFromTemplateArgs = {
  workspaceDir: string;
  title: string;
  goal: string;
  scenePackId: string;
  templateId: string;
  version: string;
  automationLevel: "cautious" | "collaborative" | "automatic";
  chatSessionKey: string | undefined;
  leaseId?: string;
  bindingRevision?: number;
};

export function createProjectFromTemplate(mutateWithStore: MutateWithStore, args: CreateProjectFromTemplateArgs) {
  const scene = getScenePack(args.scenePackId); if (!scene) throw new Error("SCENE_PACK_NOT_FOUND");
  const template = getVisualTemplate(args.templateId, args.version); if (!template) throw new Error("VISUAL_TEMPLATE_NOT_FOUND");
  const output = mutateWithStore(args.workspaceDir, (store) => store.createProjectFromVisualTemplate({
    title: args.title, goal: args.goal, scenePack: scene, template, automationLevel: args.automationLevel,
    chatBinding: args.chatSessionKey ? { chatSessionKey: args.chatSessionKey, leaseId: args.leaseId, bindingRevision: args.bindingRevision } : undefined,
  }));
  track(args.workspaceDir, output.project.id);
  const binding = output.binding ? { leaseId: output.binding.leaseId, bindingRevision: output.binding.bindingRevision, projectId: output.binding.projectId, viewId: output.binding.viewId } : undefined;
  return result({ ...output, binding }, `Created ${args.title} from ${template.name}.`);
}
