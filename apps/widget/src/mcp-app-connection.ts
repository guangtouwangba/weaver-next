type ServerToolRequest = { name: string; arguments?: Record<string, unknown> };

function isCanvasClaim(request: ServerToolRequest) {
  const snapshot = request.arguments?.snapshot as { syncPurpose?: unknown } | undefined;
  return request.name === "weaver_sync_canvas_context" && snapshot?.syncPurpose === "claim";
}

type McpAppLike = {
  connect(): Promise<void>;
  close(): Promise<void>;
  callServerTool(request: ServerToolRequest): Promise<unknown>;
};

export function createMcpAppConnection(app: McpAppLike) {
  let connectPromise: Promise<void> | undefined;
  let resetPromise: Promise<void> | undefined;
  let activeCalls = 0;
  let resolveDrained: (() => void) | undefined;

  const waitUntilDrained = () => activeCalls === 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => { resolveDrained = resolve; });

  const callOnce = async (request: ServerToolRequest) => {
    activeCalls += 1;
    try {
      return await app.callServerTool(request);
    } finally {
      activeCalls -= 1;
      if (activeCalls === 0) {
        resolveDrained?.();
        resolveDrained = undefined;
      }
    }
  };

  const ensureConnected = (): Promise<void> => {
    if (resetPromise) return resetPromise.then(ensureConnected);
    if (!connectPromise) {
      connectPromise = app.connect().catch((error) => {
        connectPromise = undefined;
        throw error;
      });
    }
    return connectPromise;
  };

  const resetConnection = () => {
    if (!resetPromise) {
      // Stop new calls at ensureConnected(), but let calls already handed to the
      // shared Apps SDK connection finish before closing it. Closing eagerly here
      // turns one transient proxy failure into failures for every concurrent
      // bootstrap/claim request.
      resetPromise = waitUntilDrained()
        .then(() => {
          connectPromise = undefined;
          return app.close().catch(() => undefined);
        })
        .finally(() => { resetPromise = undefined; });
    }
    return resetPromise;
  };

  return {
    connect: ensureConnected,
    async callServerTool(request: ServerToolRequest) {
      await ensureConnected();
      try {
        return await callOnce(request);
      } catch (error) {
        await resetConnection();
        if (isCanvasClaim(request)) {
          await ensureConnected();
          try {
            return await callOnce(request);
          } catch (retryError) {
            await resetConnection();
            throw retryError;
          }
        }
        throw error;
      }
    },
  };
}
