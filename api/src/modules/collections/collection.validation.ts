import { z } from "zod";

export const CreateCollectionSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, "Tên bộ đề tối thiểu 2 ký tự").max(120, "Tên bộ đề tối đa 120 ký tự"),
    parentId: z.string().trim().min(1).nullable().optional(),
    description: z.string().trim().max(500, "Mô tả tối đa 500 ký tự").optional(),
    bannerUrl: z.string().trim().optional(),
    orderIndex: z.number().int().min(0).default(0),
  }),
});

export const UpdateCollectionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID bộ đề"),
  }),
  body: z.object({
    name: z.string().trim().min(2, "Tên bộ đề tối thiểu 2 ký tự").max(120, "Tên bộ đề tối đa 120 ký tự").optional(),
    parentId: z.string().trim().min(1).nullable().optional(),
    description: z.string().trim().max(500, "Mô tả tối đa 500 ký tự").optional().nullable(),
    bannerUrl: z.string().trim().optional().nullable(),
    orderIndex: z.number().int().min(0).optional(),
  }),
});

export const GetCollectionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID bộ đề"),
  }),
});

export const DeleteCollectionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID bộ đề"),
  }),
});

export const ListCollectionsSchema = z.object({
  query: z.object({
    search: z.string().trim().max(200).optional(),
    parentId: z.string().trim().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});

export const AddExamsToCollectionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID bộ đề"),
  }),
  body: z.union([
    z.object({
      examIds: z.array(z.string().min(1)).min(1, "Phải chọn ít nhất một đề thi"),
      testNumber: z.number().int().min(1).optional(),
      part: z.number().int().min(1).max(4).optional(),
      orderIndex: z.number().int().min(0).optional(),
    }),
    z.object({
      items: z
        .array(
          z.object({
            examId: z.string().min(1),
            testNumber: z.number().int().min(1).optional(),
            part: z.number().int().min(1).max(4).optional(),
            orderIndex: z.number().int().min(0).optional(),
          })
        )
        .min(1, "Phải chọn ít nhất một đề thi"),
    }),
  ]),
});

export const RemoveExamFromCollectionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID bộ đề"),
    examId: z.string().min(1, "Thiếu ID đề thi"),
  }),
});

export const UpdateExamInCollectionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID bộ đề"),
    examId: z.string().min(1, "Thiếu ID đề thi"),
  }),
  body: z.object({
    testNumber: z.number().int().min(1).optional().nullable(),
    part: z.number().int().min(1).max(4).optional().nullable(),
    orderIndex: z.number().int().min(0).optional().nullable(),
  }),
});

export const ReorderExamsInCollectionSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID bộ đề"),
  }),
  body: z.object({
    items: z
      .array(
        z.object({
          examId: z.string().min(1, "Thiếu ID đề thi"),
          testNumber: z.number().int().min(1, "Test number tối thiểu là 1"),
          orderIndex: z.number().int().min(0, "Order index tối thiểu là 0"),
        })
      )
      .min(1, "Cần ít nhất một mục để cập nhật thứ tự"),
  }),
});

export type CreateCollectionBody = z.infer<typeof CreateCollectionSchema>["body"];
export type UpdateCollectionBody = z.infer<typeof UpdateCollectionSchema>["body"];
export type ListCollectionsQuery = z.infer<typeof ListCollectionsSchema>["query"];
export type AddExamsToCollectionBody = z.infer<typeof AddExamsToCollectionSchema>["body"];
export type UpdateExamInCollectionBody = z.infer<typeof UpdateExamInCollectionSchema>["body"];
export type ReorderExamsInCollectionBody = z.infer<typeof ReorderExamsInCollectionSchema>["body"];
