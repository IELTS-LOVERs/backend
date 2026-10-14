import { describe, expect, it } from "vitest";
import { resolvePresignConnection } from "./minio.js";

describe("resolvePresignConnection (I-2)", () => {
  it("falls back to the internal endpoint when no public config is provided", () => {
    const result = resolvePresignConnection({
      endpoint: "minio",
      port: 9000,
      useSSL: false,
    });

    expect(result).toEqual({ endPoint: "minio", port: 9000, useSSL: false });
  });

  it("overrides host, port and ssl independently for browser-facing URLs", () => {
    const result = resolvePresignConnection({
      endpoint: "minio",
      port: 9000,
      useSSL: false,
      publicEndpoint: "media.example.com",
      publicPort: 443,
      publicUseSSL: true,
    });

    expect(result).toEqual({ endPoint: "media.example.com", port: 443, useSSL: true });
  });

  it("supports partial overrides (host only)", () => {
    const result = resolvePresignConnection({
      endpoint: "minio",
      port: 9000,
      useSSL: false,
      publicEndpoint: "media.example.com",
    });

    expect(result).toEqual({ endPoint: "media.example.com", port: 9000, useSSL: false });
  });
});
