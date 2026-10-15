import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/database.js";
import { AssignmentModel } from "../modules/assignments/assignment.model.js";
import { ClassModel } from "../modules/classes/class.model.js";
import { generateClassCode } from "../modules/classes/class.service.js";
import { ExamModel } from "../modules/exams/exam.model.js";
import {
  QuestionModel,
  type QuestionGroupType,
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

interface SeedQuestionItem {
  prompt: string;
  acceptedAnswers: string[];
  points?: number;
  explanation?: string;
}

/** A reusable Question Group stored in the bank. */
interface SeedBankGroup {
  skill: SkillType;
  part: number;
  groupType: QuestionGroupType;
  instructions: string;
  config?: Record<string, unknown>;
  questions: SeedQuestionItem[];
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

async function upsertBankGroup(
  createdBy: mongoose.Types.ObjectId,
  input: SeedBankGroup
): Promise<mongoose.Types.ObjectId> {
  const group = await QuestionModel.findOneAndUpdate(
    { skill: input.skill, part: input.part, groupType: input.groupType, createdBy },
    {
      $set: {
        skill: input.skill,
        part: input.part,
        groupType: input.groupType,
        instructions: input.instructions,
        config: input.config ?? {},
        questions: input.questions.map((q) => ({
          prompt: q.prompt,
          acceptedAnswers: q.acceptedAnswers,
          points: q.points ?? 1,
          explanation: q.explanation,
        })),
        createdBy,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  if (!group) {
    throw new Error(`Không thể tạo nhóm câu hỏi: ${input.instructions}`);
  }

  return group._id;
}

/** Embed a list of bank groups into an exam section, numbering questions continuously. */
function toExamQuestionGroups(groups: SeedBankGroup[], startNumber: number) {
  let n = startNumber;
  return groups.map((group) => ({
    groupType: group.groupType,
    instructions: group.instructions,
    config: group.config ?? {},
    questions: group.questions.map((q) => ({
      questionNumber: n++,
      prompt: q.prompt,
      acceptedAnswers: q.acceptedAnswers,
      points: q.points ?? 1,
      explanation: q.explanation,
    })),
  }));
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

    // ── Question bank (Question Groups) ────────────────────────────────────
    const listeningFormGroup: SeedBankGroup = {
      skill: "listening",
      part: 1,
      groupType: "form_completion",
      instructions: "Complete the notes below. Write ONE WORD for each answer.",
      config: { maxWords: 1, allowNumbers: true, template: "City: [1]" },
      questions: [
        {
          prompt: "City: [1]",
          acceptedAnswers: ["london"],
          explanation: "The speaker says she lives in London.",
        },
      ],
    };
    const listeningChoiceGroup: SeedBankGroup = {
      skill: "listening",
      part: 1,
      groupType: "multiple_choice_single",
      instructions: "Choose the correct letter, A, B or C.",
      config: {
        options: [
          { id: "A", text: "9:00" },
          { id: "B", text: "10:30" },
          { id: "C", text: "14:00" },
        ],
      },
      questions: [
        {
          prompt: "What time does the museum tour start?",
          acceptedAnswers: ["B"],
          explanation: "The guide says the tour starts at 10:30.",
        },
      ],
    };
    const readingTfngGroup: SeedBankGroup = {
      skill: "reading",
      part: 1,
      groupType: "true_false_not_given",
      instructions:
        "Do the following statements agree with the information given in the passage?",
      config: {
        options: [
          { id: "TRUE", text: "TRUE" },
          { id: "FALSE", text: "FALSE" },
          { id: "NOT GIVEN", text: "NOT GIVEN" },
        ],
      },
      questions: [
        {
          prompt: "The museum is open on Mondays.",
          acceptedAnswers: ["TRUE"],
          explanation: "Paragraph 1 states the museum opens daily including Mondays.",
        },
      ],
    };
    const readingHeadingsGroup: SeedBankGroup = {
      skill: "reading",
      part: 1,
      groupType: "matching_headings",
      instructions: "Choose the correct heading for Paragraph A from the list below.",
      config: {
        headingsPool: [
          { id: "i", text: "A brief history" },
          { id: "ii", text: "Funding challenges" },
          { id: "iii", text: "The early years" },
        ],
        allowReuse: false,
      },
      questions: [
        {
          prompt: "Paragraph A",
          acceptedAnswers: ["iii"],
          explanation: "Paragraph A focuses on the early years of the institution.",
        },
      ],
    };
    const writingTask1Group: SeedBankGroup = {
      skill: "writing",
      part: 1,
      groupType: "writing_task_1",
      instructions:
        "You should spend about 20 minutes on this task. Write at least 150 words.",
      config: { minWords: 150 },
      questions: [
        {
          prompt:
            "The chart below shows the number of international students in three countries between 2000 and 2020. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
          acceptedAnswers: [],
        },
      ],
    };

    for (const group of [
      listeningFormGroup,
      listeningChoiceGroup,
      readingTfngGroup,
      readingHeadingsGroup,
      writingTask1Group,
    ]) {
      await upsertBankGroup(teacher._id, group);
    }

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
              questionGroups: toExamQuestionGroups(
                [listeningFormGroup, listeningChoiceGroup],
                1
              ),
            },
            {
              skill: "reading",
              part: 1,
              title: "Reading Passage 1",
              instructions: "Answer questions 3-4.",
              passageText:
                "The city museum first opened its doors in 1892 and has served the public every day since, including Mondays.",
              questionGroups: toExamQuestionGroups(
                [readingTfngGroup, readingHeadingsGroup],
                3
              ),
            },
            {
              skill: "writing",
              part: 1,
              title: "Writing Task 1",
              instructions: "You should spend about 20 minutes on this task.",
              questionGroups: toExamQuestionGroups([writingTask1Group], 1),
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
