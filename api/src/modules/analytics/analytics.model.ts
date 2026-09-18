import type { SkillType } from "../questions/question.model.js";

export interface ExamAnalyticsSummary {
  id: string;
  title: string;
  status: string;
}

export interface SectionAccuracy {
  skill: SkillType;
  part: number;
  title: string;
  totalQuestions: number;
  answered: number;
  correct: number;
  accuracy: number;
}

export interface HardestQuestion {
  questionId: string;
  prompt: string;
  skill: SkillType;
  part: number;
  answered: number;
  correct: number;
  accuracy: number;
}

export interface BandDistributionBucket {
  band: number;
  count: number;
}

export interface ExamAnalytics {
  exam: ExamAnalyticsSummary;
  totalAttempts: number;
  averageOverallBand: number | null;
  sections: SectionAccuracy[];
  hardestQuestions: HardestQuestion[];
  bandDistribution: BandDistributionBucket[];
}

export interface ClassSkillAverages {
  listening: number | null;
  reading: number | null;
  writing: number | null;
  overall: number | null;
}

export interface ClassStudentRow {
  student: {
    id: string;
    fullName: string;
    email: string;
  };
  attempts: number;
  listening: number | null;
  reading: number | null;
  writing: number | null;
  overall: number | null;
}

export interface ClassAnalytics {
  class: {
    id: string;
    name: string;
    code: string;
  };
  totalStudents: number;
  classAverages: ClassSkillAverages;
  students: ClassStudentRow[];
}

export interface StudentProgressPoint {
  attemptId: string;
  examId: string | null;
  examTitle: string;
  submittedAt: Date | null;
  listening: number | null;
  reading: number | null;
  writing: number | null;
  overall: number | null;
}

export interface StudentProgress {
  studentId: string;
  targetBand: number | null;
  latest: ClassSkillAverages;
  deltaFromTarget: number | null;
  points: StudentProgressPoint[];
}
