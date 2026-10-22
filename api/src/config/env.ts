import "dotenv/config";
import { z } from "zod";

const booleanFromString = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

/** Secrets that ship in the repo/sample files and must never reach production. */
export const FORBIDDEN_PRODUCTION_SECRETS = new Set([
  "change-me-access-secret",
  "change-me-refresh-secret",
  "secret",
  "changeme",
]);

export const MIN_PRODUCTION_SECRET_LENGTH = 32;

/**
 * Pure production hardening check, deliberately exported so it can be unit
 * tested without booting the whole env module (which `process.exit(1)`s).
 * Returns a list of human-readable issues; empty means the config is safe.
 */
export function validateProductionSecrets(input: {
  NODE_ENV?: string;
  JWT_ACCESS_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
}): string[] {
  if (input.NODE_ENV !== "production") return [];

  const issues: string[] = [];
  const access = input.JWT_ACCESS_SECRET ?? "";
  const refresh = input.JWT_REFRESH_SECRET ?? "";

  const isWeak = (secret: string): boolean =>
    secret.length === 0 ||
    secret.length < MIN_PRODUCTION_SECRET_LENGTH ||
    FORBIDDEN_PRODUCTION_SECRETS.has(secret);

  if (isWeak(access)) {
    issues.push(
      `JWT_ACCESS_SECRET quá yếu cho production (phải ≥ ${MIN_PRODUCTION_SECRET_LENGTH} ký tự ngẫu nhiên và không phải giá trị mặc định). Sinh bằng: openssl rand -hex 32`
    );
  }

  if (isWeak(refresh)) {
    issues.push(
      `JWT_REFRESH_SECRET quá yếu cho production (phải ≥ ${MIN_PRODUCTION_SECRET_LENGTH} ký tự ngẫu nhiên và không phải giá trị mặc định). Sinh bằng: openssl rand -hex 32`
    );
  }

  if (access.length > 0 && access === refresh) {
    issues.push(
      "JWT_ACCESS_SECRET và JWT_REFRESH_SECRET phải là hai giá trị khác nhau (access token không được dùng làm refresh token)."
    );
  }

  return issues;
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),

  /**
   * I-3: number of proxying hops in front of the API. `1` is correct behind a
   * single Cloudflare Tunnel / nginx hop. Set `0` when the API is reachable
   * directly (no proxy), otherwise clients can spoof X-Forwarded-For and evade
   * IP-based rate limiting.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),

  MONGODB_URI: z.string().min(1, "MONGODB_URI là bắt buộc"),

  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET là bắt buộc"),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default("2h"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET là bắt buộc"),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default("7d"),

  /**
   * Danh sách role chỉ được phép có MỘT phiên đăng nhập tại một thời điểm
   * (last-login-wins: thiết bị mới đăng nhập sẽ đẩy thiết bị cũ ra).
   * Ví dụ: "student" hoặc "student,teacher". Chuỗi rỗng = tắt chính sách.
   */
  SINGLE_DEVICE_ROLES: z
    .string()
    .default("student")
    .transform((value) =>
      value
        .split(",")
        .map((role) => role.trim())
        .filter((role) => role.length > 0)
    )
    .pipe(z.array(z.enum(["student", "teacher", "admin"]))),

  MINIO_ENDPOINT: z.string().min(1, "MINIO_ENDPOINT là bắt buộc"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: booleanFromString("false"),
  MINIO_ACCESS_KEY: z.string().min(1, "MINIO_ACCESS_KEY là bắt buộc"),
  MINIO_SECRET_KEY: z.string().min(1, "MINIO_SECRET_KEY là bắt buộc"),
  MINIO_BUCKET: z.string().min(1).default("ielts-media"),
  PUBLIC_MEDIA_URL: z.string().min(1, "PUBLIC_MEDIA_URL là bắt buộc"),

  /**
   * I-2: host/port that PRESIGNED URLs must embed. The signature covers the
   * Host header, so the browser-facing endpoint must be signed — while the API
   * keeps talking to MINIO_ENDPOINT internally (e.g. docker network hostname
   * `minio`). Leave unset to sign with the internal endpoint (local dev).
   */
  MINIO_PUBLIC_ENDPOINT: z.string().min(1).optional(),
  MINIO_PUBLIC_PORT: z.coerce.number().int().positive().optional(),
  MINIO_PUBLIC_USE_SSL: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),

  EXAM_GRACE_PERIOD_SECONDS: z.coerce.number().int().nonnegative().default(15),
  REQUIRE_ASSIGNMENT_FOR_ATTEMPT: booleanFromString("false"),
  ANTI_CHEAT_TAB_SWITCH_THRESHOLD: z.coerce.number().int().positive().default(5),
  ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD: z.coerce.number().int().positive().default(2),
  ANTI_CHEAT_PASTE_THRESHOLD: z.coerce.number().int().positive().default(3),
})
.superRefine((value, ctx) => {
  for (const message of validateProductionSecrets(value)) {
    ctx.addIssue({ code: "custom", message });
  }
  if (value.NODE_ENV === "production" && !value.REQUIRE_ASSIGNMENT_FOR_ATTEMPT) {
    ctx.addIssue({
      code: "custom",
      message:
        "REQUIRE_ASSIGNMENT_FOR_ATTEMPT phải là true trong production để Mock test không bị làm tự do ngoài assignment.",
    });
  }
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[env] Cấu hình biến môi trường không hợp lệ:");
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = parsed.data;
