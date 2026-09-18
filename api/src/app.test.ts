import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "./app.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe("GET /api/health", () => {
  it("returns a success envelope", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = (await response.json()) as { success: boolean; data: { status: string } };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
  });
});

describe("POST /api/auth/register", () => {
  it("rejects an invalid payload with VALIDATION_ERROR before touching the DB", async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "123" }),
    });
    const body = (await response.json()) as { success: boolean; error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("unknown endpoint", () => {
  it("returns NOT_FOUND envelope", async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    const body = (await response.json()) as { success: boolean; error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
