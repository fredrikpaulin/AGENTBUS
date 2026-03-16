# API Reference

## Module: schema.js

### `frameSchema`

The JSON Schema (draft 2020-12) object describing the frame format. Can be used for external validation tooling or documentation generation.

### `createFrame(type, sender, opts)`

Creates a new frame object.

**Parameters:**

- `type` (string, required) — One of: `"data"`, `"heartbeat"`, `"subscribe"`, `"unsubscribe"`, `"error"`
- `sender` (string, required) — Agent ID of the sender
- `opts` (object, optional):
  - `id` (integer) — Frame ID, 0–2047. Defaults to `0`
  - `channel` (string) — Target channel name. Defaults to `null`
  - `data` (any) — Arbitrary payload. Defaults to `null`
  - `priority` (integer) — Priority 0–7 where 0 is highest. Defaults to `4`

**Returns:** A frame object with all fields populated and `timestamp` set to `Date.now()`.

```js
import { createFrame } from "./schema.js";

const frame = createFrame("data", "my-agent", {
  id: 42,
  channel: "telemetry",
  data: { temp: 22.5 },
  priority: 1,
});
```

### `validateFrame(frame)`

Validates a frame object against the schema rules.

**Parameters:**

- `frame` (any) — The value to validate

**Returns:** `null` if valid, or a string describing the first validation error found.

```js
import { validateFrame } from "./schema.js";

const err = validateFrame(someFrame);
if (err) console.error("Bad frame:", err);
```

---

## Module: bus.js

### `createBus(opts)`

Creates and starts the WebSocket bus server.

**Parameters:**

- `opts` (object, optional):
  - `port` (integer) — Port to listen on. Defaults to `4444`

**Returns:** An object with:
- `server` — The `Bun.serve()` server instance. Call `server.stop(true)` to shut down immediately
- `bus` — The internal bus state object containing `agents`, `subscriptions`, `filters`, and `heartbeats` Maps

```js
import { createBus } from "./bus.js";

const { server, bus } = createBus({ port: 5555 });

// Later:
server.stop(true);
```

The bus server accepts WebSocket upgrade requests on any path. A plain HTTP GET returns a `200` text response identifying the service.

---

## Module: agent.js

### `createAgent(agentId, opts)`

Creates a new agent instance (does not connect automatically).

**Parameters:**

- `agentId` (string, required) — Unique identifier for this agent on the bus
- `opts` (object, optional):
  - `url` (string) — WebSocket URL of the bus. Defaults to `"ws://localhost:4444"`
  - `heartbeatMs` (integer) — Heartbeat interval in milliseconds. Defaults to `3000`
  - `frameId` (integer) — Numeric frame ID, 0–2047. Used for arbitration tiebreaking. Defaults to a random value

**Returns:** An agent object with the methods described below.

```js
import { createAgent } from "./agent.js";

const agent = createAgent("sensor-01", {
  url: "ws://localhost:4444",
  frameId: 10,
  heartbeatMs: 5000,
});
```

### Agent properties

- `agent.id` (string) — The agent's string ID
- `agent.frameId` (integer) — The agent's numeric frame ID

### `agent.connect()`

Opens a WebSocket connection to the bus and sends the initial heartbeat to register.

**Returns:** A Promise that resolves with the agent instance once connected, or rejects on connection error.

```js
await agent.connect();
```

### `agent.disconnect()`

Closes the WebSocket connection and stops the heartbeat timer.

```js
agent.disconnect();
```

### `agent.heartbeat()`

Manually sends a heartbeat frame. Called automatically on connect and at the configured interval. Rarely needed directly.

### `agent.subscribe(channel)`

Subscribes to a named channel. The agent will receive `data` frames sent to this channel.

**Parameters:**

- `channel` (string) — Channel name to subscribe to

**Returns:** The agent (for chaining).

```js
agent.subscribe("telemetry").subscribe("alerts");
```

### `agent.unsubscribe(channel)`

Removes a channel subscription.

**Parameters:**

- `channel` (string) — Channel name to unsubscribe from

**Returns:** The agent (for chaining).

### `agent.send(channel, data, priority)`

Sends a data frame to a specific channel.

**Parameters:**

- `channel` (string) — Target channel
- `data` (any) — Payload
- `priority` (integer, optional) — Priority 0–7. Defaults to `4`

**Returns:** The agent (for chaining).

```js
agent.send("telemetry", { temp: 22.5 }, 1);
```

### `agent.broadcast(data, priority)`

Sends a data frame with no channel. All connected agents receive it regardless of their subscriptions.

**Parameters:**

- `data` (any) — Payload
- `priority` (integer, optional) — Priority 0–7. Defaults to `4`

**Returns:** The agent (for chaining).

```js
agent.broadcast({ msg: "system reboot in 60s" }, 0);
```

### `agent.addFilter(filter)`

Adds an acceptance filter so the agent receives matching frames even without subscribing to their channel.

**Parameters:**

- `filter` (string) — Filter expression. Supported formats:
  - `"id:N"` — Match frames with numeric ID `N`
  - `"from:agentId"` — Match frames from a specific sender

**Returns:** The agent (for chaining).

```js
agent.addFilter("from:sensor-01");
agent.addFilter("id:42");
```

### `agent.on(event, fn)`

Registers an event listener.

**Parameters:**

- `event` (string) — Event name
- `fn` (function) — Callback

**Returns:** The agent (for chaining).

**Events:**

| Event | Callback signature | Description |
|---|---|---|
| `"connected"` | `()` | WebSocket connection opened and registered |
| `"disconnected"` | `()` | WebSocket connection closed |
| `"frame"` | `(frame)` | Any frame received (all types) |
| `"heartbeat"` | `(frame)` | Heartbeat frame received |
| `"data"` | `(frame)` | Data frame received |
| `"error"` | `(frame \| Error)` | Error frame or WebSocket error |
| `"channel:<name>"` | `(frame)` | Frame received on a specific channel |

```js
agent.on("data", (frame) => {
  console.log(frame.sender, frame.data);
});

agent.on("channel:alerts", (frame) => {
  console.log("Alert!", frame.data);
});
```

### `agent.off(event, fn)`

Removes an event listener.

**Parameters:**

- `event` (string) — Event name
- `fn` (function) — The exact function reference to remove

**Returns:** The agent (for chaining).
