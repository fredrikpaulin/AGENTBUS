import { test, expect, describe } from "bun:test";
import { createBus } from "../lib/bus.js";
import { createAgent } from "../lib/agent.js";
import { createFrame, validateFrame, frameSchema } from "../lib/schema.js";
import { setupBus, agent, cleanup } from "./helpers.js";

describe("public API exports (index.js)", () => {
  test("all exports are accessible from index.js", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.createBus).toBe("function");
    expect(typeof mod.createAgent).toBe("function");
    expect(typeof mod.createFrame).toBe("function");
    expect(typeof mod.validateFrame).toBe("function");
    expect(mod.frameSchema).toBeDefined();
    expect(mod.frameSchema.$schema).toBeDefined();
  });
});

describe("multi-agent network scenarios", () => {
  test("5 agents: selective channel routing", async () => {
    const { server, url } = await setupBus();
    const agents = Array.from({ length: 5 }, (_, i) =>
      agent(`node-${i}`, { url, frameId: i * 100 })
    );
    await Promise.all(agents.map((a) => a.connect()));

    // node-1 and node-2 subscribe to "telemetry"
    // node-3 subscribes to "commands"
    // node-4 subscribes to both
    agents[1].subscribe("telemetry");
    agents[2].subscribe("telemetry");
    agents[3].subscribe("commands");
    agents[4].subscribe("telemetry").subscribe("commands");

    const received = agents.map(() => []);
    agents.forEach((a, i) => a.on("data", (f) => received[i].push(f)));

    await Bun.sleep(150);

    agents[0].send("telemetry", "temp=22");
    agents[0].send("commands", "reboot");
    await Bun.sleep(300);

    // node-0 sent both, receives neither (sender exclusion)
    expect(received[0].length).toBe(0);
    // node-1: subscribed to telemetry only
    expect(received[1].length).toBe(1);
    expect(received[1][0].channel).toBe("telemetry");
    // node-2: subscribed to telemetry only
    expect(received[2].length).toBe(1);
    expect(received[2][0].channel).toBe("telemetry");
    // node-3: subscribed to commands only
    expect(received[3].length).toBe(1);
    expect(received[3][0].channel).toBe("commands");
    // node-4: subscribed to both
    expect(received[4].length).toBe(2);

    await cleanup(agents, server);
  });

  test("agent discovery: new agents announce via heartbeat", async () => {
    const { server, url } = await setupBus();
    const watcher = agent("watcher", { url, frameId: 10 });
    await watcher.connect();

    const discovered = [];
    watcher.on("heartbeat", (f) => {
      if (f.sender !== "watcher" && f.data?.status === "online") {
        discovered.push(f.sender);
      }
    });

    await Bun.sleep(100);

    // New agents join one by one
    const a = agent("joiner-a", { url, frameId: 20 });
    await a.connect();
    await Bun.sleep(100);

    const b = agent("joiner-b", { url, frameId: 30 });
    await b.connect();
    await Bun.sleep(100);

    expect(discovered).toContain("joiner-a");
    expect(discovered).toContain("joiner-b");

    await cleanup([watcher, a, b], server);
  });

  test("agent departure: offline heartbeat reaches remaining agents", async () => {
    const { server, url } = await setupBus();
    const a = agent("stayer", { url, frameId: 10 });
    const b = agent("leaver", { url, frameId: 20 });
    const c = agent("also-stays", { url, frameId: 30 });
    await Promise.all([a.connect(), b.connect(), c.connect()]);
    await Bun.sleep(100);

    const offlines = [];
    a.on("heartbeat", (f) => {
      if (f.data?.status === "offline") offlines.push(f.sender);
    });
    c.on("heartbeat", (f) => {
      if (f.data?.status === "offline") offlines.push(f.sender);
    });

    b.disconnect();
    await Bun.sleep(200);

    expect(offlines.filter((s) => s === "leaver").length).toBe(2); // both a and c got it

    await cleanup([a, c], server);
  });

  test("mixed priorities from multiple senders are correctly arbitrated", async () => {
    const { server, url } = await setupBus();
    const emergency = agent("emergency", { url, frameId: 1 });
    const normal = agent("normal", { url, frameId: 500 });
    const bulk = agent("bulk", { url, frameId: 1500 });
    const monitor = agent("monitor", { url, frameId: 2000 });
    await Promise.all([emergency.connect(), normal.connect(), bulk.connect(), monitor.connect()]);

    monitor.subscribe("data");
    const order = [];
    monitor.on("data", (f) => order.push(`${f.sender}:${f.priority}`));

    await Bun.sleep(150);

    // All send at roughly the same time
    bulk.send("data", "bulk-msg", 7);
    normal.send("data", "normal-msg", 4);
    emergency.send("data", "emergency-msg", 0);
    await Bun.sleep(300);

    // emergency (p=0, id=1) should come first
    expect(order[0]).toBe("emergency:0");
    // normal (p=4) before bulk (p=7)
    const normalIdx = order.indexOf("normal:4");
    const bulkIdx = order.indexOf("bulk:7");
    expect(normalIdx).toBeLessThan(bulkIdx);

    await cleanup([emergency, normal, bulk, monitor], server);
  });

  test("request/response pattern via channels", async () => {
    const { server, url } = await setupBus();
    const client = agent("client", { url, frameId: 10 });
    const service = agent("service", { url, frameId: 20 });
    await Promise.all([client.connect(), service.connect()]);

    // Service listens on its RPC channel
    service.subscribe("rpc:service");
    service.on("channel:rpc:service", (frame) => {
      const { replyChannel, payload } = frame.data;
      service.send(replyChannel, { result: payload.x + payload.y }, 2);
    });

    // Client subscribes to its reply channel
    const replyChannel = "reply:client:001";
    client.subscribe(replyChannel);

    const reply = new Promise((resolve) => {
      client.on(`channel:${replyChannel}`, (f) => resolve(f.data));
    });

    await Bun.sleep(150);
    client.send("rpc:service", { replyChannel, payload: { x: 3, y: 4 } }, 2);

    const result = await reply;
    expect(result).toEqual({ result: 7 });

    await cleanup([client, service], server);
  });

  test("rapid message burst is handled without loss", async () => {
    const { server, url } = await setupBus();
    const sender = agent("burst-s", { url, frameId: 10 });
    const receiver = agent("burst-r", { url, frameId: 20 });
    await Promise.all([sender.connect(), receiver.connect()]);

    receiver.subscribe("burst");
    const received = [];
    receiver.on("data", (f) => received.push(f.data));

    await Bun.sleep(100);

    const count = 50;
    for (let i = 0; i < count; i++) {
      sender.send("burst", i, 4);
    }

    await Bun.sleep(500);

    expect(received.length).toBe(count);
    // All values present (order may vary within arbitration windows)
    const sorted = [...received].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: count }, (_, i) => i));

    await cleanup([sender, receiver], server);
  });

  test("data payloads survive JSON round-trip intact", async () => {
    const { server, url } = await setupBus();
    const a = agent("json-sender", { url, frameId: 10 });
    const b = agent("json-recv", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    b.subscribe("json");
    const received = [];
    b.on("data", (f) => received.push(f.data));

    const payloads = [
      null,
      42,
      "hello",
      true,
      [1, [2, [3]]],
      { nested: { deep: { value: "ok" } } },
      { arr: [1, "two", null, false] },
    ];

    await Bun.sleep(100);
    for (const p of payloads) {
      a.send("json", p);
    }
    await Bun.sleep(400);

    expect(received.length).toBe(payloads.length);
    for (const p of payloads) {
      expect(received).toContainEqual(p);
    }

    await cleanup([a, b], server);
  });

  test("agent can subscribe, unsubscribe, then resubscribe", async () => {
    const { server, url } = await setupBus();
    const a = agent("resub-s", { url, frameId: 10 });
    const b = agent("resub-r", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    const received = [];
    b.on("data", (f) => received.push(f.data));

    // Subscribe
    b.subscribe("toggle");
    await Bun.sleep(100);
    a.send("toggle", "phase1");
    await Bun.sleep(200);
    expect(received.length).toBe(1);

    // Unsubscribe
    b.unsubscribe("toggle");
    await Bun.sleep(100);
    a.send("toggle", "phase2-missed");
    await Bun.sleep(200);
    expect(received.length).toBe(1);

    // Resubscribe
    b.subscribe("toggle");
    await Bun.sleep(100);
    a.send("toggle", "phase3");
    await Bun.sleep(200);
    expect(received.length).toBe(2);
    expect(received[1]).toBe("phase3");

    await cleanup([a, b], server);
  });
});
