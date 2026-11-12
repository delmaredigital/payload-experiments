export const RECOMMENDATION_COPY = {
  unavailable: "Results aren't available right now. Recompute, and ask a developer if it keeps happening.",
  dataProblem: 'Stop: the data looks unbalanced, check the setup.',
  collecting: 'Too early to tell. Keep it running.',
  stoppedCollecting: 'Stopped before enough people took part to tell.',
  originalBetter: 'The Original is best. Keep the Original.',
  noDifference: 'No difference found. Keep the Original, or test a bigger change.',
  keepRunning: 'No difference so far. Keep running.',
  longDuration: 'No clear difference, and a clear answer would take more than 3 months at this traffic. Consider a bigger change.',
  group: 'Variant', guardrail: 'an important outcome', winner: 'the winner',
} as const
export const guardrailRecommendation = (group: string, guardrail: string) => `Stop: ${group} is making ${guardrail} worse.`
export const collectingRecommendation = (people: string) => `Too early to tell. About ${people} more people needed to be sure.`
export const worseRecommendation = (group: string) => `No version beats the Original, and ${group} does worse. Keep the Original.`
export const winnerRecommendation = (group: string) => `${group} is most likely to be best.`
export const mixedRecommendation = (better: string, worse: string) => `Mixed: ${better} does better, ${worse} does worse. Review before deciding.`
export const runningRecommendation = (date: string) => `No difference so far. Keep running until ${date}.`
export const rolloutCollectingRecommendation = (winner: string) => `Since shipping ${winner}: still collecting data.`
export const rolloutReadoutRecommendation = (winner: string, lift: string) => `Since shipping ${winner}: ${lift} compared with the holdout.`

/** Matches the stored server finding; it is not a new statistical decision. */
export const storedGuardrailFinding = (group: string, guardrail: string) => `Stop: ${group} harms ${guardrail}.`
