import { ConfirmAction } from '../../../src/testSurface/surface/readiness/ActionDialogs.js'
import type { ExperimentAction } from '../../../src/testSurface/actions/actions.model.js'
import type { DocId } from '../../../src/types/contracts.js'
import { props } from '../surface/readiness/fixtures.js'
import { reloadPage } from '../../../src/testSurface/reload.js'

export function ConfirmActionHarness({ id, action, winnerLabel, onClose, canManage = false, isDecided = false, apiRoute }: {
  apiRoute: string; canManage?: boolean; isDecided?: boolean; id: DocId; action: ExperimentAction; winnerLabel: string; onClose: () => void
}) {
  const p = props({ id, status: isDecided ? 'decided' : 'stopped' }, { reload: async () => { reloadPage() } })
  return <ConfirmAction test={p.test} surface={{ ...p.surface, canManage, apiRoute }} action={action} winnerLabel={winnerLabel} onClose={onClose} />
}
