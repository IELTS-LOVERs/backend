import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { ClassModel } from "./class.model.js";
import {
  assertOwnership,
  createRandomClassCode,
  deleteClass,
  isMember,
  updateClass,
} from "./class.service.js";

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

describe("updateClass", () => {
  const classId = new mongoose.Types.ObjectId();
  const teacherId = new mongoose.Types.ObjectId();

  function buildClassDoc() {
    return {
      _id: classId,
      name: "Old Name",
      code: "ABC123",
      description: undefined as string | undefined,
      teacherId,
      students: [] as unknown[],
      save: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("throws NotFoundError when the class does not exist", async () => {
    vi.spyOn(ClassModel, "findById").mockResolvedValueOnce(null as never);

    await expect(
      updateClass(classId.toString(), teacherId.toString(), "teacher", { name: "New" })
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ForbiddenError for a non-owner teacher", async () => {
    const doc = buildClassDoc();
    doc.teacherId = new mongoose.Types.ObjectId() as never;
    vi.spyOn(ClassModel, "findById").mockResolvedValueOnce(doc as never);

    await expect(
      updateClass(classId.toString(), teacherId.toString(), "teacher", { name: "New" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("updates the provided fields and returns the summary", async () => {
    const doc = buildClassDoc();
    vi.spyOn(ClassModel, "findById").mockResolvedValueOnce(doc as never);

    const result = await updateClass(classId.toString(), teacherId.toString(), "teacher", {
      name: "New Name",
      description: "Updated",
    });

    expect(result.name).toBe("New Name");
    expect(result.description).toBe("Updated");
    expect(result.code).toBe("ABC123");
    expect(doc.save).toHaveBeenCalledTimes(1);
  });
});

describe("deleteClass", () => {
  const classId = new mongoose.Types.ObjectId();
  const teacherId = new mongoose.Types.ObjectId();

  it("throws NotFoundError when the class does not exist", async () => {
    vi.spyOn(ClassModel, "findById").mockResolvedValueOnce(null as never);

    await expect(
      deleteClass(classId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(NotFoundError);
  });

  it("throws BadRequestError when active assignments exist", async () => {
    vi.spyOn(ClassModel, "findById").mockResolvedValueOnce({
      _id: classId,
      teacherId,
      students: [],
    } as never);
    vi.spyOn(AssignmentModel, "countDocuments").mockResolvedValueOnce(1 as never);

    await expect(
      deleteClass(classId.toString(), teacherId.toString(), "teacher")
    ).rejects.toThrow(BadRequestError);
  });

  it("deletes the class when no active assignments exist", async () => {
    vi.spyOn(ClassModel, "findById").mockResolvedValueOnce({
      _id: classId,
      teacherId,
      students: [],
    } as never);
    vi.spyOn(AssignmentModel, "countDocuments").mockResolvedValueOnce(0 as never);
    const deleteSpy = vi
      .spyOn(ClassModel, "deleteOne")
      .mockResolvedValueOnce({ acknowledged: true, deletedCount: 1 } as never);

    const result = await deleteClass(classId.toString(), teacherId.toString(), "teacher");

    expect(result.message).toBe("Đã xóa lớp học thành công");
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });
});
