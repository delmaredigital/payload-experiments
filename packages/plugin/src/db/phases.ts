// Keep Local API calls in the allow-listed transition module (§7.8). The two
// atomic JSONB appends live in appends.ts; no phase config uses raw SQL writes.
export { setPhaseEndedAt, writePhaseRecord, type PhaseRecord } from '../transitions/phaseRecord.js'
