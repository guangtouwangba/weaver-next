type Closable = { close(): void | Promise<void> };

export function createShutdown(server: Closable, eventHub: Closable, exit: (code: number) => void = (code) => process.exit(code)) {
  let shuttingDown = false;
  return async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.allSettled([
      Promise.resolve().then(() => server.close()),
      Promise.resolve().then(() => eventHub.close()),
    ]);
    exit(0);
  };
}
