# AgentBus

A CAN bus-inspired agent communication layer built on Bun. Agents connect to a shared WebSocket bus, broadcast their presence via heartbeats, subscribe to channels, and exchange prioritized messages — similar to how ECUs communicate on a Controller Area Network.

## Quick start

```bash
bun install
bun demo.js
```

## Core concepts

AgentBus borrows key ideas from the CAN protocol and adapts them for agent-to-agent communication over WebSockets:

**Bus** — A single `Bun.serve()` WebSocket server acts as the shared wire. All agents connect to it. The bus handles message routing, priority arbitration, and subscription management.

**Agents** — Independent nodes that connect to the bus. Each agent has a string ID (its name) and a numeric frame ID (0–2047, 11-bit like standard CAN). The frame ID determines arbitration priority — lower numbers win.

**Frames** — All messages use a JSON Schema-defined frame format with fields for id, type, sender, channel, data, priority, and timestamp. Five frame types exist: `data`, `heartbeat`, `subscribe`, `unsubscribe`, and `error`.

**Priority arbitration** — Messages arriving within a 5ms window are sorted by priority (0 = highest, 7 = lowest), then by frame ID as a tiebreaker. This mirrors how CAN resolves bus contention using dominant/recessive bit arbitration.

**Channels** — Agents subscribe to named channels and only receive channel-targeted messages they've subscribed to. Messages sent without a channel broadcast to all agents.

**Acceptance filtering** — Agents can add filters like `id:42` or `from:sensor-01` to receive specific messages even without subscribing to their channel, similar to CAN hardware acceptance filters.

**Heartbeats** — Agents periodically announce their presence. Heartbeats always broadcast to every connected agent, enabling network-wide discovery.

## Usage

Start the bus:

```js
import { createBus } from "./lib/bus.js";
const { server, bus } = createBus({ port: 4444 });
```

Create and connect an agent:

```js
import { createAgent } from "./lib/agent.js";

const agent = createAgent("my-agent", { frameId: 100 });
await agent.connect();

agent.subscribe("telemetry");
agent.on("data", (frame) => console.log(frame.data));
agent.send("telemetry", { temp: 22.5 }, 2);
```

## Project structure

```
├── lib/
│   ├── schema.js       Frame JSON Schema, createFrame, validateFrame
│   ├── bus.js          WebSocket bus server with arbitration and routing
│   └── agent.js        Agent client with subscribe/send/broadcast/filter
├── tests/
│   ├── helpers.js      Shared test utilities
│   ├── schema.test.js  Frame schema and validation tests
│   ├── bus.test.js     Bus server and routing tests
│   ├── agent.test.js   Agent client and event tests
│   ├── filtering.test.js  Subscription and filter tests
│   └── integration.test.js  Multi-agent end-to-end tests
├── docs/
│   ├── getting-started.md
│   ├── architecture.md
│   ├── api-reference.md
│   ├── frame-schema.md
│   ├── priority-arbitration.md
│   ├── filtering.md
│   └── examples.md
├── index.js            Public API exports
├── demo.js             Multi-agent demo
├── package.json
├── CHANGELOG.md
└── README.md
```

## Tests

```bash
bun test
```

## Documentation

See the [docs/](docs/) folder for the full documentation suite.

## Requirements

- [Bun](https://bun.sh) v1.0+
