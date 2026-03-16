# Getting Started

This guide walks you through installing AgentBus, launching a bus, and connecting your first agents.

## Prerequisites

AgentBus requires [Bun](https://bun.sh) v1.0 or later. Bun provides the WebSocket server, built-in test runner, and fast JavaScript runtime that AgentBus is optimized for.

Install Bun if you haven't:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Installation

Clone or copy the project, then install dependencies:

```bash
bun install
```

There are no external dependencies — AgentBus uses only Bun built-ins and the standard `WebSocket` API.

## Running the demo

The quickest way to see AgentBus in action:

```bash
bun demo.js
```

This starts a bus on port 4444 and connects three agents (a sensor, a logger, and a monitor) that exchange messages across channels with different priorities. You'll see heartbeat announcements, channel-targeted data delivery, and priority-ordered message output.

## Your first bus and agent

### Step 1: Start a bus

Create a file called `my-bus.js`:

```js
import { createBus } from "./bus.js";

const { server } = createBus({ port: 4444 });
```

Run it:

```bash
bun my-bus.js
```

The bus is now listening for WebSocket connections on `ws://localhost:4444`.

### Step 2: Connect an agent

In a second terminal, create `my-agent.js`:

```js
import { createAgent } from "./agent.js";

const agent = createAgent("greeter", { frameId: 50 });
await agent.connect();

agent.on("heartbeat", (frame) => {
  console.log(`Saw agent: ${frame.sender}`);
});

agent.on("data", (frame) => {
  console.log(`Got message on ${frame.channel}:`, frame.data);
});

agent.subscribe("chat");
```

Run it:

```bash
bun my-agent.js
```

### Step 3: Send a message from another agent

In a third terminal, create `my-sender.js`:

```js
import { createAgent } from "./agent.js";

const agent = createAgent("sender", { frameId: 100 });
await agent.connect();

// Wait a moment for both agents to be registered
await Bun.sleep(200);

agent.send("chat", { text: "Hello from sender!" }, 2);

await Bun.sleep(500);
agent.disconnect();
```

Run it:

```bash
bun my-sender.js
```

The greeter agent will print the received message.

## Next steps

- [Architecture](architecture.md) — understand how the bus, agents, and arbitration work together
- [API Reference](api-reference.md) — full documentation for every function and option
- [Frame Schema](frame-schema.md) — the JSON Schema that defines message frames
- [Priority Arbitration](priority-arbitration.md) — how CAN-style priority ordering works
- [Filtering](filtering.md) — acceptance filters and channel subscriptions
- [Examples](examples.md) — common patterns and recipes
