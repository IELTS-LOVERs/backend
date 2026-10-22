import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as dashboardController from "../dashboard/dashboard.controller.js";
import * as userController from "./user.controller.js";
import {
  AdminResetPasswordSchema,
  CreateUserSchema,
  ListUsersSchema,
  UpdateProfileSchema,
  UpdateUserStatusSchema,
} from "./user.validation.js";

const router = Router();

router.get("/me", authenticate, userController.getMe);
router.patch("/me", authenticate, validate(UpdateProfileSchema), userController.updateMe);
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
router.get(
  "/",
  authenticate,
  requireRoles("admin"),
  validate(ListUsersSchema),
  userController.listUsers
);
router.post(
  "/",
  authenticate,
  requireRoles("admin"),
  validate(CreateUserSchema),
  userController.createUser
);
router.patch(
  "/:id/status",
  authenticate,
  requireRoles("admin"),
  validate(UpdateUserStatusSchema),
  userController.updateUserStatus
);
router.post(
  "/:id/reset-password",
  authenticate,
  requireRoles("admin"),
  validate(AdminResetPasswordSchema),
  userController.adminResetPassword
);
router.post(
  "/:id/revoke-sessions",
  authenticate,
  requireRoles("admin"),
  userController.revokeSessions
);

export { router as userRoutes };
export default router;
