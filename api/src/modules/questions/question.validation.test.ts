import { describe, expect, it } from "vitest";
import {
  CreateQuestionSchema,
  ListQuestionsSchema,
  UpdateQuestionSchema,
} from "./question.validation.js";

const validBody = {
  skill: "listening",
  part: 1,
  groupType: "form_completion",
  instructions: "Write NO MORE THAN TWO WORDS for each answer.",
  questions: [{ prompt: "City: [1]", acceptedAnswers: ["london"] }],
};

describe("CreateQuestionSchema", () => {
  it("accepts a valid question group payload and applies defaults", () => {
    const result = CreateQuestionSchema.safeParse({ body: validBody });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.config).toEqual({});
      expect(result.data.body.questions).toHaveLength(1);
      expect(result.data.body.questions[0].points).toBe(1);
      expect(result.data.body.questions[0].acceptedAnswers).toEqual(["london"]);
      expect(result.data.body.questions[0].mediaIds).toEqual([]);
    }
  });

  it("rejects an empty questions array", () => {
    expect(
      CreateQuestionSchema.safeParse({ body: { ...validBody, questions: [] } }).success
    ).toBe(false);
  });

  it("rejects an invalid skill and out-of-range part", () => {
    expect(
      CreateQuestionSchema.safeParse({ body: { ...validBody, skill: "invalid_skill" } }).success
    ).toBe(false);
    expect(CreateQuestionSchema.safeParse({ body: { ...validBody, part: 5 } }).success).toBe(false);
  });
});

describe("UpdateQuestionSchema", () => {
  it("allows a partial body", () => {
    const result = UpdateQuestionSchema.safeParse({
      params: { id: "66e8621c262f3b9200000003" },
      body: { instructions: "Updated instructions" },
    });

    expect(result.success).toBe(true);
  });

  it("does not inject schema defaults into a partial body (would wipe stored data)", () => {
    const result = UpdateQuestionSchema.safeParse({
      params: { id: "66e8621c262f3b9200000003" },
      body: { instructions: "Updated instructions" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.groupType).toBeUndefined();
      expect(result.data.body.config).toBeUndefined();
      expect(result.data.body.questions).toBeUndefined();
    }
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
