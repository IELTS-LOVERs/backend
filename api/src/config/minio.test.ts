import { describe, expect, it } from "vitest";
import { buildPublicReadPolicy, mediaKeyFromUrl, resolvePresignConnection } from "./minio.js";

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

describe("buildPublicReadPolicy", () => {
  it("allows anonymous GetObject on every key and nothing else", () => {
    const policy = JSON.parse(buildPublicReadPolicy("ielts-media"));

    expect(policy.Statement).toHaveLength(1);
    expect(policy.Statement[0].Effect).toBe("Allow");
    expect(policy.Statement[0].Action).toEqual(["s3:GetObject"]);
    expect(policy.Statement[0].Resource).toEqual(["arn:aws:s3:::ielts-media/*"]);
  });
});

describe("mediaKeyFromUrl", () => {
  const key = "uploads/image/2026/10/abc_banner.png";

  it("extracts the key from a static public URL", () => {
    expect(
      mediaKeyFromUrl(`https://s3ielts.lowng.dev/ielts-media/${key}`)
    ).toBe(key);
  });

  it("drops presigned query strings, including expired ones", () => {
    expect(
      mediaKeyFromUrl(
        `https://s3ielts.lowng.dev/ielts-media/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef&X-Amz-Expires=900`
      )
    ).toBe(key);
  });

  it("handles path-style dev URLs and percent-encoded names", () => {
    expect(
      mediaKeyFromUrl("http://localhost:9010/ielts-media/uploads/image/2026/10/a%20b.png")
    ).toBe("uploads/image/2026/10/a b.png");
  });

  it("returns null for non-media / external URLs", () => {
    expect(mediaKeyFromUrl("https://images.unsplash.com/photo-1?w=600")).toBeNull();
    expect(mediaKeyFromUrl("")).toBeNull();
    expect(mediaKeyFromUrl(null)).toBeNull();
  });
});
