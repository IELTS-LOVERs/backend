import { describe, expect, it } from "vitest";
import { CreateExamSchema, ListExamsSchema, UpdateExamSchema } from "./exam.validation.js";

const validBody = {
  title: "IELTS Academic Mock Test 01",
};

describe("CreateExamSchema", () => {
  it("accepts a valid payload and applies defaults", () => {
    const result = CreateExamSchema.safeParse({ body: validBody });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.durationMinutes).toBe(60);
      expect(result.data.body.sections).toEqual([]);
    }
  });

  it("accepts a valid section and applies questionIds default", () => {
    const result = CreateExamSchema.safeParse({
      body: {
        ...validBody,
        sections: [{ skill: "reading", part: 1, title: "Passage 1" }],
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.sections[0]?.questionIds).toEqual([]);
    }
  });

  it("rejects durationMinutes outside 10-180", () => {
    expect(
      CreateExamSchema.safeParse({ body: { ...validBody, durationMinutes: 5 } }).success
    ).toBe(false);
    expect(
      CreateExamSchema.safeParse({ body: { ...validBody, durationMinutes: 200 } }).success
    ).toBe(false);
  });

  it("rejects a title shorter than 3 characters and an invalid skill", () => {
    expect(CreateExamSchema.safeParse({ body: { title: "Hi" } }).success).toBe(false);
    expect(
      CreateExamSchema.safeParse({
        body: {
          ...validBody,
          sections: [{ skill: "speaking", part: 1, title: "Section 1" }],
        },
      }).success
    ).toBe(false);
  });
});

describe("UpdateExamSchema", () => {
  it("allows a partial body", () => {
    const result = UpdateExamSchema.safeParse({
      params: { id: "66e8641c262f3b9200000004" },
      body: { title: "Updated title" },
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid partial field", () => {
    const result = UpdateExamSchema.safeParse({
      params: { id: "66e8641c262f3b9200000004" },
      body: { durationMinutes: 5 },
    });

    expect(result.success).toBe(false);
  });
});

describe("ListExamsSchema", () => {
  it("coerces query strings and applies pagination defaults", () => {
    const result = ListExamsSchema.safeParse({ query: { status: "draft", page: "2", limit: "5" } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query.status).toBe("draft");
      expect(result.data.query.page).toBe(2);
      expect(result.data.query.limit).toBe(5);
    }
  });
});
