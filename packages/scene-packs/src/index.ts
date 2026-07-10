import { scenePackSchema, type ScenePack, type ViewType } from "@weaver/contracts";

type PackInput = {
  id: string;
  name: string;
  category: ScenePack["category"];
  description: string;
  nodeTypes: Array<[string, string, string?]>;
  edgeTypes: Array<[string, string, boolean?]>;
  views: ViewType[];
  strategy: string;
  artifacts: string[];
  direction?: "top-bottom" | "bottom-top" | "left-right" | "right-left";
  weights?: Record<string, number>;
};

function pack(input: PackInput): ScenePack {
  return scenePackSchema.parse({
    id: input.id,
    version: "1.0.0",
    name: input.name,
    category: input.category,
    description: input.description,
    nodeTypes: input.nodeTypes.map(([key, label, color]) => ({ key, label, color, defaultWidth: 220, defaultHeight: 112, requiredProperties: [], defaultContentKind: "document", allowedContentKinds: ["document", "image", "link"] })),
    edgeTypes: input.edgeTypes.map(([key, label, directed = true]) => ({ key, label, directed, sourceTypes: [], targetTypes: [] })),
    recommendedViews: input.views,
    defaultView: input.views[0],
    allowedStrategies: [input.strategy, "grid", "hybrid"],
    defaultStrategy: input.strategy,
    defaultDirection: input.direction,
    contextPolicy: { modes: ["selected_nodes", "pinned_nodes", "typed_neighborhood"], maxNodes: 40, maxHops: 2 },
    artifactTypes: input.artifacts,
    scoringWeights: input.weights ?? { overlap: 10, crossings: 4, displacement: 2, compactness: 1 },
  });
}

export const builtinScenePacks: ScenePack[] = [
  pack({ id: "free-brainstorming", name: "自由头脑风暴", category: "thinking", description: "围绕核心想法自由发散、聚类和重新组织。", nodeTypes: [["idea", "想法", "#f5b942"], ["question", "问题", "#5f7ee8"], ["note", "便签", "#8b9a87"]], edgeTypes: [["association", "关联", false], ["inspires", "启发"]], views: ["canvas", "graph", "board"], strategy: "cluster", artifacts: ["summary", "action-items"], weights: { overlap: 10, crossings: 3, displacement: 6, compactness: 1 } }),
  pack({ id: "problem-decomposition", name: "问题拆解", category: "thinking", description: "把复杂问题拆成子问题、假设和验证路径。", nodeTypes: [["problem", "问题"], ["subproblem", "子问题"], ["assumption", "假设"], ["evidence", "证据"]], edgeTypes: [["decomposes", "拆解为"], ["supports", "支持"]], views: ["tree", "flow", "table"], strategy: "tree", direction: "top-bottom", artifacts: ["problem-map", "research-plan"] }),
  pack({ id: "decision-comparison", name: "决策比较", category: "thinking", description: "比较方案、标准、风险和权衡。", nodeTypes: [["decision", "决策"], ["option", "方案"], ["criterion", "标准"], ["risk", "风险"]], edgeTypes: [["evaluates", "评价"], ["conflicts", "冲突", false]], views: ["board", "table", "graph"], strategy: "swimlane", artifacts: ["decision-memo"] }),
  pack({ id: "argument-map", name: "论证地图", category: "thinking", description: "组织主张、证据、反例和推论。", nodeTypes: [["claim", "主张"], ["evidence", "证据"], ["counterclaim", "反方观点"], ["inference", "推论"]], edgeTypes: [["supports", "支持"], ["challenges", "反驳"]], views: ["graph", "tree", "table"], strategy: "layered", direction: "left-right", artifacts: ["outline", "article"] }),
  pack({ id: "situational-vocabulary", name: "场景词汇", category: "learning", description: "从真实场景衍生词汇、搭配、例句和语义关系。", nodeTypes: [["scene", "场景", "#ef8f65"], ["word", "单词", "#5f7ee8"], ["meaning", "词义"], ["example", "例句"], ["collocation", "搭配"]], edgeTypes: [["appears-in", "出现于"], ["means", "含义"], ["example-of", "例句"], ["synonym", "近义", false], ["antonym", "反义", false], ["collocates", "搭配", false]], views: ["graph", "canvas", "board", "table"], strategy: "radial", artifacts: ["flashcards", "quiz", "word-list"], weights: { overlap: 10, crossings: 3, displacement: 2, semanticDistance: 8 } }),
  pack({ id: "concept-learning", name: "概念学习", category: "learning", description: "建立概念、定义、例子和前置知识网络。", nodeTypes: [["concept", "概念"], ["definition", "定义"], ["example", "例子"], ["prerequisite", "前置知识"]], edgeTypes: [["defines", "定义"], ["example-of", "例子"], ["requires", "依赖"]], views: ["tree", "graph", "table"], strategy: "layered", artifacts: ["study-notes", "quiz"] }),
  pack({ id: "learning-path", name: "学习路径", category: "learning", description: "按依赖和阶段组织学习目标、材料和练习。", nodeTypes: [["goal", "目标"], ["module", "模块"], ["resource", "材料"], ["exercise", "练习"]], edgeTypes: [["precedes", "先于"], ["contains", "包含"]], views: ["flow", "timeline", "board"], strategy: "layered", direction: "left-right", artifacts: ["learning-plan", "checklist"] }),
  pack({ id: "entity-relationship", name: "实体关系", category: "research", description: "构建通用实体、属性和多类型关系图谱。", nodeTypes: [["entity", "实体"], ["attribute", "属性"], ["source", "来源"]], edgeTypes: [["relates-to", "关联"], ["has-attribute", "具有属性"]], views: ["graph", "table", "canvas"], strategy: "force", artifacts: ["knowledge-report"] }),
  pack({ id: "people-organization-network", name: "人物与组织网络", category: "research", description: "梳理人物、组织、角色、合作和影响关系。", nodeTypes: [["person", "人物"], ["organization", "组织"], ["role", "角色"], ["event", "事件"]], edgeTypes: [["member-of", "属于"], ["collaborates", "合作", false], ["influences", "影响"]], views: ["graph", "board", "timeline"], strategy: "cluster", artifacts: ["relationship-brief"] }),
  pack({ id: "causal-map", name: "因果地图", category: "research", description: "表达原因、机制、结果和反馈回路。", nodeTypes: [["cause", "原因"], ["mechanism", "机制"], ["effect", "结果"], ["feedback", "反馈"]], edgeTypes: [["causes", "导致"], ["amplifies", "增强"], ["reduces", "抑制"]], views: ["flow", "graph", "tree"], strategy: "layered", direction: "left-right", artifacts: ["causal-summary"], weights: { overlap: 10, crossings: 8, direction: 10, displacement: 1 } }),
  pack({ id: "event-timeline", name: "事件时间线", category: "research", description: "按时间组织事件、阶段、参与者和影响。", nodeTypes: [["event", "事件"], ["period", "阶段"], ["actor", "参与者"], ["impact", "影响"]], edgeTypes: [["precedes", "先于"], ["participates", "参与"], ["impacts", "影响"]], views: ["timeline", "graph", "table"], strategy: "timeline", artifacts: ["chronology"] }),
  pack({ id: "project-breakdown", name: "项目拆解", category: "planning", description: "拆分目标、里程碑、任务、依赖和负责人。", nodeTypes: [["project", "项目"], ["milestone", "里程碑"], ["task", "任务"], ["risk", "风险"]], edgeTypes: [["contains", "包含"], ["depends-on", "依赖"]], views: ["tree", "board", "timeline", "table"], strategy: "layered", artifacts: ["project-plan", "checklist"] }),
  pack({ id: "process-design", name: "流程设计", category: "planning", description: "设计步骤、判断、角色、输入和输出。", nodeTypes: [["start", "开始"], ["step", "步骤"], ["decision", "判断"], ["output", "输出"]], edgeTypes: [["next", "下一步"], ["branch", "分支"]], views: ["flow", "table", "canvas"], strategy: "layered", direction: "left-right", artifacts: ["sop", "checklist"] }),
];

export function getScenePack(id: string, version = "1.0.0") {
  return builtinScenePacks.find((candidate) => candidate.id === id && candidate.version === version) ?? null;
}
