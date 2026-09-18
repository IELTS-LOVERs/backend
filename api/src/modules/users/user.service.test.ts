import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import type { IUser } from "./user.model.js";
import { toSafeUser } from "./user.serializer.js";

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
