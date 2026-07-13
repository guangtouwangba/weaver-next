// Per-tab canvas session identity.
//
// `sessionStorage` survives a page reload but is scoped to a single tab (a new
// tab starts empty) — exactly the semantics a canvas session needs. Reusing the
// same session id across a reload means the reloaded page resumes the SAME
// server-side canvas session instead of minting a new one that has to fight the
// just-closed session for the binding (which briefly showed CANVAS_CLAIM_FAILED
// for the whole offline window). A genuinely new tab still gets its own id.
//
// The sync sequence is persisted alongside it: the server rejects stale/replayed
// sequence numbers, so a reload must continue strictly increasing rather than
// restart from 0 (which would trip STALE_CANVAS_SEQUENCE on reclaim).

const SID_KEY = "weaver:canvasSessionId";
const SEQ_KEY = "weaver:canvasSequence";

function safeSession(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** The current tab's canvas session id, stable across reloads, unique per tab. */
export function loadCanvasSessionId(): string {
  const store = safeSession();
  const existing = store?.getItem(SID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  try { store?.setItem(SID_KEY, id); } catch { /* private mode / disabled storage */ }
  return id;
}

/** The last persisted sync sequence for this tab (0 when fresh). */
export function loadCanvasSequence(): number {
  const raw = safeSession()?.getItem(SEQ_KEY);
  const value = raw ? Number(raw) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Persist the latest sync sequence so a reload continues from here. */
export function persistCanvasSequence(sequence: number): void {
  try {
    const store = safeSession();
    if (!store) return;
    const persisted = loadCanvasSequence();
    store.setItem(SEQ_KEY, String(Math.max(persisted, sequence)));
  } catch { /* ignore */ }
}

/** Serialize context writes so a later sequence cannot overtake an earlier request. */
export function createCanvasSyncQueue() {
  let tail = Promise.resolve();
  return function enqueue<T>(work: () => Promise<T>) {
    const next = tail.then(work, work);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
}

/**
 * Reserve the next sequence from the shared per-tab floor.
 *
 * Codex can briefly keep the inline iframe alive while mounting the fullscreen
 * iframe. Both documents then share sessionStorage but have separate React refs.
 * Reading the shared floor for every send prevents those overlapping instances
 * from emitting the same sequence and invalidating each other.
 */
export function reserveCanvasSequence(localSequence: number): number {
  const next = Math.max(localSequence, loadCanvasSequence()) + 1;
  persistCanvasSequence(next);
  return next;
}
