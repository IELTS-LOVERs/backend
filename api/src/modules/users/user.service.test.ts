import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { UserModel, type IUser } from "./user.model.js";
import { toSafeUser } from "./user.serializer.js";
import { createUser, listUsers, updateProfile, updateUserStatus } from "./user.service.js";

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

  it("bumps tokenVersion when suspending a user", async () => {
    const userId = new mongoose.Types.ObjectId();
    const doc = {
      _id: userId,
      status: "active",
      tokenVersion: 2,
      save: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(doc as never);

    await updateUserStatus(userId.toString(), "suspended");

    expect(doc.status).toBe("suspended");
    expect(doc.tokenVersion).toBe(3);
  });

  it("throws NotFoundError when updating a missing user", async () => {
    vi.spyOn(UserModel, "findById").mockResolvedValueOnce(null as never);

    await expect(updateUserStatus("missing", "active")).rejects.toThrow(NotFoundError);
  });
});
