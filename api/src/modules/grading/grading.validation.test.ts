import { describe, expect, it } from "vitest";
import { GradeWritingSchema } from "./grading.validation.js";

function validPayload() {
  return {
    body: {
      attemptId: "66e8681c262f3b9200000007",
      task1: { score: 6, comment: "Bố cục rõ ràng." },
      task2: { score: 7 },
      generalFeedback: "Cần cải thiện từ vựng.",
    },
  };
}

describe("GradeWritingSchema", () => {
  it("accepts a valid grading payload", () => {
    expect(GradeWritingSchema.safeParse(validPayload()).success).toBe(true);
  });

  it("accepts missing optional comments and feedback", () => {
    const result = GradeWritingSchema.safeParse({
      body: {
        attemptId: "66e8681c262f3b9200000007",
        task1: { score: 5.5 },
        task2: { score: 8 },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects scores above 9", () => {
    const result = GradeWritingSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, task2: { score: 9.5 } },
    });

    expect(result.success).toBe(false);
  });

  it("rejects scores below 0", () => {
    const result = GradeWritingSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, task1: { score: -0.5 } },
    });

    expect(result.success).toBe(false);
  });

  it("rejects scores that are not multiples of 0.5", () => {
    const result = GradeWritingSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, task1: { score: 6.3 } },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("0.5"))).toBe(
        true
      );
    }
  });

  it("accepts half-band scores", () => {
    const result = GradeWritingSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, task1: { score: 6.5 }, task2: { score: 7 } },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing attemptId", () => {
    const result = GradeWritingSchema.safeParse({
      body: {
        task1: { score: 6 },
        task2: { score: 7 },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty attemptId", () => {
    const result = GradeWritingSchema.safeParse({
      ...validPayload(),
      body: { ...validPayload().body, attemptId: "" },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a grading payload with only task1 or only task2", () => {
    const task1Only = GradeWritingSchema.safeParse({
      body: {
        attemptId: "66e8681c262f3b9200000007",
        task1: { score: 6.5 },
      },
    });
    expect(task1Only.success).toBe(true);

    const task2Only = GradeWritingSchema.safeParse({
      body: {
        attemptId: "66e8681c262f3b9200000007",
        task2: { score: 7.0 },
      },
    });
    expect(task2Only.success).toBe(true);
  });

  it("rejects a grading payload when both task1 and task2 are omitted", () => {
    const result = GradeWritingSchema.safeParse({
      body: {
        attemptId: "66e8681c262f3b9200000007",
        generalFeedback: "Thiếu bài làm",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Phải nhập điểm cho ít nhất một Task Writing");
    }
  });
});
