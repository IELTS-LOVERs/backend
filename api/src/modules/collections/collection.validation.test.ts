import { describe, expect, it } from "vitest";
import {
  AddExamsToCollectionSchema,
  CreateCollectionSchema,
  ListCollectionsSchema,
  UpdateCollectionSchema,
  UpdateExamInCollectionSchema,
} from "./collection.validation.js";

describe("Collection Validation Schemas", () => {
  describe("CreateCollectionSchema", () => {
    it("validates valid payload with default category", () => {
      const parsed = CreateCollectionSchema.safeParse({
        body: {
          name: "Cambridge IELTS 19",
        },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.body.category).toBe("Giáo trình trung tâm");
        expect(parsed.data.body.orderIndex).toBe(0);
      }
    });

    it("accepts custom category string", () => {
      const parsed = CreateCollectionSchema.safeParse({
        body: {
          name: "Cambridge IELTS 19",
          category: "Forecast 2026",
        },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.body.category).toBe("Forecast 2026");
      }
    });

    it("fails when name is too short", () => {
      const parsed = CreateCollectionSchema.safeParse({
        body: {
          name: "C",
        },
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("UpdateCollectionSchema", () => {
    it("accepts valid partial updates", () => {
      const parsed = UpdateCollectionSchema.safeParse({
        params: { id: "col123" },
        body: {
          name: "Cambridge IELTS 19 Updated",
          category: "cambridge",
        },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("ListCollectionsSchema", () => {
    it("coerces page and limit strings to numbers", () => {
      const parsed = ListCollectionsSchema.safeParse({
        query: {
          page: "2",
          limit: "25",
          category: "vol",
        },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.query.page).toBe(2);
        expect(parsed.data.query.limit).toBe(25);
        expect(parsed.data.query.category).toBe("vol");
      }
    });
  });

  describe("AddExamsToCollectionSchema", () => {
    it("accepts examIds array variant", () => {
      const parsed = AddExamsToCollectionSchema.safeParse({
        params: { id: "col123" },
        body: {
          examIds: ["exam1", "exam2"],
          testNumber: 1,
          part: 1,
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts items array variant", () => {
      const parsed = AddExamsToCollectionSchema.safeParse({
        params: { id: "col123" },
        body: {
          items: [
            { examId: "exam1", testNumber: 1, part: 1 },
            { examId: "exam2", testNumber: 1, part: 2 },
          ],
        },
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("UpdateExamInCollectionSchema", () => {
    it("accepts valid testNumber and part", () => {
      const parsed = UpdateExamInCollectionSchema.safeParse({
        params: { id: "col123", examId: "exam1" },
        body: {
          testNumber: 2,
          part: 3,
          orderIndex: 1,
        },
      });
      expect(parsed.success).toBe(true);
    });
  });
});
