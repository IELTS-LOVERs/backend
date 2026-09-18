import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as dashboardController from "../dashboard/dashboard.controller.js";
import * as userController from "./user.controller.js";
import { AdminResetPasswordSchema } from "./user.validation.js";

const router = Router();

router.get("/me", authenticate, userController.getMe);
router.get(
  "/dashboard/student",
  authenticate,
  requireRoles("student"),
  dashboardController.getStudentDashboard
);
router.get(
  "/dashboard/teacher",
  authenticate,
  requireRoles("teacher", "admin"),
  dashboardController.getTeacherDashboard
);
router.post(
  "/:id/reset-password",
  authenticate,
  requireRoles("admin"),
  validate(AdminResetPasswordSchema),
  userController.adminResetPassword
);

export { router as userRoutes };
export default router;
