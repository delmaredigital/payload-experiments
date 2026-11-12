import type { Snapshot } from '../../types/snapshot.js'
import type { DecideBody } from '../../types/endpoints.js'
import { decideGuard } from '../../results/decideGuard.js'
import { expectedConfirm, matchesConfirm } from '../../transitions/confirmPhrases.js'
import { ACTIONS_COPY as C } from '../copy/actions.js'
import { actionGroupLabel, type ActionGroup } from './actions.model.js'

export function decideState({ snapshot, arms, chosenArm, note, typed }: {
  snapshot: Snapshot | null; arms: readonly ActionGroup[]; chosenArm: string | null; note: string; typed: string
}) {
  const options = arms.filter(group => group.key !== 'holdout' && group.kind !== 'holdout')
    .map(group => ({ value: group.key, label: actionGroupLabel(group.key, group.label) }))
  const chosen = options.find(option => option.value === chosenArm)
  const guarded = decideGuard(snapshot, chosenArm ?? '')
  const phrase = expectedConfirm('decide', chosen?.label ?? '')
  const reason = !chosen || !guarded ? null
    : snapshot && typeof snapshot.verdict.row === 'number' && [1, 2, 3, 4].includes(snapshot.verdict.row) ? snapshot.verdict.headline
      : !snapshot ? C.noResults
        : snapshot.verdict.recommendedArm === null ? C.noRecommendation
          : chosenArm !== snapshot.verdict.recommendedArm ? C.different : null
  const canSubmit = Boolean(chosen) && (!guarded || (note.trim() !== '' && matchesConfirm(phrase, typed)))
  const body: DecideBody = { winnerArm: chosenArm ?? '', ...(note.trim() ? { note: note.trim() } : {}),
    ...(guarded ? { confirmation: typed.trim() } : {}) }
  return { options, prefill: snapshot?.verdict.recommendedArm ?? null, guarded, reason, phrase, canSubmit, body }
}
