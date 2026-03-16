import { test, expect, describe } from "bun:test";
import { createAgent } from "../lib/agent.js";
import { setupBus, agent, cleanup } from "./helpers.js";

describe("createAgent", () => {
  test("sets id and frameId from arguments", () => {
    const a = createAgent("test-id", { frameId: 42 });
    expect(a.id).toBe("test-id");
    expect(a.frameId).toBe(42);
  });

  test("assigns random frameId when not provided", () => {
    const a = createAgent("rand");
    expect(a.frameId).toBeGreaterThanOrEqual(0);
    expect(a.frameId).toBeLessThanOrEqual(2047);
  });

  test("exposes all public methods", () => {
    const a = createAgent("api");
    expect(typeof a.connect).toBe("function");
    expect(typeof a.disconnect).toBe("function");
    expect(typeof a.heartbeat).toBe("function");
    expect(typeof a.subscribe).toBe("function");
    expect(typeof a.unsubscribe).toBe("function");
    expect(typeof a.addFilter).toBe("function");
    expect(typeof a.send).toBe("function");
    expect(typeof a.broadcast).toBe("function");
    expect(typeof a.on).toBe("function");
    expect(typeof a.off).toBe("function");
  });
});

describe("agent.connect", () => {
  test("resolves with the agent instance", async () => {
    const { server, url } = await setupBus();
    const a = agent("conn-resolve", { url, frameId: 10 });
    const result = await a.connect();
    expect(result).toBe(a);
    await cleanup([a], server);
  });

  test("emits connected event", async () => {
    const { server, url } = await setupBus();
    const a = agent("conn-evt", { url, frameId: 10 });
    let fired = false;
    a.on("connected", () => { fired = true; });
    await a.connect();
    expect(fired).toBe(true);
    await cleanup([a], server);
  });

  test("rejects when server is unreachable", async () => {
    const a = createAgent("no-server", { url: "ws://localhost:19999", heartbeatMs: 60000 });
    let rejected = false;
    try {
      await a.connect();
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});

describe("agent.disconnect", () => {
  test("emits disconnected event", async () => {
    const { server, url } = await setupBus();
    const a = agent("dc-evt", { url, frameId: 10 });
    await a.connect();

    let fired = false;
    a.on("disconnected", () => { fired = true; });
    a.disconnect();
    await Bun.sleep(100);
    expect(fired).toBe(true);

    server.stop(true);
  });
});

describe("agent events", () => {
  test("on returns agent for chaining", async () => {
    const a = createAgent("chain-on");
    const result = a.on("data", () => {});
    expect(result).toBe(a);
  });

  test("off removes a listener", async () => {
    const { server, url } = await setupBus();
    const a = agent("off-test", { url, frameId: 10 });
    const b = agent("off-sender", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    a.subscribe("off-ch");
    const received = [];
    const handler = (f) => received.push(f);
    a.on("data", handler);

    await Bun.sleep(100);
    b.send("off-ch", "first");
    await Bun.sleep(200);
    expect(received.length).toBe(1);

    a.off("data", handler);
    b.send("off-ch", "second");
    await Bun.sleep(200);
    expect(received.length).toBe(1); // still 1, handler removed

    await cleanup([a, b], server);
  });

  test("frame event fires for all incoming frames", async () => {
    const { server, url } = await setupBus();
    const a = agent("frame-all", { url, frameId: 10 });
    const b = agent("frame-sender", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    a.subscribe("fch");
    const frames = [];
    a.on("frame", (f) => frames.push(f));

    await Bun.sleep(100);
    b.send("fch", "msg");
    await Bun.sleep(200);

    // Should have heartbeat(s) + data frame
    const types = frames.map((f) => f.type);
    expect(types).toContain("data");

    await cleanup([a, b], server);
  });

  test("channel-specific event fires", async () => {
    const { server, url } = await setupBus();
    const a = agent("ch-evt-recv", { url, frameId: 10 });
    const b = agent("ch-evt-send", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    a.subscribe("specific");
    const specific = [];
    a.on("channel:specific", (f) => specific.push(f));

    await Bun.sleep(100);
    b.send("specific", "targeted");
    await Bun.sleep(200);

    expect(specific.length).toBe(1);
    expect(specific[0].data).toBe("targeted");

    await cleanup([a, b], server);
  });

  test("error event fires for bus errors", async () => {
    const { server, url } = await setupBus();
    // Connect raw WebSocket, send bad frame, check error comes back
    const ws = new WebSocket(url);
    await new Promise((r) => ws.addEventListener("open", r));

    const errors = [];
    ws.addEventListener("message", (e) => {
      const f = JSON.parse(e.data);
      if (f.type === "error") errors.push(f);
    });

    ws.send("garbage");
    await Bun.sleep(100);
    expect(errors.length).toBe(1);

    ws.close();
    await Bun.sleep(50);
    server.stop(true);
  });
});

describe("agent method chaining", () => {
  test("subscribe returns agent", () => {
    const a = createAgent("chain", { heartbeatMs: 60000 });
    expect(a.subscribe("ch")).toBe(a);
  });

  test("unsubscribe returns agent", () => {
    const a = createAgent("chain2", { heartbeatMs: 60000 });
    expect(a.unsubscribe("ch")).toBe(a);
  });

  test("addFilter returns agent", () => {
    const a = createAgent("chain3", { heartbeatMs: 60000 });
    expect(a.addFilter("id:42")).toBe(a);
  });

  test("on and off return agent", () => {
    const a = createAgent("chain4");
    const fn = () => {};
    expect(a.on("data", fn)).toBe(a);
    expect(a.off("data", fn)).toBe(a);
  });

  test("full chain works", async () => {
    const { server, url } = await setupBus();
    const a = agent("full-chain", { url, frameId: 10 });
    await a.connect();

    const result = a
      .subscribe("ch1")
      .subscribe("ch2")
      .addFilter("from:someone")
      .on("data", () => {});

    expect(result).toBe(a);
    await cleanup([a], server);
  });
});

describe("agent heartbeat", () => {
  test("heartbeat is sent on connect", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("hb-auto", { url, frameId: 10 });
    await a.connect();
    await Bun.sleep(100);

    expect(bus.heartbeats.has("hb-auto")).toBe(true);
    await cleanup([a], server);
  });

  test("manual heartbeat updates timestamp", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("hb-manual", { url, frameId: 10 });
    await a.connect();
    await Bun.sleep(100);

    const ts1 = bus.heartbeats.get("hb-manual");
    await Bun.sleep(50);
    a.heartbeat();
    await Bun.sleep(100);

    const ts2 = bus.heartbeats.get("hb-manual");
    expect(ts2).toBeGreaterThan(ts1);

    await cleanup([a], server);
  });
});
