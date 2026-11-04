'use client'
import { Button, SelectInput, useAuth, useConfig, useDocumentInfo, useForm, useFormFields, useFormModified, useServerFunctions } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { useState } from 'react'
import { hostBlocks } from '../../blocks/model.js'
import { wrapExperimentBlock } from '../../blocks/formState.js'
import { CreateRefused, createTest } from '../../puck/editor/createTest.js'
import { createApi } from '../api.js'
import { BLOCK_COPY, blockSaveNotice, blockTestName } from '../copy/blocks.js'
import { API_MESSAGES } from '../copy/common.js'
import { adaptClientBlocksField, dataAt, experimentBlockSlug, findClientBlocksField, replaceBlockRow, wrapMode } from './formApi.js'
import { blockChoices, labelText } from './model.js'

export function TestBlockField(props: UIFieldClientProps & { blocksField: string; blockSlug?: string }) {
  const { permissions } = useAuth()
  const testPermissions: { update?: boolean } | undefined = permissions?.collections?.['xp-experiments']
  return testPermissions?.update === true ? <ManagedTestBlockField {...props} /> : null
}
function ManagedTestBlockField({ blocksField, blockSlug: suppliedSlug }: UIFieldClientProps & { blocksField: string; blockSlug?: string }) {
  const form = useForm(), modified = useFormModified(), document = useDocumentInfo()
  const { config, getEntityConfig } = useConfig(), { getFormState } = useServerFunctions()
  useFormFields(([fields]) => fields)
  const collection = document.collectionSlug ? getEntityConfig({ collectionSlug: document.collectionSlug }) : undefined
  const clientField = collection ? findClientBlocksField(collection.fields, blocksField) : undefined
  const field = clientField ? adaptClientBlocksField(clientField, config) : undefined
  const [choice, setChoice] = useState<string>(), [busy, setBusy] = useState(false), [error, setError] = useState<string>()
  if (!field || !collection || !document.collectionSlug) return null
  const blockSlug = suppliedSlug ?? experimentBlockSlug(field)
  const rows = hostBlocks(form.getDataByPath(blocksField)), choices = blockChoices(rows, field, blockSlug)
  const wrappers = rows.filter(block => block.blockType === blockSlug && typeof block.experiment === 'string')
  async function wrap() {
    if (!field || busy || !document.collectionSlug || !collection) return
    setError(undefined)
    if (wrapMode === 'fallback' && modified) { setError(BLOCK_COPY.saveFirst); return }
    const selected = blockChoices(form.getDataByPath(blocksField), field, blockSlug).find(item => String(item.index) === choice)
    if (!selected) return
    const title = collection.admin?.useAsTitle ? form.getDataByPath(collection.admin.useAsTitle) : undefined
    const name = blockTestName(typeof title === 'string' && title.trim() ? title : labelText(collection.labels.singular) ?? collection.slug, selected.label)
    const beforeCreate = JSON.stringify(form.getData())
    setBusy(true)
    try {
      const test = await createTest(config.routes.api, { kind: 'block', name, unitType: 'visitor' })
      if (wrapMode === 'fallback') {
        if (JSON.stringify(form.getData()) !== beforeCreate) throw new Error(BLOCK_COPY.saveFirst)
        if (document.id == null || !selected.block.id) throw new Error(BLOCK_COPY.wrapRefusals['wrap-target-missing'])
        const result = await createApi(config.routes.api).wrapBlock({ collection: document.collectionSlug, id: document.id, field: blocksField, blockId: selected.block.id, experiment: test.slug })
        if (!result.ok) throw new Error(result.code && BLOCK_COPY.wrapRefusals[result.code] || result.message)
        window.location.reload()
      } else {
        await replaceBlockRow({ form, getFormState, collectionSlug: document.collectionSlug, id: document.id, field: blocksField, index: selected.index, expectedBlock: selected.block,
          rows: [wrapExperimentBlock(selected.block, test.slug, field, {}, blockSlug)], docPermissions: document.docPermissions, docPreferences: await document.getDocPreferences?.() })
      }
      setChoice(undefined)
    } catch (cause) { setError(cause instanceof CreateRefused || cause instanceof Error ? cause.message : API_MESSAGES.failed) }
    finally { setBusy(false) }
  }
  return <div>
    <h3>{BLOCK_COPY.testBlock}</h3>
    {choices.length ? <><SelectInput name="xpBlockChoice" path="xpBlockChoice" label={BLOCK_COPY.pick} options={choices.map(item => ({ label: item.option, value: String(item.index) }))}
      value={choice} readOnly={busy} onChange={option => { if (!Array.isArray(option)) setChoice(option?.value as string | undefined) }} />
      <Button disabled={busy || choice === undefined} onClick={() => void wrap()}>{BLOCK_COPY.testBlock}</Button></> : <p>{BLOCK_COPY.empty}</p>}
    {error ? <p role="alert">{error}</p> : null}
    {wrappers.map(block => {
      const slug = block.experiment as string
      const saved = !modified && hostBlocks(dataAt(document.data, blocksField)).some(row => row.blockType === blockSlug && row.experiment === slug)
      return <p key={block.id ?? slug}>{!saved ? <>{blockSaveNotice(Boolean(collection.versions?.drafts))}{' '}</> : null}
        <a aria-disabled={!saved} href={saved ? formatAdminURL({ adminRoute: config.routes.admin, path: `/experiments/by-slug/${encodeURIComponent(slug)}` }) : undefined}>{BLOCK_COPY.setup}</a></p>
    })}
  </div>
}
