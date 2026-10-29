import { Router } from "express";
import { authenticate } from "../../common/middlewares/auth.middleware.js";
import { requireRoles } from "../../common/middlewares/rbac.middleware.js";
import { validate } from "../../common/middlewares/validate.middleware.js";
import * as collectionController from "./collection.controller.js";
import {
  AddExamsToCollectionSchema,
  CreateCollectionSchema,
  DeleteCollectionSchema,
  GetCollectionSchema,
  ListCollectionsSchema,
  RemoveExamFromCollectionSchema,
  UpdateCollectionSchema,
  UpdateExamInCollectionSchema,
} from "./collection.validation.js";

const router = Router();

router.get(
  "/",
  authenticate,
  validate(ListCollectionsSchema),
  collectionController.listCollections
);

router.get(
  "/:id",
  authenticate,
  validate(GetCollectionSchema),
  collectionController.getCollection
);

router.use(authenticate, requireRoles("teacher", "admin"));

router.post(
  "/",
  validate(CreateCollectionSchema),
  collectionController.createCollection
);

router.put(
  "/:id",
  validate(UpdateCollectionSchema),
  collectionController.updateCollection
);

router.delete(
  "/:id",
  validate(DeleteCollectionSchema),
  collectionController.deleteCollection
);

router.post(
  "/:id/exams",
  validate(AddExamsToCollectionSchema),
  collectionController.addExamsToCollection
);

router.delete(
  "/:id/exams/:examId",
  validate(RemoveExamFromCollectionSchema),
  collectionController.removeExamFromCollection
);

router.patch(
  "/:id/exams/:examId",
  validate(UpdateExamInCollectionSchema),
  collectionController.updateExamInCollection
);

export { router as collectionRoutes };
export default router;
