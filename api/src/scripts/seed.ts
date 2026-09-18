import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/database.js";
import { AssignmentModel } from "../modules/assignments/assignment.model.js";
import { ClassModel } from "../modules/classes/class.model.js";
import { generateClassCode } from "../modules/classes/class.service.js";
import { ExamModel } from "../modules/exams/exam.model.js";
import {
  QuestionModel,
  type QuestionType,
  type SkillType,
} from "../modules/questions/question.model.js";
import { UserModel, type IUser, type UserRole } from "../modules/users/user.model.js";

const SALT_ROUNDS = 12;

interface SeedUserInput {
  email: string;
  password: string;
  fullName: string;
  role: UserRole;
}

interface SeedQuestionInput {
  skill: SkillType;
  type: QuestionType;
  part: number;
  prompt: string;
  data?: Record<string, unknown>;
  acceptedAnswers?: string[];
  points?: number;
  explanation?: string;
}

async function upsertUser(input: SeedUserInput): Promise<IUser> {
  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const user = await UserModel.findOneAndUpdate(
    { email: input.email },
    {
      $set: {
        passwordHash,
        fullName: input.fullName,
        role: input.role,
        status: "active",
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  if (!user) {
    throw new Error(`Không thể tạo user ${input.email}`);
  }

  return user;
}

async function upsertQuestion(
  createdBy: mongoose.Types.ObjectId,
  input: SeedQuestionInput
): Promise<mongoose.Types.ObjectId> {
  const question = await QuestionModel.findOneAndUpdate(
    { prompt: input.prompt, createdBy },
    { $set: { ...input, createdBy } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  if (!question) {
    throw new Error(`Không thể tạo câu hỏi: ${input.prompt}`);
  }

  return question._id;
}

async function main(): Promise<void> {
  await connectDB();
  mongoose.set("debug", false);

  try {
    const admin = await upsertUser({
      email: "admin@ielts.com",
      password: "Admin@123",
      fullName: "System Admin",
      role: "admin",
    });
    const teacher = await upsertUser({
      email: "teacher@ielts.com",
      password: "Teacher@123",
      fullName: "Nguyen Van Teacher",
      role: "teacher",
    });
    const student1 = await upsertUser({
      email: "student1@ielts.com",
      password: "Student@123",
      fullName: "Nguyen Van A",
      role: "student",
    });
    const student2 = await upsertUser({
      email: "student2@ielts.com",
      password: "Student@123",
      fullName: "Tran Thi B",
      role: "student",
    });

    const cls = await ClassModel.findOneAndUpdate(
      { name: "IELTS Intensive K12", teacherId: teacher._id },
      {
        $set: {
          description: "Lớp ôn cấp tốc mục tiêu 7.0",
          students: [student1._id, student2._id],
        },
        $setOnInsert: { code: await generateClassCode() },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    if (!cls) {
      throw new Error("Không thể tạo lớp học");
    }

    const listeningFormQuestionId = await upsertQuestion(teacher._id, {
      skill: "listening",
      type: "form_completion",
      part: 1,
      prompt: "Complete the notes. Write ONE WORD for each answer. City: [1]",
      data: { templateText: "City: [1]" },
      acceptedAnswers: ["london"],
      points: 1,
      explanation: "The speaker says she lives in London.",
    });
    const listeningChoiceQuestionId = await upsertQuestion(teacher._id, {
      skill: "listening",
      type: "multiple_choice",
      part: 1,
      prompt: "What time does the museum tour start?",
      data: {
        options: [
          { id: "A", text: "9:00" },
          { id: "B", text: "10:30" },
          { id: "C", text: "14:00" },
        ],
      },
      acceptedAnswers: ["B"],
      points: 1,
      explanation: "The guide says the tour starts at 10:30.",
    });
    const readingTrueFalseQuestionId = await upsertQuestion(teacher._id, {
      skill: "reading",
      type: "true_false_not_given",
      part: 1,
      prompt: "The museum is open on Mondays. TRUE / FALSE / NOT GIVEN",
      data: {
        options: [
          { id: "TRUE", text: "True" },
          { id: "FALSE", text: "False" },
          { id: "NOT GIVEN", text: "Not Given" },
        ],
      },
      acceptedAnswers: ["TRUE"],
      points: 1,
      explanation: "Paragraph 1 states the museum opens daily including Mondays.",
    });
    const readingMatchingQuestionId = await upsertQuestion(teacher._id, {
      skill: "reading",
      type: "matching_headings",
      part: 1,
      prompt: "Choose the correct heading for Paragraph A.",
      data: {
        headings: [
          { id: "i", text: "A brief history" },
          { id: "ii", text: "Funding challenges" },
          { id: "iii", text: "The early years" },
        ],
      },
      acceptedAnswers: ["iii"],
      points: 1,
      explanation: "Paragraph A focuses on the early years of the institution.",
    });
    const writingTask1QuestionId = await upsertQuestion(teacher._id, {
      skill: "writing",
      type: "writing_task_1",
      part: 1,
      prompt:
        "The chart below shows the number of international students in three countries between 2000 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words.",
      acceptedAnswers: [],
      points: 1,
    });

    const exam = await ExamModel.findOneAndUpdate(
      { title: "IELTS Academic Mock Test 01", createdBy: teacher._id },
      {
        $set: {
          description: "Đề thi mẫu đầy đủ 3 kỹ năng Listening, Reading, Writing.",
          durationMinutes: 60,
          status: "published",
          sections: [
            {
              skill: "listening",
              part: 1,
              title: "Listening Part 1",
              instructions: "Answer questions 1-2.",
              questionIds: [listeningFormQuestionId, listeningChoiceQuestionId],
            },
            {
              skill: "reading",
              part: 1,
              title: "Reading Part 1",
              instructions: "Answer questions 3-4.",
              questionIds: [readingTrueFalseQuestionId, readingMatchingQuestionId],
            },
            {
              skill: "writing",
              part: 1,
              title: "Writing Task 1",
              instructions: "You should spend about 20 minutes on this task.",
              questionIds: [writingTask1QuestionId],
            },
          ],
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    if (!exam) {
      throw new Error("Không thể tạo đề thi");
    }

    const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const assignment = await AssignmentModel.findOneAndUpdate(
      { examId: exam._id, classId: cls._id, teacherId: teacher._id },
      { $set: { deadline, status: "active" } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    console.log("[seed] Hoàn tất tạo dữ liệu mẫu:");
    console.log(`  - Admin:    ${admin.email} / Admin@123`);
    console.log(`  - Teacher:  ${teacher.email} / Teacher@123`);
    console.log(`  - Students: ${student1.email}, ${student2.email} / Student@123`);
    console.log(`  - Class:    ${cls.name} (code: ${cls.code})`);
    console.log("  - Questions: 5 (2 listening, 2 reading, 1 writing_task_1)");
    console.log(`  - Exam:     ${exam.title} (id: ${exam._id.toString()})`);
    console.log(`  - Assignment: ${assignment?._id.toString()} (deadline: ${deadline.toISOString()})`);
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error("[seed] Thất bại:", error);
  process.exit(1);
});
