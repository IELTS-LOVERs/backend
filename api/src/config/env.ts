import "dotenv/config";
import { z } from "zod";

const booleanFromString = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),

  MONGODB_URI: z.string().min(1, "MONGODB_URI là bắt buộc"),

  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET là bắt buộc"),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default("15m"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET là bắt buộc"),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default("7d"),

  MINIO_ENDPOINT: z.string().min(1, "MINIO_ENDPOINT là bắt buộc"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: booleanFromString("false"),
  MINIO_ACCESS_KEY: z.string().min(1, "MINIO_ACCESS_KEY là bắt buộc"),
  MINIO_SECRET_KEY: z.string().min(1, "MINIO_SECRET_KEY là bắt buộc"),
  MINIO_BUCKET: z.string().min(1).default("ielts-media"),
  PUBLIC_MEDIA_URL: z.string().min(1, "PUBLIC_MEDIA_URL là bắt buộc"),

  EXAM_GRACE_PERIOD_SECONDS: z.coerce.number().int().nonnegative().default(15),
  ANTI_CHEAT_TAB_SWITCH_THRESHOLD: z.coerce.number().int().positive().default(5),
  ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD: z.coerce.number().int().positive().default(2),
  ANTI_CHEAT_PASTE_THRESHOLD: z.coerce.number().int().positive().default(3),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[env] Cấu hình biến môi trường không hợp lệ:");
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = parsed.data;
