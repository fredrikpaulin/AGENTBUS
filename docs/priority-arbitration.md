# Priority Arbitration

AgentBus implements CAN-style message priority arbitration to ensure that higher-priority messages are delivered before lower-priority ones, even when they arrive at the bus nearly simultaneously.

## How CAN arbitration works

On a real CAN bus, arbitration happens at the electrical level. When multiple nodes try to transmit at the same time, they each send their frame ID bit-by-bit. A node sending a "dominant" bit (0) wins over a node sending a "recessive" bit (1). The node with the lowest ID always wins, and losing nodes back off and retry. This is non-destructive — no data is lost, and the highest-priority message always gets through first.

## How AgentBus approximates it

Since WebSockets don't have bit-level contention, AgentBus uses a time-windowed priority queue:

1. When a frame arrives at the bus, it's pushed into a pending queue rather than delivered immediately.
2. If no flush is scheduled, a timer is set for `ARBITRATION_WINDOW_MS` (default: 5ms).
3. During this window, additional frames that arrive are also pushed into the queue.
4. When the timer fires, all pending frames are sorted by `priority` (ascending — lower number = higher priority), then by `id` (ascending — lower ID wins ties).
5. Frames are then delivered one by one in sorted order.

```
Time ─────────────────────────────────────►

  t=0ms    t=1ms    t=3ms         t=5ms (flush)
  ┌──────┐ ┌──────┐ ┌──────┐     ┌─── Delivery order:
  │P=7   │ │P=0   │ │P=3   │     │ 1. P=0 (emergency)
  │id=500│ │id=10 │ │id=200│     │ 2. P=3 (command)
  └──┬───┘ └──┬───┘ └──┬───┘     │ 3. P=7 (bulk)
     │        │        │          └───────────────────
     └────────┴────────┘
         Pending queue
```

## The arbitration window

The 5ms default is a balance between latency and batching effectiveness:

- **Shorter window (1–2ms):** Lower latency, but less opportunity to reorder competing messages. In practice, messages from different agents arriving over WebSocket often have >1ms jitter anyway.
- **Longer window (10–50ms):** More messages get batched and correctly ordered, but adds delivery latency to all messages.

The constant is defined at the top of `bus.js`:

```js
const ARBITRATION_WINDOW_MS = 5;
```

For real-time systems where ordering correctness matters more than latency, increase this value. For interactive systems where latency matters more, decrease it.

## Priority levels

Frames have a `priority` field from 0 (highest) to 7 (lowest):

| Value | Level | Typical use |
|-------|-------|-------------|
| 0 | Emergency | Safety-critical messages, system shutdown |
| 1 | Alert | Alarm conditions, threshold breaches |
| 2 | High | Urgent commands, time-sensitive control |
| 3 | Normal command | Standard command and control |
| 4 | Standard (default) | Regular data exchange |
| 5 | Low | Non-urgent data, status updates |
| 6 | Diagnostic | Logging, metrics, debug info |
| 7 | Bulk | Large transfers, background sync |

If no priority is specified, frames default to priority 4.

## Frame ID as tiebreaker

When two frames have the same priority, the frame with the lower numeric `id` (0–2047) is delivered first. This mirrors CAN, where the 11-bit identifier determines the winner during bit-by-bit arbitration.

In practice, you can assign lower frame IDs to agents whose messages should win ties. For example, a safety controller might use `frameId: 1` while a logging agent uses `frameId: 1500`.

```js
const safety = createAgent("safety", { frameId: 1 });    // wins ties
const logger = createAgent("logger", { frameId: 1500 });  // loses ties
```

## Limitations compared to real CAN

There are a few ways AgentBus arbitration differs from a real CAN bus:

**Not truly non-destructive.** On CAN, arbitration happens before any data is lost — the losing node simply backs off. In AgentBus, all frames are fully received by the bus before sorting. This means no data is lost, but it also means the bus must buffer all frames in the window.

**Network latency affects batching.** On a physical CAN bus, all contending transmissions overlap in real time. Over WebSockets, messages from different agents arrive with variable network delay, so two messages "sent at the same time" might land in different arbitration windows.

**No backpressure.** CAN nodes that lose arbitration automatically retry. AgentBus delivers all queued messages — there's no mechanism for an agent to know its message was delayed by a higher-priority one.

Despite these differences, the arbitration model provides meaningful priority ordering that is useful for systems where some messages are more time-sensitive than others.
