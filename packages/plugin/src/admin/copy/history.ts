export const HISTORY_COPY = { layers: 'Layer usage', rounds: 'Rounds', now: 'now', decided: 'Decided by an editor' }
export const layerSummary = (used: number, free: number) => `${used} of 100 slices in use; ${free} free.`
export const layerRow = (name: string, status: string, slices: number) => `${name} · ${status} · ${slices} slice${slices === 1 ? '' : 's'}`
export const roundRow = (phase: number, kind: string, from: string, to: string, weights: string) =>
  `Round ${phase} · ${kind} · ${from} – ${to} · ${weights}`
