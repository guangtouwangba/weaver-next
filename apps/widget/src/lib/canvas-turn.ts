/**
 * The full user-turn text injected into the Codex chat when the user submits the
 * on-canvas composer. It must be SELF-CONTAINED: `updateModelContext` content is
 * invisible and hosts may not attach it to the turn, so the selection summary and
 * the read-the-canvas protocol ride inside the message itself. The host shows this
 * exact text in its send-confirmation dialog, so the user sees what the agent sees.
 */
export function composeCanvasTurnMessage(instruction: string, contextText?: string): string {
  return [
    `【Weaver 画布】${contextText ?? "当前未选中任何节点。"}`,
    `用户在画布输入框提交了指令：${instruction}`,
    "请先调用 weaver_get_bound_canvas 读取当前绑定画布的权威选区与上下文（需要节点全文时用 weaver_get_node_content）；如需修改画布内容，必须通过 weaver_submit_changeset 提交变更集，由用户在画布上确认。",
  ].join("\n");
}
