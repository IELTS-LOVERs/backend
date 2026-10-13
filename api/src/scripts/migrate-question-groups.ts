/**
 * Migration script: Convert legacy questionIds → questionGroups
 *
 * Usage: npx tsx src/scripts/migrate-question-groups.ts [--dry-run]
 *
 * This script converts existing exams from the flat questionIds format
 * to the new embedded questionGroups format. It groups consecutive
 * questions of the same type into QuestionGroups.
 *
 * Safe to run multiple times — skips exams that already have questionGroups.
 */
import mongoose from "mongoose";
import { config } from "dotenv";
import { ExamModel, type IQuestionGroup, type IQuestionItem } from "../modules/exams/exam.model.js";
import { QuestionModel, type IQuestion } from "../modules/questions/question.model.js";
import { mapLegacyTypeToGroupType } from "../config/constants.js";

config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/ieltslovers";
const DRY_RUN = process.argv.includes("--dry-run");

function defaultInstructionForType(type: string): string {
  const MAP: Record<string, string> = {
    multiple_choice_single: "Choose the correct letter, A, B, C or D.",
    multiple_choice_multiple: "Choose the correct letters.",
    true_false_not_given: "Do the following statements agree with the information given in the reading passage?",
    yes_no_not_given: "Do the following statements agree with the views of the writer?",
    matching_headings: "Choose the correct heading for each section from the list of headings below.",
    matching_information: "Which paragraph contains the following information?",
    matching_features: "Look at the following statements and the list of people below.",
    matching_sentence_endings: "Complete each sentence with the correct ending, A-G, below.",
    sentence_completion: "Complete the sentences below.",
    note_completion: "Complete the notes below.",
    table_completion: "Complete the table below.",
    summary_completion: "Complete the summary below.",
    form_completion: "Complete the form below.",
    flow_chart_completion: "Complete the flow-chart below.",
    map_labelling: "Label the map/plan below.",
    diagram_labelling: "Label the diagram below.",
    short_answer: "Answer the questions below.",
  };
  return MAP[type] ?? "";
}

async function migrateExam(exam: mongoose.Document & { _id: mongoose.Types.ObjectId; sections: any[] }) {
  let modified = false;

  for (const section of exam.sections) {
    // Skip sections that already have questionGroups
    if (Array.isArray(section.questionGroups) && section.questionGroups.length > 0) {
      continue;
    }

    const questionIds: mongoose.Types.ObjectId[] = section.questionIds ?? [];
    if (questionIds.length === 0) continue;

    // Load actual questions
    const questions = await QuestionModel.find({
      _id: { $in: questionIds },
    }).sort({ _id: 1 });

    // Build ordered list matching original questionIds order
    const questionMap = new Map<string, IQuestion>();
    for (const q of questions) {
      questionMap.set(q._id.toString(), q);
    }

    const orderedQuestions: IQuestion[] = [];
    for (const id of questionIds) {
      const q = questionMap.get(id.toString());
      if (q) orderedQuestions.push(q);
    }

    // Group consecutive questions of the same type
    const groups: IQuestionGroup[] = [];
    let currentGroup: IQuestionGroup | null = null;
    let qNumber = 1;

    for (const q of orderedQuestions) {
      const groupType = mapLegacyTypeToGroupType(q.type);

      if (!currentGroup || currentGroup.groupType !== groupType) {
        currentGroup = {
          _id: new mongoose.Types.ObjectId(),
          groupType: groupType as any,
          instructions: q.content || defaultInstructionForType(groupType),
          config: q.data ?? {},
          questions: [],
        };
        groups.push(currentGroup);
      }

      const item: IQuestionItem = {
        _id: new mongoose.Types.ObjectId(),
        questionNumber: qNumber++,
        prompt: q.prompt,
        acceptedAnswers: q.acceptedAnswers ?? [],
        points: q.points ?? 1,
        explanation: q.explanation,
        mediaIds: q.mediaIds,
      };

      currentGroup.questions.push(item);
    }

    section.questionGroups = groups;
    modified = true;
  }

  return modified;
}

async function main() {
  console.log(`🔄 Migration: questionIds → questionGroups`);
  console.log(`   Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log(`   Database: ${MONGO_URI.replace(/\/\/.*@/, "//***@")}`);
  console.log();

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB\n");

  const exams = await ExamModel.find({});
  console.log(`📋 Found ${exams.length} exams to check\n`);

  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const exam of exams) {
    const examTitle = exam.title || exam._id.toString();
    try {
      const modified = await migrateExam(exam);
      if (modified) {
        if (!DRY_RUN) {
          await exam.save();
        }
        migratedCount++;
        console.log(`  ✅ ${DRY_RUN ? "[DRY] " : ""}Migrated: ${examTitle}`);
      } else {
        skippedCount++;
        console.log(`  ⏭️  Skipped (already migrated or empty): ${examTitle}`);
      }
    } catch (err) {
      errorCount++;
      console.error(`  ❌ Error migrating ${examTitle}:`, err);
    }
  }

  console.log();
  console.log("═══════════════════════════════════════");
  console.log(`  Migrated: ${migratedCount}`);
  console.log(`  Skipped:  ${skippedCount}`);
  console.log(`  Errors:   ${errorCount}`);
  console.log("═══════════════════════════════════════");

  await mongoose.disconnect();
  console.log("\n✅ Done");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
