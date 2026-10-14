import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimiter.js";
import { errorHandler } from "./errorHandler.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.get(
    "/limited",
    createRateLimiter(2, 60_000),
    (_req, res) => {
      res.json({ success: true });
    }
  );
  // I-4: mimics the login route — only failed responses count toward the limit.
  app.post(
    "/login-like",
    createRateLimiter(2, 60_000, { skipSuccessfulRequests: true }),
    (req, res) => {
      if (req.query.fail === "1") {
        res.status(400).json({ success: false });
        return;
      }
      res.json({ success: true });
    }
  );
  app.use(errorHandler);

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

describe("createRateLimiter", () => {
  it("returns 429 with error.code TOO_MANY_REQUESTS past the limit", async () => {
    const first = await fetch(`${baseUrl}/limited`);
    const second = await fetch(`${baseUrl}/limited`);
    const third = await fetch(`${baseUrl}/limited`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);

    const body = (await third.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("TOO_MANY_REQUESTS");
  });

  it("skipSuccessfulRequests: successful requests do not count, failures do (I-4)", async () => {
    const sleep = () => new Promise((resolve) => setTimeout(resolve, 30));

    // Three SUCCESSFUL requests — must never be blocked by a limit of 2.
    for (let i = 0; i < 3; i += 1) {
      const res = await fetch(`${baseUrl}/login-like`, { method: "POST" });
      expect(res.status).toBe(200);
      await res.json();
      await sleep();
    }

    // Failed requests still count: the 3rd failure trips the limit of 2.
    const firstFailure = await fetch(`${baseUrl}/login-like?fail=1`, { method: "POST" });
    const secondFailure = await fetch(`${baseUrl}/login-like?fail=1`, { method: "POST" });
    const thirdFailure = await fetch(`${baseUrl}/login-like?fail=1`, { method: "POST" });

    expect(firstFailure.status).toBe(400);
    expect(secondFailure.status).toBe(400);
    expect(thirdFailure.status).toBe(429);
  });
});
