import mongoose, { type Types } from "mongoose";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../common/errors/AppError.js";
import { csvEscape } from "../../common/utils/csv.js";
import { canStaffViewStudent } from "../../common/utils/student-access.js";
import { AssignmentModel } from "../assignments/assignment.model.js";
import { AttemptModel, type IAttempt } from "../attempts/attempt.model.js";
import { ClassModel } from "../classes/class.model.js";
import { ExamModel } from "../exams/exam.model.js";
import { countExamQuestions, countExamPoints } from "../exams/exam.service.js";
import type { CatalogQuery, HeatmapQuery } from "./practice.validation.js";

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Escape user input before passing it to `new RegExp` (prevents 500/ReDoS). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function toVnDateKey(date: Date): string {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

export function vnDayStartUtc(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00+07:00`);
}

export function vnDayEndUtc(dayKey: string): Date {
  return new Date(`${dayKey}T23:59:59.999+07:00`);
}

/**
 * Returns Monday (YYYY-MM-DD) for any given local date string.
 */
export function getMondayKey(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = date.getUTCDay(); // 0 is Sunday, 1 is Monday...
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

export type DailyPracticeStatus = "both" | "listening_only" | "reading_only" | "none";

export interface CatalogItemProgress {
  status: "not_started" | "in_progress" | "completed";
  attemptId?: string;
  lastSubmittedAt?: Date;
  rawScore?: number;
  totalPoints?: number;
  percentage?: number;
  correctCount?: number;
  wrongCount?: number;
  blankCount?: number;
}

export interface CatalogItem {
  examId: string;
  title: string;
  bannerUrl?: string;
  durationMinutes: number;
  questionCount: number;
  totalPoints: number;
  kind: "practice";
  curriculum?: {
    collectionName?: string;
    testNumber?: number;
    part?: number;
    orderIndex?: number;
  };
  skills: string[];
  parts: number[];
  sections: Array<{
    skill: string;
    part: number;
    title?: string;
  }>;
  questionTypes?: string[];
  progress: CatalogItemProgress;
}

export interface CatalogResponse {
  items: CatalogItem[];
}

export interface HeatmapDay {
  date: string;
  status: DailyPracticeStatus;
  listening: number;
  reading: number;
}

export interface HeatmapResponse {
  range: {
    from: string;
    to: string;
    timezone: string;
  };
  days: HeatmapDay[];
  streak: {
    current: number;
    longest: number;
  };
}

export interface WeeklyReportDayCell {
  date: string;
  status: DailyPracticeStatus;
  listening: number;
  reading: number;
  practiceCount: number;
  mockCount: number;
}

export interface WeeklyReportStudentItem {
  student: {
    id: string;
    fullName: string;
  };
  days: WeeklyReportDayCell[];
  assignmentsDue: number;
  assignmentsCompleted: number;
  completionRate: number | null;
  practiceAttempts: number;
  practiceAccuracy: number | null;
  mockAverageBand: number | null;
}

export interface WeeklyReportResponse {
  class: {
    id: string;
    name: string;
    code: string;
  };
  week: {
    from: string;
    to: string;
    timezone: string;
  };
  students: WeeklyReportStudentItem[];
  totals: {
    students: number;
    assignmentsDue: number;
    assignmentsCompleted: number;
    completionRate: number | null;
  };
}

/**
 * Student Practice Catalog with individual progress
 */
export async function getPracticeCatalog(
  studentId: string,
  query: CatalogQuery
): Promise<CatalogResponse> {
  const filter: Record<string, unknown> = {
    $or: [{ kind: "practice" }, { type: "practice" }],
    status: "published",
  };

  if (query.collectionName) {
    filter["curriculum.collectionName"] = new RegExp(
      escapeRegExp(query.collectionName.trim()),
      "i"
    );
  }

  if (query.skill) {
    filter["sections.skill"] = query.skill;
  }

  if (query.part !== undefined) {
    filter.$and = [
      {
        $or: [
          { "curriculum.part": query.part },
          { "sections.part": query.part },
        ],
      },
    ];
  }

  if (query.search) {
    filter.title = new RegExp(escapeRegExp(query.search.trim()), "i");
  }

  const exams = await ExamModel.find(filter).sort({
    "curriculum.collectionName": 1,
    "curriculum.testNumber": 1,
    "curriculum.orderIndex": 1,
    "curriculum.part": 1,
    title: 1,
  });

  if (exams.length === 0) {
    return { items: [] };
  }

  const examIds = exams.map((e) => e._id);
  const attempts = await AttemptModel.find({
    studentId: new mongoose.Types.ObjectId(studentId),
    examId: { $in: examIds },
  }).select("examId status scores submittedAt questionCount startedAt updatedAt");

  const attemptsByExam = new Map<string, IAttempt[]>();
  for (const attempt of attempts) {
    const k = attempt.examId.toString();
    const list = attemptsByExam.get(k) ?? [];
    list.push(attempt);
    attemptsByExam.set(k, list);
  }

  const items: CatalogItem[] = exams.map((exam) => {
    const totalQCount = countExamQuestions(exam);
    const totalPoints = countExamPoints(exam);
    const examAttempts = attemptsByExam.get(exam._id.toString()) ?? [];

    const inProgress = examAttempts.find((a) => a.status === "in_progress");
    let progress: CatalogItemProgress;

    if (inProgress) {
      progress = {
        status: "in_progress",
        attemptId: inProgress._id.toString(),
      };
    } else {
      const submittedAttempts = examAttempts.filter((a) => a.status === "submitted");
      if (submittedAttempts.length > 0) {
        submittedAttempts.sort((a, b) => {
          const tA = (a.submittedAt ?? a.updatedAt ?? a.startedAt).getTime();
          const tB = (b.submittedAt ?? b.updatedAt ?? b.startedAt).getTime();
          return tB - tA;
        });

        const latest = submittedAttempts[0];
        const rawScore = (latest.scores?.listeningRaw ?? 0) + (latest.scores?.readingRaw ?? 0);
        const attemptPoints = latest.totalPoints || totalPoints;
        const percentage = attemptPoints > 0 ? Math.round((rawScore / attemptPoints) * 100) : 0;

        progress = {
          status: "completed",
          attemptId: latest._id.toString(),
          lastSubmittedAt: latest.submittedAt,
          rawScore,
          totalPoints: attemptPoints,
          percentage,
          correctCount: latest.correctCount,
          wrongCount: latest.wrongCount,
          blankCount: latest.blankCount,
        };
      } else {
        progress = {
          status: "not_started",
        };
      }
    }

    const skills = Array.from(new Set(exam.sections.map((s) => s.skill)));
    const parts = Array.from(new Set(exam.sections.map((s) => s.part))).sort((a, b) => a - b);
    const sections = exam.sections.map((s) => ({
      skill: s.skill,
      part: s.part,
      title: s.title,
    }));

    const questionTypes: string[] = [];
    for (const section of exam.sections) {
      for (const group of section.questionGroups || []) {
        if (group.groupType && !questionTypes.includes(group.groupType)) {
          questionTypes.push(group.groupType);
        }
      }
    }

    return {
      examId: exam._id.toString(),
      title: exam.title,
      bannerUrl: exam.bannerUrl,
      durationMinutes: exam.durationMinutes,
      questionCount: totalQCount,
      totalPoints,
      kind: "practice",
      curriculum: exam.curriculum
        ? {
            collectionName: exam.curriculum.collectionName,
            testNumber: exam.curriculum.testNumber,
            part: exam.curriculum.part,
            orderIndex: exam.curriculum.orderIndex,
          }
        : undefined,
      skills,
      parts,
      sections,
      questionTypes,
      progress,
    };
  });

  return { items };
}

/**
 * Practice heatmap for student (Asia/Ho_Chi_Minh UTC+7)
 */
export async function getPracticeHeatmap(
  currentUser: { id: string; role: string },
  query: HeatmapQuery
): Promise<HeatmapResponse> {
  let targetStudentId = currentUser.id;

  if (currentUser.role === "student") {
    if (query.studentId && query.studentId !== currentUser.id) {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Học sinh chỉ có quyền xem biểu đồ luyện tập của chính mình."
      );
    }
  } else if (currentUser.role === "teacher") {
    if (!query.studentId) {
      throw new BadRequestError(
        "STUDENT_ID_REQUIRED",
        "Giáo viên cần truyền studentId để xem biểu đồ luyện tập."
      );
    }
    if (!(await canStaffViewStudent(currentUser, query.studentId))) {
      throw new ForbiddenError(
        "FORBIDDEN",
        "Giáo viên chỉ có quyền xem học sinh thuộc lớp/bài tập do mình phụ trách."
      );
    }
    targetStudentId = query.studentId;
  } else if (currentUser.role === "admin" && query.studentId) {
    if (!mongoose.isValidObjectId(query.studentId)) {
      throw new BadRequestError(
        "INVALID_STUDENT_ID",
        "Mã học sinh không hợp lệ."
      );
    }
    targetStudentId = query.studentId;
  }

  const todayKey = toVnDateKey(new Date());
  let to = query.to ?? query.endDate ?? todayKey;
  let from = query.from ?? query.startDate ?? addDays(to, -180);

  if (from > to) {
    const temp = from;
    from = to;
    to = temp;
  }

  // Cap at 366 days
  const startDt = new Date(from);
  const endDt = new Date(to);
  const diffDays = Math.round((endDt.getTime() - startDt.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays > 366) {
    from = addDays(to, -365);
  }

  const startUtc = vnDayStartUtc(from);
  const endUtc = vnDayEndUtc(to);

  const attempts = await AttemptModel.find({
    studentId: new mongoose.Types.ObjectId(targetStudentId),
    status: "submitted",
    suspicious: { $ne: true },
    submittedAt: { $gte: startUtc, $lte: endUtc },
  }).populate<{ examId: { kind?: string; type?: string; sections?: Array<{ skill: string }> } }>(
    "examId",
    "kind type sections.skill"
  );

  // Group practice attempts by VN date
  const dayStatsMap = new Map<string, { listening: number; reading: number }>();

  for (const attempt of attempts) {
    const exam = attempt.examId;
    const kind = attempt.examKind ?? exam?.kind ?? exam?.type ?? "mock";
    if (kind !== "practice") continue; // Exclude mocks!

    const ts = attempt.submittedAt;
    if (!ts) continue;

    const dateKey = toVnDateKey(ts);

    let stats = dayStatsMap.get(dateKey);
    if (!stats) {
      stats = { listening: 0, reading: 0 };
      dayStatsMap.set(dateKey, stats);
    }

    const skills = attempt.skills && attempt.skills.length > 0
      ? attempt.skills
      : (exam?.sections ?? []).map((s) => s.skill);

    if (skills.includes("listening")) stats.listening += 1;
    if (skills.includes("reading")) stats.reading += 1;
  }

  // Build full days list
  const days: HeatmapDay[] = [];
  let cursor = from;

  while (cursor <= to) {
    const stats = dayStatsMap.get(cursor) ?? { listening: 0, reading: 0 };
    let status: DailyPracticeStatus = "none";
    if (stats.listening > 0 && stats.reading > 0) {
      status = "both";
    } else if (stats.listening > 0) {
      status = "listening_only";
    } else if (stats.reading > 0) {
      status = "reading_only";
    }

    days.push({
      date: cursor,
      status,
      listening: stats.listening,
      reading: stats.reading,
    });

    cursor = addDays(cursor, 1);
  }

  // Calculate streaks
  const dayMap = new Map<string, HeatmapDay>(days.map((d) => [d.date, d]));
  const yesterdayKey = addDays(todayKey, -1);

  let currentStreak = 0;
  let streakCursor: string | null = null;

  if (dayMap.get(todayKey)?.status !== "none") {
    streakCursor = todayKey;
  } else if (dayMap.get(yesterdayKey)?.status !== "none") {
    streakCursor = yesterdayKey;
  }

  if (streakCursor) {
    while (streakCursor) {
      const d = dayMap.get(streakCursor);
      if (d && d.status !== "none") {
        currentStreak += 1;
        streakCursor = addDays(streakCursor, -1);
      } else {
        break;
      }
    }
  }

  // Longest streak in range
  let longestStreak = 0;
  let tempStreak = 0;
  for (const day of days) {
    if (day.status !== "none") {
      tempStreak += 1;
      if (tempStreak > longestStreak) longestStreak = tempStreak;
    } else {
      tempStreak = 0;
    }
  }

  return {
    range: {
      from,
      to,
      timezone: "Asia/Ho_Chi_Minh",
    },
    days,
    streak: {
      current: currentStreak,
      longest: longestStreak,
    },
  };
}

/**
 * Class weekly report with CSV export
 */
export async function getClassWeeklyReport(
  currentUser: { id: string; role: string },
  classId: string,
  weekStartQuery?: string,
  studentIdFilter?: string
): Promise<WeeklyReportResponse> {
  const cls = await ClassModel.findById(classId).populate<{
    students: Array<{ _id: Types.ObjectId; fullName: string; email: string }>;
  }>("students", "fullName email");

  if (!cls) {
    throw new NotFoundError("Lớp học không tồn tại.");
  }

  if (currentUser.role !== "admin" && cls.teacherId.toString() !== currentUser.id) {
    throw new ForbiddenError("FORBIDDEN", "Không có quyền xem báo cáo của lớp học này.");
  }

  const todayKey = toVnDateKey(new Date());
  const mondayKey = getMondayKey(weekStartQuery ?? todayKey);
  const sundayKey = addDays(mondayKey, 6);

  const startUtc = vnDayStartUtc(mondayKey);
  const endUtc = vnDayEndUtc(sundayKey);

  const studentList = studentIdFilter
    ? (cls.students ?? []).filter((s) => s._id.toString() === studentIdFilter)
    : (cls.students ?? []);
  const studentIds = studentList.map((s) => s._id);

  // 1. Get assignments due in this week (class-wide + individual).
  const dueDateConditions = [
    { deadline: { $gte: startUtc, $lte: endUtc } },
    { deadline: { $exists: false }, assignedAt: { $gte: startUtc, $lte: endUtc } },
    { deadline: null, assignedAt: { $gte: startUtc, $lte: endUtc } },
  ];
  const assignments = await AssignmentModel.find({
    status: { $ne: "archived" },
    $or: [
      { classId: cls._id, $or: dueDateConditions },
      { studentId: { $in: studentIds }, $or: dueDateConditions },
    ],
  }).select("_id examId deadline assignedAt classId studentId");

  const assignmentIds = assignments.map((a) => a._id);

  // 2. Fetch attempts in week or for due assignments
  const attempts = studentIds.length > 0
    ? await AttemptModel.find({
        studentId: { $in: studentIds },
        status: "submitted",
        $or: [
          { submittedAt: { $gte: startUtc, $lte: endUtc } },
          { assignmentId: { $in: assignmentIds } },
        ],
      }).populate<{ examId: { kind?: string; type?: string; sections?: Array<{ skill: string }> } }>(
        "examId",
        "kind type sections.skill"
      )
    : [];

  const weekDayKeys: string[] = [];
  for (let i = 0; i < 7; i++) {
    weekDayKeys.push(addDays(mondayKey, i));
  }

  let totalDueAll = 0;
  let totalCompletedAll = 0;

  const studentsReport: WeeklyReportStudentItem[] = studentList.map((st) => {
    const sId = st._id.toString();
    const studentAttempts = attempts.filter((a) => a.studentId.toString() === sId);

    // Assignments due & completed for this student
    const studentAssignments = assignments.filter((assign) => {
      const classMatches =
        !assign.classId || assign.classId.toString() === cls._id.toString();
      const studentMatches =
        !assign.studentId || assign.studentId.toString() === sId;
      return classMatches && studentMatches;
    });
    const assignmentsDueCount = studentAssignments.length;
    let assignmentsCompletedCount = 0;

    for (const assign of studentAssignments) {
      const hasSubmitted = studentAttempts.some(
        (a) => a.assignmentId?.toString() === assign._id.toString() && a.status === "submitted"
      );
      if (hasSubmitted) assignmentsCompletedCount += 1;
    }

    totalDueAll += assignmentsDueCount;
    totalCompletedAll += assignmentsCompletedCount;

    const completionRate = assignmentsDueCount > 0
      ? Math.round((assignmentsCompletedCount / assignmentsDueCount) * 100) / 100
      : null;

    // Practice attempts submitted in week
    const weekPracticeAttempts = studentAttempts.filter((a) => {
      const ts = a.submittedAt;
      if (!ts || ts < startUtc || ts > endUtc) return false;
      const kind = a.examKind ?? a.examId?.kind ?? a.examId?.type ?? "mock";
      return kind === "practice";
    });

    // Mock attempts submitted in week
    const weekMockAttempts = studentAttempts.filter((a) => {
      const ts = a.submittedAt;
      if (!ts || ts < startUtc || ts > endUtc) return false;
      const kind = a.examKind ?? a.examId?.kind ?? a.examId?.type ?? "mock";
      return kind === "mock";
    });

    let practiceAccuracy: number | null = null;
    if (weekPracticeAttempts.length > 0) {
      let totalRaw = 0;
      let totalMax = 0;
      for (const p of weekPracticeAttempts) {
        totalRaw += (p.scores?.listeningRaw ?? 0) + (p.scores?.readingRaw ?? 0);
        totalMax += p.totalPoints || p.questionCount || 1;
      }
      practiceAccuracy = totalMax > 0 ? Math.round((totalRaw / totalMax) * 100) : 0;
    }

    let mockAverageBand: number | null = null;
    const mockBands = weekMockAttempts
      .map((m) => m.scores?.overallBand)
      .filter((b): b is number => typeof b === "number");
    if (mockBands.length > 0) {
      mockAverageBand = Math.round((mockBands.reduce((a, b) => a + b, 0) / mockBands.length) * 10) / 10;
    }

    // Daily cells
    const days: WeeklyReportDayCell[] = weekDayKeys.map((dayKey) => {
      const dayPractice = weekPracticeAttempts.filter((a) => a.submittedAt && toVnDateKey(a.submittedAt) === dayKey);
      const dayMock = weekMockAttempts.filter((a) => a.submittedAt && toVnDateKey(a.submittedAt) === dayKey);

      let listening = 0;
      let reading = 0;

      for (const p of dayPractice) {
        const skills = p.skills && p.skills.length > 0
          ? p.skills
          : (p.examId?.sections ?? []).map((s) => s.skill);
        if (skills.includes("listening")) listening += 1;
        if (skills.includes("reading")) reading += 1;
      }

      let status: DailyPracticeStatus = "none";
      if (listening > 0 && reading > 0) status = "both";
      else if (listening > 0) status = "listening_only";
      else if (reading > 0) status = "reading_only";

      return {
        date: dayKey,
        status,
        listening,
        reading,
        practiceCount: dayPractice.length,
        mockCount: dayMock.length,
      };
    });

    return {
      student: {
        id: sId,
        fullName: st.fullName,
      },
      days,
      assignmentsDue: assignmentsDueCount,
      assignmentsCompleted: assignmentsCompletedCount,
      completionRate,
      practiceAttempts: weekPracticeAttempts.length,
      practiceAccuracy,
      mockAverageBand,
    };
  });

  const totalsCompletionRate = totalDueAll > 0
    ? Math.round((totalCompletedAll / totalDueAll) * 100) / 100
    : null;

  return {
    class: {
      id: cls._id.toString(),
      name: cls.name,
      code: cls.code ?? "",
    },
    week: {
      from: mondayKey,
      to: sundayKey,
      timezone: "Asia/Ho_Chi_Minh",
    },
    students: studentsReport,
    totals: {
      students: studentList.length,
      assignmentsDue: totalDueAll,
      assignmentsCompleted: totalCompletedAll,
      completionRate: totalsCompletionRate,
    },
  };
}

export function exportWeeklyReportCsv(report: WeeklyReportResponse): string {
  const header = [
    "Học sinh",
    "Thứ 2",
    "Thứ 3",
    "Thứ 4",
    "Thứ 5",
    "Thứ 6",
    "Thứ 7",
    "Chủ nhật",
    "Bài tập đến hạn",
    "Bài tập đã nộp",
    "Tỷ lệ hoàn thành",
    "Bài luyện tập",
    "Độ chính xác luyện tập",
    "Điểm TB đề thi",
  ];

  const lines = [header.map(csvEscape).join(",")];

  for (const s of report.students) {
    const dayCells = s.days.map((d) => {
      if (d.listening > 0 && d.reading > 0) return `L${d.listening}/R${d.reading}`;
      if (d.listening > 0) return `L${d.listening}`;
      if (d.reading > 0) return `R${d.reading}`;
      return "";
    });

    const completionRateText = s.completionRate !== null
      ? `${Math.round(s.completionRate * 100)}%`
      : "—";

    const accuracyText = s.practiceAccuracy !== null
      ? `${s.practiceAccuracy}%`
      : "—";

    const bandText = s.mockAverageBand !== null
      ? String(s.mockAverageBand)
      : "—";

    lines.push(
      [
        csvEscape(s.student.fullName),
        ...dayCells.map(csvEscape),
        csvEscape(s.assignmentsDue),
        csvEscape(s.assignmentsCompleted),
        csvEscape(completionRateText),
        csvEscape(s.practiceAttempts),
        csvEscape(accuracyText),
        csvEscape(bandText),
      ].join(",")
    );
  }

  return lines.join("\n");
}
