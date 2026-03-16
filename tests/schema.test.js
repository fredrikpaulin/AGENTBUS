import { test, expect, describe } from "bun:test";
import { createFrame, validateFrame, frameSchema } from "../lib/schema.js";

describe("frameSchema", () => {
  test("is a valid JSON Schema draft 2020-12 object", () => {
    expect(frameSchema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(frameSchema.type).toBe("object");
    expect(frameSchema.additionalProperties).toBe(false);
  });

  test("requires id, type, and sender", () => {
    expect(frameSchema.required).toEqual(["id", "type", "sender"]);
  });

  test("defines all expected properties", () => {
    const keys = Object.keys(frameSchema.properties);
    expect(keys).toContain("id");
    expect(keys).toContain("type");
    expect(keys).toContain("sender");
    expect(keys).toContain("channel");
    expect(keys).toContain("data");
    expect(keys).toContain("priority");
    expect(keys).toContain("timestamp");
    expect(keys.length).toBe(7);
  });

  test("id range is 0-2047 (11-bit)", () => {
    expect(frameSchema.properties.id.minimum).toBe(0);
    expect(frameSchema.properties.id.maximum).toBe(2047);
  });

  test("priority range is 0-7 with default 4", () => {
    expect(frameSchema.properties.priority.minimum).toBe(0);
    expect(frameSchema.properties.priority.maximum).toBe(7);
    expect(frameSchema.properties.priority.default).toBe(4);
  });

  test("type enum lists all frame types", () => {
    expect(frameSchema.properties.type.enum).toEqual(
      ["data", "heartbeat", "subscribe", "unsubscribe", "error"]
    );
  });
});

describe("createFrame", () => {
  test("creates a frame with required fields", () => {
    const f = createFrame("data", "agent-1");
    expect(f.type).toBe("data");
    expect(f.sender).toBe("agent-1");
    expect(f.id).toBe(0);
    expect(f.channel).toBeNull();
    expect(f.data).toBeNull();
    expect(f.priority).toBe(4);
    expect(typeof f.timestamp).toBe("number");
  });

  test("applies opts overrides", () => {
    const f = createFrame("heartbeat", "s1", {
      id: 42,
      channel: "ch1",
      data: { foo: "bar" },
      priority: 1,
    });
    expect(f.id).toBe(42);
    expect(f.channel).toBe("ch1");
    expect(f.data).toEqual({ foo: "bar" });
    expect(f.priority).toBe(1);
  });

  test("timestamp is close to Date.now()", () => {
    const before = Date.now();
    const f = createFrame("data", "x");
    const after = Date.now();
    expect(f.timestamp).toBeGreaterThanOrEqual(before);
    expect(f.timestamp).toBeLessThanOrEqual(after);
  });

  test("defaults id to 0 when not provided", () => {
    expect(createFrame("data", "a").id).toBe(0);
  });

  test("defaults priority to 4 when not provided", () => {
    expect(createFrame("data", "a").priority).toBe(4);
  });

  test("creates valid frames for every type", () => {
    for (const type of ["data", "heartbeat", "subscribe", "unsubscribe", "error"]) {
      const f = createFrame(type, "agent", { id: 100 });
      expect(validateFrame(f)).toBeNull();
    }
  });

  test("handles complex data payloads", () => {
    const payload = { nested: { arr: [1, 2, 3], bool: true, str: "hello" } };
    const f = createFrame("data", "a", { data: payload });
    expect(f.data).toEqual(payload);
  });

  test("handles empty opts object", () => {
    const f = createFrame("data", "a", {});
    expect(f.id).toBe(0);
    expect(f.priority).toBe(4);
  });
});

describe("validateFrame", () => {
  test("returns null for valid frames", () => {
    expect(validateFrame(createFrame("data", "a", { id: 0 }))).toBeNull();
    expect(validateFrame(createFrame("data", "a", { id: 2047 }))).toBeNull();
    expect(validateFrame(createFrame("heartbeat", "b"))).toBeNull();
    expect(validateFrame(createFrame("subscribe", "c", { channel: "ch" }))).toBeNull();
    expect(validateFrame(createFrame("unsubscribe", "d", { channel: "ch" }))).toBeNull();
    expect(validateFrame(createFrame("error", "bus", { data: "oops" }))).toBeNull();
  });

  // Non-object inputs
  test("rejects null", () => {
    expect(validateFrame(null)).toBe("frame must be an object");
  });

  test("rejects undefined", () => {
    expect(validateFrame(undefined)).toBe("frame must be an object");
  });

  test("rejects string", () => {
    expect(validateFrame("hello")).toBe("frame must be an object");
  });

  test("rejects number", () => {
    expect(validateFrame(42)).toBe("frame must be an object");
  });

  test("rejects array (fails on id check)", () => {
    // Arrays are typeof "object" in JS, so they pass the object check
    // but fail on the id field validation
    expect(validateFrame([1, 2])).toBe("id must be 0-2047");
  });

  // ID validation
  test("rejects negative id", () => {
    expect(validateFrame({ id: -1, type: "data", sender: "a" })).toBe("id must be 0-2047");
  });

  test("rejects id above 2047", () => {
    expect(validateFrame({ id: 2048, type: "data", sender: "a" })).toBe("id must be 0-2047");
  });

  test("rejects non-numeric id", () => {
    expect(validateFrame({ id: "10", type: "data", sender: "a" })).toBe("id must be 0-2047");
  });

  test("rejects missing id", () => {
    expect(validateFrame({ type: "data", sender: "a" })).toBe("id must be 0-2047");
  });

  test("accepts boundary ids 0 and 2047", () => {
    expect(validateFrame({ id: 0, type: "data", sender: "a" })).toBeNull();
    expect(validateFrame({ id: 2047, type: "data", sender: "a" })).toBeNull();
  });

  // Type validation
  test("rejects invalid type", () => {
    expect(validateFrame({ id: 0, type: "nope", sender: "a" })).toBe("invalid type: nope");
  });

  test("rejects empty type", () => {
    expect(validateFrame({ id: 0, type: "", sender: "a" })).toBe("invalid type: ");
  });

  test("rejects missing type", () => {
    expect(validateFrame({ id: 0, sender: "a" })).toMatch(/invalid type/);
  });

  // Sender validation
  test("rejects empty sender", () => {
    expect(validateFrame({ id: 0, type: "data", sender: "" })).toBe("sender required");
  });

  test("rejects missing sender", () => {
    expect(validateFrame({ id: 0, type: "data" })).toBe("sender required");
  });

  test("rejects non-string sender", () => {
    expect(validateFrame({ id: 0, type: "data", sender: 123 })).toBe("sender required");
  });

  // Priority validation
  test("rejects priority below 0", () => {
    expect(validateFrame({ id: 0, type: "data", sender: "a", priority: -1 })).toBe("priority must be 0-7");
  });

  test("rejects priority above 7", () => {
    expect(validateFrame({ id: 0, type: "data", sender: "a", priority: 8 })).toBe("priority must be 0-7");
  });

  test("accepts priority boundaries 0 and 7", () => {
    expect(validateFrame({ id: 0, type: "data", sender: "a", priority: 0 })).toBeNull();
    expect(validateFrame({ id: 0, type: "data", sender: "a", priority: 7 })).toBeNull();
  });

  test("accepts missing priority (optional)", () => {
    expect(validateFrame({ id: 0, type: "data", sender: "a" })).toBeNull();
  });
});
