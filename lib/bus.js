import { validateFrame, createFrame } from "./schema.js";

// Priority queue — lower priority number wins (CAN-style arbitration)
// Messages are batched in a short time window then flushed in priority order
const pendingFrames = [];
let flushTimer = null;
const ARBITRATION_WINDOW_MS = 5;

function scheduleFlush(bus) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    // Sort: lower priority number = higher priority, then lower frame id wins ties
    pendingFrames.sort((a, b) => (a.frame.priority - b.frame.priority) || (a.frame.id - b.frame.id));
    while (pendingFrames.length) {
      const { frame, sender } = pendingFrames.shift();
      deliverFrame(bus, frame, sender);
    }
  }, ARBITRATION_WINDOW_MS);
}

function deliverFrame(bus, frame, senderWs) {
  const msg = JSON.stringify(frame);

  // Heartbeats broadcast to everyone
  if (frame.type === "heartbeat") {
    for (const ws of bus.agents.values()) {
      if (ws !== senderWs) ws.send(msg);
    }
    return;
  }

  // Data frames with a channel: only deliver to channel subscribers
  // Data frames without a channel (broadcast): deliver to all agents
  for (const ws of bus.agents.values()) {
    if (ws === senderWs) continue;

    if (frame.channel) {
      // Channel message — must be subscribed to channel OR have a matching acceptance filter
      const subs = bus.subscriptions.get(frame.channel);
      const filters = bus.filters.get(ws);
      const subscribedToChannel = subs?.has(ws);
      const matchesFilter = filters && (
        filters.has(`id:${frame.id}`) || filters.has(`from:${frame.sender}`)
      );
      if (!subscribedToChannel && !matchesFilter) continue;
    }
    // No channel = broadcast to all

    ws.send(msg);
  }
}

export function createBus(opts = {}) {
  const port = opts.port ?? 4444;

  const bus = {
    agents: new Map(),       // agentId -> ws
    subscriptions: new Map(), // channel -> Set<ws>
    filters: new Map(),       // ws -> Set<filterString>  (id:N, from:agentId)
    heartbeats: new Map(),    // agentId -> lastTimestamp
  };

  const server = Bun.serve({
    port,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("AgentBus CAN-like network", { status: 200 });
    },
    websocket: {
      open(ws) {
        ws.agentId = null;
        bus.filters.set(ws, new Set());
      },

      message(ws, raw) {
        let frame;
        try { frame = JSON.parse(raw); } catch {
          ws.send(JSON.stringify(createFrame("error", "bus", { data: "invalid JSON" })));
          return;
        }

        const err = validateFrame(frame);
        if (err) {
          ws.send(JSON.stringify(createFrame("error", "bus", { data: err })));
          return;
        }

        // Register agent on first heartbeat
        if (frame.type === "heartbeat") {
          if (!ws.agentId) {
            ws.agentId = frame.sender;
            bus.agents.set(frame.sender, ws);
          }
          bus.heartbeats.set(frame.sender, frame.timestamp);
          // Broadcast heartbeat so all agents know who's on the bus
          pendingFrames.push({ frame, sender: ws });
          scheduleFlush(bus);
          return;
        }

        // Must be registered (sent at least one heartbeat)
        if (!ws.agentId) {
          ws.send(JSON.stringify(createFrame("error", "bus", { data: "send heartbeat first to register" })));
          return;
        }

        if (frame.type === "subscribe" && frame.channel) {
          // __filter: prefix = acceptance filter, not a channel subscription
          if (frame.channel.startsWith("__filter:")) {
            const filter = frame.channel.slice(9); // strip "__filter:"
            bus.filters.get(ws)?.add(filter);
          } else {
            if (!bus.subscriptions.has(frame.channel)) bus.subscriptions.set(frame.channel, new Set());
            bus.subscriptions.get(frame.channel).add(ws);
          }
          return;
        }

        if (frame.type === "unsubscribe" && frame.channel) {
          if (frame.channel.startsWith("__filter:")) {
            bus.filters.get(ws)?.delete(frame.channel.slice(9));
          } else {
            bus.subscriptions.get(frame.channel)?.delete(ws);
          }
          return;
        }

        if (frame.type === "data") {
          pendingFrames.push({ frame, sender: ws });
          scheduleFlush(bus);
          return;
        }
      },

      close(ws) {
        if (ws.agentId) {
          bus.agents.delete(ws.agentId);
          bus.heartbeats.delete(ws.agentId);
          // Broadcast departure
          const departure = createFrame("heartbeat", ws.agentId, { data: { status: "offline" } });
          for (const other of bus.agents.values()) {
            other.send(JSON.stringify(departure));
          }
        }
        // Clean up subscriptions and filters
        for (const subs of bus.subscriptions.values()) subs.delete(ws);
        bus.filters.delete(ws);
      },
    },
  });

  console.log(`[bus] listening on ws://localhost:${server.port}`);
  return { server, bus };
}
