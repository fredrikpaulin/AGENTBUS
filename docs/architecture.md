# Architecture

AgentBus is a message-oriented communication layer loosely modeled on the CAN (Controller Area Network) protocol. This document explains the system design, how it maps to CAN concepts, and the flow of data through the system.

## System overview

```
┌─────────┐     ws      ┌──────────────────────────┐     ws      ┌─────────┐
│ Agent A ├────────────►│         Bus Server         │◄───────────┤ Agent B │
│ id: 10  │◄────────────┤   (Bun.serve WebSocket)   ├───────────►│ id: 200 │
└─────────┘              │                          │              └─────────┘
                         │  - Frame validation       │
┌─────────┐     ws      │  - Priority arbitration   │     ws      ┌─────────┐
│ Agent C ├────────────►│  - Channel routing         │◄───────────┤ Agent D │
│ id: 500 │◄────────────┤  - Acceptance filtering   ├───────────►│ id: 800 │
└─────────┘              │  - Heartbeat tracking     │              └─────────┘
                         └──────────────────────────┘
```

The bus is a central WebSocket server. Agents are clients that connect to it. All routing logic lives on the bus — agents are intentionally simple and stateless with respect to the network topology.

## CAN protocol mapping

AgentBus translates CAN concepts into a WebSocket + JSON environment:

| CAN Concept | AgentBus Equivalent |
|---|---|
| Physical bus wire | WebSocket server (`Bun.serve`) |
| ECU (node) | Agent (`createAgent`) |
| CAN frame | JSON frame object |
| 11-bit identifier | `frame.id` field (0–2047) |
| Bus arbitration | Priority queue sorted by `priority` then `id` |
| Acceptance filter | `addFilter("id:N")` or `addFilter("from:agent")` |
| Error frame | Frame with `type: "error"` |
| Remote frame | Not implemented (pull-based requests could be added) |

## Key design decisions

### Hub topology instead of true broadcast

Real CAN uses a shared electrical bus where every node physically sees every bit. AgentBus uses a star topology with the bus server at the center. This is a pragmatic trade-off: WebSockets require a server, but the bus logic makes it behave like a shared medium from each agent's perspective.

### Arbitration via time-windowed sorting

CAN arbitration happens at the bit level — nodes back off when they detect a dominant bit they didn't send. AgentBus approximates this by collecting all messages that arrive within a 5ms window, then sorting them by priority and frame ID before delivery. This means messages sent in rapid succession get ordered correctly, while messages separated by more than 5ms are delivered in their own batch.

The 5ms window is defined by the `ARBITRATION_WINDOW_MS` constant in `bus.js` and can be tuned for your latency requirements.

### Registration via heartbeat

On a CAN bus, nodes don't need to "register" — they just start transmitting. In AgentBus, an agent must send at least one heartbeat before it can send other frame types. This lets the bus track which agents are online and associate a WebSocket connection with an agent ID. The heartbeat also serves as a keep-alive and presence announcement.

### Channel-based routing

CAN doesn't have "channels" — every node sees every frame and decides locally whether to process it. AgentBus adds channels as a routing layer on top. This reduces unnecessary traffic: agents only receive channel messages they've subscribed to. Broadcasts (frames with no channel) still go to everyone, preserving the CAN-like "everyone sees it" behavior when needed.

## Data flow

### Agent registration

1. Agent opens WebSocket connection to bus
2. Agent sends a `heartbeat` frame containing its `sender` ID
3. Bus stores the agent ID → WebSocket mapping
4. Bus broadcasts the heartbeat to all other connected agents
5. Agent begins periodic heartbeat interval (default 3 seconds)

### Sending a channel message

1. Agent calls `agent.send("channel-name", data, priority)`
2. Client creates a frame with `type: "data"` and sends it as JSON over WebSocket
3. Bus validates the frame
4. Bus pushes the frame into the pending queue
5. If no flush is scheduled, bus sets a 5ms timer
6. When the timer fires, all pending frames are sorted by priority (ascending) then frame ID (ascending)
7. Each frame is delivered to agents subscribed to its channel, or agents with a matching acceptance filter

### Broadcasting

Same as channel messages but with `channel: null`. The bus delivers to all agents except the sender, bypassing subscription checks.

## Module boundaries

The system is split into three modules with clear responsibilities:

**schema.js** — Pure data. Defines the frame JSON Schema, the `createFrame` factory, and the `validateFrame` validator. No I/O, no state.

**bus.js** — The server. Owns the WebSocket lifecycle, agent registry, subscription maps, filter sets, heartbeat tracking, the priority queue, and the arbitration flush loop.

**agent.js** — The client. Owns the WebSocket client connection, heartbeat timer, event emitter, and the public API for subscribing, sending, broadcasting, and filtering. No knowledge of bus internals.

## State management

All state lives on the bus server in four Maps:

- `agents` — Maps agent ID strings to their WebSocket connection
- `subscriptions` — Maps channel name strings to Sets of subscribed WebSocket connections
- `filters` — Maps WebSocket connections to Sets of acceptance filter strings
- `heartbeats` — Maps agent ID strings to their last heartbeat timestamp (unix ms)

When an agent disconnects, the bus cleans up all four maps and broadcasts an offline heartbeat to remaining agents.
