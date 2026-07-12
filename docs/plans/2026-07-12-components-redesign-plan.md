# Weaver 点·线·面 组件 Redesign — 实施计划

> **设计权威**: 根目录 `DESIGN.md`(Weaver Semantic Canvas Design System)。本计划是它的落地路线;凡冲突以 DESIGN.md 的视觉/交互规范为准,以 `AGENTS.md` 的仓库优先级解冲突。
> **日期**: 2026-07-12 · **状态**: 待评审

## Context(为什么做 / 已定决策)

把画布的三个基础组件按 DESIGN.md 重做。脑暴已定四条:
- 样式基准 = DESIGN.md token(近单色暗色 + 单蓝 accent,与 `docs/tapnow-canvas-design.md` 同源)。
- **点** = Heptabase/Notion 式:节点是**文档级块编辑器**——顶部工具栏、大标题、块正文(标题/粗体引导列表/编号列表/emoji 标题/块拖拽手柄)、`/` 命令 + `@` 引用空状态、**卡内直接编辑**(拖拽手势暂停)。⚠️ 这比"markdown 渲染 + textarea"重:需接块编辑器内核(TipTap/ProseMirror 级)——见 Phase 2。
- **面** = **可操作真组**:框选建组 / 改名 / 拖动整组 / 拖节点进出改成员;语义布局的聚类组升级为同一种可操作组。
- **线** = **语义默认 + 手动覆盖**:每种关系类型有出厂样式,选中后可手动改实/虚、箭头、直/曲(只影响当前视图)。

### 铁律(DESIGN.md § Authority boundary)
- 内容与语义关系属于 **Graph**;坐标/尺寸/路由/样式/投影/主题/视口属于当前视图的 **LayoutDocument**。
- **视觉变更绝不 bump `graphRevision`**。线的样式、组框、成员布局都是 layout 操作。
- 区域只有通过显式 Graph 操作才获得语义成员;拖框/改框永不隐式改图。

### 当前差距(已核实,file:line)
- 线:`edgeLayoutSchema`(`contracts/layout.ts:27`)有 `routing`,无 `lineStyle`/`arrows`;`edgeStyleSchema`(`contracts/visual.ts:32`)有 `dashed`+`marker(none|arrow)`,无双箭头、无按类型的语义默认(只有 `default`)。`WeaverEdge.tsx`(27 行)只 switch routing + 硬编码 `context-reference` 虚线。
- 点:`ContentCards.tsx` 的 DocumentCard 只显示 excerpt;`react-markdown@10` 已在依赖;读图路径把 document.markdown 裁掉(为省 agent 上下文)。
- 面:`groupLayoutSchema`(`contracts/layout.ts:38`,rect+direction+padding+collapsed)已存在;layout 操作有 `assign-node-to-group`/`set-group-frame`/`set-group-direction`(`:125-127`),**缺** `create-group`/`rename-group`/`delete-group` 与 group 的 `label`/`kind` 字段;组当前是 `zIndex:-1` 只读背景。

## 分阶段实施

> 顺序按「自包含度 × 可见价值」:先 token(地基)→ 线(最小自包含)→ 点(中)→ 面(最大)。每阶段独立可交付、独立可 review。

### Phase 0 · 设计 token 落地(地基,小)
- 把 DESIGN.md 的 `colors/typography/rounded/spacing` 精确映射为 `apps/widget/src/styles.css` 的 `:root` CSS 变量单一来源(暗色即默认,不做反色推导浅色)。补齐 DESIGN.md 有而现状缺的:`--surface-raised`、`--border-strong`、`--edge-muted`、`--group-fill`、`--group-border`、reading/metadata 字体族。
- 现有内联 `--node-*` 主题变量保留(canvas-theme.ts 仍算每节点),但其取值改为引用 DESIGN.md token。
- 验收:Phase 0 后所有组件颜色/圆角/字号取自 token;无散落硬编码 hex。

### Phase 1 · 线 · Typed Edges(小-中)
**contracts** `packages/contracts/src/layout.ts`、`visual.ts`
- `edgeLayoutSchema` 增 per-edge 视觉覆盖:`lineStyle: z.enum(["solid","dashed"]).optional()`、`arrows: z.enum(["none","forward","both"]).optional()`(可选=沿用语义默认;向后兼容)。
- `edgeStyleSchema` 把 `marker` 升级为 `arrows: z.enum(["none","forward","both"])`(保留 `dashed`;`routing` 已有;加 `curvature` 可选),这是**语义默认**的载体。
**语义默认** `canvas-theme.ts` + scene pack `edgeTypes`
- **默认路由 = 直线**(更规整、路由更稳);曲线是手动可选项。按关系类型出厂样式:`relates-to`=实线·**直**·单向;`has-attribute`=实线·直·单向;`association`=实线·**直**·无箭头;`reference`/引用=虚线·**直**·无箭头·`--edge-muted`。`canvasThemeForMode` 为每个 edgeType 生成 `edgeStyles[type]`,默认 `routing:"straight"`。
**渲染** `apps/widget/src/components/WeaverEdge.tsx`
- SVG `<marker>` 定义(单一箭头头型,定稿后统一):`markerStart` 用于 `both`、`markerEnd` 用于 `forward`/`both`。
- 解析优先级:edge 的 layout 覆盖 → 该类型语义默认 → 全局 default。渲染 `lineStyle`(strokeDasharray)、`arrows`、`routing`(直/曲/正交)。
- 状态(DESIGN.md § Edge states):选中=accent 蓝+2.5px;incident(端点被选)加强;非相关可 mute 但不消失;proposed=虚线+badge;断链=可操作错误态。
- **命中区**:透明加宽 stroke(hit area > 视觉 stroke,DESIGN.md § a11y)。label 用 canvas 色 chip,避让节点/箭头(已有 EdgeLabelRenderer,补避让)。
**手动覆盖** 新 `EdgeStyleBar`(floating-panel)
- 选中一条边 → 浮出小工具条,改实/虚、无/单/双箭头、直/曲 → 发 `set-edge-route` layout 操作(已存在,补 lineStyle/arrows 字段透传)。仅影响当前视图,不 bump graphRevision。
**测试**:schema 向后兼容(旧 layout 无新字段仍 parse);样式解析优先级(覆盖>语义>default)纯函数单测;WeaverEdge marker/dash 几何。

### Phase 2 · 点 · Notion 式文档块编辑器(大 — 范围已升级)
> 精细度对标 Heptabase:节点是**块编辑器**,不是"渲染一段 markdown"。这带来 `/` 命令、`@` 引用、块拖拽重排、块级选择——工作量和依赖都比原计划大一截。
**编辑器内核决策(需先定)**:选 **TipTap(ProseMirror 封装)** —— 成熟、可扩展块、React 友好、可序列化为 markdown。落库仍以 **markdown 为规范格式**(节点 `content.markdown` 不变),编辑器负责 markdown ⇄ 块的双向;避免图谱数据模型被块结构绑死。
**数据** 读图路径(`weaver_read_graph` / `useCanvasGraph`)
- document 节点带上 **截断的 markdown**(设上限,如 4–8KB;超长在专注视图才全量拉);agent 侧读取维持裁剪。`CardData` 加 `markdown?`。
**节点外壳** `NodeShell.tsx` + 新 `DocumentNode.tsx`
- 顶部工具栏(折叠/展开为专注/侧栏 · 更多/评论/分享),悬停或选中才浮现;大标题(title)与类型 kicker;蓝菱形连接/选中点。
- 节点状态(DESIGN.md § Node states)全做:resting/hover/selected/focused/pinned/proposed/stale/dimmed —— `data-*` + token 化 CSS,不靠颜色单编码。
**块编辑器** 新 `NodeBlockEditor.tsx`(TipTap)
- 块类型:段落、H1–H3、有序/无序列表、待办、引用、行内代码/代码块、图片、分割线。块 hover 出 ⠿ 拖拽手柄可重排;空块显示 `Type '/' or '@' for commands`。
- `/` 命令菜单(插入块)、`@` 引用(引用其它 Weaver 节点 → 建 reference 边,走 ChangeSet)。
- **卡内直接编辑**:进入即可打字;画布拖拽/框选手势暂停(DESIGN.md § a11y:手势不争抢);Esc/失焦保存,序列化回 markdown → `weaver_update_node_content`(或重构后等价 canvas action)。
- **安全**:TipTap 输出受控 schema,不注入任意 HTML;`@`/图片来源校验。
**LOD**(DESIGN.md § Zoom and LOD)
- full=完整块编辑器;compact=标题+首块只读;thumbnail=标题+silhouette。由有效 zoom(`canvas-wrap[data-lod]`)决定;选中/焦点多留一级。低 LOD 用只读渲染(不挂 TipTap 实例)省性能。
**测试**:markdown ⇄ 块 往返(round-trip 无损);`/` 命令插入块;`@` 引用产出 reference 边(ChangeSet);编辑保存路径;LOD 降级与只读渲染;XSS 输入不注入 HTML。
**依赖**:新增 `@tiptap/*`(react + starter-kit + 需要的扩展),打进 widget bundle(纯前端,无 CSP 问题)。

### Phase 3 · 面 · Operable Groups & Regions(大)
**contracts** `layout.ts`
- `groupLayoutSchema` 增 `label: z.string().optional()`、`kind: z.enum(["frame","interaction","semantic","projection"]).default("interaction")`(DESIGN.md § Plane 四类)。
- 新 layout 操作:`create-group`(id+frame+label+kind)、`rename-group`(groupId+label)、`delete-group`(groupId,仅解散框不删节点)。`core` 的 `applyLayoutOperations` + `diffLayoutDocuments` 补这三个。
**widget** 新 `RegionLayer` / 升级现有 group 背景渲染
- 框选空白 → 建 interaction group(marquee);双击标题改名;拖标题移动整组(带成员);拖节点进/出 → 改 `groupId` + 自动重算 group frame(padding 24)。区域渲染在节点/边之下(DESIGN.md § Region rules)。
- 四类区域视觉区分:frame(标题牌)/interaction(轻)/semantic(强边+成员说明)/projection(投影派生,只读、不可误当节点)。
- **不隐式改图**:建/改/移组只发 layout 操作;要变成语义区需显式 Graph 操作(单独跟进,不在本期)。
**语义布局衔接** `layout-engine`
- 现有 cluster 组 emit 时标 `kind:"semantic"` 或 `"interaction"`;重排尊重 `preserve.manualGroups`(已消费)。
**测试**:三个新 group 操作 round-trip(apply+diff);拖节点改成员 + frame 自动包含;删组不删节点。

## 跨阶段(DESIGN.md 强制,随各期落)
- **选择/焦点/上下文三态**(§ Selection):三种状态不可用同一个 ring 表达;多选一个集合框+个体归属提示。
- **动效**(§ Motion):hover/选择 90–180ms;视图/抽屉/预览 180–260ms;尊重 `prefers-reduced-motion`;不用动画掩盖 stale。
- **无障碍**(§ a11y):所有画布操作有键盘等价;命中区 ≥24px、主操作 40px;类型/状态/错误不靠颜色单编码。

## 验证(以 DESIGN.md § Canvas Acceptance Checklist 为验收门)
1. 点:每种节点类型在 resting/hover/selected/focused/pinned/proposed/error 都清晰。
2. 线:方向/类型/label/选中/proposed 不靠颜色也可辨。
3. 面:frame/交互组/语义区/投影区视觉可分。
4. 无 label 压节点/标题/箭头/其它 label;自动布局无重叠、不违反 pinned。
5. full/compact/thumbnail 保持身份与关键状态。
6. **graph-only 操作 bump graphRevision;layout-only 不 bump**(自动化测试守住)。
7. preview/apply/reject/undo/stale/offline/conflict 各态可测。
8. **双宿主**:Codex 全屏 widget + Claude 浏览器都过键盘/指针/zoom/resize/reduced-motion。
9. 控制台/网络无异常。
- 每阶段:`npx vitest run` 全绿 + `build:plugin` + 部署到缓存 `runtime/server.mjs`(用活探针验证,别只 grep dist)+ 双端目视。

## 风险与协调
- **并发重构冲突(最大风险)**:并发流正在做「rebuild as Codex fullscreen widget」,动 `main.tsx`/`mcp-client`/canvas 层。本计划大量改 widget 组件,**必须与其协调**:建议每阶段在 fix/feature 分支上做、rebase 到最新 master、显式 `git add <路径>` 不 `-A`,并在动 `WeaverEdge`/`ContentCards`/`useCanvasGraph` 前确认对方未同时在改。
- graphRevision 边界:所有新操作分类为 layout,自动化测试守住"视觉不 bump graphRevision"。
- markdown 安全:react-markdown 保持默认(不渲染原始 HTML),测试用 XSS 输入验证。
- 范围:本计划聚焦 DESIGN.md 的**点线面 + 其强制的状态/LOD/token**;更广的部分(完整投影区体系、完整动效系统、完整 a11y 审计)列为后续,YAGNI。
- 部署陷阱(已记入项目记忆):Codex 缓存跑 `runtime/server.mjs`,MCP 改动要 `build-mcp-bundle --outfile $CACHE/runtime/server.mjs` 并活探针验证。

## 建议实施顺序
Phase 0(token)→ Phase 1(线,含 contracts+theme+WeaverEdge+EdgeStyleBar+测试)→ Phase 2(点,含数据 plumb+markdown 渲染+卡内编辑+状态+LOD)→ Phase 3(面,含 contracts 组操作+RegionLayer 交互+语义布局衔接)。每期独立 PR。
