import { Client } from "minio";
import { env } from "./env.js";
import { logger } from "../common/utils/logger.js";

export const minioClient = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

export interface PresignConnection {
  endPoint: string;
  port: number;
  useSSL: boolean;
}

/**
 * I-2: resolve the connection that presigned URLs must be signed with. The
 * signature covers the Host header, so URLs are only usable from a browser if
 * they embed a client-reachable host (e.g. `media.example.com`), while the API
 * keeps talking to the internal endpoint (e.g. docker hostname `minio`).
 * Pure helper so the resolution logic is unit-testable.
 */
export function resolvePresignConnection(config: {
  endpoint: string;
  port: number;
  useSSL: boolean;
  publicEndpoint?: string;
  publicPort?: number;
  publicUseSSL?: boolean;
}): PresignConnection {
  return {
    endPoint: config.publicEndpoint ?? config.endpoint,
    port: config.publicPort ?? config.port,
    useSSL: config.publicUseSSL ?? config.useSSL,
  };
}

export const presignConnection: PresignConnection = resolvePresignConnection({
  endpoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  publicEndpoint: env.MINIO_PUBLIC_ENDPOINT,
  publicPort: env.MINIO_PUBLIC_PORT,
  publicUseSSL: env.MINIO_PUBLIC_USE_SSL,
});

/**
 * Mobile devices can only load media if the public host is reachable from the
 * internet and served over HTTPS (mixed content is blocked). Surface obvious
 * misconfiguration at boot instead of leaving it to "images sometimes fail".
 */
function warnAboutPublicMediaConfig(): void {
  if (env.NODE_ENV !== "production") return;

  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
  if (
    env.MINIO_PUBLIC_ENDPOINT &&
    localHosts.has(env.MINIO_PUBLIC_ENDPOINT.toLowerCase())
  ) {
    logger.warn("media.public_endpoint_local", {
      minioPublicEndpoint: env.MINIO_PUBLIC_ENDPOINT,
    });
  }

  if (env.PUBLIC_MEDIA_URL.startsWith("http://")) {
    logger.warn("media.public_media_url_insecure", {
      publicMediaUrl: env.PUBLIC_MEDIA_URL,
    });
  }

  try {
    const host = new URL(env.PUBLIC_MEDIA_URL).hostname.toLowerCase();
    if (localHosts.has(host)) {
      logger.warn("media.public_media_url_local", {
        publicMediaUrl: env.PUBLIC_MEDIA_URL,
      });
    }
  } catch {
    logger.warn("media.public_media_url_invalid", {
      publicMediaUrl: env.PUBLIC_MEDIA_URL,
    });
  }
}

warnAboutPublicMediaConfig();

const presignUsesInternalEndpoint =
  presignConnection.endPoint === env.MINIO_ENDPOINT &&
  presignConnection.port === env.MINIO_PORT &&
  presignConnection.useSSL === env.MINIO_USE_SSL;

/**
 * Client used ONLY for presigning (upload PUT / media GET). Falls back to the
 * regular client when no distinct public endpoint is configured.
 */
export const minioPresignClient = presignUsesInternalEndpoint
  ? minioClient
  : new Client({
      endPoint: presignConnection.endPoint,
      port: presignConnection.port,
      useSSL: presignConnection.useSSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
    });

export async function ensureBucket(bucketName: string): Promise<void> {
  const exists = await minioClient.bucketExists(bucketName).catch(() => false);

  if (!exists) {
    await minioClient.makeBucket(bucketName);
    console.log(`[minio] Bucket "${bucketName}" created`);
  } else {
    console.log(`[minio] Bucket "${bucketName}" ready`);
  }
}

/**
 * Short-lived in-memory cache of presigned GET URLs.
 *
 * Presigning is a cheap local HMAC computation (no network call), but exams can
 * reference the same media from many places; the cache avoids re-signing on
 * every request. Entries expire well before the URL itself so we never serve a
 * URL that is about to expire. Cache key includes the TTL so a short-TTL
 * library URL can never mask a long-TTL exam URL.
 */
const presignCache = new Map<string, { url: string; cachedAt: number }>();
const PRESIGN_CACHE_TTL_MS = 60_000;

/**
 * Build a presigned GET URL for an object (supports HTTP Range natively, so
 * `<audio>` seeking works). Returns null on failure so callers can decide on a
 * fallback instead of throwing away the whole response.
 */
export async function presignGetObject(
  key: string,
  expiresInSeconds: number
): Promise<string | null> {
  const cacheKey = `${env.MINIO_BUCKET}:${key}:${expiresInSeconds}`;
  const cached = presignCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAt < PRESIGN_CACHE_TTL_MS) {
    return cached.url;
  }

  try {
    const url = await minioPresignClient.presignedGetObject(
      env.MINIO_BUCKET,
      key,
      expiresInSeconds
    );
    presignCache.set(cacheKey, { url, cachedAt: Date.now() });
    return url;
  } catch {
    return null;
  }
}

