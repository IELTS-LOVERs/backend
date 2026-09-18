import mongoose from "mongoose";
import { describe, expect, it, vi } from "vitest";
import { UserModel, type IUser } from "./user.model.js";
import { toSafeUser } from "./user.serializer.js";
import { updateProfile } from "./user.service.js";

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
