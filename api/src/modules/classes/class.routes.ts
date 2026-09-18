import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as classController from "./class.controller.js";
import { AddStudentSchema, CreateClassSchema, JoinClassSchema } from "./class.validation.js";

const router = Router();

router.get("/", authenticate, classController.getClasses);
router.post(
  "/",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(CreateClassSchema),
  classController.createClass
);
router.post(
  "/join",
  authenticate,
  requireRoles("student"),
  validate(JoinClassSchema),
  classController.joinClass
);
router.get("/:id", authenticate, classController.getClassDetail);
router.post(
  "/:id/students",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(AddStudentSchema),
  classController.addStudent
);
router.delete(
  "/:id/students/:studentId",
  authenticate,
  requireRoles("teacher", "admin"),
  classController.removeStudent
);

export { router as classRoutes };
export default router;
