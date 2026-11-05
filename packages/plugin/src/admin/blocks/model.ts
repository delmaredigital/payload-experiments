import type { PlacementStatusResult } from '../../types/endpoints.js'
import { hostBlocks } from '../../blocks/model.js'
import { BLOCK_COPY, blockDecidedStatus, blockDraftStatus, blockFinishedStatus, blockPosition } from '../copy/blocks.js'
import type { RowsField } from './formApi.js'
export type BlockStatus = PlacementStatusResult['slugs'][string]
export type LiveBlockStatus = Extract<BlockStatus, { status: string }>
export function liveStatus(status: BlockStatus | null): status is LiveBlockStatus { return !!status && 'status' in status }
export function slotLabel(slot: string, status: BlockStatus | null): string {
  return (liveStatus(status) ? status.arms.find(arm => arm.key !== 'holdout' && (arm.slot ?? arm.key) === slot)?.label : undefined) || BLOCK_COPY.slotLabels[slot] || slot
}
export function statusSentence(status: BlockStatus): string {
  if (!liveStatus(status)) return BLOCK_COPY.deleted
  const winner = status.arms.find(arm => arm.key === status.winnerArm)
  const winnerLabel = winner?.label || BLOCK_COPY.slotLabels[status.winnerArm ?? 'control'] || status.winnerArm || BLOCK_COPY.slotLabels.control!
  switch (status.status) {
    case 'draft': return blockDraftStatus(status.name)
    case 'running': return BLOCK_COPY.running
    case 'stopped': return BLOCK_COPY.stopped
    case 'decided': return blockDecidedStatus(winnerLabel, status.rollout)
    case 'archived': return status.winnerArm ? blockFinishedStatus(winnerLabel) : BLOCK_COPY.discarded
  }
}
export function isOrphan(status: BlockStatus): boolean { return !liveStatus(status) || status.status === 'archived' && !status.winnerArm }
export function labelText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : value && typeof value === 'object' ? Object.values(value).find((item): item is string => typeof item === 'string') : undefined
}
export function blockChoices(value: unknown, field: RowsField, blockSlug: string) {
  return hostBlocks(value).flatMap((block, index) => {
    if (block.blockType === blockSlug) return []
    const label = labelText(field.blocks.find(config => config.slug === block.blockType)?.labels?.singular) || block.blockType
    return [{ block, index, label, option: blockPosition(label, index + 1) }]
  })
}
