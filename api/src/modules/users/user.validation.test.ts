import { describe, expect, it } from "vitest";
import { AdminResetPasswordSchema } from "./user.validation.js";

describe("AdminResetPasswordSchema", () => {
  it("accepts valid reset password input", () => {
    const result = AdminResetPasswordSchema.safeParse({
      params: { id: "66e85d1c262f3b9200000001" },
      body: { newPassword: "supersecretpass" },
    });

    expect(result.success).toBe(true);
  });

  it("rejects short password or empty id", () => {
    const result = AdminResetPasswordSchema.safeParse({
      params: { id: "" },
      body: { newPassword: "short" },
    });

    expect(result.success).toBe(false);
  });
});
