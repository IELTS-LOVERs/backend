import { describe, expect, it } from "vitest";
import {
  AddStudentSchema,
  CreateClassSchema,
  JoinClassSchema,
  UpdateClassSchema,
} from "./class.validation.js";

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

describe("UpdateClassSchema", () => {
  it("accepts updating only the name", () => {
    const result = UpdateClassSchema.safeParse({
      params: { id: "66e8601c262f3b9200000002" },
      body: { name: "New Name" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts updating only the description", () => {
    const result = UpdateClassSchema.safeParse({
      params: { id: "66e8601c262f3b9200000002" },
      body: { description: "New description" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty update payload", () => {
    const result = UpdateClassSchema.safeParse({
      params: { id: "66e8601c262f3b9200000002" },
      body: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects a name shorter than 2 characters", () => {
    const result = UpdateClassSchema.safeParse({
      params: { id: "66e8601c262f3b9200000002" },
      body: { name: "A" },
    });
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
