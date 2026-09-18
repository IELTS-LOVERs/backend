import { Router } from "express";
import { createRateLimiter } from "../../common/middlewares/rateLimiter.js";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as authController from "./auth.controller.js";
import { ChangePasswordSchema, LoginSchema, RegisterSchema } from "./auth.validation.js";

const router = Router();

const authRateLimiter = createRateLimiter(10, 15 * 60 * 1000);

router.post("/register", authRateLimiter, validate(RegisterSchema), authController.register);
router.post("/login", authRateLimiter, validate(LoginSchema), authController.login);
router.post("/refresh", authRateLimiter, authController.refresh);
router.post("/logout", authController.logout);
router.post(
  "/change-password",
  authenticate,
  validate(ChangePasswordSchema),
  authController.changePassword
);

export { router as authRoutes };
export default router;
