import { useMemo } from 'react'
import { useAuth, useConfig, useDocumentInfo, useForm, useFormFields, useServerFunctions } from '@payloadcms/ui'
import { adaptClientBlocksField, findClientBlocksField, replaceBlockRow, rowLocation } from './formApi.js'
import type { ExperimentBlock, HostBlock } from '../../blocks/model.js'

export function useBlockForm(path: string) {
  const form = useForm(), document = useDocumentInfo(), { config, getEntityConfig } = useConfig()
  const { getFormState } = useServerFunctions(), { permissions } = useAuth()
  // useForm's getters are stable; subscribe so changed slug/row paths are read again.
  useFormFields(([fields]) => fields)
  const location = rowLocation(path)
  const collection = document.collectionSlug ? getEntityConfig({ collectionSlug: document.collectionSlug }) : undefined
  const clientField = location && collection ? findClientBlocksField(collection.fields, location.field) : undefined
  const field = useMemo(() => clientField ? adaptClientBlocksField(clientField, config) : undefined, [clientField, config])
  const block = location ? form.getDataByPath<ExperimentBlock>(`${location.field}.${location.index}`) : undefined
  const testPermissions: { update?: boolean } | undefined = permissions?.collections?.['xp-experiments']
  const manager = testPermissions?.update === true
  async function replace(rows: HostBlock[]) {
    if (!location || !document.collectionSlug) return
    await replaceBlockRow({ form, getFormState, collectionSlug: document.collectionSlug, id: document.id,
      ...location, rows, expectedBlock: block, docPermissions: document.docPermissions, docPreferences: await document.getDocPreferences?.() })
  }
  return { form, document, config, collection, field, block, manager, replace, location }
}
