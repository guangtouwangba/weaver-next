import { afterEach, describe, expect, it, vi } from "vitest";
import { createCanvasSyncQueue, loadCanvasSequence, persistCanvasSequence, reserveCanvasSequence } from "../lib/canvas-session";

function memorySessionStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

describe("canvas session sequence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes context writes so sequence N cannot arrive after N+1", async () => {
    const enqueue = createCanvasSyncQueue();
    const arrivals: number[] = [];
    let release!: () => void;
    const first = enqueue(async () => { await new Promise<void>((resolve) => { release = resolve; }); arrivals.push(1); });
    const second = enqueue(async () => { arrivals.push(2); });
    await Promise.resolve();
    expect(arrivals).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(arrivals).toEqual([1, 2]);
  });

  it("allocates distinct monotonic sequences across overlapping widget instances", () => {
    vi.stubGlobal("window", { sessionStorage: memorySessionStorage() });
    persistCanvasSequence(7);

    const firstInstance = reserveCanvasSequence(1);
    const secondInstance = reserveCanvasSequence(1);

    expect(firstInstance).toBe(8);
    expect(secondInstance).toBe(9);
    expect(loadCanvasSequence()).toBe(9);
  });

  it("does not let a late lower acknowledgement move the shared floor backwards", () => {
    vi.stubGlobal("window", { sessionStorage: memorySessionStorage() });
    persistCanvasSequence(12);
    persistCanvasSequence(8);
    expect(loadCanvasSequence()).toBe(12);
  });
});
