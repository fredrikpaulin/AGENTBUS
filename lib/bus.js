import { validateFrame, createFrame } from "./schema.js";

// Priority queue — lower priority number wins (CAN-style arbitration)
// Messages are batched in a short time window then flushed in priority order
const ARBITRATION_WINDOW_MS = 5;

function addToIndex(index, key, ws) {
  if (!index.has(key)) index.set(key, new Set());
  index.get(key).add(ws);
}

function removeFromIndex(index, key, ws) {
  const entries = index.get(key);
  if (!entries) return;
  entries.delete(ws);
  if (entries.size === 0) index.delete(key);
}

function addFilter(bus, ws, filter) {
  const filters = bus.filters.get(ws);
  if (!filters || filters.has(filter)) return;

  filters.add(filter);

  if (filter.startsWith("id:")) {
    const id = Number(filter.slice(3));
    if (Number.isInteger(id) && id >= 0 && id <= 2047) addToIndex(bus.filtersById, id, ws);
    return;
  }

  if (filter.startsWith("from:")) {
    const sender = filter.slice(5);
    if (sender) addToIndex(bus.filtersBySender, sender, ws);
  }
}

function removeFilter(bus, ws, filter) {
  const filters = bus.filters.get(ws);
  if (!filters?.delete(filter)) return;

  if (filter.startsWith("id:")) {
    const id = Number(filter.slice(3));
    if (Number.isInteger(id)) removeFromIndex(bus.filtersById, id, ws);
    return;
  }

  if (filter.startsWith("from:")) {
    removeFromIndex(bus.filtersBySender, filter.slice(5), ws);
  }
}

function removeSubscription(bus, channel, ws) {
  const subs = bus.subscriptions.get(channel);
  if (!subs) return;
  subs.delete(ws);
  if (subs.size === 0) bus.subscriptions.delete(channel);
}

function sendFrame(bus, ws, msg) {
  try {
    const status = ws.send(msg);
    if (status === 0) {
      bus.deliveryStats.dropped++;
      return false;
    }
    if (status === -1) {
      bus.deliveryStats.backpressure++;
      return false;
    }
    bus.deliveryStats.sent++;
    return true;
  } catch {
    bus.deliveryStats.dropped++;
    return false;
  }
}

function deliverFrame(bus, frame, senderWs) {
  const msg = JSON.stringify(frame);

  // Heartbeats broadcast to everyone
  if (frame.type === "heartbeat") {
    for (const ws of bus.agents.values()) {
      if (ws !== senderWs) sendFrame(bus, ws, msg);
    }
    return;
  }

  // Data frames with a channel: only deliver to channel subscribers
  // Data frames without a channel (broadcast): deliver to all agents
  if (frame.channel) {
    const recipients = new Set();
    for (const ws of bus.subscriptions.get(frame.channel) ?? []) {
      if (ws !== senderWs) recipients.add(ws);
    }
    for (const ws of bus.filtersById.get(frame.id) ?? []) {
      if (ws !== senderWs) recipients.add(ws);
    }
    for (const ws of bus.filtersBySender.get(frame.sender) ?? []) {
      if (ws !== senderWs) recipients.add(ws);
    }

    for (const ws of recipients) sendFrame(bus, ws, msg);
    return;
  }

  // No channel = broadcast to all
  for (const ws of bus.agents.values()) {
    if (ws !== senderWs) sendFrame(bus, ws, msg);
  }
}

export function createBus(opts = {}) {
  const port = opts.port ?? 4444;
  const pendingFrames = [];
  let flushTimer = null;

  const bus = {
    agents: new Map(),       // agentId -> ws
    subscriptions: new Map(), // channel -> Set<ws>
    filters: new Map(),       // ws -> Set<filterString>  (id:N, from:agentId)
    filtersById: new Map(),   // frame id -> Set<ws>
    filtersBySender: new Map(), // sender id -> Set<ws>
    heartbeats: new Map(),    // agentId -> lastTimestamp
    deliveryStats: {
      sent: 0,
      backpressure: 0,
      dropped: 0,
    },
  };

  function enqueueFrame(frame, sender) {
    pendingFrames.push({ frame, sender });
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      // Sort: lower priority number = higher priority, then lower frame id wins ties
      pendingFrames.sort((a, b) => (a.frame.priority - b.frame.priority) || (a.frame.id - b.frame.id));
      const batch = pendingFrames.splice(0);
      for (const { frame, sender } of batch) deliverFrame(bus, frame, sender);
    }, ARBITRATION_WINDOW_MS);
  }

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
          sendFrame(bus, ws, JSON.stringify(createFrame("error", "bus", { data: "invalid JSON" })));
          return;
        }

        const err = validateFrame(frame);
        if (err) {
          sendFrame(bus, ws, JSON.stringify(createFrame("error", "bus", { data: err })));
          return;
        }
        frame.channel ??= null;
        frame.data ??= null;
        frame.priority ??= 4;
        frame.timestamp ??= Date.now();

        // Register agent on first heartbeat
        if (frame.type === "heartbeat") {
          if (!ws.agentId) {
            if (bus.agents.has(frame.sender)) {
              sendFrame(bus, ws, JSON.stringify(createFrame("error", "bus", { data: "agent id already registered" })));
              ws.close(1008, "agent id already registered");
              return;
            }
            ws.agentId = frame.sender;
            bus.agents.set(frame.sender, ws);
          } else if (frame.sender !== ws.agentId) {
            sendFrame(bus, ws, JSON.stringify(createFrame("error", "bus", { data: "frame sender must match registered agent" })));
            return;
          }
          bus.heartbeats.set(frame.sender, frame.timestamp);
          // Broadcast heartbeat so all agents know who's on the bus
          enqueueFrame(frame, ws);
          return;
        }

        // Must be registered (sent at least one heartbeat)
        if (!ws.agentId) {
          sendFrame(bus, ws, JSON.stringify(createFrame("error", "bus", { data: "send heartbeat first to register" })));
          return;
        }

        if (frame.sender !== ws.agentId) {
          sendFrame(bus, ws, JSON.stringify(createFrame("error", "bus", { data: "frame sender must match registered agent" })));
          return;
        }

        if (frame.type === "subscribe" && frame.channel) {
          // __filter: prefix = acceptance filter, not a channel subscription
          if (frame.channel.startsWith("__filter:")) {
            const filter = frame.channel.slice(9); // strip "__filter:"
            addFilter(bus, ws, filter);
          } else {
            if (!bus.subscriptions.has(frame.channel)) bus.subscriptions.set(frame.channel, new Set());
            bus.subscriptions.get(frame.channel).add(ws);
          }
          return;
        }

        if (frame.type === "unsubscribe" && frame.channel) {
          if (frame.channel.startsWith("__filter:")) {
            removeFilter(bus, ws, frame.channel.slice(9));
          } else {
            removeSubscription(bus, frame.channel, ws);
          }
          return;
        }

        if (frame.type === "data") {
          enqueueFrame(frame, ws);
          return;
        }
      },

      close(ws) {
        if (ws.agentId && bus.agents.get(ws.agentId) === ws) {
          bus.agents.delete(ws.agentId);
          bus.heartbeats.delete(ws.agentId);
          // Broadcast departure
          const departure = createFrame("heartbeat", ws.agentId, { data: { status: "offline" } });
          for (const other of bus.agents.values()) {
            sendFrame(bus, other, JSON.stringify(departure));
          }
        }
        // Clean up subscriptions and filters
        for (const [channel, subs] of bus.subscriptions) {
          subs.delete(ws);
          if (subs.size === 0) bus.subscriptions.delete(channel);
        }
        for (const filter of [...(bus.filters.get(ws) ?? [])]) removeFilter(bus, ws, filter);
        bus.filters.delete(ws);
      },
      backpressureLimit: opts.backpressureLimit,
      closeOnBackpressureLimit: opts.closeOnBackpressureLimit,
      maxPayloadLength: opts.maxPayloadLength,
      idleTimeout: opts.idleTimeout,
    },
  });

  console.log(`[bus] listening on ws://localhost:${server.port}`);
  return { server, bus };
}
