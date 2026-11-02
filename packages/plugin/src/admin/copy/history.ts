export const HISTORY_COPY = { layers: 'Tests in this group', rounds: 'Rounds', now: 'now', decided: 'Decided by an editor' }
export const layerSummary = (used: number, free: number) => `${used}% of people in this group are in a test; ${free}% are free.`
export const layerRow = (name: string, status: string, slices: number) => `${name} · ${status} · ${slices}%`
export const roundRow = (phase: number, kind: string, from: string, to: string, weights: string) =>
  `Round ${phase} · ${kind} · ${from} – ${to} · ${weights}`
