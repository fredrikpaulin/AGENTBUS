import { createBus } from "./lib/bus.js";
import { createAgent } from "./lib/agent.js";

// Start the bus
const { server } = createBus({ port: 4444 });

// Give server a tick to be ready
await Bun.sleep(100);

// Create three agents with different frame IDs (lower = higher priority)
const sensor = createAgent("sensor-01", { frameId: 10 });   // high priority
const logger = createAgent("logger-01", { frameId: 500 });   // medium priority
const monitor = createAgent("monitor-01", { frameId: 1000 }); // low priority

// Connect all agents
await Promise.all([sensor.connect(), logger.connect(), monitor.connect()]);

// Logger subscribes to "telemetry" channel
logger.subscribe("telemetry");
logger.on("data", (frame) => {
  console.log(`[${logger.id}] got data from ${frame.sender} on ch:${frame.channel}`, frame.data);
});

// Monitor subscribes to "telemetry" and "alerts" channels
monitor.subscribe("telemetry");
monitor.subscribe("alerts");
monitor.on("data", (frame) => {
  console.log(`[${monitor.id}] got data from ${frame.sender} on ch:${frame.channel}`, frame.data);
});

// Listen for heartbeats to see who joins the network
monitor.on("heartbeat", (frame) => {
  console.log(`[${monitor.id}] heartbeat from ${frame.sender}:`, frame.data);
});

await Bun.sleep(200);

// Sensor sends telemetry data with high priority
sensor.send("telemetry", { temp: 72.5, unit: "F" }, 1);

// Sensor sends an alert with highest priority
sensor.send("alerts", { msg: "temperature spike detected" }, 0);

// Logger tries to broadcast (lower priority, will be delivered after higher priority msgs)
logger.send("telemetry", { note: "system nominal" }, 5);

await Bun.sleep(500);

// Disconnect and shut down
sensor.disconnect();
logger.disconnect();
monitor.disconnect();

await Bun.sleep(200);
server.stop();
console.log("\n[demo] done");
