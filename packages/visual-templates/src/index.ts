import { defaultViewTheme, visualTemplateSchema, type ScenePack, type SpaceNode, type TemplateValidationResult, type ViewTheme, type VisualFamily, type VisualTemplate, type ViewType } from "@weaver/contracts";
import { builtinScenePacks, getScenePack } from "@weaver/scene-packs";

const palette: Record<VisualFamily, [string, string, string]> = {
  canvas: ["#315cf6", "#f2f3ed", "#fbfbf6"], hierarchy: ["#7657d5", "#f5f1fb", "#fffdf8"], relationship: ["#188977", "#eef7f3", "#fcfffd"],
  flow: ["#d05a42", "#faf0eb", "#fffdf8"], temporal: ["#376db6", "#edf4fb", "#fbfdff"], board: ["#b16b13", "#f7f2e7", "#fffdf7"],
  matrix: ["#b5456b", "#faeef3", "#fffafd"], table: ["#4f6650", "#eef2eb", "#fcfdf9"],
};

function theme(family: VisualFamily): ViewTheme {
  const [accent, background, fill] = palette[family];
  return { ...structuredClone(defaultViewTheme), canvas: { mode: "light", backgroundColor: background, pattern: family === "table" ? "grid" : "dots", patternGap: 20, patternSize: 1, patternColor: `${accent}66`, patternOpacity: 0.42 }, nodeStyles: { default: { fill, borderColor: `${accent}88`, textColor: "#20231f", accentColor: accent, borderRadius: family === "flow" ? 5 : 10, titleScale: family === "hierarchy" ? 1.12 : 1 } }, edgeStyles: { default: { color: accent, width: 1.6, dashed: family === "relationship", routing: family === "flow" ? "orthogonal" : "bezier", marker: "arrow" } } };
}

function bind(scenePackId: string, roles: string[], edgeRoles: string[], fields: Record<string, { propertyKey: string; required: boolean }> = {}) {
  const scene = getScenePack(scenePackId)!;
  return { nodeRoles: Object.fromEntries(roles.map((role, index) => [role, scene.nodeTypes[Math.min(index, scene.nodeTypes.length - 1)].key])), edgeRoles: Object.fromEntries(edgeRoles.map((role, index) => [role, scene.edgeTypes[Math.min(index, scene.edgeTypes.length - 1)]?.key ?? "association"])), fields };
}

type Definition = { id: string; name: string; description: string; family: VisualFamily; renderer: ViewType; scenes: string[]; roles: string[]; edgeRoles: string[]; strategy: VisualTemplate["layoutPreset"]["strategy"]; projection: VisualTemplate["projection"]; fields?: Record<string, { propertyKey: string; required: boolean }> };

function createTemplate(definition: Definition): VisualTemplate {
  const nodes = definition.roles.slice(0, 6).map((role, index) => ({ key: `node-${index + 1}`, role, title: index === 0 ? definition.name : `${role} ${index}`, contentKind: "document" as const, properties: Object.fromEntries(Object.values(definition.fields ?? {}).map((field) => [field.propertyKey, field.propertyKey.includes("At") ? `2026-0${Math.min(index + 1, 9)}-01` : field.propertyKey.match(/impact|effort|urgency|importance/) ? (index + 1) * 20 : index === 0 ? "待处理" : "进行中"])) }));
  const edges = nodes.slice(1).map((node, index) => ({ key: `edge-${index + 1}`, role: definition.edgeRoles[index % Math.max(definition.edgeRoles.length, 1)] ?? "relation", sourceKey: nodes[0].key, targetKey: node.key }));
  return visualTemplateSchema.parse({
    id: definition.id, version: "1.0.0", name: definition.name, description: definition.description, family: definition.family, renderer: definition.renderer,
    defaultScenePackId: definition.scenes[0], compatibleScenePackIds: definition.scenes, starterBlueprint: { nodes, edges },
    sceneBindings: Object.fromEntries(definition.scenes.map((scene) => [scene, bind(scene, definition.roles, definition.edgeRoles, definition.fields)])),
    projection: definition.projection, layoutPreset: { strategy: definition.strategy, direction: "left-right", config: { nodeSpacing: 72, rankSpacing: 120, density: 1 }, constraints: [] },
    theme: theme(definition.family), agentGuidance: `Use ${definition.name} when the user's content benefits from a ${definition.family} visual projection.`,
  });
}

const definitions: Definition[] = [
  { id: "blank-canvas", name: "空白自由画布", description: "从一个中心节点开始自由组织内容。", family: "canvas", renderer: "canvas", scenes: builtinScenePacks.map((scene) => scene.id), roles: ["center", "note", "detail"], edgeRoles: ["relation"], strategy: "hybrid", projection: { kind: "canvas", nodeTypes: [], edgeTypes: [], clusterBy: "none" } },
  { id: "topic-cluster", name: "主题聚类画布", description: "按主题将内容组织成多个空间簇。", family: "canvas", renderer: "canvas", scenes: builtinScenePacks.map((scene) => scene.id), roles: ["center", "topic", "detail"], edgeRoles: ["relation"], strategy: "cluster", projection: { kind: "canvas", nodeTypes: [], edgeTypes: [], clusterBy: "type" } },
  { id: "radial-mind-map", name: "中心主题思维导图", description: "围绕核心主题径向展开多级分支。", family: "hierarchy", renderer: "tree", scenes: ["free-brainstorming", "problem-decomposition", "situational-vocabulary", "concept-learning", "project-breakdown"], roles: ["root", "branch", "detail"], edgeRoles: ["parent"], strategy: "radial", projection: { kind: "tree", nodeTypes: [], edgeTypes: [], parentEdgeTypes: [], direction: "left-right" } },
  { id: "logic-tree", name: "逻辑拆解树", description: "自上而下拆解问题、假设与执行项。", family: "hierarchy", renderer: "tree", scenes: ["problem-decomposition", "concept-learning", "project-breakdown"], roles: ["root", "branch", "evidence"], edgeRoles: ["parent"], strategy: "tree", projection: { kind: "tree", nodeTypes: [], edgeTypes: [], parentEdgeTypes: [], direction: "top-bottom" } },
  { id: "concept-network", name: "概念关系网络", description: "展示概念、定义、证据之间的交叉关系。", family: "relationship", renderer: "graph", scenes: ["concept-learning", "entity-relationship", "argument-map"], roles: ["concept", "support", "example"], edgeRoles: ["relation", "support"], strategy: "force", projection: { kind: "graph", nodeTypes: [], edgeTypes: [], relationshipDistance: 190 } },
  { id: "people-network", name: "人物组织关系网", description: "按组织聚类展示人物、角色和事件。", family: "relationship", renderer: "graph", scenes: ["people-organization-network", "entity-relationship"], roles: ["person", "organization", "event"], edgeRoles: ["membership", "influence"], strategy: "cluster", projection: { kind: "graph", nodeTypes: [], edgeTypes: [], groupBy: "organization", relationshipDistance: 210 } },
  { id: "process-flow", name: "标准流程图", description: "按步骤和判断节点组织执行流程。", family: "flow", renderer: "flow", scenes: ["process-design", "learning-path", "project-breakdown"], roles: ["start", "step", "decision", "output"], edgeRoles: ["next", "branch"], strategy: "layered", projection: { kind: "flow", nodeTypes: [], edgeTypes: [], stepEdgeTypes: [], direction: "left-right" } },
  { id: "causal-chain", name: "因果链路图", description: "从原因到机制、结果与反馈组织因果关系。", family: "flow", renderer: "flow", scenes: ["causal-map"], roles: ["cause", "mechanism", "effect", "feedback"], edgeRoles: ["cause", "feedback"], strategy: "layered", projection: { kind: "flow", nodeTypes: [], edgeTypes: [], stepEdgeTypes: [], direction: "left-right" } },
  { id: "event-timeline", name: "事件时间线", description: "按发生时间展示事件、阶段和影响。", family: "temporal", renderer: "timeline", scenes: ["event-timeline", "people-organization-network"], roles: ["event", "period", "actor"], edgeRoles: ["precedes"], strategy: "timeline", fields: { time: { propertyKey: "occurredAt", required: true }, group: { propertyKey: "period", required: false } }, projection: { kind: "timeline", nodeTypes: [], edgeTypes: [], timeField: "occurredAt", groupField: "period", direction: "left-right" } },
  { id: "project-roadmap", name: "项目路线图", description: "以阶段和时间跨度展示项目推进路径。", family: "temporal", renderer: "timeline", scenes: ["project-breakdown", "learning-path"], roles: ["goal", "phase", "item"], edgeRoles: ["precedes"], strategy: "timeline", fields: { start: { propertyKey: "startAt", required: true }, end: { propertyKey: "endAt", required: false }, group: { propertyKey: "phase", required: false } }, projection: { kind: "timeline", nodeTypes: [], edgeTypes: [], timeField: "startAt", endField: "endAt", groupField: "phase", direction: "left-right" } },
  { id: "kanban-board", name: "Kanban 看板", description: "按状态分列管理任务和工作项。", family: "board", renderer: "board", scenes: ["project-breakdown", "decision-comparison"], roles: ["item", "group", "risk"], edgeRoles: ["relation"], strategy: "swimlane", fields: { status: { propertyKey: "status", required: true } }, projection: { kind: "board", nodeTypes: [], edgeTypes: [], columnField: "status", columnOrder: ["待处理", "进行中", "已完成"] } },
  { id: "role-swimlane", name: "角色泳道板", description: "按状态和负责人二维组织工作。", family: "board", renderer: "board", scenes: ["process-design", "project-breakdown"], roles: ["item", "owner", "output"], edgeRoles: ["next"], strategy: "swimlane", fields: { status: { propertyKey: "status", required: true }, owner: { propertyKey: "owner", required: false } }, projection: { kind: "board", nodeTypes: [], edgeTypes: [], columnField: "status", laneField: "owner", columnOrder: ["待处理", "进行中", "已完成"] } },
  { id: "swot-matrix", name: "SWOT 四象限", description: "将优势、劣势、机会和威胁放入四象限。", family: "matrix", renderer: "board", scenes: ["decision-comparison"], roles: ["item", "criterion", "risk"], edgeRoles: ["relation"], strategy: "grid", fields: { x: { propertyKey: "impact", required: true }, y: { propertyKey: "effort", required: true } }, projection: { kind: "matrix", nodeTypes: [], edgeTypes: [], xField: "impact", yField: "effort", xLabels: ["内部", "外部"], yLabels: ["负向", "正向"], quadrantLabels: ["劣势", "威胁", "优势", "机会"] } },
  { id: "priority-matrix", name: "重要紧急矩阵", description: "按重要性和紧急性安排事项。", family: "matrix", renderer: "board", scenes: ["project-breakdown", "decision-comparison"], roles: ["item", "risk", "detail"], edgeRoles: ["relation"], strategy: "grid", fields: { x: { propertyKey: "urgency", required: true }, y: { propertyKey: "importance", required: true } }, projection: { kind: "matrix", nodeTypes: [], edgeTypes: [], xField: "urgency", yField: "importance", xLabels: ["不紧急", "紧急"], yLabels: ["不重要", "重要"], quadrantLabels: ["稍后处理", "委派", "计划", "立即处理"] } },
  { id: "comparison-table", name: "多方案对比表", description: "将方案、标准和风险组织成可比较表格。", family: "table", renderer: "table", scenes: ["decision-comparison", "argument-map"], roles: ["item", "criterion", "risk"], edgeRoles: ["relation"], strategy: "grid", projection: { kind: "table", nodeTypes: [], edgeTypes: [], columns: [{ key: "title", label: "名称", source: "title" }, { key: "type", label: "类型", source: "type" }] } },
  { id: "research-catalog", name: "结构化研究目录", description: "按实体类型整理研究对象和来源。", family: "table", renderer: "table", scenes: ["entity-relationship", "argument-map", "concept-learning"], roles: ["item", "source", "detail"], edgeRoles: ["relation"], strategy: "grid", projection: { kind: "table", nodeTypes: [], edgeTypes: [], columns: [{ key: "title", label: "主题", source: "title" }, { key: "type", label: "分类", source: "type" }], groupBy: "type" } },
];

export const builtinVisualTemplates = definitions.map(createTemplate);

export function getVisualTemplate(id: string, version = "1.0.0") { return builtinVisualTemplates.find((item) => item.id === id && item.version === version) ?? null; }

export function validateVisualTemplateDefinition(template: VisualTemplate) {
  visualTemplateSchema.parse(template);
  const keys = new Set(template.starterBlueprint.nodes.map((node) => node.key));
  if (keys.size !== template.starterBlueprint.nodes.length) throw new Error("VISUAL_TEMPLATE_BLUEPRINT_INVALID:DUPLICATE_NODE_KEY");
  for (const edge of template.starterBlueprint.edges) if (!keys.has(edge.sourceKey) || !keys.has(edge.targetKey)) throw new Error("VISUAL_TEMPLATE_BLUEPRINT_INVALID:EDGE_REFERENCE");
  for (const sceneId of template.compatibleScenePackIds) {
    const scene = getScenePack(sceneId); const binding = template.sceneBindings[sceneId];
    if (!scene || !binding) throw new Error(`VISUAL_TEMPLATE_BINDING_INVALID:${sceneId}`);
    const nodeTypes = new Set(scene.nodeTypes.map((item) => item.key)); const edgeTypes = new Set(scene.edgeTypes.map((item) => item.key));
    if (Object.values(binding.nodeRoles).some((key) => !nodeTypes.has(key)) || Object.values(binding.edgeRoles).some((key) => !edgeTypes.has(key))) throw new Error(`VISUAL_TEMPLATE_BINDING_INVALID:${sceneId}`);
  }
  return template;
}

export function validateVisualTemplateForProject(template: VisualTemplate, scene: ScenePack, nodes: SpaceNode[]): TemplateValidationResult {
  const compatible = template.compatibleScenePackIds.includes(scene.id); const binding = template.sceneBindings[scene.id];
  if (!compatible || !binding) return { compatible: false, ready: false, matchedNodeCount: 0, unmatchedNodeCount: nodes.length, missingRequiredFields: [], warnings: ["Template is not compatible with this Scene Pack."] };
  const allowed = new Set(Object.values(binding.nodeRoles)); const active = nodes.filter((node) => !node.archived); const matched = active.filter((node) => allowed.has(node.type));
  const missingRequiredFields = Object.values(binding.fields).filter((field) => field.required).flatMap((field) => matched.filter((node) => node.properties[field.propertyKey] === undefined || node.properties[field.propertyKey] === "").map((node) => ({ nodeId: node.id, nodeType: node.type, propertyKey: field.propertyKey })));
  return { compatible: true, ready: missingRequiredFields.length === 0, matchedNodeCount: matched.length, unmatchedNodeCount: active.length - matched.length, missingRequiredFields, warnings: matched.length ? [] : ["No current nodes match this template; it remains available for a new project."] };
}

builtinVisualTemplates.forEach(validateVisualTemplateDefinition);
