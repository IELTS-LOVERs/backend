import { type Types } from "mongoose";
import { ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { matchAnswer } from "../../common/utils/string-normalizer.js";
import { AttemptModel, type IAttemptScores } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel } from "../exams/exam.model.js";
import { assertOwnership } from "../exams/exam.service.js";
import type { SkillType } from "../questions/question.model.js";
import { UserModel } from "../users/user.model.js";
import type {
  BandDistributionBucket,
  ClassAnalytics,
  ClassSkillAverages,
  ClassStudentRow,
  ExamAnalytics,
  HardestQuestion,
  SectionAccuracy,
  StudentProgress,
  StudentProgressPoint,
} from "./analytics.model.js";

interface PopulatedAnalyticsQuestion {
  _id: Types.ObjectId;
  skill?: SkillType;
  type?: string;
  part?: number;
  prompt?: string;
  acceptedAnswers?: string[];
}

interface PopulatedAnalyticsSection {
  skill: SkillType;
  part: number;
  title: string;
  questionIds?: unknown[];
  questionGroups?: Array<{
    groupType?: string;
    questions?: Array<{
      _id: Types.ObjectId | string;
      prompt?: string;
      acceptedAnswers?: string[];
    }>;
  }>;
}

interface AnalyticsAttempt {
  _id: Types.ObjectId;
  answers: { questionId: Types.ObjectId; value: string }[];
  scores: IAttemptScores;
}

export interface StudentProgressQuery {
  studentId?: string;
  limit?: number;
}

function isPopulatedQuestion(value: unknown): value is PopulatedAnalyticsQuestion {
  return typeof value === "object" && value !== null && "_id" in value;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function averageBand(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (value): value is number => typeof value === "number" && !Number.isNaN(value)
  );

  if (valid.length === 0) return null;

  return roundToOneDecimal(valid.reduce((acc, value) => acc + value, 0) / valid.length);
}

function emptySkillAverages(): ClassSkillAverages {
  return { listening: null, reading: null, writing: null, overall: null };
}

export async function getExamAnalytics(
  examId: string,
  userId: string,
  role: string
): Promise<ExamAnalytics> {
  const exam = await ExamModel.findById(examId).populate("sections.questionIds");

  if (!exam) {
    throw new NotFoundError("Đề thi không tồn tại.");
  }

  assertOwnership(exam, userId, role);

  const attempts = (await AttemptModel.find({
    examId: exam._id,
    status: { $in: ["submitted", "expired"] },
  }).select("answers scores")) as unknown as AnalyticsAttempt[];

  const sectionStats = new Map<string, SectionAccuracy>();
  const questionStats = new Map<string, HardestQuestion>();

  for (const attempt of attempts) {
    for (const section of exam.sections as unknown as PopulatedAnalyticsSection[]) {
      const key = `${section.skill}-${section.part}-${section.title}`;
      const sectionEntry =
        sectionStats.get(key) ??
        ({
          skill: section.skill,
          part: section.part,
          title: section.title,
          totalQuestions: 0,
          answered: 0,
          correct: 0,
          accuracy: 0,
        } satisfies SectionAccuracy);

      const itemsToProcess: Array<{
        _id: Types.ObjectId | string;
        prompt?: string;
        skill: SkillType;
        part: number;
        acceptedAnswers: string[];
      }> = [];

      if (Array.isArray(section.questionGroups) && section.questionGroups.length > 0) {
        for (const group of section.questionGroups) {
          for (const q of group.questions ?? []) {
            itemsToProcess.push({
              _id: q._id,
              prompt: q.prompt,
              skill: section.skill,
              part: section.part,
              acceptedAnswers: q.acceptedAnswers ?? [],
            });
          }
        }
      } else {
        for (const item of section.questionIds ?? []) {
          if (!isPopulatedQuestion(item)) continue;
          const question = item as PopulatedAnalyticsQuestion;
          itemsToProcess.push({
            _id: question._id,
            prompt: question.prompt,
            skill: question.skill ?? section.skill,
            part: question.part ?? section.part,
            acceptedAnswers: question.acceptedAnswers ?? [],
          });
        }
      }

      for (const question of itemsToProcess) {
        const acceptedAnswers = question.acceptedAnswers ?? [];
        const answer = attempt.answers.find(
          (candidate) => candidate.questionId.toString() === question._id.toString()
        );
        const isCorrect = Boolean(
          answer && matchAnswer(answer.value, acceptedAnswers)
        );

        sectionEntry.totalQuestions += 1;
        if (answer) sectionEntry.answered += 1;
        if (isCorrect) sectionEntry.correct += 1;

        const questionKey = question._id.toString();
        const questionEntry =
          questionStats.get(questionKey) ??
          ({
            questionId: questionKey,
            prompt: question.prompt ?? "",
            skill: question.skill,
            part: question.part,
            answered: 0,
            correct: 0,
            accuracy: 0,
          } satisfies HardestQuestion);

        if (answer) questionEntry.answered += 1;
        if (isCorrect) questionEntry.correct += 1;

        questionStats.set(questionKey, questionEntry);
      }

      sectionStats.set(key, sectionEntry);
    }
  }

  const sections = [...sectionStats.values()].map((section) => ({
    ...section,
    accuracy: section.answered > 0 ? section.correct / section.answered : 0,
  }));

  const hardestQuestions = [...questionStats.values()]
    .filter((question) => question.answered > 0)
    .map((question) => ({
      ...question,
      accuracy: question.correct / question.answered,
    }))
    .sort((a, b) => a.accuracy - b.accuracy || b.answered - a.answered)
    .slice(0, 10);

  const bandCounts = new Map<number, number>();
  for (const attempt of attempts) {
    const overall = attempt.scores?.overallBand;
    if (typeof overall !== "number" || Number.isNaN(overall)) continue;

    const band = Math.round(overall * 2) / 2;
    bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
  }

  const bandDistribution: BandDistributionBucket[] = [...bandCounts.entries()]
    .map(([band, count]) => ({ band, count }))
    .sort((a, b) => a.band - b.band);

  return {
    exam: {
      id: exam._id.toString(),
      title: exam.title,
      status: exam.status,
    },
    totalAttempts: attempts.length,
    averageOverallBand: averageBand(
      attempts.map((attempt) => attempt.scores?.overallBand)
    ),
    sections,
    hardestQuestions,
    bandDistribution,
  };
}

export async function getClassAnalytics(
  classId: string,
  userId: string,
  role: string
): Promise<ClassAnalytics> {
  const cls = await ClassModel.findById(classId);

  if (!cls) {
    throw new NotFoundError("Lớp học không tồn tại.");
  }

  if (role !== "admin" && cls.teacherId.toString() !== userId) {
    throw new ForbiddenError("FORBIDDEN", "Người dùng không đủ quyền thực hiện hành động.");
  }

  const studentIds = (cls.students ?? []).map(
    (student) =>
      (student as Types.ObjectId & { _id?: Types.ObjectId })._id ?? (student as Types.ObjectId)
  );

  const students = await UserModel.find({ _id: { $in: studentIds } }).select(
    "fullName email"
  );

  const attempts = (await AttemptModel.find({
    studentId: { $in: studentIds },
    status: { $in: ["submitted", "expired"] },
  }).select("studentId scores")) as unknown as (AnalyticsAttempt & {
    studentId: Types.ObjectId;
  })[];

  const rows: ClassStudentRow[] = students.map((student) => {
    const studentAttempts = attempts.filter(
      (attempt) => attempt.studentId.toString() === student._id.toString()
    );

    return {
      student: {
        id: student._id.toString(),
        fullName: student.fullName,
        email: student.email,
      },
      attempts: studentAttempts.length,
      listening: averageBand(
        studentAttempts.map((attempt) => attempt.scores?.listeningBand)
      ),
      reading: averageBand(
        studentAttempts.map((attempt) => attempt.scores?.readingBand)
      ),
      writing: averageBand(
        studentAttempts.map((attempt) => attempt.scores?.writingBand)
      ),
      overall: averageBand(
        studentAttempts.map((attempt) => attempt.scores?.overallBand)
      ),
    };
  });

  return {
    class: {
      id: cls._id.toString(),
      name: cls.name,
      code: cls.code,
    },
    totalStudents: students.length,
    classAverages: {
      listening: averageBand(rows.map((row) => row.listening)),
      reading: averageBand(rows.map((row) => row.reading)),
      writing: averageBand(rows.map((row) => row.writing)),
      overall: averageBand(rows.map((row) => row.overall)),
    },
    students: rows,
  };
}

export async function getStudentProgress(
  currentUser: { id: string; role: string },
  query: StudentProgressQuery
): Promise<StudentProgress> {
  const studentId =
    currentUser.role === "student" ? currentUser.id : query.studentId ?? currentUser.id;

  const student = await UserModel.findById(studentId).select("targetBand");

  if (!student) {
    throw new NotFoundError("Người dùng không tồn tại.");
  }

  const attempts = await AttemptModel.find({
    studentId,
    status: { $in: ["submitted", "expired"] },
  })
    .populate("examId", "title")
    .sort({ submittedAt: 1 })
    .limit(query.limit ?? 20);

  const points: StudentProgressPoint[] = attempts.map((attempt) => {
    const exam = attempt.examId as unknown as {
      _id?: Types.ObjectId;
      title?: string;
    } | null;

    return {
      attemptId: attempt._id.toString(),
      examId: exam?._id ? exam._id.toString() : null,
      examTitle: exam?.title ?? "",
      submittedAt: attempt.submittedAt ?? null,
      listening: attempt.scores?.listeningBand ?? null,
      reading: attempt.scores?.readingBand ?? null,
      writing: attempt.scores?.writingBand ?? null,
      overall: attempt.scores?.overallBand ?? null,
    };
  });

  const latest = emptySkillAverages();
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (latest.listening === null && point.listening !== null) latest.listening = point.listening;
    if (latest.reading === null && point.reading !== null) latest.reading = point.reading;
    if (latest.writing === null && point.writing !== null) latest.writing = point.writing;
    if (latest.overall === null && point.overall !== null) latest.overall = point.overall;
  }

  const targetBand = student.targetBand ?? null;
  const deltaFromTarget =
    targetBand !== null && latest.overall !== null
      ? roundToOneDecimal(latest.overall - targetBand)
      : null;

  return {
    studentId,
    targetBand,
    latest,
    deltaFromTarget,
    points,
  };
}
