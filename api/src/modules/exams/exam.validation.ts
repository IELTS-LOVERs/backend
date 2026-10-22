import { z } from "zod";

const SkillEnum = z.enum(["listening", "reading", "writing"]);

const QuestionGroupTypeEnum = z.enum([
  "multiple_choice_single",
  "multiple_choice_multiple",
  "true_false_not_given",
  "yes_no_not_given",
  "matching_headings",
  "matching_information",
  "matching_features",
  "matching_sentence_endings",
  "sentence_completion",
  "note_completion",
  "table_completion",
  "summary_completion",
  "summary_completion_options",
  "form_completion",
  "flow_chart_completion",
  "map_labelling",
  "diagram_labelling",
  "short_answer",
  "writing_task_1",
  "writing_task_2",
]);

export const QuestionGroupConfigSchema = z
  .object({
    options: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    maxSelections: z.number().int().min(1).optional(),
    headingsPool: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    paragraphLabels: z.array(z.string()).optional(),
    featuresPool: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    endingsPool: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    allowReuse: z.boolean().optional(),
    template: z.string().optional(),
    maxWords: z.number().int().min(1).optional(),
    allowNumbers: z.boolean().optional(),
    wordLimitText: z.string().optional(),
    optionsPool: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    imageMediaId: z.string().nullish(),
    labels: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          xPercent: z.number().optional(),
          yPercent: z.number().optional(),
        })
      )
      .optional(),
    minWords: z.number().int().min(1).optional(),
    sampleAnswer: z.string().optional(),
    bandDescriptors: z.string().optional(),
    topics: z
      .array(
        z.object({
          topicName: z.string(),
          questions: z.array(z.string()),
        })
      )
      .optional(),
    cueCard: z.string().optional(),
    bulletPoints: z.array(z.string()).optional(),
    prepTimeSeconds: z.number().int().optional(),
    speakTimeSeconds: z.number().int().optional(),
    questions: z.array(z.string()).optional(),
  })
  .default({});

const QuestionItemInputSchema = z.object({
  _id: z.string().optional().nullable(),
  questionNumber: z.number().int().min(1),
  prompt: z.string().default(""),
  acceptedAnswers: z.array(z.string()).default([]),
  points: z.number().int("Điểm phải là số nguyên").min(1).max(10).default(1),
  explanation: z.string().optional().nullable(),
  mediaIds: z.array(z.string()).optional(),
});

const QuestionGroupInputSchema = z.object({
  _id: z.string().optional().nullable(),
  groupType: QuestionGroupTypeEnum,
  instructions: z.string().default(""),
  config: QuestionGroupConfigSchema,
  questions: z.array(QuestionItemInputSchema).default([]),
});

const ExamSectionInputSchema = z.object({
  _id: z.string().optional().nullable(),
  skill: SkillEnum,
  part: z.number().int().min(1).max(4),
  title: z.string().optional().default(""),
  instructions: z.string().optional().nullable(),
  passageText: z.string().optional().nullable(),
  transcript: z.string().optional().nullable(),
  mediaIds: z.array(z.string()).optional(),
  questionGroups: z.array(QuestionGroupInputSchema).optional().default([]),
});

export const CurriculumSchema = z.object({
  collectionName: z.string().trim().max(120).optional().nullable(),
  testNumber: z.number().int().min(1).optional().nullable(),
  part: z.number().int().min(1).max(4).optional().nullable(),
  orderIndex: z.number().int().min(0).optional().nullable(),
  // Deprecated alias for backwards compatibility
  partOrPassage: z.number().int().min(1).optional().nullable(),
  skill: SkillEnum.optional().nullable(),
});

export const VocabularyItemSchema = z.object({
  _id: z.string().optional(),
  word: z.string().trim().min(1, "Từ vựng không được để trống").max(120),
  phonetic: z.string().trim().max(120).optional().nullable(),
  meaning: z.string().trim().min(1, "Nghĩa không được để trống").max(500),
  contextSentence: z.string().trim().max(1000).optional().nullable(),
});

export const BandThresholdSchema = z.object({
  minRaw: z.number().int().min(0).max(40),
  band: z.number().min(0).max(9),
});

export const BandConversionSchema = z.object({
  mode: z.enum(["auto", "custom"]),
  readingType: z.enum(["academic", "general"]).default("academic"),
  listeningThresholds: z.array(BandThresholdSchema).max(30).optional(),
  readingThresholds: z.array(BandThresholdSchema).max(30).optional(),
});

const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https?:\/\//i, "URL phải bắt đầu bằng http:// hoặc https://");

export const PostSubmissionResourcesSchema = z.object({
  solutionVideoUrl: httpUrlSchema.optional().nullable(),
  solutionDocumentUrl: httpUrlSchema.optional().nullable(),
  solutionNotes: z.string().max(5000).optional().nullable(),
  vocabularyItems: z.array(VocabularyItemSchema).max(100).optional().default([]),
});

export const CreateExamSchema = z.object({
  body: z.object({
    title: z.string().min(3, "Tiêu đề tối thiểu 3 ký tự"),
    description: z.string().optional().nullable(),
    bannerUrl: z.string().optional().nullable(),
    kind: z.enum(["practice", "mock"]).optional(),
    scoringMode: z.enum(["band", "raw"]).optional(),
    bandConversion: BandConversionSchema.optional().nullable(),
    disableTextSelection: z.boolean().optional(),
    type: z.enum(["practice", "mock"]).optional(), // backwards compat alias
    curriculum: CurriculumSchema.optional().nullable(),
    postSubmissionResources: PostSubmissionResourcesSchema.optional().nullable(),
    durationMinutes: z.number().int().min(10).max(180).default(60),
    sections: z.array(ExamSectionInputSchema).default([]),
    openAt: z.iso.datetime().optional().nullable(),
    closeAt: z.iso.datetime().optional().nullable(),
  }),
});

export const UpdateExamSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID đề thi"),
  }),
  body: z.object({
    title: z.string().min(3, "Tiêu đề tối thiểu 3 ký tự").optional(),
    description: z.string().optional().nullable(),
    bannerUrl: z.string().optional().nullable(),
    kind: z.enum(["practice", "mock"]).optional(),
    scoringMode: z.enum(["band", "raw"]).optional(),
    bandConversion: BandConversionSchema.optional().nullable(),
    disableTextSelection: z.boolean().optional(),
    type: z.enum(["practice", "mock"]).optional(),
    curriculum: CurriculumSchema.optional().nullable(),
    postSubmissionResources: PostSubmissionResourcesSchema.optional().nullable(),
    durationMinutes: z.number().int().min(10).max(180).optional(),
    sections: z.array(ExamSectionInputSchema).optional(),
    openAt: z.iso.datetime().optional().nullable(),
    closeAt: z.iso.datetime().optional().nullable(),
  }),
});

export const UpdateExamMetadataSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID đề thi"),
  }),
  body: z.object({
    title: z.string().min(3, "Tiêu đề tối thiểu 3 ký tự").optional(),
    description: z.string().optional().nullable(),
    bannerUrl: z.string().optional().nullable(),
    kind: z.enum(["practice", "mock"]).optional(),
    scoringMode: z.enum(["band", "raw"]).optional(),
    bandConversion: BandConversionSchema.optional().nullable(),
    disableTextSelection: z.boolean().optional(),
    type: z.enum(["practice", "mock"]).optional(),
    curriculum: CurriculumSchema.optional().nullable(),
    postSubmissionResources: PostSubmissionResourcesSchema.optional().nullable(),
    openAt: z.iso.datetime().optional().nullable(),
    closeAt: z.iso.datetime().optional().nullable(),
  }),
});

export const UpdateExamResourcesSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID đề thi"),
  }),
  body: z.object({
    solutionVideoUrl: httpUrlSchema.optional().nullable(),
    solutionDocumentUrl: httpUrlSchema.optional().nullable(),
    solutionNotes: z.string().max(5000).optional().nullable(),
    vocabularyItems: z.array(VocabularyItemSchema).max(100).optional(),
  }),
});

export const UpdateExamCurriculumSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Thiếu ID đề thi"),
  }),
  body: CurriculumSchema,
});

export const ListExamsSchema = z.object({
  query: z.object({
    status: z.enum(["draft", "published", "closed"]).optional(),
    kind: z.enum(["practice", "mock"]).optional(),
    type: z.enum(["practice", "mock"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export type QuestionItemInput = z.infer<typeof QuestionItemInputSchema>;
export type QuestionGroupInput = z.infer<typeof QuestionGroupInputSchema>;
export type ExamSectionInput = z.infer<typeof ExamSectionInputSchema>;
export type CurriculumInput = z.infer<typeof CurriculumSchema>;
export type VocabularyItemInput = z.infer<typeof VocabularyItemSchema>;
export type PostSubmissionResourcesInput = z.infer<typeof PostSubmissionResourcesSchema>;
export type BandConversionInput = z.infer<typeof BandConversionSchema>;
export type CreateExamBody = z.infer<typeof CreateExamSchema>["body"];
export type UpdateExamBody = z.infer<typeof UpdateExamSchema>["body"];
export type UpdateExamMetadataBody = z.infer<typeof UpdateExamMetadataSchema>["body"];
export type UpdateExamResourcesBody = z.infer<typeof UpdateExamResourcesSchema>["body"];
export type UpdateExamCurriculumBody = z.infer<typeof UpdateExamCurriculumSchema>["body"];
export type ListExamsQuery = z.infer<typeof ListExamsSchema>["query"];
