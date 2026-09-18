import { describe, expect, it } from "vitest";
import { type ValidationError } from "mongoose";
import { UserModel } from "./user.model.js";

describe("UserModel", () => {
  it("registers expected schema paths", () => {
    expect(UserModel.modelName).toBe("User");
    expect(UserModel.schema.path("email")).toBeDefined();
    expect(UserModel.schema.path("passwordHash")).toBeDefined();
    expect(UserModel.schema.path("fullName")).toBeDefined();
    expect(UserModel.schema.path("phone")).toBeDefined();
    expect(UserModel.schema.path("role")).toBeDefined();
    expect(UserModel.schema.path("targetBand")).toBeDefined();
    expect(UserModel.schema.path("avatarMediaId")).toBeDefined();
    expect(UserModel.schema.path("status")).toBeDefined();
    expect(UserModel.schema.path("tokenVersion")).toBeDefined();
  });

  it("requires email, passwordHash, and fullName", async () => {
    let error: ValidationError | undefined;
    try {
      await new UserModel({}).validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.email).toBeDefined();
    expect(error?.errors.passwordHash).toBeDefined();
    expect(error?.errors.fullName).toBeDefined();
  });

  it("applies defaults for role and status", async () => {
    const doc = new UserModel({
      email: "test@example.com",
      passwordHash: "hashed123",
      fullName: "Test User",
    });

    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.role).toBe("student");
    expect(doc.status).toBe("active");
    expect(doc.tokenVersion).toBe(0);
  });

  it("rejects invalid role or status enum values", async () => {
    const doc = new UserModel({
      email: "test@example.com",
      passwordHash: "hashed123",
      fullName: "Test User",
      role: "superman" as unknown as any,
      status: "deleted" as unknown as any,
    });

    let error: ValidationError | undefined;
    try {
      await doc.validate();
    } catch (err) {
      error = err as ValidationError;
    }

    expect(error?.errors.role).toBeDefined();
    expect(error?.errors.status).toBeDefined();
  });
});
