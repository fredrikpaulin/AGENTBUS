# Changelog

All notable changes to AgentBus will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-16

Initial release of AgentBus — a CAN bus-inspired agent communication layer built on Bun.

### Added

- **Bus server** (`bus.js`) — WebSocket hub using `Bun.serve()` that acts as the shared communication wire. Handles agent registration, message routing, and connection lifecycle.
- **Agent client** (`agent.js`) — Lightweight client with `connect`, `disconnect`, `subscribe`, `unsubscribe`, `send`, `broadcast`, `addFilter`, and event listener APIs. All mutating methods return the agent for chaining.
- **Frame schema** (`schema.js`) — JSON Schema (draft 2020-12) defining the CAN-like frame format with fields for `id` (11-bit, 0–2047), `type`, `sender`, `channel`, `data`, `priority` (0–7), and `timestamp`. Includes `createFrame` factory and `validateFrame` validator.
- **Priority arbitration** — Messages arriving within a 5ms window are sorted by priority (lower = higher priority), then by frame ID as a tiebreaker, mirroring CAN-style bus contention resolution.
- **Channel subscriptions** — Agents subscribe to named channels and only receive channel-targeted data frames they've opted into. Broadcasts (no channel) reach all agents.
- **Acceptance filtering** — Agents can register `id:N` or `from:agentId` filters to receive matching frames regardless of channel subscription, inspired by CAN hardware acceptance filters.
- **Heartbeat system** — Agents announce presence on connect and at a configurable interval (default 3s). Heartbeats broadcast to all agents. The bus synthesizes an offline heartbeat when an agent disconnects.
- **Frame validation** — Every incoming frame is validated on the bus. Invalid frames trigger an error frame sent back to the offending agent.
- **Public API** (`index.js`) — Re-exports `createBus`, `createAgent`, `createFrame`, `validateFrame`, and `frameSchema`.
- **Demo** (`demo.js`) — Three-agent scenario (sensor, logger, monitor) demonstrating channels, priority ordering, and heartbeat discovery.
- **Test suite** (`bus.test.js`) — 6 tests covering frame validation, agent messaging, priority arbitration, subscription filtering, and broadcast delivery.
- **Documentation** (`docs/`) — Getting started guide, architecture overview, full API reference, frame schema specification, priority arbitration deep dive, filtering and subscriptions guide, and examples with 10 common patterns.

[0.1.0]: https://github.com/agentbus/agentbus/releases/tag/v0.1.0
