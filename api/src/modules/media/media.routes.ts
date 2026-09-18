import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as mediaController from "./media.controller.js";
import { PresignUploadSchema } from "./media.validation.js";

const router = Router();

router.post(
  "/presign",
  authenticate,
  requireRoles("teacher", "admin"),
  validate(PresignUploadSchema),
  mediaController.presignUpload
);
router.post("/:id/confirm", authenticate, mediaController.confirmUpload);

export { router as mediaRoutes };
export default router;
