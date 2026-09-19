import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as authController from "./auth.controller.js";
import { ChangePasswordSchema, LoginSchema, RegisterSchema } from "./auth.validation.js";

const router = Router();

router.post("/register", validate(RegisterSchema), authController.register);
router.post("/login", validate(LoginSchema), authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
router.post(
  "/change-password",
  authenticate,
  validate(ChangePasswordSchema),
  authController.changePassword
);

export { router as authRoutes };
export default router;
