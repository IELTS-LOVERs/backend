import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_PRODUCTION_SECRETS,
  MIN_PRODUCTION_SECRET_LENGTH,
  validateProductionSecrets,
} from "./env.js";

const STRONG_A = "a".repeat(MIN_PRODUCTION_SECRET_LENGTH);
const STRONG_B = "b".repeat(MIN_PRODUCTION_SECRET_LENGTH);

describe("validateProductionSecrets", () => {
  it("does nothing outside production", () => {
    expect(
      validateProductionSecrets({
        NODE_ENV: "development",
        JWT_ACCESS_SECRET: "change-me-access-secret",
        JWT_REFRESH_SECRET: "change-me-refresh-secret",
      })
    ).toEqual([]);

    expect(
      validateProductionSecrets({
        NODE_ENV: "test",
        JWT_ACCESS_SECRET: "secret",
        JWT_REFRESH_SECRET: "secret",
      })
    ).toEqual([]);
  });

  it("rejects the shipped default secrets in production", () => {
    const issues = validateProductionSecrets({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: "change-me-access-secret",
      JWT_REFRESH_SECRET: "change-me-refresh-secret",
    });

    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.join(" ")).toContain("JWT_ACCESS_SECRET");
    expect(issues.join(" ")).toContain("JWT_REFRESH_SECRET");
  });

  it("rejects short secrets even when not on the denylist", () => {
    const issues = validateProductionSecrets({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: "short-secret",
      JWT_REFRESH_SECRET: STRONG_B,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("JWT_ACCESS_SECRET");
  });

  it("rejects identical access and refresh secrets", () => {
    const issues = validateProductionSecrets({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: STRONG_A,
      JWT_REFRESH_SECRET: STRONG_A,
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("khác nhau");
  });

  it("accepts two strong distinct secrets", () => {
    expect(
      validateProductionSecrets({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: STRONG_A,
        JWT_REFRESH_SECRET: STRONG_B,
      })
    ).toEqual([]);
  });

  it("ships the expected denylist entries", () => {
    expect(FORBIDDEN_PRODUCTION_SECRETS.has("change-me-access-secret")).toBe(true);
    expect(FORBIDDEN_PRODUCTION_SECRETS.has("change-me-refresh-secret")).toBe(true);
    expect(FORBIDDEN_PRODUCTION_SECRETS.has("secret")).toBe(true);
    expect(FORBIDDEN_PRODUCTION_SECRETS.has("changeme")).toBe(true);
  });
});
