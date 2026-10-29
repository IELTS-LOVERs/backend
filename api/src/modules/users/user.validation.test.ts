import { describe, expect, it } from "vitest";
import { AdminResetPasswordSchema, ListStudentsSchema } from "./user.validation.js";

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

describe("ListStudentsSchema", () => {
  it("defaults to page 1 and 20 students per page", () => {
    const result = ListStudentsSchema.safeParse({ query: {} });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.query.page).toBe(1);
    expect(result.data.query.limit).toBe(20);
    expect(result.data.query.unassigned).toBe(false);
  });

  it("parses the unassigned flag from the query string", () => {
    const withFlag = ListStudentsSchema.safeParse({ query: { unassigned: "true" } });
    const withoutFlag = ListStudentsSchema.safeParse({ query: { unassigned: "false" } });

    expect(withFlag.success).toBe(true);
    expect(withoutFlag.success).toBe(true);
    if (!withFlag.success || !withoutFlag.success) return;
    expect(withFlag.data.query.unassigned).toBe(true);
    expect(withoutFlag.data.query.unassigned).toBe(false);
  });

  it("rejects an invalid unassigned value", () => {
    const result = ListStudentsSchema.safeParse({ query: { unassigned: "maybe" } });

    expect(result.success).toBe(false);
  });
});
