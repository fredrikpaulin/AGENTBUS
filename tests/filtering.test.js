import { test, expect, describe } from "bun:test";
import { setupBus, agent, cleanup } from "./helpers.js";

describe("channel subscriptions", () => {
  test("subscriber receives channel messages", async () => {
    const { server, url } = await setupBus();
    const a = agent("f-sender", { url, frameId: 10 });
    const b = agent("f-sub", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    b.subscribe("news");
    const received = [];
    b.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.send("news", "headline");
    await Bun.sleep(200);

    expect(received.length).toBe(1);
    expect(received[0].channel).toBe("news");
    expect(received[0].data).toBe("headline");

    await cleanup([a, b], server);
  });

  test("non-subscriber does not receive channel messages", async () => {
    const { server, url } = await setupBus();
    const a = agent("f-sender2", { url, frameId: 10 });
    const b = agent("f-nosub", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    // b does NOT subscribe
    const received = [];
    b.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.send("private", "secret");
    await Bun.sleep(200);

    expect(received.length).toBe(0);

    await cleanup([a, b], server);
  });

  test("multiple channels work independently", async () => {
    const { server, url } = await setupBus();
    const a = agent("multi-sender", { url, frameId: 10 });
    const b = agent("multi-sub", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    b.subscribe("ch-a");
    b.subscribe("ch-b");

    const channels = [];
    b.on("data", (f) => channels.push(f.channel));

    await Bun.sleep(100);
    a.send("ch-a", "a");
    a.send("ch-b", "b");
    a.send("ch-c", "c"); // b not subscribed to this
    await Bun.sleep(200);

    expect(channels).toContain("ch-a");
    expect(channels).toContain("ch-b");
    expect(channels).not.toContain("ch-c");
    expect(channels.length).toBe(2);

    await cleanup([a, b], server);
  });

  test("unsubscribe stops delivery", async () => {
    const { server, url } = await setupBus();
    const a = agent("unsub-sender", { url, frameId: 10 });
    const b = agent("unsub-recv", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    b.subscribe("temp");
    const received = [];
    b.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.send("temp", "before");
    await Bun.sleep(200);
    expect(received.length).toBe(1);

    b.unsubscribe("temp");
    await Bun.sleep(100);

    a.send("temp", "after");
    await Bun.sleep(200);
    expect(received.length).toBe(1); // still 1

    await cleanup([a, b], server);
  });

  test("multiple agents subscribed to same channel all receive", async () => {
    const { server, url } = await setupBus();
    const sender = agent("fan-sender", { url, frameId: 10 });
    const r1 = agent("fan-r1", { url, frameId: 20 });
    const r2 = agent("fan-r2", { url, frameId: 30 });
    const r3 = agent("fan-r3", { url, frameId: 40 });
    await Promise.all([sender.connect(), r1.connect(), r2.connect(), r3.connect()]);

    r1.subscribe("fan");
    r2.subscribe("fan");
    r3.subscribe("fan");

    const d1 = [], d2 = [], d3 = [];
    r1.on("data", (f) => d1.push(f));
    r2.on("data", (f) => d2.push(f));
    r3.on("data", (f) => d3.push(f));

    await Bun.sleep(100);
    sender.send("fan", "fanout");
    await Bun.sleep(200);

    expect(d1.length).toBe(1);
    expect(d2.length).toBe(1);
    expect(d3.length).toBe(1);

    await cleanup([sender, r1, r2, r3], server);
  });
});

describe("acceptance filters", () => {
  test("from: filter receives frames from a specific sender", async () => {
    const { server, url } = await setupBus();
    const a = agent("target-sender", { url, frameId: 10 });
    const b = agent("filter-recv", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    // b adds a filter for a's messages, without subscribing to the channel
    b.addFilter("from:target-sender");
    const received = [];
    b.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.send("any-channel", "filtered-in");
    await Bun.sleep(200);

    expect(received.length).toBe(1);
    expect(received[0].data).toBe("filtered-in");
    expect(received[0].sender).toBe("target-sender");

    await cleanup([a, b], server);
  });

  test("from: filter ignores frames from other senders", async () => {
    const { server, url } = await setupBus();
    const a = agent("wanted", { url, frameId: 10 });
    const b = agent("unwanted", { url, frameId: 20 });
    const c = agent("filter-only", { url, frameId: 30 });
    await Promise.all([a.connect(), b.connect(), c.connect()]);

    c.addFilter("from:wanted");
    const received = [];
    c.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.send("ch", "from-wanted");
    b.send("ch", "from-unwanted");
    await Bun.sleep(200);

    // Should only get the one from "wanted"
    expect(received.length).toBe(1);
    expect(received[0].sender).toBe("wanted");

    await cleanup([a, b, c], server);
  });

  test("id: filter receives frames with specific numeric id", async () => {
    const { server, url } = await setupBus();
    const a = agent("id-sender", { url, frameId: 42 });
    const b = agent("id-other", { url, frameId: 99 });
    const c = agent("id-filter", { url, frameId: 200 });
    await Promise.all([a.connect(), b.connect(), c.connect()]);

    c.addFilter("id:42");
    const received = [];
    c.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.send("somechan", "from-42");
    b.send("somechan", "from-99");
    await Bun.sleep(200);

    // Only frames with frame id 42 should match
    expect(received.length).toBe(1);
    expect(received[0].id).toBe(42);

    await cleanup([a, b, c], server);
  });

  test("filter works alongside channel subscriptions", async () => {
    const { server, url } = await setupBus();
    const a = agent("combo-a", { url, frameId: 10 });
    const b = agent("combo-b", { url, frameId: 20 });
    const c = agent("combo-recv", { url, frameId: 30 });
    await Promise.all([a.connect(), b.connect(), c.connect()]);

    c.subscribe("alerts");
    c.addFilter("from:combo-a");

    const received = [];
    c.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.send("other-ch", "via-filter");    // matches from: filter
    b.send("alerts", "via-sub");         // matches channel sub
    b.send("other-ch", "should-miss");   // matches neither
    await Bun.sleep(200);

    expect(received.length).toBe(2);
    const sources = received.map((f) => f.data);
    expect(sources).toContain("via-filter");
    expect(sources).toContain("via-sub");

    await cleanup([a, b, c], server);
  });

  test("filters are stored in bus state", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("filter-state", { url, frameId: 10 });
    await a.connect();

    a.addFilter("from:someone");
    a.addFilter("id:42");
    await Bun.sleep(100);

    // Find this agent's filter set in the bus
    let found = false;
    for (const [, filters] of bus.filters) {
      if (filters.has("from:someone") && filters.has("id:42")) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);

    await cleanup([a], server);
  });

  test("filters are cleaned up on disconnect", async () => {
    const { server, bus, url } = await setupBus();
    const a = agent("filter-cleanup", { url, frameId: 10 });
    await a.connect();

    a.addFilter("from:x");
    await Bun.sleep(100);

    const sizeBefore = bus.filters.size;
    a.disconnect();
    await Bun.sleep(100);

    // The ws entry should be removed from the filters map
    expect(bus.filters.size).toBe(sizeBefore - 1);

    server.stop(true);
  });
});

describe("broadcast vs channel", () => {
  test("broadcast bypasses subscription requirement", async () => {
    const { server, url } = await setupBus();
    const a = agent("bc-s", { url, frameId: 10 });
    const b = agent("bc-r", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    // b has NO subscriptions and NO filters
    const received = [];
    b.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.broadcast("global");
    await Bun.sleep(200);

    expect(received.length).toBe(1);
    expect(received[0].data).toBe("global");
    expect(received[0].channel).toBeNull();

    await cleanup([a, b], server);
  });

  test("channel message does not reach unsubscribed agent even with broadcast listener", async () => {
    const { server, url } = await setupBus();
    const a = agent("mixed-s", { url, frameId: 10 });
    const b = agent("mixed-r", { url, frameId: 20 });
    await Promise.all([a.connect(), b.connect()]);

    // b only listens, no subs
    const received = [];
    b.on("data", (f) => received.push(f));

    await Bun.sleep(100);
    a.broadcast("should-arrive");
    a.send("some-ch", "should-not");
    await Bun.sleep(200);

    expect(received.length).toBe(1);
    expect(received[0].data).toBe("should-arrive");

    await cleanup([a, b], server);
  });
});
