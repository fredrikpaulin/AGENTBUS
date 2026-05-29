// CAN-like frame JSON Schema definitions

export const frameSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  required: ["id", "type", "sender"],
  properties: {
    id: { type: "integer", minimum: 0, maximum: 2047, description: "11-bit frame ID, lower = higher priority (CAN-style)" },
    type: { type: "string", enum: ["data", "heartbeat", "subscribe", "unsubscribe", "error"] },
    sender: { type: "string", minLength: 1, description: "Agent ID of the sender" },
    channel: { type: "string", description: "Target channel name" },
    data: { description: "Arbitrary payload" },
    priority: { type: "integer", minimum: 0, maximum: 7, default: 4, description: "0 = highest, 7 = lowest" },
    timestamp: { type: "integer", description: "Unix ms timestamp" },
  },
  additionalProperties: false,
};

const VALID_TYPES = new Set(["data", "heartbeat", "subscribe", "unsubscribe", "error"]);

export function createFrame(type, sender, opts = {}) {
  return {
    id: opts.id ?? 0,
    type,
    sender,
    channel: opts.channel ?? null,
    data: opts.data ?? null,
    priority: opts.priority ?? 4,
    timestamp: Date.now(),
  };
}

export function validateFrame(frame) {
  if (!frame || typeof frame !== "object") return "frame must be an object";
  if (!Number.isInteger(frame.id) || frame.id < 0 || frame.id > 2047) return "id must be 0-2047";
  if (!VALID_TYPES.has(frame.type)) return "invalid type: " + frame.type;
  if (typeof frame.sender !== "string" || !frame.sender) return "sender required";
  if (frame.priority !== undefined && (!Number.isInteger(frame.priority) || frame.priority < 0 || frame.priority > 7)) return "priority must be 0-7";
  return null;
}
