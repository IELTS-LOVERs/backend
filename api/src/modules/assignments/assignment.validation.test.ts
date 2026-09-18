import { describe, expect, it } from "vitest";
import { CreateAssignmentSchema } from "./assignment.validation.js";

describe("CreateAssignmentSchema", () => {
  it("accepts assigning to a class", () => {
    const result = CreateAssignmentSchema.safeParse({
      body: { examId: "66e8641c262f3b9200000004", classId: "66e8601c262f3b9200000002" },
    });

    expect(result.success).toBe(true);
  });

  it("accepts assigning directly to a student", () => {
    const result = CreateAssignmentSchema.safeParse({
      body: { examId: "66e8641c262f3b9200000004", studentId: "66e85d1c262f3b9200000001" },
    });

    expect(result.success).toBe(true);
  });

  it("rejects when neither classId nor studentId is provided", () => {
    const result = CreateAssignmentSchema.safeParse({
      body: { examId: "66e8641c262f3b9200000004" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid deadline format", () => {
    const result = CreateAssignmentSchema.safeParse({
      body: {
        examId: "66e8641c262f3b9200000004",
        classId: "66e8601c262f3b9200000002",
        deadline: "30-09-2026",
      },
    });

    expect(result.success).toBe(false);
  });
});
