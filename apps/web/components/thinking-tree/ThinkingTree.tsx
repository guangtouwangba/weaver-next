import { Bot, Check, GitBranch, Minus, Plus, Send, Sparkles, Upload } from "lucide-react";
import { useThinkingTree } from "../../hooks/useThinkingTree";
import { Screen } from "../../lib/types";
import { ProjectTopbar } from "../ProjectTopbar";
import { SourceCard } from "./SourceCard";

export function ThinkingTree({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const {
    forest,
    focusedNodeId,
    setFocusedNodeId,
    focusedNode,
    context,
    proposals,
    treeStatus,
    composerText,
    setComposerText,
    acceptProposal,
    addComposerNode,
    edgePaths,
    branchCount
  } = useThinkingTree();

  return (
    <section className="think-page">
      <ProjectTopbar active="think" nodeCount={forest.nodes.length} branchCount={branchCount} setScreen={setScreen} />
      <div className="think-layout">
        <aside className="sources-panel">
          <div className="side-title">
            <strong>Sources</strong>
            <span className="mono-pill">OPTIONAL</span>
          </div>
          <p>Grounding is optional. With sources, answers carry sentence-level citations.</p>
          <SourceCard icon="P" title="State of Email New..." meta="PDF - 42 pages" cites="2 cited" />
          <SourceCard icon="A" title="The Attention Reces..." meta="theargument.com - article" cites="1 cited" expanded />
          <SourceCard icon="Q" title="Interview - B. Reed..." meta="Quick note - captured Jun 18" cites="0 cited" />
          <button className="import-box"><Upload size={15} /> Import URL / PDF / paste</button>
        </aside>
        <section className="tree-canvas">
          <svg className="edges" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
            {edgePaths.map((edge) => <path key={edge.id} d={edge.d} className={edge.active ? "strong" : ""} />)}
          </svg>
          {forest.nodes.map((node) => (
            <button key={node.id} className={`tree-node ${node.id === focusedNodeId ? "active" : ""} ${node.status === "dead_end" ? "dead" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} onClick={() => setFocusedNodeId(node.id)}>
              <span>{node.tag}</span>
              <strong>{node.title}</strong>
              <small>{node.status === "dead_end" ? "dead end" : "AI inference"} - {(forest.children[node.id] ?? []).length} forks</small>
            </button>
          ))}
          <div className="zoom-controls"><Minus size={14} /><span>61%</span><Plus size={14} /><span>Fit</span></div>
          <div className="composer">
            <span>CONTINUING FROM {focusedNode?.title.slice(0, 54)}</span>
            <div>
              <input
                placeholder="Ask the next question on this branch..."
                value={composerText}
                onChange={(event) => setComposerText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addComposerNode();
                }}
              />
              <button className="ghost-button" onClick={() => void addComposerNode()}><GitBranch size={15} /> Fork</button>
              <button className="send-button" onClick={() => void addComposerNode()}><Send size={18} /></button>
            </div>
          </div>
        </section>
        <aside className="node-detail">
          <span className="status thinking">PROMISING</span>
          <span className="detail-tag">{focusedNode?.tag}</span>
          <span className={`connection-pill ${treeStatus}`}>{treeStatus === "loading" ? "syncing tree" : treeStatus === "live" ? "api live" : "offline sample"}</span>
          <h2>{focusedNode?.title}</h2>
          <div className="context-box">
            <Check size={15} />
            <strong>Isolated context - {context?.chain.length ?? 0} nodes</strong>
          </div>
          <ul className="lineage">
            {(context?.chain ?? []).map((message) => (
              <li key={message.node_id} className={message.node_id === focusedNodeId ? "active" : ""}>{message.title}</li>
            ))}
          </ul>
          <p className="detail-copy">The AI on this branch sees only this lineage - sibling branches stay out of its context. That's the moat.</p>
          <p className="eyebrow">THREAD</p>
          <p>{focusedNode?.body}</p>
          <div className="hint">Not grounded - AI inference. Add a source to pressure-test it.</div>
          <div className="suggestions">
            <strong><Sparkles size={15} /> Weaver suggests splitting this</strong>
            {proposals.map((proposal) => (
              <button key={`${proposal.suggested_label}-${proposal.title}`} onClick={() => void acceptProposal(proposal)}>
                <Plus size={16} /> <span>{proposal.prompt}</span>
              </button>
            ))}
          </div>
          <button className="detail-action"><Upload size={15} /> Promote to argument point</button>
          <button className="detail-action muted"><Bot size={15} /> Mark dead end</button>
        </aside>
      </div>
    </section>
  );
}
