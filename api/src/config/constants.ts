import { env } from "./env.js";

export const LISTENING_BAND_TABLE: Record<number, number> = {
  39: 9.0,
  40: 9.0,
  37: 8.5,
  38: 8.5,
  35: 8.0,
  36: 8.0,
  32: 7.5,
  33: 7.5,
  34: 7.5,
  30: 7.0,
  31: 7.0,
  26: 6.5,
  27: 6.5,
  28: 6.5,
  29: 6.5,
  23: 6.0,
  24: 6.0,
  25: 6.0,
  18: 5.5,
  19: 5.5,
  20: 5.5,
  21: 5.5,
  22: 5.5,
  16: 5.0,
  17: 5.0,
  13: 4.5,
  14: 4.5,
  15: 4.5,
  10: 4.0,
  11: 4.0,
  12: 4.0,
  8: 3.5,
  9: 3.5,
  6: 3.0,
  7: 3.0,
  4: 2.5,
  5: 2.5,
};

export const READING_ACADEMIC_BAND_TABLE: Record<number, number> = {
  39: 9.0,
  40: 9.0,
  37: 8.5,
  38: 8.5,
  35: 8.0,
  36: 8.0,
  33: 7.5,
  34: 7.5,
  30: 7.0,
  31: 7.0,
  32: 7.0,
  27: 6.5,
  28: 6.5,
  29: 6.5,
  23: 6.0,
  24: 6.0,
  25: 6.0,
  26: 6.0,
  19: 5.5,
  20: 5.5,
  21: 5.5,
  22: 5.5,
  15: 5.0,
  16: 5.0,
  17: 5.0,
  18: 5.0,
  13: 4.5,
  14: 4.5,
  10: 4.0,
  11: 4.0,
  12: 4.0,
  8: 3.5,
  9: 3.5,
  6: 3.0,
  7: 3.0,
  4: 2.5,
  5: 2.5,
};

export function calculateBandScore(rawScore: number, skill: "listening" | "reading"): number {
  if (rawScore <= 3) return 2.0;
  if (rawScore > 40) rawScore = 40;

  const table =
    skill === "listening" ? LISTENING_BAND_TABLE : READING_ACADEMIC_BAND_TABLE;

  return table[rawScore] ?? 2.5;
}

export const EXAM_GRACE_PERIOD_SECONDS = env.EXAM_GRACE_PERIOD_SECONDS;

export const ANTI_CHEAT_TAB_SWITCH_THRESHOLD = env.ANTI_CHEAT_TAB_SWITCH_THRESHOLD;
export const ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD = env.ANTI_CHEAT_FULLSCREEN_EXIT_THRESHOLD;
export const ANTI_CHEAT_PASTE_THRESHOLD = env.ANTI_CHEAT_PASTE_THRESHOLD;
