import { createFrame } from "./schema.js";

export function createAgent(agentId, opts = {}) {
  const url = opts.url ?? "ws://localhost:4444";
  const heartbeatInterval = opts.heartbeatMs ?? 3000;
  const frameId = opts.frameId ?? Math.floor(Math.random() * 2048); // 0-2047

  const listeners = new Map(); // event -> Set<fn>
  let ws = null;
  let heartbeatTimer = null;
  let connected = false;

  const agent = {
    id: agentId,
    frameId,

    connect() {
      return new Promise((resolve, reject) => {
        ws = new WebSocket(url);

        ws.addEventListener("open", () => {
          connected = true;
          // Send initial heartbeat to register on the bus
          agent.heartbeat();
          heartbeatTimer = setInterval(() => agent.heartbeat(), heartbeatInterval);
          emit("connected");
          resolve(agent);
        });

        ws.addEventListener("message", (event) => {
          let frame;
          try { frame = JSON.parse(event.data); } catch { return; }
          emit("frame", frame);
          if (frame.type === "heartbeat") emit("heartbeat", frame);
          if (frame.type === "data") emit("data", frame);
          if (frame.type === "error") emit("error", frame);
          if (frame.channel) emit(`channel:${frame.channel}`, frame);
        });

        ws.addEventListener("close", () => {
          connected = false;
          clearInterval(heartbeatTimer);
          emit("disconnected");
        });

        ws.addEventListener("error", (err) => {
          if (!connected) reject(err);
          emit("error", err);
        });
      });
    },

    disconnect() {
      clearInterval(heartbeatTimer);
      ws?.close();
    },

    heartbeat() {
      send(createFrame("heartbeat", agentId, { id: frameId, data: { status: "online" } }));
    },

    // Subscribe to a channel on the bus
    subscribe(channel) {
      send(createFrame("subscribe", agentId, { id: frameId, channel }));
      return agent;
    },

    unsubscribe(channel) {
      send(createFrame("unsubscribe", agentId, { id: frameId, channel }));
      return agent;
    },

    // Add acceptance filter (receive frames matching filter even without channel sub)
    // filter format: "id:123" or "from:agentName"
    addFilter(filter) {
      send(createFrame("subscribe", agentId, { id: frameId, channel: `__filter:${filter}`, data: { filter } }));
      return agent;
    },

    // Send data on a channel with optional priority
    send(channel, data, priority = 4) {
      send(createFrame("data", agentId, { id: frameId, channel, data, priority }));
      return agent;
    },

    // Broadcast data (no specific channel)
    broadcast(data, priority = 4) {
      send(createFrame("data", agentId, { id: frameId, data, priority }));
      return agent;
    },

    // Event listener
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return agent;
    },

    off(event, fn) {
      listeners.get(event)?.delete(fn);
      return agent;
    },
  };

  function send(frame) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  function emit(event, ...args) {
    for (const fn of listeners.get(event) ?? []) fn(...args);
  }

  return agent;
}
