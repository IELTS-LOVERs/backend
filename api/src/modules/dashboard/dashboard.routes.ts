import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import * as dashboardController from "./dashboard.controller.js";

const router = Router();

router.get(
  "/student",
  authenticate,
  requireRoles("student"),
  dashboardController.getStudentDashboard
);

router.get(
  "/teacher",
  authenticate,
  requireRoles("teacher", "admin"),
  dashboardController.getTeacherDashboard
);

export { router as dashboardRoutes };
export default router;
