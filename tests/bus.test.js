import { test, expect, describe } from "bun:test";
import { createBus } from "../lib/bus.js";
import { setupBus, agent, cleanup, nextPort } from "./helpers.js";

describe("bus server lifecycle", () => {
  test("createBus returns server and bus objects", () => {
    const { server, bus } = createBus({ port: nextPort() });
    expect(server).toBeDefined();
    expect(bus).toBeDefined();
    expect(bus.agents).toBeInstanceOf(Map);
    expect(bus.subscriptions).toBeInstanceOf(Map);
    expect(bus.filters).toBeInstanceOf(Map);
    expect(bus.heartbeats).toBeInstanceOf(Map);
    server.stop(true);
  });

  test("bus responds to HTTP GET", async () => {
    const { server, port } = await setupBus();
    const res = await fetch(`http://localhost:${port}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("AgentBus CAN-like network");
    server.stop(true);
  });

  test("bus accepts WebSocket upgrades", async () => {
    const { server, url } = await setupBus();
    const ws = new WebSocket(url);
    await new Promise((resolve) => ws.addEventListener("open", resolve));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await Bun.sleep(50);
    server.stop(true);
  });
});

describe("bus agent registration", () => {
  test("agent is registered in bus.agents after heartbeat", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("reg-test", { url, frameId: 10 });
    await a.connect();

    await Bun.sleep(100);
    expect(bus.agents.has("reg-test")).toBe(true);

    await cleanup([a], server);
  });

  test("agent is removed from bus.agents on disconnect", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("dc-test", { url, frameId: 10 });
    await a.connect();
    await Bun.sleep(100);

    expect(bus.agents.has("dc-test")).toBe(true);
    a.disconnect();
    await Bun.sleep(100);
    expect(bus.agents.has("dc-test")).toBe(false);

    server.stop(true);
  });

  test("heartbeat timestamp is recorded", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("hb-ts", { url, frameId: 10 });
    await a.connect();
    await Bun.sleep(100);

    const ts = bus.heartbeats.get("hb-ts");
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThan(0);

    await cleanup([a], server);
  });

  test("multiple agents can register simultaneously", async () => {
    const { server, bus, url } = await setupBus();
    const agents = Array.from({ length: 5 }, (_, i) =>
      agent(`multi-${i}`, { url, frameId: i * 10 })
    );
    await Promise.all(agents.map((a) => a.connect()));
    await Bun.sleep(100);

    expect(bus.agents.size).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(bus.agents.has(`multi-${i}`)).toBe(true);
    }

    await cleanup(agents, server);
  });
});

describe("bus error handling", () => {
  test("bus sends error for invalid JSON", async () => {
    const { server, url } = await setupBus();
    const ws = new WebSocket(url);
    await new Promise((resolve) => ws.addEventListener("open", resolve));

    const received = [];
    ws.addEventListener("message", (e) => received.push(JSON.parse(e.data)));

    ws.send("not json{{{");
    await Bun.sleep(100);

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("error");
    expect(received[0].data).toBe("invalid JSON");

    ws.close();
    await Bun.sleep(50);
    server.stop(true);
  });

  test("bus sends error for invalid frame fields", async () => {
    const { server, url } = await setupBus();
    const ws = new WebSocket(url);
    await new Promise((resolve) => ws.addEventListener("open", resolve));

    const received = [];
    ws.addEventListener("message", (e) => received.push(JSON.parse(e.data)));

    ws.send(JSON.stringify({ id: -1, type: "data", sender: "a" }));
    await Bun.sleep(100);

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("error");
    expect(received[0].data).toBe("id must be 0-2047");

    ws.close();
    await Bun.sleep(50);
    server.stop(true);
  });

  test("bus rejects data frames from unregistered agent", async () => {
    const { server, url } = await setupBus();
    const ws = new WebSocket(url);
    await new Promise((resolve) => ws.addEventListener("open", resolve));

    const received = [];
    ws.addEventListener("message", (e) => received.push(JSON.parse(e.data)));

    // Send data without heartbeat first
    ws.send(JSON.stringify({ id: 0, type: "data", sender: "rogue", data: "hi" }));
    await Bun.sleep(100);

    expect(received.length).toBe(1);
    expect(received[0].type).toBe("error");
    expect(received[0].data).toBe("send heartbeat first to register");

    ws.close();
    await Bun.sleep(50);
    server.stop(true);
  });
});

describe("bus message routing", () => {
  test("sender does not receive its own message", async () => {
    const { server, url } = await setupBus();
    const a = agent("echo-test", { url, frameId: 10 });
    await a.connect();

    a.subscribe("self-ch");
    const received = [];
    a.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.send("self-ch", "self-msg");
    await Bun.sleep(200);

    expect(received.length).toBe(0);

    await cleanup([a], server);
  });

  test("channel messages go only to subscribers", async () => {
    const { server, url } = await setupBus();
    const a = agent("sender", { url, frameId: 10 });
    const b = agent("sub", { url, frameId: 20 });
    const c = agent("nosub", { url, frameId: 30 });
    await Promise.all([a.connect(), b.connect(), c.connect()]);

    b.subscribe("ch1");
    // c does NOT subscribe

    const bData = [], cData = [];
    b.on("data", (f) => bData.push(f));
    c.on("data", (f) => cData.push(f));

    await Bun.sleep(100);
    a.send("ch1", "hello");
    await Bun.sleep(200);

    expect(bData.length).toBe(1);
    expect(cData.length).toBe(0);

    await cleanup([a, b, c], server);
  });

  test("broadcast reaches all agents", async () => {
    const { server, url } = await setupBus();
    const a = agent("bc-sender", { url, frameId: 10 });
    const b = agent("bc-recv1", { url, frameId: 20 });
    const c = agent("bc-recv2", { url, frameId: 30 });
    await Promise.all([a.connect(), b.connect(), c.connect()]);

    const bData = [], cData = [];
    b.on("data", (f) => bData.push(f));
    c.on("data", (f) => cData.push(f));

    await Bun.sleep(100);
    a.broadcast("hey all");
    await Bun.sleep(200);

    expect(bData.length).toBe(1);
    expect(bData[0].data).toBe("hey all");
    expect(cData.length).toBe(1);
    expect(cData[0].data).toBe("hey all");

    await cleanup([a, b, c], server);
  });

  test("heartbeats broadcast to all agents", async () => {
    const { server, url } = await setupBus();
    const a = agent("hb-a", { url, frameId: 10 });
    const b = agent("hb-b", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    const heartbeats = [];
    b.on("heartbeat", (f) => heartbeats.push(f));

    await Bun.sleep(100);
    a.heartbeat();
    await Bun.sleep(200);

    const fromA = heartbeats.filter((f) => f.sender === "hb-a");
    expect(fromA.length).toBeGreaterThanOrEqual(1);

    await cleanup([a, b], server);
  });

  test("offline heartbeat is broadcast when agent disconnects", async () => {
    const { server, url } = await setupBus();
    const a = agent("leaver", { url, frameId: 10 });
    const b = agent("watcher", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);
    await Bun.sleep(100);

    const heartbeats = [];
    b.on("heartbeat", (f) => heartbeats.push(f));

    a.disconnect();
    await Bun.sleep(200);

    const offlines = heartbeats.filter(
      (f) => f.sender === "leaver" && f.data?.status === "offline"
    );
    expect(offlines.length).toBe(1);

    await cleanup([b], server);
  });
});

describe("bus priority arbitration", () => {
  test("messages are delivered in priority order", async () => {
    const { server, url } = await setupBus();
    const s = agent("pri-sender", { url, frameId: 5 });
    const r = agent("pri-recv", { url, frameId: 100 });
    await Promise.all([s.connect(), r.connect()]);

    r.subscribe("p");
    const order = [];
    r.on("data", (f) => order.push(f.data));

    await Bun.sleep(100);
    s.send("p", "low", 7);
    s.send("p", "high", 0);
    s.send("p", "mid", 3);
    await Bun.sleep(200);

    expect(order).toEqual(["high", "mid", "low"]);

    await cleanup([s, r], server);
  });

  test("same priority uses frame id as tiebreaker", async () => {
    const { server, url } = await setupBus();
    // Two senders with different frame IDs, same priority
    const hi = agent("hi-id", { url, frameId: 500 });
    const lo = agent("lo-id", { url, frameId: 10 });
    const r = agent("tie-recv", { url, frameId: 1000 });
    await Promise.all([hi.connect(), lo.connect(), r.connect()]);

    r.subscribe("tie");
    const order = [];
    r.on("data", (f) => order.push(f.sender));

    await Bun.sleep(100);
    hi.send("tie", "from-hi", 4);
    lo.send("tie", "from-lo", 4);
    await Bun.sleep(200);

    // lo-id (frameId 10) should come before hi-id (frameId 500)
    expect(order[0]).toBe("lo-id");
    expect(order[1]).toBe("hi-id");

    await cleanup([hi, lo, r], server);
  });
});

describe("bus subscription management", () => {
  test("subscriptions are tracked in bus state", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("sub-state", { url, frameId: 10 });
    await a.connect();

    a.subscribe("tracked-ch");
    await Bun.sleep(100);

    expect(bus.subscriptions.has("tracked-ch")).toBe(true);
    expect(bus.subscriptions.get("tracked-ch").size).toBe(1);

    await cleanup([a], server);
  });

  test("unsubscribe removes from bus state", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("unsub-state", { url, frameId: 10 });
    await a.connect();

    a.subscribe("temp-ch");
    await Bun.sleep(100);
    expect(bus.subscriptions.get("temp-ch")?.size).toBe(1);

    a.unsubscribe("temp-ch");
    await Bun.sleep(100);
    expect(bus.subscriptions.get("temp-ch")?.size).toBe(0);

    await cleanup([a], server);
  });

  test("subscriptions are cleaned up on disconnect", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("cleanup-sub", { url, frameId: 10 });
    await a.connect();

    a.subscribe("orphan-ch");
    await Bun.sleep(100);
    expect(bus.subscriptions.get("orphan-ch")?.size).toBe(1);

    a.disconnect();
    await Bun.sleep(100);
    expect(bus.subscriptions.get("orphan-ch")?.size).toBe(0);

    server.stop(true);
  });
});
