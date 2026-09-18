export function roundIeltsBand(score: number): number {
  const floor = Math.floor(score);
  const decimal = score - floor;

  if (decimal < 0.25) {
    return floor;
  } else if (decimal < 0.75) {
    return floor + 0.5;
  } else {
    return floor + 1.0;
  }
}

export function calculateWritingBand(task1Score: number, task2Score: number): number {
  return roundIeltsBand((task1Score + task2Score * 2) / 3);
}

export function calculateOverallBand(scores: {
  listening?: number;
  reading?: number;
  writing?: number;
}): number {
  const validScores: number[] = [];

  if (scores.listening !== undefined) validScores.push(scores.listening);
  if (scores.reading !== undefined) validScores.push(scores.reading);
  if (scores.writing !== undefined) validScores.push(scores.writing);

  if (validScores.length === 0) return 0;

  const rawAverage = validScores.reduce((sum, value) => sum + value, 0) / validScores.length;
  return roundIeltsBand(rawAverage);
}
