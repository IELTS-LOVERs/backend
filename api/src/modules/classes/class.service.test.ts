import { describe, expect, it } from "vitest";
import { assertOwnership, createRandomClassCode, isMember } from "./class.service.js";

describe("createRandomClassCode", () => {
  it("generates a 6 character uppercase alphanumeric code", () => {
    const code = createRandomClassCode();

    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("excludes visually confusing characters", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(createRandomClassCode()).not.toMatch(/[0O1IL]/);
    }
  });
});

describe("assertOwnership", () => {
  it("allows admin to access any class", () => {
    const cls = { teacherId: "teacher-123" as unknown as any };
    expect(() => assertOwnership(cls, "admin-999", "admin")).not.toThrow();
  });

  it("allows the owner teacher to access their class", () => {
    const cls = { teacherId: "teacher-123" as unknown as any };
    expect(() => assertOwnership(cls, "teacher-123", "teacher")).not.toThrow();
  });

  it("throws ForbiddenError for a non-owner teacher", () => {
    const cls = { teacherId: "teacher-123" as unknown as any };
    expect(() => assertOwnership(cls, "teacher-456", "teacher")).toThrow();
  });
});

describe("isMember", () => {
  it("returns true when student id is in class students array", () => {
    const cls = { students: ["student-1", "student-2"] as unknown as any[] };
    expect(isMember(cls, "student-1")).toBe(true);
  });

  it("returns false when student id is not in class students array", () => {
    const cls = { students: ["student-1", "student-2"] as unknown as any[] };
    expect(isMember(cls, "student-3")).toBe(false);
  });
});
