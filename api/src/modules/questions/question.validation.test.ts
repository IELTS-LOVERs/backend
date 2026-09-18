import { describe, expect, it } from "vitest";
import {
  CreateQuestionSchema,
  ListQuestionsSchema,
  UpdateQuestionSchema,
} from "./question.validation.js";

const validBody = {
  skill: "listening",
  type: "form_completion",
  part: 1,
  prompt: "Write NO MORE THAN TWO WORDS for each answer.",
};

describe("CreateQuestionSchema", () => {
  it("accepts a valid payload and applies defaults", () => {
    const result = CreateQuestionSchema.safeParse({ body: validBody });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.points).toBe(1);
      expect(result.data.body.data).toEqual({});
      expect(result.data.body.acceptedAnswers).toEqual([]);
      expect(result.data.body.mediaIds).toEqual([]);
    }
  });

  it("rejects an invalid skill and out-of-range part", () => {
    expect(
      CreateQuestionSchema.safeParse({ body: { ...validBody, skill: "speaking" } }).success
    ).toBe(false);
    expect(CreateQuestionSchema.safeParse({ body: { ...validBody, part: 5 } }).success).toBe(false);
  });
});

describe("UpdateQuestionSchema", () => {
  it("allows a partial body", () => {
    const result = UpdateQuestionSchema.safeParse({
      params: { id: "66e8621c262f3b9200000003" },
      body: { prompt: "Updated prompt" },
    });

    expect(result.success).toBe(true);
  });
});

describe("ListQuestionsSchema", () => {
  it("coerces query strings and applies pagination defaults", () => {
    const result = ListQuestionsSchema.safeParse({ query: {} });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query.page).toBe(1);
      expect(result.data.query.limit).toBe(20);
    }
  });

  it("coerces string numbers from the query string", () => {
    const result = ListQuestionsSchema.safeParse({ query: { part: "2", page: "3", limit: "10" } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query.part).toBe(2);
      expect(result.data.query.page).toBe(3);
      expect(result.data.query.limit).toBe(10);
    }
  });

  it("accepts search keyword in query", () => {
    const result = ListQuestionsSchema.safeParse({ query: { search: "vocabulary" } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.query.search).toBe("vocabulary");
    }
  });
});
