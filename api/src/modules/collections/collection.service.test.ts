import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { ExamModel } from "../exams/exam.model.js";
import { CollectionModel } from "./collection.model.js";
import {
  addExamsToCollection,
  createCollection,
  deleteCollection,
  getCollectionDetail,
  listCollections,
  removeExamFromCollection,
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
        exec: vi.fn().mockResolvedValue(null),
      } as never);

      const mockCol = {
        _id: collectionId,
        name: "Cambridge IELTS 18",
        category: "cambridge",
        orderIndex: 0,
        createdBy: teacherId,
      };

      vi.spyOn(CollectionModel, "create").mockResolvedValue(mockCol as never);

      const res = await createCollection(
        {
          name: "Cambridge IELTS 18",
          category: "cambridge",
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
            category: "cambridge",
          },
          teacherId
        )
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("listCollections", () => {
    it("lists collections and aggregates exam stats", async () => {
      const mockDocs = [
        {
          _id: collectionId,
          name: "Cambridge IELTS 18",
          category: "cambridge",
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

      vi.spyOn(CollectionModel, "distinct").mockReturnValue({
        exec: vi.fn().mockResolvedValue(["cambridge"]),
      } as never);

      vi.spyOn(ExamModel, "aggregate").mockResolvedValue([
        {
          _id: "Cambridge IELTS 18",
          totalExams: 4,
          readingCount: 2,
          listeningCount: 2,
          writingCount: 0,
        },
      ] as never);

      const res = await listCollections(teacherId, "teacher", { page: 1, limit: 10 });
      expect(res.collections).toHaveLength(1);
      expect(res.collections[0].name).toBe("Cambridge IELTS 18");
      expect(res.collections[0].examCount).toBe(4);
      expect(res.collections[0].readingCount).toBe(2);
      expect(res.collections[0].listeningCount).toBe(2);
      expect(res.collections[0].writingCount).toBe(0);
    });
  });

  describe("getCollectionDetail", () => {
    it("returns collection and sorted exams", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Cambridge IELTS 18",
        category: "cambridge",
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      const mockExams = [
        {
          _id: new mongoose.Types.ObjectId(),
          title: "CAM 18 TEST 2 READING PASSAGE 1",
          curriculum: { testNumber: 2, part: 1 },
          sections: [{ skill: "reading", part: 1 }],
        },
        {
          _id: new mongoose.Types.ObjectId(),
          title: "CAM 18 TEST 1 READING PASSAGE 1",
          curriculum: { testNumber: 1, part: 1 },
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
      // Sorted by testNumber asc: Test 1 before Test 2
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
        category: "custom",
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
  });

  describe("deleteCollection", () => {
    it("unlinks exams and deletes collection doc", async () => {
      const mockCol = {
        _id: collectionId,
        name: "Collection To Delete",
      };

      vi.spyOn(CollectionModel, "findById").mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockCol),
      } as never);

      const updateExamsSpy = vi.spyOn(ExamModel, "updateMany").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ modifiedCount: 5 }),
      } as never);

      const deleteColSpy = vi.spyOn(CollectionModel, "deleteOne").mockReturnValue({
        exec: vi.fn().mockResolvedValue({ deletedCount: 1 }),
      } as never);

      const res = await deleteCollection(collectionId, teacherId, "teacher");
      expect(res.id).toBe(collectionId);
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
