# Examples

Practical patterns for common AgentBus scenarios.

## Minimal setup: one bus, two agents

```js
import { createBus } from "./bus.js";
import { createAgent } from "./agent.js";

const { server } = createBus({ port: 4444 });
await Bun.sleep(50);

const alice = createAgent("alice", { frameId: 10 });
const bob = createAgent("bob", { frameId: 20 });

await Promise.all([alice.connect(), bob.connect()]);

bob.subscribe("greetings");
bob.on("data", (f) => console.log(f.data.text));

await Bun.sleep(100);
alice.send("greetings", { text: "Hello Bob!" });

await Bun.sleep(200);
alice.disconnect();
bob.disconnect();
server.stop(true);
```

## Agent discovery via heartbeats

Track which agents are online by listening to heartbeats:

```js
const registry = new Map();

agent.on("heartbeat", (frame) => {
  if (frame.data?.status === "online") {
    registry.set(frame.sender, { frameId: frame.id, lastSeen: frame.timestamp });
  }
  if (frame.data?.status === "offline") {
    registry.delete(frame.sender);
  }
});

// Periodically check for stale agents (missed heartbeats)
setInterval(() => {
  const now = Date.now();
  for (const [id, info] of registry) {
    if (now - info.lastSeen > 10000) {
      console.log(`${id} appears stale`);
      registry.delete(id);
    }
  }
}, 5000);
```

## Request/response pattern

AgentBus is fire-and-forget by design, but you can build request/response on top using channels and correlation IDs:

```js
// Requester
function request(agent, target, payload) {
  return new Promise((resolve) => {
    const correlationId = crypto.randomUUID();
    const replyChannel = `reply:${agent.id}:${correlationId}`;

    agent.subscribe(replyChannel);
    const handler = (frame) => {
      if (frame.channel === replyChannel) {
        agent.off("data", handler);
        agent.unsubscribe(replyChannel);
        resolve(frame.data);
      }
    };
    agent.on("data", handler);
    agent.send(`rpc:${target}`, { correlationId, replyChannel, payload }, 2);
  });
}

// Responder
agent.subscribe("rpc:my-service");
agent.on("channel:rpc:my-service", (frame) => {
  const { correlationId, replyChannel, payload } = frame.data;
  const result = handleRequest(payload); // your logic
  agent.send(replyChannel, result, 2);
});

// Usage
const result = await request(client, "my-service", { action: "getStatus" });
```

## Priority-based traffic shaping

Use priority levels to ensure critical messages aren't delayed by bulk traffic:

```js
// Emergency stop — highest priority
agent.send("commands", { action: "emergency_stop" }, 0);

// Normal telemetry — default priority
agent.send("telemetry", { temp: 22.5 }, 4);

// Bulk data dump — lowest priority, won't delay anything else
agent.send("data-export", { rows: largeDataset }, 7);
```

When these messages arrive at the bus within the same arbitration window, the emergency stop is delivered first, then telemetry, then the bulk export.

## Monitoring all traffic

An agent can subscribe to everything by listening on the `"frame"` event, which fires for all received frames:

```js
const monitor = createAgent("monitor", { frameId: 2000 });
await monitor.connect();

// Subscribe to all channels you want to monitor
monitor.subscribe("telemetry");
monitor.subscribe("alerts");
monitor.subscribe("commands");

monitor.on("frame", (frame) => {
  const ts = new Date(frame.timestamp).toISOString();
  console.log(`${ts} [${frame.type}] ${frame.sender} -> ${frame.channel ?? "*"}: ${JSON.stringify(frame.data)}`);
});
```

Alternatively, use `addFilter` to monitor a specific agent's traffic across all channels:

```js
monitor.addFilter("from:sensor-01");
```

## Direct agent-to-agent communication

Use agent-specific channels for point-to-point messaging:

```js
// Agent "controller" wants to talk directly to "actuator-03"
controller.send("direct:actuator-03", { command: "open_valve", percent: 75 }, 2);

// Agent "actuator-03" subscribes to its own direct channel
actuator.subscribe("direct:actuator-03");
actuator.on("channel:direct:actuator-03", (frame) => {
  executeCommand(frame.data);
});
```

## Multiple bus instances

For testing or segmentation, run multiple buses on different ports:

```js
const { server: busProd } = createBus({ port: 4444 });
const { server: busTest } = createBus({ port: 4445 });

const prodAgent = createAgent("prod-sensor", { url: "ws://localhost:4444", frameId: 10 });
const testAgent = createAgent("test-sensor", { url: "ws://localhost:4445", frameId: 10 });

await Promise.all([prodAgent.connect(), testAgent.connect()]);
```

## Chaining agent methods

All agent methods that don't return data return the agent itself, so you can chain:

```js
const agent = createAgent("chained", { frameId: 50 });
await agent.connect();

agent
  .subscribe("telemetry")
  .subscribe("alerts")
  .addFilter("from:sensor-01")
  .on("data", (f) => console.log(f.data))
  .on("heartbeat", (f) => console.log(f.sender, "online"));
```

## Custom frame validation

Use the exported `validateFrame` and `frameSchema` for your own validation logic:

```js
import { validateFrame, frameSchema } from "./schema.js";

// Validate before sending raw WebSocket messages
const frame = { id: 42, type: "data", sender: "custom", data: { foo: "bar" }, priority: 2, timestamp: Date.now() };
const err = validateFrame(frame);
if (err) throw new Error(`Invalid frame: ${err}`);

// Use the JSON Schema with external tools
console.log(JSON.stringify(frameSchema, null, 2));
```

## Graceful shutdown

Close agents before stopping the bus to ensure departure heartbeats are broadcast:

```js
// Disconnect agents first
agent1.disconnect();
agent2.disconnect();

// Give the bus a moment to broadcast departure heartbeats
await Bun.sleep(200);

// Stop the server
server.stop(true);
```
