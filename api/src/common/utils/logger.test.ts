import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a structured JSON line with level, event and fields", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info("auth.login_succeeded", { userId: "u1", role: "student" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;

    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("auth.login_succeeded");
    expect(parsed.userId).toBe("u1");
    expect(parsed.role).toBe("student");
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("routes warn and error to their console channels", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logger.warn("auth.login_failed", { email: "student@example.com" });
    logger.error("request.error", { name: "Error", message: "boom" });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
