# Frame Schema

All messages on the AgentBus are structured as frames — JSON objects that follow a defined schema. This document covers the frame format, each field's semantics, the five frame types, and how validation works.

## JSON Schema definition

The canonical schema is exported from `schema.js` as `frameSchema`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["id", "type", "sender"],
  "properties": {
    "id":        { "type": "integer", "minimum": 0, "maximum": 2047 },
    "type":      { "type": "string", "enum": ["data", "heartbeat", "subscribe", "unsubscribe", "error"] },
    "sender":    { "type": "string", "minLength": 1 },
    "channel":   { "type": "string" },
    "data":      {},
    "priority":  { "type": "integer", "minimum": 0, "maximum": 7, "default": 4 },
    "timestamp": { "type": "integer" }
  },
  "additionalProperties": false
}
```

## Field reference

### `id` (integer, required)

An 11-bit numeric identifier ranging from 0 to 2047, mirroring the standard CAN frame identifier. This value serves two purposes: it identifies the frame type/source in a way that agents can filter on, and it acts as a tiebreaker during priority arbitration — lower IDs win when two frames have the same priority.

In CAN, the 11-bit ID determines both the message's meaning and its bus priority. AgentBus separates priority into its own field but keeps the ID for identification and as a secondary sort key.

### `type` (string, required)

The frame type. One of five values:

- `"data"` — Carries application payload. The primary message type.
- `"heartbeat"` — Presence announcement. Sent periodically by every agent. The bus broadcasts heartbeats to all connected agents regardless of subscriptions.
- `"subscribe"` — Requests a channel subscription (or registers an acceptance filter when the channel starts with `__filter:`). Handled by the bus; not forwarded.
- `"unsubscribe"` — Removes a subscription or filter. Handled by the bus; not forwarded.
- `"error"` — Sent by the bus back to an agent when validation fails or protocol rules are violated.

### `sender` (string, required)

The string ID of the agent that created the frame. Must be non-empty. The bus uses this to identify which WebSocket connection sent the frame and to prevent echo (frames are not sent back to their sender).

### `channel` (string, optional)

A named channel for targeted delivery. When a data frame has a channel, only agents subscribed to that channel (or with a matching acceptance filter) receive it. When `null` or absent, the frame is treated as a broadcast and delivered to all agents.

Channel names are arbitrary strings. Common conventions include dot-separated namespaces (`"sensors.temperature"`) or simple descriptive names (`"alerts"`, `"commands"`).

### `data` (any, optional)

The frame payload. Can be any JSON-serializable value: objects, arrays, strings, numbers, booleans, or `null`. The bus does not inspect or validate the data field — it's opaque application content.

### `priority` (integer, optional)

Arbitration priority from 0 (highest) to 7 (lowest). Defaults to 4 if not specified. During the arbitration window, frames with lower priority numbers are delivered first. When two frames share the same priority, the one with the lower `id` wins.

The 0–7 range gives you 8 priority levels. A suggested allocation:

| Priority | Suggested use |
|----------|---------------|
| 0 | Emergency / safety-critical |
| 1 | Alerts and alarms |
| 2 | High-priority commands |
| 3 | Normal commands |
| 4 | Standard data (default) |
| 5 | Low-priority data |
| 6 | Logging and diagnostics |
| 7 | Background / bulk transfer |

### `timestamp` (integer, optional)

Unix timestamp in milliseconds, set by `createFrame` to `Date.now()`. The bus does not validate or use this field — it's informational for receivers.

## Frame types in detail

### Data frames

The workhorse of the protocol. Agents call `agent.send(channel, data, priority)` or `agent.broadcast(data, priority)` to emit data frames. The bus queues them for priority arbitration and then routes them to appropriate recipients.

```js
{
  id: 10,
  type: "data",
  sender: "sensor-01",
  channel: "telemetry",
  data: { temp: 22.5, unit: "C" },
  priority: 2,
  timestamp: 1710600000000
}
```

### Heartbeat frames

Sent automatically when an agent connects and periodically thereafter. The first heartbeat registers the agent on the bus. All subsequent heartbeats update the last-seen timestamp and are broadcast to every other agent.

```js
{
  id: 10,
  type: "heartbeat",
  sender: "sensor-01",
  channel: null,
  data: { status: "online" },
  priority: 4,
  timestamp: 1710600000000
}
```

When an agent disconnects, the bus synthesizes an offline heartbeat and broadcasts it:

```js
{
  id: 0,
  type: "heartbeat",
  sender: "sensor-01",
  channel: null,
  data: { status: "offline" },
  priority: 4,
  timestamp: 1710600003000
}
```

### Subscribe / unsubscribe frames

Control frames that the bus processes but does not forward. When the channel starts with `__filter:`, the bus registers an acceptance filter instead of a channel subscription.

```js
// Channel subscription
{ id: 10, type: "subscribe", sender: "logger-01", channel: "telemetry", ... }

// Acceptance filter
{ id: 10, type: "subscribe", sender: "logger-01", channel: "__filter:from:sensor-01", ... }
```

### Error frames

Sent by the bus to the offending agent. Never broadcast. The `data` field contains a human-readable error string.

```js
{
  id: 0,
  type: "error",
  sender: "bus",
  channel: null,
  data: "id must be 0-2047",
  priority: 4,
  timestamp: 1710600000000
}
```

## Validation

The `validateFrame` function checks:

1. Frame is a non-null object
2. `id` is a number between 0 and 2047
3. `type` is one of the five valid types
4. `sender` is a non-empty string
5. `priority`, if present, is between 0 and 7

It returns `null` on success or the first error message string on failure. The bus validates every incoming frame and sends an error frame back if validation fails.
