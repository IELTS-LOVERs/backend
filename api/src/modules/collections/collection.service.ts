import mongoose, { type Types } from "mongoose";
import { BadRequestError, ConflictError, NotFoundError } from "../../common/errors/AppError.js";
import { ExamModel } from "../exams/exam.model.js";
import {
  CollectionModel,
  type ICollection,
} from "./collection.model.js";
import type {
  AddExamsToCollectionBody,
  CreateCollectionBody,
  ListCollectionsQuery,
  ReorderExamsInCollectionBody,
  UpdateCollectionBody,
  UpdateExamInCollectionBody,
} from "./collection.validation.js";

function escapeRegex(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

export interface CollectionWithStats {
  _id: string;
  name: string;
  parentId?: string | null;
  description?: string;
  bannerUrl?: string;
  orderIndex: number;
  childCount: number;
  examCount: number;
  readingCount: number;
  listeningCount: number;
  writingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CollectionTreeNode {
  _id: string;
  name: string;
  description?: string;
  bannerUrl?: string;
  orderIndex: number;
  examCount: number;
  directExamCount: number;
  readingCount: number;
  listeningCount: number;
  writingCount: number;
  children: Array<{
    _id: string;
    name: string;
    parentId: string;
    description?: string;
    bannerUrl?: string;
    orderIndex: number;
    examCount: number;
    readingCount: number;
    listeningCount: number;
    writingCount: number;
  }>;
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
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}> {
  const filter: Record<string, unknown> = {};

  if (query.search) {
    filter.name = { $regex: new RegExp(escapeRegex(query.search), "i") };
  }
  if (query.parentId !== undefined) {
    if (query.parentId === "null" || query.parentId === "") {
      filter.parentId = null;
    } else {
      filter.parentId = new mongoose.Types.ObjectId(query.parentId);
    }
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 50;
  const skip = (page - 1) * limit;

  const [rawDocs, total] = await Promise.all([
    CollectionModel.find(filter)
      .sort({ orderIndex: 1, createdAt: -1 })
      .lean()
      .exec(),
    CollectionModel.countDocuments(filter).exec(),
  ]);

  // Natural sort by name if orderIndex is same
  const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });
  rawDocs.sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) {
      return a.orderIndex - b.orderIndex;
    }
    return collator.compare(a.name, b.name);
  });

  const pagedDocs = rawDocs.slice(skip, skip + limit);

  // Aggregate children count for each doc
  const docIds = pagedDocs.map((doc) => doc._id);
  const childCounts = await CollectionModel.aggregate([
    { $match: { parentId: { $in: docIds } } },
    { $group: { _id: "$parentId", count: { $sum: 1 } } },
  ]);
  const childCountMap = new Map<string, number>();
  for (const item of childCounts) {
    childCountMap.set(String(item._id), item.count);
  }

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
      parentId: doc.parentId ? String(doc.parentId) : null,
      description: doc.description,
      bannerUrl: doc.bannerUrl,
      orderIndex: doc.orderIndex,
      childCount: childCountMap.get(String(doc._id)) || 0,
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
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getCollectionTree(): Promise<CollectionTreeNode[]> {
  const allCollections = await CollectionModel.find({}).lean().exec();
  const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

  // Natural sort
  allCollections.sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
    return collator.compare(a.name, b.name);
  });

  // Collect exam statistics
  const examStats = await ExamModel.aggregate([
    {
      $match: {
        "curriculum.collectionName": { $exists: true, $ne: null },
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

  const roots: CollectionTreeNode[] = [];
  const childrenByParent = new Map<string, typeof allCollections>();

  for (const col of allCollections) {
    if (col.parentId) {
      const pId = String(col.parentId);
      if (!childrenByParent.has(pId)) childrenByParent.set(pId, []);
      childrenByParent.get(pId)!.push(col);
    }
  }

  for (const root of allCollections) {
    if (!root.parentId) {
      const rootId = String(root._id);
      const rootStats = statsMap.get(root.name.toLowerCase()) || {
        totalExams: 0,
        readingCount: 0,
        listeningCount: 0,
        writingCount: 0,
      };

      const childDocs = childrenByParent.get(rootId) || [];
      const formattedChildren = childDocs.map((c) => {
        const cStats = statsMap.get(c.name.toLowerCase()) || {
          totalExams: 0,
          readingCount: 0,
          listeningCount: 0,
          writingCount: 0,
        };
        return {
          _id: String(c._id),
          name: c.name,
          parentId: rootId,
          description: c.description,
          bannerUrl: c.bannerUrl,
          orderIndex: c.orderIndex,
          examCount: cStats.totalExams,
          readingCount: cStats.readingCount,
          listeningCount: cStats.listeningCount,
          writingCount: cStats.writingCount,
        };
      });

      // Sum stats for root = direct + children
      const totalExamCount = rootStats.totalExams + formattedChildren.reduce((acc, c) => acc + c.examCount, 0);
      const totalReadingCount = rootStats.readingCount + formattedChildren.reduce((acc, c) => acc + c.readingCount, 0);
      const totalListeningCount = rootStats.listeningCount + formattedChildren.reduce((acc, c) => acc + c.listeningCount, 0);
      const totalWritingCount = rootStats.writingCount + formattedChildren.reduce((acc, c) => acc + c.writingCount, 0);

      roots.push({
        _id: rootId,
        name: root.name,
        description: root.description,
        bannerUrl: root.bannerUrl,
        orderIndex: root.orderIndex,
        examCount: totalExamCount,
        directExamCount: rootStats.totalExams,
        readingCount: totalReadingCount,
        listeningCount: totalListeningCount,
        writingCount: totalWritingCount,
        children: formattedChildren,
      });
    }
  }

  return roots;
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

  const collator = new Intl.Collator("vi", { numeric: true, sensitivity: "base" });

  // Unified sorting: Test -> orderIndex -> Part -> title
  exams.sort((a, b) => {
    const testA = a.curriculum?.testNumber ?? 9999;
    const testB = b.curriculum?.testNumber ?? 9999;
    if (testA !== testB) return testA - testB;

    const orderA = a.curriculum?.orderIndex ?? 0;
    const orderB = b.curriculum?.orderIndex ?? 0;
    if (orderA !== orderB) return orderA - orderB;

    const partA = a.curriculum?.part ?? 9999;
    const partB = b.curriculum?.part ?? 9999;
    if (partA !== partB) return partA - partB;

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
    name: { $regex: new RegExp(`^${escapeRegex(data.name.trim())}$`, "i") },
  }).exec();

  if (existing) {
    throw new ConflictError("COLLECTION_EXISTS", "Tên nhóm bộ đề đã tồn tại.");
  }

  let parentObjectId: Types.ObjectId | null = null;
  if (data.parentId) {
    const parent = await CollectionModel.findById(data.parentId).exec();
    if (!parent) {
      throw new NotFoundError("Không tìm thấy bộ đề cha.");
    }
    // Max 2 levels: parent must be root
    if (parent.parentId) {
      throw new BadRequestError("INVALID_PARENT", "Hệ thống chỉ hỗ trợ tối đa 2 cấp bộ đề (Gốc -> Bộ con).");
    }
    parentObjectId = parent._id;
  }

  // Calculate default orderIndex if not given
  let orderIndex = data.orderIndex ?? 0;
  if (data.orderIndex === undefined || data.orderIndex === 0) {
    const lastSibling = await CollectionModel.findOne({ parentId: parentObjectId })
      .sort({ orderIndex: -1 })
      .exec();
    orderIndex = lastSibling ? lastSibling.orderIndex + 1 : 0;
  }

  const created = await CollectionModel.create({
    name: data.name.trim(),
    parentId: parentObjectId,
    description: data.description,
    bannerUrl: data.bannerUrl,
    orderIndex,
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

  if (data.parentId !== undefined) {
    if (!data.parentId) {
      collection.parentId = null;
    } else {
      if (String(collection._id) === String(data.parentId)) {
        throw new BadRequestError("INVALID_PARENT", "Bộ đề không thể làm cha của chính mình.");
      }

      // Check if collection currently has children
      const hasChildren = await CollectionModel.exists({ parentId: collection._id }).exec();
      if (hasChildren) {
        throw new BadRequestError("COLLECTION_HAS_CHILDREN", "Bộ đề đang có các bộ con, không thể chuyển thành bộ con của bộ khác.");
      }

      const targetParent = await CollectionModel.findById(data.parentId).exec();
      if (!targetParent) {
        throw new NotFoundError("Không tìm thấy bộ đề cha.");
      }
      if (targetParent.parentId) {
        throw new BadRequestError("INVALID_PARENT", "Hệ thống chỉ hỗ trợ tối đa 2 cấp bộ đề (Gốc -> Bộ con).");
      }

      collection.parentId = targetParent._id;
    }
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

  // Rule 6: Promote children to root if this collection has children
  await CollectionModel.updateMany(
    { parentId: collection._id },
    { $set: { parentId: null } }
  ).exec();

  // Unlink associated exams of this collection
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

  // Rule 3: Do not add exams directly to parent if parent already has children
  const hasChildren = await CollectionModel.exists({ parentId: collection._id }).exec();
  if (hasChildren) {
    throw new ConflictError("COLLECTION_HAS_CHILDREN", "Bộ đề này đã có các bộ đề con. Vui lòng thêm đề thi vào từng bộ đề con.");
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

export async function reorderExamsInCollection(
  collectionId: string,
  body: ReorderExamsInCollectionBody,
  _userId: string,
  _role: string
): Promise<{ count: number; message: string }> {
  const collection = await CollectionModel.findById(collectionId).exec();
  if (!collection) {
    throw new NotFoundError("Không tìm thấy nhóm bộ đề.");
  }

  if (body.items.length === 0) {
    return { count: 0, message: "Không có đề thi nào để cập nhật." };
  }

  const bulkOps = body.items.map((item) => ({
    updateOne: {
      filter: {
        _id: item.examId,
        "curriculum.collectionName": collection.name,
      },
      update: {
        $set: {
          "curriculum.testNumber": item.testNumber,
          "curriculum.orderIndex": item.orderIndex,
        },
      },
    },
  }));

  const result = await ExamModel.bulkWrite(bulkOps);

  return {
    count: result.modifiedCount,
    message: `Đã cập nhật thứ tự cho ${result.modifiedCount} đề thi.`,
  };
}
