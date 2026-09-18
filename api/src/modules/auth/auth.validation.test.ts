import { describe, expect, it } from "vitest";
import {
  ChangePasswordSchema,
  LoginSchema,
  RegisterSchema,
} from "./auth.validation.js";

describe("RegisterSchema", () => {
  it("accepts valid registration input with default targetBand", () => {
    const result = RegisterSchema.safeParse({
      body: {
        email: "student@example.com",
        password: "securepassword123",
        fullName: "Nguyen Van A",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body.targetBand).toBe(6.5);
    }
  });

  it("rejects invalid email and short password", () => {
    const result = RegisterSchema.safeParse({
      body: {
        email: "not-an-email",
        password: "short",
        fullName: "A",
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("LoginSchema", () => {
  it("accepts valid login credentials", () => {
    const result = LoginSchema.safeParse({
      body: {
        email: "teacher@example.com",
        password: "password123",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects empty password or invalid email", () => {
    const result = LoginSchema.safeParse({
      body: {
        email: "notanemail",
        password: "",
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("ChangePasswordSchema", () => {
  it("accepts valid change password payload", () => {
    const result = ChangePasswordSchema.safeParse({
      body: {
        oldPassword: "oldpassword123",
        newPassword: "newpassword456",
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects short new password", () => {
    const result = ChangePasswordSchema.safeParse({
      body: {
        oldPassword: "oldpassword123",
        newPassword: "short",
      },
    });

    expect(result.success).toBe(false);
  });
});
