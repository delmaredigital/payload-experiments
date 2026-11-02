export const HISTORY_COPY = { layers: 'Tests in this group' }
export const layerSummary = (used: number, free: number) => `${used}% of people in this group are in a test; ${free}% are free.`
export const layerRow = (name: string, status: string, slices: number) => `${name} · ${status} · ${slices}%`
