import { describe, expect, it } from "vitest";
import { LogExamEventSchema } from "./anti-cheat.validation.js";

function validPayload() {
  return {
    body: {
      attemptId: "66e8681c262f3b9200000007",
      type: "TAB_SWITCH",
      timestamp: "2026-09-18T10:00:00.000Z",
      metadata: { url: "https://example.com" },
    },
  };
}

describe("LogExamEventSchema", () => {
  it("accepts a valid event payload", () => {
    expect(LogExamEventSchema.safeParse(validPayload()).success).toBe(true);
  });

  it("accepts an event without optional timestamp and metadata", () => {
    const result = LogExamEventSchema.safeParse({
      body: {
        attemptId: "66e8681c262f3b9200000007",
        type: "PASTE",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown event type", () => {
    const result = LogExamEventSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, type: "SCREENSHOT" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid timestamp", () => {
    const result = LogExamEventSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, timestamp: "not-a-date" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing attemptId", () => {
    const result = LogExamEventSchema.safeParse({
      body: { type: "TAB_SWITCH" },
    });

    expect(result.success).toBe(false);
  });
});
