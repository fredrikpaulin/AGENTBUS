# Filtering and Subscriptions

AgentBus provides two complementary mechanisms for controlling which messages an agent receives: channel subscriptions and acceptance filters. Together, they determine the routing of every data frame on the bus.

## Message delivery rules

The bus applies these rules when routing a data frame:

1. **Broadcast (no channel):** If the frame has no `channel` (null), it's delivered to every connected agent except the sender. No subscription or filter required.
2. **Channel message:** If the frame has a `channel`, it's only delivered to agents that meet at least one of these conditions:
   - The agent is subscribed to that channel, OR
   - The agent has an acceptance filter matching the frame's `id` or `sender`

Heartbeat frames bypass these rules entirely and are always broadcast to all agents.

## Channel subscriptions

Channels are named topics that agents opt into. An agent must explicitly subscribe to receive messages on a channel.

```js
const agent = createAgent("my-agent", { frameId: 100 });
await agent.connect();

// Subscribe to one or more channels
agent.subscribe("telemetry");
agent.subscribe("alerts");

// Listen for data on subscribed channels
agent.on("data", (frame) => {
  console.log(`[${frame.channel}]`, frame.data);
});
```

To stop receiving messages on a channel:

```js
agent.unsubscribe("telemetry");
```

Subscriptions take effect immediately on the bus. There's no acknowledgment frame — the next matching message will (or won't) be delivered.

### Channel naming

Channel names are arbitrary strings. There are no reserved names (except the internal `__filter:` prefix used by the acceptance filter mechanism). Some useful conventions:

- Simple names: `"alerts"`, `"commands"`, `"telemetry"`
- Dot-separated namespaces: `"sensors.temperature"`, `"sensors.pressure"`
- Agent-specific channels: `"agent:sensor-01:status"` (for direct communication)

### Channel-specific events

In addition to the general `"data"` event, agents emit a `"channel:<name>"` event for each frame that has a channel:

```js
agent.on("channel:alerts", (frame) => {
  // Only fires for frames on the "alerts" channel
  console.log("Alert:", frame.data);
});
```

This lets you register targeted handlers without filtering in a single `"data"` callback.

## Acceptance filters

Acceptance filters are inspired by CAN hardware acceptance filters, which allow a node to receive specific frame IDs even if it hasn't "subscribed" to them (CAN doesn't have subscriptions — every node sees every frame by default, and acceptance filters let hardware discard unwanted ones).

In AgentBus, acceptance filters serve the opposite purpose: they let an agent receive frames on channels it hasn't subscribed to, based on the frame's numeric ID or sender.

### Filter types

Two filter formats are supported:

**ID filter** — Matches frames by their numeric `id` field:

```js
agent.addFilter("id:42");
// Now receives any frame with id=42, regardless of channel
```

**Sender filter** — Matches frames by their `sender` field:

```js
agent.addFilter("from:sensor-01");
// Now receives any frame from sensor-01, regardless of channel
```

### When to use filters vs. subscriptions

Use **subscriptions** when you care about a topic regardless of who's sending:

```js
// "I want all telemetry, from any agent"
agent.subscribe("telemetry");
```

Use **filters** when you care about a specific source regardless of what channel they're using:

```js
// "I want everything from sensor-01, no matter what channel"
agent.addFilter("from:sensor-01");
```

Or when you want frames with a specific numeric ID for protocol-level routing:

```js
// "I want all frames with ID 42, which my system uses for emergency stop"
agent.addFilter("id:42");
```

### How filters work internally

When an agent calls `addFilter("from:sensor-01")`, the client sends a subscribe frame with `channel: "__filter:from:sensor-01"`. The bus recognizes the `__filter:` prefix and stores `"from:sensor-01"` in the agent's filter set rather than creating an actual channel subscription.

During delivery, for each channel-targeted frame, the bus checks:
1. Is the recipient subscribed to the frame's channel? → deliver
2. Does the recipient have a filter matching `id:<frame.id>`? → deliver
3. Does the recipient have a filter matching `from:<frame.sender>`? → deliver
4. None of the above → skip

## Combining subscriptions and filters

Subscriptions and filters are additive. An agent can use both:

```js
agent.subscribe("alerts");           // Get all alerts
agent.addFilter("from:sensor-01");   // Also get everything from sensor-01

// This agent will receive:
// - Any frame on the "alerts" channel (from any sender)
// - Any frame from sensor-01 (on any channel)
// - All broadcasts (no channel)
// - All heartbeats
```

## Heartbeat visibility

Heartbeats are always delivered to all agents regardless of subscriptions or filters. You don't need to subscribe to anything to receive heartbeats. This ensures every agent can discover other agents on the network.

```js
agent.on("heartbeat", (frame) => {
  if (frame.data?.status === "online") {
    console.log(`${frame.sender} joined the bus`);
  }
  if (frame.data?.status === "offline") {
    console.log(`${frame.sender} left the bus`);
  }
});
```
