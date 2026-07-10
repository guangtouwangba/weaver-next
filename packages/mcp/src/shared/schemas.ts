import { z } from "zod";

export const workspaceSchema = z.object({ workspaceDir: z.string().min(1) });
export const projectSchema = workspaceSchema.extend({ projectId: z.string().min(1) });
