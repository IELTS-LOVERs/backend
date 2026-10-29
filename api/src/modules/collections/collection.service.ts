import { ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { ExamModel } from "../exams/exam.model.js";
import {
  CollectionModel,
  type CollectionCategory,
  type ICollection,
} from "./collection.model.js";
import type {
  AddExamsToCollectionBody,
  CreateCollectionBody,
  ListCollectionsQuery,
  UpdateCollectionBody,
  UpdateExamInCollectionBody,
} from "./collection.validation.js";

function escapeRegex(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

export interface CollectionWithStats {
  _id: string;
  name: string;
  category: CollectionCategory;
  description?: string;
  bannerUrl?: string;
  orderIndex: number;
  examCount: number;
  readingCount: number;
  listeningCount: number;
  writingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionDetailResponse {
  collection: ICollection;
  exams: Array<{
    _id: string;
    title: string;
    kind: string;
    scoringMode: string;
    status: string;
    durationMinutes: number;
    sections: Array<{
      _id: unknown;
      skill: string;
      part: number;
      title?: string;
    }>;
    curriculum?: {
      collectionName?: string;
      testNumber?: number;
      part?: number;
      orderIndex?: number;
    };
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export async function listCollections(
  _userId: string,
  _role: string,
  query: ListCollectionsQuery
): Promise<{
  collections: CollectionWithStats[];
  allCategories: string[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const filter: Record<string, unknown> = {};

  if (query.search) {
    filter.name = { $regex: new RegExp(escapeRegex(query.search), "i") };
  }
  if (query.category) {
    filter.category = { $regex: new RegExp(`^${escapeRegex(query.category)}$`, "i") };
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 50;
  const skip = (page - 1) * limit;

  const [rawDocs, total, distinctCategories] = await Promise.all([
    CollectionModel.find(filter)
      .sort({ orderIndex: 1, createdAt: -1 })
      .lean()
      .exec(),
    CollectionModel.countDocuments(filter).exec(),
    CollectionModel.distinct("category").exec(),
  ]);

  // Natural sort by name if orderIndex is same
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  rawDocs.sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) {
      return a.orderIndex - b.orderIndex;
    }
    return collator.compare(a.name, b.name);
  });

  const pagedDocs = rawDocs.slice(skip, skip + limit);

  // Aggregate exam counts per collection
  const collectionNames = pagedDocs.map((doc) => doc.name);
  const examStats = await ExamModel.aggregate([
    {
      $match: {
        "curriculum.collectionName": { $in: collectionNames },
      },
    },
    {
      $project: {
        collectionName: "$curriculum.collectionName",
        skills: "$sections.skill",
      },
    },
    {
      $group: {
        _id: "$collectionName",
        totalExams: { $sum: 1 },
        readingCount: {
          $sum: { $cond: [{ $in: ["reading", "$skills"] }, 1, 0] },
        },
        listeningCount: {
          $sum: { $cond: [{ $in: ["listening", "$skills"] }, 1, 0] },
        },
        writingCount: {
          $sum: { $cond: [{ $in: ["writing", "$skills"] }, 1, 0] },
        },
      },
    },
  ]);

  const statsMap = new Map<string, { totalExams: number; readingCount: number; listeningCount: number; writingCount: number }>();
  for (const stat of examStats) {
    if (stat._id) {
      statsMap.set(String(stat._id).toLowerCase(), {
        totalExams: stat.totalExams || 0,
        readingCount: stat.readingCount || 0,
        listeningCount: stat.listeningCount || 0,
        writingCount: stat.writingCount || 0,
      });
    }
  }

  const collections: CollectionWithStats[] = pagedDocs.map((doc) => {
    const stats = statsMap.get(doc.name.toLowerCase()) || {
      totalExams: 0,
      readingCount: 0,
      listeningCount: 0,
      writingCount: 0,
    };

    return {
      _id: String(doc._id),
      name: doc.name,
      category: doc.category,
      description: doc.description,
      bannerUrl: doc.bannerUrl,
      orderIndex: doc.orderIndex,
      examCount: stats.totalExams,
      readingCount: stats.readingCount,
      listeningCount: stats.listeningCount,
      writingCount: stats.writingCount,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  });

  return {
    collections,
    allCategories: (distinctCategories as string[]).filter(Boolean),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getCollectionDetail(
  id: string,
  _userId: string,
  _role: string
): Promise<CollectionDetailResponse> {
  const collection = await CollectionModel.findById(id).exec();
  if (!collection) {
    throw new NotFoundError("Không tìm thấy nhóm bộ đề.");
  }

  const exams = await ExamModel.find({
    "curriculum.collectionName": collection.name,
  })
    .select("_id title kind scoringMode status durationMinutes sections curriculum createdAt updatedAt")
    .lean()
    .exec();

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

  exams.sort((a, b) => {
    const testA = a.curriculum?.testNumber ?? 9999;
    const testB = b.curriculum?.testNumber ?? 9999;
    if (testA !== testB) return testA - testB;

    const partA = a.curriculum?.part ?? 9999;
    const partB = b.curriculum?.part ?? 9999;
    if (partA !== partB) return partA - partB;

    const orderA = a.curriculum?.orderIndex ?? 0;
    const orderB = b.curriculum?.orderIndex ?? 0;
    if (orderA !== orderB) return orderA - orderB;

    return collator.compare(a.title, b.title);
  });

  const formattedExams = exams.map((exam) => ({
    _id: String(exam._id),
    title: exam.title,
    kind: exam.kind,
    scoringMode: exam.scoringMode,
    status: exam.status,
    durationMinutes: exam.durationMinutes,
    sections: (exam.sections || []).map((sec) => ({
      _id: sec._id,
      skill: sec.skill,
      part: sec.part,
      title: sec.title,
    })),
    curriculum: exam.curriculum,
    createdAt: exam.createdAt,
    updatedAt: exam.updatedAt,
  }));

  return {
    collection,
    exams: formattedExams,
  };
}

export async function createCollection(
  data: CreateCollectionBody,
  userId: string
): Promise<ICollection> {
  const existing = await CollectionModel.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(data.name)}$`, "i") },
  }).exec();

  if (existing) {
    throw new ConflictError("COLLECTION_EXISTS", "Tên nhóm bộ đề đã tồn tại.");
  }

  const created = await CollectionModel.create({
    name: data.name,
    category: data.category,
    description: data.description,
    bannerUrl: data.bannerUrl,
    orderIndex: data.orderIndex ?? 0,
    createdBy: userId,
  });

  return created;
}

export async function updateCollection(
  id: string,
  data: UpdateCollectionBody,
  _userId: string,
  _role: string
): Promise<ICollection> {
  const collection = await CollectionModel.findById(id).exec();
  if (!collection) {
    throw new NotFoundError("Không tìm thấy nhóm bộ đề.");
  }

  if (data.name && data.name.trim().toLowerCase() !== collection.name.toLowerCase()) {
    const existing = await CollectionModel.findOne({
      _id: { $ne: collection._id },
      name: { $regex: new RegExp(`^${escapeRegex(data.name.trim())}$`, "i") },
    }).exec();

    if (existing) {
      throw new ConflictError("COLLECTION_EXISTS", "Tên nhóm bộ đề đã tồn tại.");
    }

    const oldName = collection.name;
    const newName = data.name.trim();

    // Cascade rename to linked exams
    await ExamModel.updateMany(
      { "curriculum.collectionName": oldName },
      { $set: { "curriculum.collectionName": newName } }
    ).exec();

    collection.name = newName;
  }

  if (data.category !== undefined) {
    collection.category = data.category;
  }
  if (data.description !== undefined) {
    collection.description = data.description ?? undefined;
  }
  if (data.bannerUrl !== undefined) {
    collection.bannerUrl = data.bannerUrl ?? undefined;
  }
  if (data.orderIndex !== undefined) {
    collection.orderIndex = data.orderIndex;
  }

  await collection.save();
  return collection;
}

export async function deleteCollection(
  id: string,
  _userId: string,
  _role: string
): Promise<{ id: string; message: string }> {
  const collection = await CollectionModel.findById(id).exec();
  if (!collection) {
    throw new NotFoundError("Không tìm thấy nhóm bộ đề.");
  }

  // Unlink associated exams (keep exams safe in library)
  await ExamModel.updateMany(
    { "curriculum.collectionName": collection.name },
    { $set: { "curriculum.collectionName": null } }
  ).exec();

  await CollectionModel.deleteOne({ _id: collection._id }).exec();

  return { id, message: "Đã xoá nhóm bộ đề thành công." };
}

export async function addExamsToCollection(
  collectionId: string,
  body: AddExamsToCollectionBody,
  _userId: string,
  _role: string
): Promise<{ count: number; message: string }> {
  const collection = await CollectionModel.findById(collectionId).exec();
  if (!collection) {
    throw new NotFoundError("Không tìm thấy nhóm bộ đề.");
  }

  interface ExamItemConfig {
    examId: string;
    testNumber?: number;
    part?: number;
    orderIndex?: number;
  }

  let items: ExamItemConfig[] = [];
  if ("items" in body && Array.isArray(body.items)) {
    items = body.items;
  } else if ("examIds" in body && Array.isArray(body.examIds)) {
    items = body.examIds.map((examId, index) => ({
      examId,
      testNumber: body.testNumber,
      part: body.part,
      orderIndex: body.orderIndex !== undefined ? body.orderIndex + index : index,
    }));
  }

  if (items.length === 0) {
    return { count: 0, message: "Không có đề thi nào để cập nhật." };
  }

  const bulkOps = items.map((item) => {
    const setFields: Record<string, unknown> = {
      "curriculum.collectionName": collection.name,
    };
    if (item.testNumber !== undefined) {
      setFields["curriculum.testNumber"] = item.testNumber;
    }
    if (item.part !== undefined) {
      setFields["curriculum.part"] = item.part;
    }
    if (item.orderIndex !== undefined) {
      setFields["curriculum.orderIndex"] = item.orderIndex;
    }

    return {
      updateOne: {
        filter: { _id: item.examId },
        update: { $set: setFields },
      },
    };
  });

  const result = await ExamModel.bulkWrite(bulkOps);

  return {
    count: result.modifiedCount,
    message: `Đã thêm ${result.modifiedCount} đề thi vào nhóm bộ đề.`,
  };
}

export async function removeExamFromCollection(
  collectionId: string,
  examId: string,
  _userId: string,
  _role: string
): Promise<{ examId: string; message: string }> {
  const collection = await CollectionModel.findById(collectionId).exec();
  if (!collection) {
    throw new NotFoundError("Không tìm thấy nhóm bộ đề.");
  }

  const exam = await ExamModel.findById(examId).exec();
  if (!exam) {
    throw new NotFoundError("Không tìm thấy bài thi.");
  }

  await ExamModel.updateOne(
    { _id: exam._id },
    { $set: { "curriculum.collectionName": null } }
  ).exec();

  return { examId, message: "Đã gỡ bài thi khỏi nhóm bộ đề." };
}

export async function updateExamInCollection(
  collectionId: string,
  examId: string,
  data: UpdateExamInCollectionBody,
  _userId: string,
  _role: string
): Promise<{ examId: string; message: string }> {
  const collection = await CollectionModel.findById(collectionId).exec();
  if (!collection) {
    throw new NotFoundError("Không tìm thấy nhóm bộ đề.");
  }

  const exam = await ExamModel.findById(examId).exec();
  if (!exam) {
    throw new NotFoundError("Không tìm thấy bài thi.");
  }

  const setFields: Record<string, unknown> = {};
  if (data.testNumber !== undefined) {
    setFields["curriculum.testNumber"] = data.testNumber;
  }
  if (data.part !== undefined) {
    setFields["curriculum.part"] = data.part;
  }
  if (data.orderIndex !== undefined) {
    setFields["curriculum.orderIndex"] = data.orderIndex;
  }

  if (Object.keys(setFields).length > 0) {
    await ExamModel.updateOne({ _id: exam._id }, { $set: setFields }).exec();
  }

  return { examId, message: "Đã cập nhật vị trí bài thi trong nhóm bộ đề." };
}
