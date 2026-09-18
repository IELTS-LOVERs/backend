import { calculateOverallBand, calculateWritingBand } from "../common/utils/ielts-calculator.js";

const BASE_URL = process.env.SMOKE_API_BASE_URL ?? "http://localhost:4000";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  token?: string;
  body?: unknown;
}

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

interface AuthResult {
  user: { id: string; email: string; fullName: string; role: string };
  accessToken: string;
}

interface ClassSummary {
  id: string;
  name: string;
  code: string;
  studentsCount: number;
}

interface QuestionSummary {
  id: string;
}

interface ExamSummary {
  id: string;
  title: string;
  status: string;
}

interface AssignmentSummary {
  id: string;
  examId: string;
  classId: string | null;
}

interface MyAssignment {
  id: string;
  examTitle: string;
  submissionStatus: string;
}

interface StartAttemptResult {
  attemptId: string;
  remainingSeconds: number;
}

interface EventResult {
  recorded: boolean;
  suspiciousFlag: boolean;
}

interface SubmitResult {
  attemptId: string;
  status: string;
  scores: {
    listeningRaw?: number;
    listeningBand?: number;
    writingBand?: number;
    overallBand?: number;
  };
}

interface PendingItem {
  attemptId: string;
  studentName: string;
  hasSuspiciousActivity: boolean;
}

interface GradingTask {
  task: number;
  prompt: string;
  studentContent: string;
  wordCount: number;
}

interface GradingView {
  attemptId: string;
  student: { id: string; fullName: string };
  writingTasks: GradingTask[];
}

interface WritingReviewResult {
  id: string;
  attemptId: string;
  task1Score: number;
  task2Score: number;
  overallWritingScore: number;
  attemptOverallBand: number;
}

interface ResultView {
  attemptId: string;
  status: string;
  scores: {
    listeningRaw?: number;
    writingBand?: number;
    overallBand?: number;
  };
  writingReview: { id: string; overallWritingScore: number } | null;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};

  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const body = (await response.json()) as ApiSuccess<T> | ApiFailure;

  if (!body.success) {
    throw new Error(
      `${options.method ?? "GET"} ${path} -> HTTP ${response.status} ` +
        `${body.error.code}: ${body.error.message}`
    );
  }

  return body.data;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function logStep(step: string): void {
  console.log(`[smoke] OK - ${step}`);
}

async function assertApiIsUp(): Promise<void> {
  try {
    await request<{ status: string }>("/api/health");
  } catch (error) {
    throw new Error(
      `Không kết nối được API tại ${BASE_URL}. ` +
        'Hãy chạy "docker compose up -d" hoặc "npm run dev" trước. ' +
        `Chi tiết: ${String(error)}`,
      { cause: error }
    );
  }
}

async function main(): Promise<void> {
  await assertApiIsUp();
  logStep(`API sẵn sàng tại ${BASE_URL}`);

  const suffix = Date.now().toString(36);
  const studentEmail = `smoke.student.${suffix}@ielts.com`;
  const task1Content =
    "The chart illustrates the number of international students in three countries between 2000 and 2020. Overall, Country A remained the most popular destination throughout the period while Country C grew the fastest.";
  const task2Content =
    "In modern society, education plays a crucial role in shaping individuals and communities. This essay will discuss both views before presenting my own opinion on the matter.";

  const teacherAuth = await request<AuthResult>("/api/auth/login", {
    method: "POST",
    body: { email: "teacher@ielts.com", password: "Teacher@123" },
  });
  logStep("Đăng nhập giáo viên");

  const studentAuth = await request<AuthResult>("/api/auth/register", {
    method: "POST",
    body: {
      email: studentEmail,
      password: "Student@123",
      fullName: "Smoke Test Student",
    },
  });
  logStep("Đăng ký học sinh mới");

  const cls = await request<ClassSummary>("/api/classes", {
    method: "POST",
    token: teacherAuth.accessToken,
    body: { name: `Smoke Class ${suffix}` },
  });
  await request(`/api/classes/${cls.id}/students`, {
    method: "POST",
    token: teacherAuth.accessToken,
    body: { email: studentEmail },
  });
  logStep(`Tạo lớp ${cls.code} và thêm học sinh`);

  const listeningQuestion = await request<QuestionSummary>("/api/questions", {
    method: "POST",
    token: teacherAuth.accessToken,
    body: {
      skill: "listening",
      type: "form_completion",
      part: 1,
      prompt: `Smoke listening question ${suffix}: City: [1]`,
      data: { templateText: "City: [1]" },
      acceptedAnswers: ["london"],
      points: 1,
    },
  });
  const writingTask1 = await request<QuestionSummary>("/api/questions", {
    method: "POST",
    token: teacherAuth.accessToken,
    body: {
      skill: "writing",
      type: "writing_task_1",
      part: 1,
      prompt: `Smoke writing task 1 ${suffix}`,
      acceptedAnswers: [],
      points: 1,
    },
  });
  const writingTask2 = await request<QuestionSummary>("/api/questions", {
    method: "POST",
    token: teacherAuth.accessToken,
    body: {
      skill: "writing",
      type: "writing_task_2",
      part: 2,
      prompt: `Smoke writing task 2 ${suffix}`,
      acceptedAnswers: [],
      points: 1,
    },
  });
  logStep("Tạo 3 câu hỏi (listening + 2 writing)");

  const exam = await request<ExamSummary>("/api/exams", {
    method: "POST",
    token: teacherAuth.accessToken,
    body: {
      title: `Smoke Exam ${suffix}`,
      description: "Đề kiểm tra smoke test",
      durationMinutes: 60,
      sections: [
        {
          skill: "listening",
          part: 1,
          title: "Listening Part 1",
          questionIds: [listeningQuestion.id],
        },
        {
          skill: "writing",
          part: 1,
          title: "Writing Task 1",
          questionIds: [writingTask1.id],
        },
        {
          skill: "writing",
          part: 2,
          title: "Writing Task 2",
          questionIds: [writingTask2.id],
        },
      ],
    },
  });
  await request(`/api/exams/${exam.id}/publish`, {
    method: "PATCH",
    token: teacherAuth.accessToken,
  });
  logStep("Tạo đề thi và publish");

  const assignment = await request<AssignmentSummary>("/api/assignments", {
    method: "POST",
    token: teacherAuth.accessToken,
    body: {
      examId: exam.id,
      classId: cls.id,
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  logStep("Giao bài cho lớp");

  const myAssignments = await request<MyAssignment[]>("/api/assignments/my", {
    token: studentAuth.accessToken,
  });
  const myAssignment = myAssignments.find((item) => item.id === assignment.id);
  assert(myAssignment, "Assignment không xuất hiện trong /api/assignments/my");
  assert(
    myAssignment.submissionStatus === "not_started",
    `submissionStatus phải là not_started, nhận được ${myAssignment.submissionStatus}`
  );
  logStep("Học sinh thấy bài tập với trạng thái not_started");

  const started = await request<StartAttemptResult>("/api/attempts", {
    method: "POST",
    token: studentAuth.accessToken,
    body: { examId: exam.id, assignmentId: assignment.id },
  });
  const attemptId = started.attemptId;
  assert(started.remainingSeconds > 0, "remainingSeconds phải lớn hơn 0");
  logStep(`Bắt đầu làm bài (attempt ${attemptId})`);

  const event = await request<EventResult>("/api/anti-cheat/events", {
    method: "POST",
    token: studentAuth.accessToken,
    body: { attemptId, type: "TAB_SWITCH" },
  });
  assert(event.recorded, "Anti-cheat event phải được ghi nhận");
  assert(event.suspiciousFlag === false, "1 TAB_SWITCH không được bật cờ suspicious");
  logStep("Ghi nhận sự kiện anti-cheat");

  await request(`/api/attempts/${attemptId}/answers`, {
    method: "PATCH",
    token: studentAuth.accessToken,
    body: {
      answers: [
        { questionId: listeningQuestion.id, value: "London" },
        { questionId: writingTask1.id, value: task1Content },
        { questionId: writingTask2.id, value: task2Content },
      ],
    },
  });
  logStep("Autosave đáp án");

  const submitted = await request<SubmitResult>(`/api/attempts/${attemptId}/submit`, {
    method: "POST",
    token: studentAuth.accessToken,
  });
  assert(submitted.status === "submitted", "Attempt phải ở trạng thái submitted");
  assert(submitted.scores.listeningRaw === 1, "Listening phải được 1 câu đúng");
  assert(submitted.scores.listeningBand === 2, "Listening band phải là 2.0");
  logStep("Nộp bài và auto-grade listening");

  const pending = await request<PendingItem[]>("/api/grading/pending", {
    token: teacherAuth.accessToken,
  });
  const pendingItem = pending.find((item) => item.attemptId === attemptId);
  assert(pendingItem, "Bài nộp phải xuất hiện trong danh sách chờ chấm");
  assert(
    pendingItem.hasSuspiciousActivity === false,
    "hasSuspiciousActivity phải là false"
  );
  logStep("Bài nộp xuất hiện trong danh sách chờ chấm");

  const gradingView = await request<GradingView>(`/api/attempts/${attemptId}/grading`, {
    token: teacherAuth.accessToken,
  });
  const gradedTask1 = gradingView.writingTasks.find((task) => task.task === 1);
  const gradedTask2 = gradingView.writingTasks.find((task) => task.task === 2);
  assert(gradedTask1, "Thiếu Writing Task 1 trong giao diện chấm");
  assert(gradedTask2, "Thiếu Writing Task 2 trong giao diện chấm");
  assert(
    gradedTask1.wordCount === countWords(task1Content),
    `wordCount Task 1 phải là ${countWords(task1Content)}, nhận được ${gradedTask1.wordCount}`
  );
  assert(
    gradedTask2.wordCount === countWords(task2Content),
    `wordCount Task 2 phải là ${countWords(task2Content)}, nhận được ${gradedTask2.wordCount}`
  );
  logStep("Giao diện chấm hiển thị đúng nội dung và số từ");

  const review = await request<WritingReviewResult>("/api/writing-reviews", {
    method: "POST",
    token: teacherAuth.accessToken,
    body: {
      attemptId,
      task1: { score: 6.5, comment: "Bố cục tốt, cần thêm số liệu." },
      task2: { score: 7, comment: "Lập luận rõ ràng." },
      generalFeedback: "Cần cải thiện ngữ pháp nâng cao.",
    },
  });
  assert(
    review.overallWritingScore === calculateWritingBand(6.5, 7),
    `overallWritingScore phải là ${calculateWritingBand(6.5, 7)}`
  );
  assert(
    review.attemptOverallBand === calculateOverallBand({ listening: 2, writing: 7 }),
    `attemptOverallBand phải là ${calculateOverallBand({ listening: 2, writing: 7 })}`
  );
  logStep("Giáo viên chấm Writing và cập nhật điểm tổng");

  const result = await request<ResultView>(`/api/attempts/${attemptId}/result`, {
    token: studentAuth.accessToken,
  });
  assert(result.status === "submitted", "Kết quả phải thuộc bài đã nộp");
  assert(result.writingReview, "Kết quả phải chứa writingReview");
  assert(
    result.writingReview.overallWritingScore === review.overallWritingScore,
    "writingReview trong kết quả phải khớp điểm đã chấm"
  );
  assert(
    result.scores.writingBand === review.overallWritingScore,
    "writingBand phải khớp overallWritingScore"
  );
  logStep("Học sinh xem kết quả kèm nhận xét Writing");

  const pendingAfter = await request<PendingItem[]>("/api/grading/pending", {
    token: teacherAuth.accessToken,
  });
  assert(
    !pendingAfter.some((item) => item.attemptId === attemptId),
    "Bài đã chấm không được còn trong danh sách chờ"
  );
  logStep("Bài đã chấm được loại khỏi danh sách chờ");

  console.log("[smoke] Hoàn tất: toàn bộ luồng end-to-end chạy thành công.");
}

main().catch((error) => {
  console.error("[smoke] Thất bại:", error);
  process.exit(1);
});
