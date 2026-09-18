import { randomInt } from "node:crypto";
import mongoose, { type Types } from "mongoose";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../common/errors/AppError.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { UserModel } from "../users/user.model.js";
import { ClassModel, type IClass } from "./class.model.js";
import type { CreateClassBody, UpdateClassBody } from "./class.validation.js";

// Excludes visually confusing characters: 0, O, 1, I, L.
const CLASS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CLASS_CODE_LENGTH = 6;
const CLASS_CODE_MAX_ATTEMPTS = 10;

export interface ClassSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  studentsCount: number;
}

export interface StudentSummary {
  id: string;
  email: string;
  fullName: string;
  targetBand: number | null;
}

export interface ClassDetail extends ClassSummary {
  teacher: { id: string; fullName: string };
  students: StudentSummary[];
}

interface PopulatedStudent {
  _id: Types.ObjectId;
  email: string;
  fullName: string;
  targetBand?: number;
}

interface PopulatedTeacher {
  _id: Types.ObjectId;
  fullName: string;
}

export function createRandomClassCode(): string {
  let code = "";
  for (let i = 0; i < CLASS_CODE_LENGTH; i += 1) {
    code += CLASS_CODE_ALPHABET[randomInt(0, CLASS_CODE_ALPHABET.length)];
  }
  return code;
}

export async function generateClassCode(): Promise<string> {
  for (let attempt = 0; attempt < CLASS_CODE_MAX_ATTEMPTS; attempt += 1) {
    const code = createRandomClassCode();
    const exists = await ClassModel.exists({ code });
    if (!exists) return code;
  }

  throw new ConflictError("CONFLICT", "Không thể tạo mã lớp duy nhất, vui lòng thử lại.");
}

function serializeSummary(cls: IClass): ClassSummary {
  return {
    id: cls._id.toString(),
    name: cls.name,
    code: cls.code,
    description: cls.description ?? null,
    studentsCount: cls.students.length,
  };
}

export function isMember(cls: Pick<IClass, "students">, studentId: string): boolean {
  return cls.students.some((id) => id.toString() === studentId);
}

export function assertOwnership(cls: Pick<IClass, "teacherId">, userId: string, role: string): void {
  if (role === "admin") return;

  if (cls.teacherId.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }
}

export async function createClass(
  teacherId: string,
  data: CreateClassBody
): Promise<ClassSummary & { teacherId: string }> {
  const code = await generateClassCode();

  const cls = await ClassModel.create({
    name: data.name,
    code,
    description: data.description,
    teacherId: new mongoose.Types.ObjectId(teacherId),
    students: [],
  });

  return { ...serializeSummary(cls), teacherId: cls.teacherId.toString() };
}

export async function getClassesByUser(userId: string, role: string): Promise<ClassSummary[]> {
  const filter =
    role === "admin" ? {} : role === "teacher" ? { teacherId: userId } : { students: userId };

  const classes = await ClassModel.find(filter).sort({ createdAt: -1 });
  return classes.map(serializeSummary);
}

export async function getClassDetail(
  classId: string,
  userId: string,
  role: string
): Promise<ClassDetail> {
  const cls = await ClassModel.findById(classId)
    .populate("students", "email fullName targetBand")
    .populate("teacherId", "fullName");

  if (!cls) {
    throw new NotFoundError("Lớp học không tồn tại.");
  }

  if (role !== "admin") {
    const teacher = cls.teacherId as unknown as PopulatedTeacher | null;
    const teacherIdStr =
      teacher && (teacher as unknown as { _id: Types.ObjectId })._id
        ? (teacher as unknown as { _id: Types.ObjectId })._id.toString()
        : cls.teacherId?.toString();

    const isTeacher = teacherIdStr === userId;
    const isEnrolled = (cls.students ?? []).some((s: unknown) => {
      const studentObj = s as { _id?: Types.ObjectId } | Types.ObjectId | null;
      const sId =
        studentObj && typeof (studentObj as { _id?: Types.ObjectId })._id !== "undefined"
          ? (studentObj as { _id: Types.ObjectId })._id.toString()
          : studentObj?.toString();
      return sId === userId;
    });

    if (!isTeacher && !isEnrolled) {
      throw new ForbiddenError("FORBIDDEN", "Bạn không có quyền truy cập thông tin lớp này.");
    }
  }

  const students = ((cls.students ?? []) as unknown as (PopulatedStudent | null)[])
    .filter((student): student is PopulatedStudent => Boolean(student && student._id))
    .map((student) => ({
      id: student._id.toString(),
      email: student.email,
      fullName: student.fullName,
      targetBand: student.targetBand ?? null,
    }));

  const teacher = cls.teacherId as unknown as PopulatedTeacher | null;

  return {
    ...serializeSummary(cls),
    teacher:
      teacher && teacher._id
        ? { id: teacher._id.toString(), fullName: teacher.fullName }
        : { id: "", fullName: "" },
    students,
  };
}

export async function updateClass(
  classId: string,
  userId: string,
  role: string,
  data: UpdateClassBody
): Promise<ClassSummary> {
  const cls = await ClassModel.findById(classId);

  if (!cls) {
    throw new NotFoundError("Lớp học không tồn tại.");
  }

  assertOwnership(cls, userId, role);

  if (data.name !== undefined) {
    cls.name = data.name;
  }

  if (data.description !== undefined) {
    cls.description = data.description;
  }

  await cls.save();

  return serializeSummary(cls);
}

export async function deleteClass(
  classId: string,
  userId: string,
  role: string
): Promise<{ message: string }> {
  const cls = await ClassModel.findById(classId);

  if (!cls) {
    throw new NotFoundError("Lớp học không tồn tại.");
  }

  assertOwnership(cls, userId, role);

  const activeAssignments = await AssignmentModel.countDocuments({
    classId: cls._id,
    status: "active",
  });

  if (activeAssignments > 0) {
    throw new BadRequestError(
      "CLASS_HAS_ACTIVE_ASSIGNMENTS",
      "Không thể xóa lớp đang có bài tập được giao. Hãy hủy hoặc lưu trữ các bài tập trước."
    );
  }

  await ClassModel.deleteOne({ _id: cls._id });

  return { message: "Đã xóa lớp học thành công" };
}

export async function joinClass(
  studentId: string,
  code: string
): Promise<{ classId: string; name: string; message: string }> {
  const cls = await ClassModel.findOne({ code: code.toUpperCase().trim() });

  if (!cls) {
    throw new BadRequestError("CLASS_CODE_INVALID", "Mã lớp không tồn tại hoặc không hợp lệ.");
  }

  if (isMember(cls, studentId)) {
    throw new BadRequestError("STUDENT_ALREADY_IN_CLASS", "Học sinh đã là thành viên của lớp này.");
  }

  cls.students.push(new mongoose.Types.ObjectId(studentId));
  await cls.save();

  return { classId: cls._id.toString(), name: cls.name, message: "Tham gia lớp học thành công" };
}

export async function addStudentByEmail(
  classId: string,
  userId: string,
  role: string,
  email: string
): Promise<{ message: string; student: { id: string; email: string; fullName: string } }> {
  const cls = await ClassModel.findById(classId);

  if (!cls) {
    throw new NotFoundError("Lớp học không tồn tại.");
  }

  assertOwnership(cls, userId, role);

  const student = await UserModel.findOne({ email: email.toLowerCase().trim(), role: "student" });

  if (!student) {
    throw new NotFoundError("Không tìm thấy học sinh với email này.");
  }

  if (isMember(cls, student._id.toString())) {
    throw new BadRequestError("STUDENT_ALREADY_IN_CLASS", "Học sinh đã là thành viên của lớp này.");
  }

  cls.students.push(student._id);
  await cls.save();

  return {
    message: "Đã thêm học sinh vào lớp",
    student: { id: student._id.toString(), email: student.email, fullName: student.fullName },
  };
}

export async function removeStudent(
  classId: string,
  userId: string,
  role: string,
  studentId: string
): Promise<{ message: string }> {
  const cls = await ClassModel.findById(classId);

  if (!cls) {
    throw new NotFoundError("Lớp học không tồn tại.");
  }

  assertOwnership(cls, userId, role);

  if (!isMember(cls, studentId)) {
    throw new BadRequestError("STUDENT_NOT_IN_CLASS", "Học sinh không thuộc lớp học này.");
  }

  cls.students = cls.students.filter((id) => id.toString() !== studentId);
  await cls.save();

  return { message: "Đã xóa học sinh khỏi lớp học" };
}
