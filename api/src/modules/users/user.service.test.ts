import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { ClassModel } from "../classes/class.model.js";
import { UserModel, type IUser } from "./user.model.js";
import { toSafeUser } from "./user.serializer.js";
import {
  createUser,
  listRegisteredStudents,
  listUsers,
  revokeSessions,
  updateProfile,
  updateUserStatus,
} from "./user.service.js";

describe("toSafeUser", () => {
  it("serializes user document to safe user payload without passwordHash", () => {
    const avatarId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    const now = new Date();

    const mockUser = {
      _id: userId,
      email: "student@example.com",
      passwordHash: "secret-hash-that-must-never-leak",
      fullName: "Nguyen Van A",
      phone: "0901234567",
      role: "student",
      targetBand: 7.0,
      status: "active",
      avatarMediaId: avatarId,
      createdAt: now,
      updatedAt: now,
    } as unknown as IUser;

    const safe = toSafeUser(mockUser);

    expect(safe.id).toBe(userId.toString());
    expect(safe.email).toBe("student@example.com");
    expect(safe.fullName).toBe("Nguyen Van A");
    expect(safe.phone).toBe("0901234567");
    expect(safe.role).toBe("student");
    expect(safe.targetBand).toBe(7.0);
    expect(safe.status).toBe("active");
    expect(safe.avatarMediaId).toBe(avatarId.toString());
    expect((safe as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it("handles optional fields with null defaults", () => {
    const userId = new mongoose.Types.ObjectId();
    const now = new Date();

    const mockUser = {
      _id: userId,
      email: "teacher@example.com",
      fullName: "Teacher Tran",
      role: "teacher",
      status: "active",
      createdAt: now,
      updatedAt: now,
    } as unknown as IUser;

    const safe = toSafeUser(mockUser);

    expect(safe.phone).toBeNull();
    expect(safe.targetBand).toBeNull();
    expect(safe.avatarMediaId).toBeNull();
  });
});

describe("updateProfile", () => {
  it("updates user fields and excludes passwordHash in returned document", async () => {
    const userId = new mongoose.Types.ObjectId();
    const avatarId = new mongoose.Types.ObjectId();
    const mockUser = {
      _id: userId,
      fullName: "Old Name",
      phone: "0123456789",
      targetBand: 6.0,
      avatarMediaId: undefined as mongoose.Types.ObjectId | undefined,
      save: vi.fn(),
      select: vi.fn().mockResolvedValue({
        _id: userId,
        fullName: "New Name",
        phone: "0987654321",
        targetBand: 7.5,
        avatarMediaId: avatarId,
      }),
    };

    vi.spyOn(UserModel, "findById").mockReturnValue(mockUser as never);

    const result = await updateProfile(userId.toString(), {
      fullName: "New Name",
      phone: "0987654321",
      targetBand: 7.5,
      avatarMediaId: avatarId.toString(),
    });

    expect(mockUser.fullName).toBe("New Name");
    expect(mockUser.phone).toBe("0987654321");
    expect(mockUser.targetBand).toBe(7.5);
    expect(mockUser.avatarMediaId?.toString()).toBe(avatarId.toString());
    expect(mockUser.save).toHaveBeenCalled();
    expect(result.fullName).toBe("New Name");
    expect((result as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
  });
});

describe("admin user management", () => {
  it("filters users by role, status and search term", async () => {
    let capturedQuery: Record<string, unknown> | undefined;
    const mockFind = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ _id: "u1" }]),
    };
    vi.spyOn(UserModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return mockFind as never;
    });
    vi.spyOn(UserModel, "countDocuments").mockResolvedValueOnce(1 as never);

    const result = await listUsers({
      role: "teacher",
      status: "active",
      search: "an",
      page: 1,
      limit: 20,
    });

    expect(capturedQuery?.role).toBe("teacher");
    expect(capturedQuery?.status).toBe("active");
    expect(capturedQuery?.$or).toBeDefined();
    expect(result.users).toHaveLength(1);
    expect(result.totalPages).toBe(1);
  });

  it("escapes regex metacharacters in the search term (FIX-21)", async () => {
    let capturedQuery: Record<string, unknown> | undefined;
    const mockFind = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(UserModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return mockFind as never;
    });
    vi.spyOn(UserModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await expect(listUsers({ search: "[", page: 1, limit: 20 })).resolves.toBeDefined();

    const or = capturedQuery?.$or as Array<{ email: RegExp }>;
    expect(or[0].email).toBeInstanceOf(RegExp);
    expect(or[0].email.source).toBe("\\[");
  });

  it("does not throw on catastrophic-looking patterns (FIX-21)", async () => {
    const mockFind = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(UserModel, "find").mockImplementationOnce(() => mockFind as never);
    vi.spyOn(UserModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await expect(
      listUsers({ search: "(a+)+$", page: 1, limit: 20 })
    ).resolves.toBeDefined();
  });

  it("rejects a duplicate email when creating a user", async () => {
    vi.spyOn(UserModel, "findOne").mockResolvedValueOnce({ _id: "existing" } as never);

    await expect(
      createUser({
        email: "teacher@example.com",
        password: "Password@1",
        fullName: "New Teacher",
        role: "teacher",
      })
    ).rejects.toThrow(ConflictError);
  });

  it("creates a teacher account when the email is free", async () => {
    vi.spyOn(UserModel, "findOne").mockResolvedValueOnce(null);
    vi.spyOn(UserModel, "create").mockResolvedValueOnce({
      _id: new mongoose.Types.ObjectId(),
      role: "teacher",
      status: "active",
    } as never);

    const user = await createUser({
      email: "teacher@example.com",
      password: "Password@1",
      fullName: "New Teacher",
      role: "teacher",
    });

    expect(user.role).toBe("teacher");
  });

  it("bumps tokenVersion and clears refresh sessions when suspending a user", async () => {
    const userId = new mongoose.Types.ObjectId();
    const doc = {
      _id: userId,
      status: "active",
      tokenVersion: 2,
      activeSessionId: "session-1",
      refreshSessions: [
        { tokenHash: "abc", createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
      ],
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(doc as never);

    await updateUserStatus(userId.toString(), "suspended");

    expect(doc.status).toBe("suspended");
    expect(doc.tokenVersion).toBe(3);
    expect(doc.refreshSessions).toEqual([]);
    expect(doc.activeSessionId).toBeUndefined();
  });

  it("throws NotFoundError when updating a missing user", async () => {
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(null as never);

    await expect(updateUserStatus("missing", "active")).rejects.toThrow(NotFoundError);
  });

  it("revokes every session and bumps tokenVersion when admin logs the user out", async () => {
    const userId = new mongoose.Types.ObjectId();
    const doc = {
      _id: userId,
      status: "active",
      tokenVersion: 4,
      activeSessionId: "session-1",
      refreshSessions: [
        { tokenHash: "abc", createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) },
      ],
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(doc as never);

    await revokeSessions(userId.toString());

    expect(doc.refreshSessions).toEqual([]);
    expect(doc.activeSessionId).toBeUndefined();
    expect(doc.tokenVersion).toBe(5);
    expect(doc.save).toHaveBeenCalled();
  });

  it("throws NotFoundError when revoking sessions of a missing user", async () => {
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(null as never);

    await expect(revokeSessions("missing")).rejects.toThrow(NotFoundError);
  });
});

describe("listRegisteredStudents", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("only lists student accounts and attaches their current classes", async () => {
    const studentA = new mongoose.Types.ObjectId();
    const studentB = new mongoose.Types.ObjectId();
    const classId = new mongoose.Types.ObjectId();
    let capturedQuery: Record<string, unknown> | undefined;

    const userFind = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { _id: studentA, email: "a@example.com", fullName: "An", role: "student" },
        { _id: studentB, email: "b@example.com", fullName: "Binh", role: "student" },
      ]),
    };
    vi.spyOn(UserModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return userFind as never;
    });
    vi.spyOn(UserModel, "countDocuments").mockResolvedValueOnce(2 as never);

    const classFind = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockResolvedValue([
        {
          _id: classId,
          name: "IELTS 6.5",
          code: "ABC123",
          students: [studentA],
        },
      ]),
    };
    vi.spyOn(ClassModel, "find").mockReturnValueOnce(classFind as never);

    const result = await listRegisteredStudents({
      page: 1,
      limit: 20,
      unassigned: false,
    });

    expect(capturedQuery?.role).toBe("student");
    expect(result.students).toHaveLength(2);
    expect(result.students[0].classes).toEqual([
      { id: classId.toString(), name: "IELTS 6.5", code: "ABC123" },
    ]);
    expect(result.students[1].classes).toEqual([]);
  });

  it("filters out enrolled students when unassigned is true", async () => {
    const enrolled = new mongoose.Types.ObjectId();
    let capturedQuery: Record<string, unknown> | undefined;

    const userFind = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(UserModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return userFind as never;
    });
    vi.spyOn(UserModel, "countDocuments").mockResolvedValueOnce(0 as never);
    vi.spyOn(ClassModel, "distinct").mockResolvedValueOnce([enrolled] as never);

    await listRegisteredStudents({ page: 1, limit: 20, unassigned: true });

    expect(capturedQuery?._id).toEqual({ $nin: [enrolled] });
    expect(ClassModel.distinct).toHaveBeenCalledWith("students");
  });

  it("escapes regex metacharacters in the search term", async () => {
    let capturedQuery: Record<string, unknown> | undefined;

    const userFind = {
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(UserModel, "find").mockImplementationOnce((query) => {
      capturedQuery = query as Record<string, unknown>;
      return userFind as never;
    });
    vi.spyOn(UserModel, "countDocuments").mockResolvedValueOnce(0 as never);

    await listRegisteredStudents({ search: "[", page: 1, limit: 20, unassigned: false });

    const or = capturedQuery?.$or as Array<{ email: RegExp }>;
    expect(or[0].email.source).toBe("\\[");
  });
});
