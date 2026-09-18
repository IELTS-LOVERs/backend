import { describe, expect, it } from "vitest";
import {
  AutosaveAnswersSchema,
  GetMyAttemptsSchema,
  StartAttemptSchema,
} from "./attempt.validation.js";

describe("StartAttemptSchema", () => {
  it("accepts a start payload with only examId", () => {
    const result = StartAttemptSchema.safeParse({
      body: { examId: "66e8641c262f3b9200000004" },
    });

    expect(result.success).toBe(true);
  });

  it("accepts an optional assignmentId", () => {
    const result = StartAttemptSchema.safeParse({
      body: {
        examId: "66e8641c262f3b9200000004",
        assignmentId: "66e8651c262f3b9200000005",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing examId", () => {
    expect(StartAttemptSchema.safeParse({ body: {} }).success).toBe(false);
    expect(StartAttemptSchema.safeParse({ body: { examId: "" } }).success).toBe(false);
  });
});

describe("AutosaveAnswersSchema", () => {
  it("accepts a valid answers payload", () => {
    const result = AutosaveAnswersSchema.safeParse({
      params: { id: "66e8661c262f3b9200000006" },
      body: {
        answers: [{ questionId: "66e8621c262f3b9200000003", value: "London" }],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects answers with a non-string value", () => {
    const result = AutosaveAnswersSchema.safeParse({
      params: { id: "66e8661c262f3b9200000006" },
      body: {
        answers: [{ questionId: "66e8621c262f3b9200000003", value: 42 }],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing answers array", () => {
    const result = AutosaveAnswersSchema.safeParse({
      params: { id: "66e8661c262f3b9200000006" },
      body: {},
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing attempt id in params", () => {
    const result = AutosaveAnswersSchema.safeParse({
      params: {},
      body: { answers: [] },
    });

    expect(result.success).toBe(false);
  });
});

describe("GetMyAttemptsSchema", () => {
  it("applies defaults for page and limit", () => {
    const result = GetMyAttemptsSchema.safeParse({ query: {} });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query.page).toBe(1);
      expect(result.data.query.limit).toBe(10);
    }
  });

  it("coerces string numbers for pagination", () => {
    const result = GetMyAttemptsSchema.safeParse({
      query: { page: "2", limit: "25", status: "submitted" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query.page).toBe(2);
      expect(result.data.query.limit).toBe(25);
      expect(result.data.query.status).toBe("submitted");
    }
  });

  it("rejects invalid status", () => {
    const result = GetMyAttemptsSchema.safeParse({
      query: { status: "invalid_status" },
    });
    expect(result.success).toBe(false);
  });
});

