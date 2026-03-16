import { createBus } from "../lib/bus.js";
import { createAgent } from "../lib/agent.js";

// Random starting port in the ephemeral range to avoid collisions
let portCounter = 10000 + Math.floor(Math.random() * 40000);

export function nextPort() {
  return portCounter++;
}

export async function setupBus(opts = {}) {
  const port = opts.port ?? nextPort();
  const { server, bus } = createBus({ port });
  await Bun.sleep(50);
  return { server, bus, port, url: `ws://localhost:${port}` };
}

export function agent(id, opts = {}) {
  return createAgent(id, { heartbeatMs: 60000, ...opts });
}

export async function cleanup(agents, server) {
  for (const a of agents) a.disconnect();
  await Bun.sleep(50);
  server.stop(true);
}
