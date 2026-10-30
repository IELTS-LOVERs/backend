import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { ExamModel } from "../exams/exam.model.js";
import { CollectionModel } from "./collection.model.js";
import {
  addExamsToCollection,
  createCollection,
  deleteCollection,
  getCollectionDetail,
  getCollectionTree,
  listCollections,
  removeExamFromCollection,
  reorderExamsInCollection,
  updateCollection,
  updateExamInCollection,
} from "./collection.service.js";

describe("Collection Service", () => {
  const teacherId = new mongoose.Types.ObjectId().toString();
  const collectionId = new mongoose.Types.ObjectId().toString();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("createCollection", () => {
    it("creates collection when name is unique", async () => {
      vi.spyOn(CollectionModel, "findOne").mockReturnValue({
        sort: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
        exec: vi.fn().mockResolvedValue(null),
      } as never);

      const mockCol = {
        _id: collectionId,
        name: "Cambridge IELTS 18",
        parentId: null,
        orderIndex: 0,
        createdBy: teacherId,
      };

      vi.spyOn(CollectionModel, "create").mockResolvedValue(mockCol as never);

      const res = await createCollection(
        {
          name: "Cambridge IELTS 18",
          orderIndex: 0,
        },
        teacherId
      );

      expect(res.name).toBe("Cambridge IELTS 18");
      expect(CollectionModel.create).toHaveBeenCalled();
    });

    it("throws ConflictError when collection name already exists", async () => {
      vi.spyOn(CollectionModel, "findOne").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: "existing_id", name: "Cambridge IELTS 18" }),
      } as never);

      await expect(
        createCollection(
          {
            name: "Cambridge IELTS 18",
          },
          teacherId
        )
      ).rejects.toThrow(ConflictError);
    });

    it("throws BadRequestError if parent collection is already a sub-collection (max 2 levels)", async () => {
      vi.spyOn(CollectionModel, "findOne").mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as never);

      const mockParent = {
        _id: new mongoose.Types.ObjectId(),
        name: "Cam 18",
        parentId: new mongoose.Types.ObjectId(), // has parent -> cannot be parent
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockParent),
      } as never);

      await expect(
        createCollection(
          {
            name: "Cam 18 Sub",
            parentId: mockParent._id.toString(),
          },
          teacherId
        )
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("listCollections", () => {
    it("lists collections and aggregates exam stats and childCount", async () => {
      const mockDocs = [
        {
          _id: collectionId,
          name: "Cambridge",
          parentId: null,
          orderIndex: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      vi.spyOn(CollectionModel, "find").mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(mockDocs),
          }),
        }),
      } as never);

      vi.spyOn(CollectionModel, "countDocuments").mockReturnValue({
        exec: vi.fn().mockResolvedValue(1),
      } as never);

      vi.spyOn(CollectionModel, "aggregate").mockResolvedValue([
        { _id: collectionId, count: 2 },
      ] as never);

      vi.spyOn(ExamModel, "aggregate").mockResolvedValue([
        {
          _id: "Cambridge",
          totalExams: 4,
          readingCount: 2,
          listeningCount: 2,
          writingCount: 0,
        },
      ] as never);

      const res = await listCollections(teacherId, "teacher", { page: 1, limit: 10 });
      expect(res.collections).toHaveLength(1);
      expect(res.collections[0].name).toBe("Cambridge");
      expect(res.collections[0].childCount).toBe(2);
      expect(res.collections[0].examCount).toBe(4);
    });
  });

  describe("getCollectionTree", () => {
    it("builds hierarchy with root and children and combined exam counts", async () => {
      const rootId = new mongoose.Types.ObjectId();
      const childId = new mongoose.Types.ObjectId();

      const allDocs = [
        {
          _id: rootId,
          name: "Cambridge",
          parentId: null,
          orderIndex: 0,
        },
        {
          _id: childId,
          name: "Cambridge 18",
          parentId: rootId,
          orderIndex: 0,
        },
      ];

      vi.spyOn(CollectionModel, "find").mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(allDocs),
        }),
      } as never);

      vi.spyOn(ExamModel, "aggregate").mockResolvedValue([
        {
          _id: "Cambridge 18",
          totalExams: 4,
          readingCount: 4,
          listeningCount: 0,
          writingCount: 0,
        },
      ] as never);

      const tree = await getCollectionTree();
      expect(tree).toHaveLength(1);
      expect(tree[0].name).toBe("Cambridge");
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].name).toBe("Cambridge 18");
      expect(tree[0].examCount).toBe(4);
      expect(tree[0].directExamCount).toBe(0);
    });
  });

  describe("getCollectionDetail", () => {
    it("returns collection and sorted exams", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Cambridge IELTS 18",
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      const mockExams = [
        {
          _id: new mongoose.Types.ObjectId(),
          title: "CAM 18 TEST 2 READING PASSAGE 1",
          curriculum: { testNumber: 2, orderIndex: 0, part: 1 },
          sections: [{ skill: "reading", part: 1 }],
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title: "CAM 18 TEST 1 READING PASSAGE 1",
          curriculum: { testNumber: 1, orderIndex: 0, part: 1 },
          sections: [{ skill: "reading", part: 1 }],
        },
      ];

      vi.spyOn(ExamModel, "find").mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue(mockExams),
          }),
        }),
      } as never);

      const res = await getCollectionDetail(collectionId, teacherId, "teacher");
      expect(res.collection.name).toBe("Cambridge IELTS 18");
      expect(res.exams).toHaveLength(2);
      expect(res.exams[0].curriculum?.testNumber).toBe(1);
      expect(res.exams[1].curriculum?.testNumber).toBe(2);
    });

    it("throws NotFoundError when collection does not exist", async () => {
      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as never);

      await expect(getCollectionDetail("not_found", teacherId, "teacher")).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe("updateCollection", () => {
    it("cascades name change to ExamModel curriculum.collectionName", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Old Collection Name",
        save: vi.fn().mockResolvedValue(undefined),
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      vi.spyOn(CollectionModel, "findOne").mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as never);

      const updateExamsSpy = vi.spyOn(ExamModel, "updateMany").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ modifiedCount: 3 }),
      } as never);

      const res = await updateCollection(
        collectionId,
        { name: "New Collection Name" },
        teacherId,
        "teacher"
      );

      expect(res.name).toBe("New Collection Name");
      expect(updateExamsSpy).toHaveBeenCalledWith(
        { "curriculum.collectionName": "Old Collection Name" },
        { $set: { "curriculum.collectionName": "New Collection Name" } }
      );
      expect(mockCol.save).toHaveBeenCalled();
    });

    it("prevents assigning parent to itself", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Collection A",
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      await expect(
        updateCollection(collectionId, { parentId: collectionId }, teacherId, "teacher")
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("deleteCollection", () => {
    it("promotes children to root, unlinks exams and deletes collection doc", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Collection To Delete",
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      const updateColSpy = vi.spyOn(CollectionModel, "updateMany").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
      } as never);

      const updateExamsSpy = vi.spyOn(ExamModel, "updateMany").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ modifiedCount: 5 }),
      } as never);

      const deleteColSpy = vi.spyOn(CollectionModel, "deleteOne").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      } as never);

      const res = await deleteCollection(collectionId, teacherId, "teacher");
      expect(res.id).toBe(collectionId);
      expect(updateColSpy).toHaveBeenCalledWith(
        { parentId: collectionId },
        { $set: { parentId: null } }
      );
      expect(updateExamsSpy).toHaveBeenCalledWith(
        { "curriculum.collectionName": "Collection To Delete" },
        { $set: { "curriculum.collectionName": null } }
      );
      expect(deleteColSpy).toHaveBeenCalledWith({ _id: collectionId });
    });
  });

  describe("addExamsToCollection", () => {
    it("bulk updates curriculum for added exams", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Cambridge IELTS 18",
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      vi.spyOn(CollectionModel, "exists").mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as never);

      const bulkWriteSpy = vi.spyOn(ExamModel, "bulkWrite").mockResolvedValue({
        modifiedCount: 2,
      } as never);

      const res = await addExamsToCollection(
        collectionId,
        {
          examIds: ["exam1", "exam2"],
          testNumber: 1,
          part: 1,
        },
        teacherId,
        "teacher"
      );

      expect(res.count).toBe(2);
      expect(bulkWriteSpy).toHaveBeenCalled();
    });

    it("throws ConflictError if collection already has child collections", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Cambridge Root",
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      vi.spyOn(CollectionModel, "exists").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ _id: "child1" }),
      } as never);

      await expect(
        addExamsToCollection(
          collectionId,
          {
            examIds: ["exam1"],
          },
          teacherId,
          "teacher"
        )
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("reorderExamsInCollection", () => {
    it("performs bulkWrite to reorder exams", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Cambridge IELTS 18",
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      const bulkWriteSpy = vi.spyOn(ExamModel, "bulkWrite").mockResolvedValue({
        modifiedCount: 2,
      } as never);

      const res = await reorderExamsInCollection(
        collectionId,
        {
          items: [
            { examId: "ex1", testNumber: 1, orderIndex: 0 },
            { examId: "ex2", testNumber: 1, orderIndex: 1 },
          ],
        },
        teacherId,
        "teacher"
      );

      expect(res.count).toBe(2);
      expect(bulkWriteSpy).toHaveBeenCalled();
    });
  });

  describe("removeExamFromCollection", () => {
    it("sets curriculum.collectionName to null", async () => {
      const mockCol = { _id: collectionId, name: "Cambridge IELTS 18" };
      const examId = new mongoose.Types.ObjectId();
      const mockExam = { _id: examId, title: "Test Exam" };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      vi.spyOn(ExamModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockExam),
      } as never);

      const updateOneSpy = vi.spyOn(ExamModel, "updateOne").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      } as never);

      const res = await removeExamFromCollection(
        collectionId,
        examId.toString(),
        teacherId,
        "teacher"
      );

      expect(res.examId).toBe(examId.toString());
      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: examId },
        { $set: { "curriculum.collectionName": null } }
      );
    });
  });

  describe("updateExamInCollection", () => {
    it("updates testNumber and part", async () => {
      const mockCol = { _id: collectionId, name: "Cambridge IELTS 18" };
      const examId = new mongoose.Types.ObjectId();
      const mockExam = { _id: examId, title: "Test Exam" };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      vi.spyOn(ExamModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockExam),
      } as never);

      const updateOneSpy = vi.spyOn(ExamModel, "updateOne").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
      } as never);

      const res = await updateExamInCollection(
        collectionId,
        examId.toString(),
        { testNumber: 3, part: 2, orderIndex: 4 },
        teacherId,
        "teacher"
      );

      expect(res.examId).toBe(examId.toString());
      expect(updateOneSpy).toHaveBeenCalledWith(
        { _id: examId },
        {
          $set: {
            "curriculum.testNumber": 3,
            "curriculum.part": 2,
            "curriculum.orderIndex": 4,
          },
        }
      );
    });
  });
});
