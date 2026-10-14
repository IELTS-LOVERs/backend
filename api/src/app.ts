import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { sendSuccess } from "./common/utils/response.util.js";
import { errorHandler } from "./common/middlewares/errorHandler.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { userRoutes } from "./modules/users/user.routes.js";
import { classRoutes } from "./modules/classes/class.routes.js";
import { questionRoutes } from "./modules/questions/question.routes.js";
import { examRoutes } from "./modules/exams/exam.routes.js";
import { assignmentRoutes } from "./modules/assignments/assignment.routes.js";
import { attemptRoutes } from "./modules/attempts/attempt.routes.js";
import {
  gradingAttemptRoutes,
  gradingRoutes,
  writingReviewRoutes,
} from "./modules/grading/grading.routes.js";
import { mediaRoutes } from "./modules/media/media.routes.js";
import { antiCheatRoutes } from "./modules/anti-cheat/anti-cheat.routes.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard.routes.js";
import { analyticsRoutes } from "./modules/analytics/analytics.routes.js";

const app = express();

// I-3: behind Cloudflare Tunnel / reverse proxies, the client IP arrives in
// X-Forwarded-For. The number of trusted hops is configurable (set
// TRUST_PROXY_HOPS=0 when the API is reachable directly) so `req.ip` stays
// accurate in logs — and would stay accurate if rate limiting is re-enabled.
app.set("trust proxy", env.TRUST_PROXY_HOPS);

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  sendSuccess(res, { status: "ok", timestamp: new Date() });
});

// ⚠️ RATE LIMITING ĐÃ ĐƯỢC GỠ theo yêu cầu chủ dự án (2026-10-14):
// không còn giới hạn tần suất cho /api/auth/login, /api/auth/register,
// /api/auth/refresh và toàn bộ /api. Hệ quả: không còn lớp chống brute-force
// mật khẩu và DoS nhẹ ở tầng ứng dụng.
// Middleware `common/middlewares/rateLimiter.ts` (+ test) vẫn được giữ nguyên;
// để bật lại, chỉ cần import và mount như cũ:
//   app.use("/api/auth/login", createRateLimiter(10, 60_000, { skipSuccessfulRequests: true }));
//   app.use("/api", createRateLimiter(1200, 60_000));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/classes", classRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/exams", examRoutes);
app.use("/api/assignments", assignmentRoutes);
app.use("/api/attempts", attemptRoutes);
app.use("/api/attempts", gradingAttemptRoutes);
app.use("/api/grading", gradingRoutes);
app.use("/api/writing-reviews", writingReviewRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/anti-cheat", antiCheatRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/analytics", analyticsRoutes);


app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Endpoint không tồn tại.",
      details: null,
    },
  });
});

app.use(errorHandler);

export { app };
export default app;
