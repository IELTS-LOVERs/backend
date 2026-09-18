import { describe, expect, it } from "vitest";
import { AddStudentSchema, CreateClassSchema, JoinClassSchema } from "./class.validation.js";

describe("CreateClassSchema", () => {
  it("accepts a valid payload", () => {
    const result = CreateClassSchema.safeParse({ body: { name: "IELTS K12" } });
    expect(result.success).toBe(true);
  });

  it("rejects a name shorter than 2 characters", () => {
    const result = CreateClassSchema.safeParse({ body: { name: "A" } });
    expect(result.success).toBe(false);
  });
});

describe("JoinClassSchema", () => {
  it("requires exactly 6 characters", () => {
    expect(JoinClassSchema.safeParse({ body: { code: "KH79E2" } }).success).toBe(true);
    expect(JoinClassSchema.safeParse({ body: { code: "KH79" } }).success).toBe(false);
  });
});

describe("AddStudentSchema", () => {
  it("validates the class id and student email", () => {
    const valid = AddStudentSchema.safeParse({
      params: { id: "66e8601c262f3b9200000002" },
      body: { email: "student@example.com" },
    });
    expect(valid.success).toBe(true);

    const invalid = AddStudentSchema.safeParse({
      params: { id: "66e8601c262f3b9200000002" },
      body: { email: "not-an-email" },
    });
    expect(invalid.success).toBe(false);
  });
});
