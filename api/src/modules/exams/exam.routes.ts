import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as examController from "./exam.controller.js";
import { CreateExamSchema, ListExamsSchema, UpdateExamSchema } from "./exam.validation.js";

const router = Router();

router.get("/", authenticate, validate(ListExamsSchema), examController.listExams);
router.get("/:id", authenticate, examController.getExam);

router.use(authenticate, requireRoles("teacher", "admin"));

router.post("/", validate(CreateExamSchema), examController.createExam);
router.put("/:id", validate(UpdateExamSchema), examController.updateExam);
router.delete("/:id", examController.deleteExam);
router.post("/:id/clone", examController.cloneExam);
router.patch("/:id/publish", examController.publishExam);
router.patch("/:id/unpublish", examController.unpublishExam);
router.patch("/:id/close", examController.closeExam);

export { router as examRoutes };
export default router;
