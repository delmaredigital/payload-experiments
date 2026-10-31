'use client'

import { FieldDescription, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import type { FieldDescriptionClientProps, StaticDescription } from 'payload'
import type { Status } from '../types/contracts.js'
import { EDITABLE_BY_STATUS } from '../collections/experiments/editability.js'
import { lockedReason } from './lockedNotice.model.js'

export function LockedFieldNotice(props: FieldDescriptionClientProps) {
  const status = useFormFields(([fields]) => fields.status?.value) as Status | undefined
  const { id } = useDocumentInfo()
  const admin = props.field.admin
  const description = admin && 'description' in admin ? admin.description : undefined
  const customField = admin?.custom?.field
  const field = typeof customField === 'string' ? customField : props.path.split('.')[0]!
  const reason = id != null && status ? lockedReason(status, field, EDITABLE_BY_STATUS) : null
  return <>
    <FieldDescription description={description as StaticDescription | undefined} path={props.path} />
    {reason ? <p className="xp-locked-notice">{reason}</p> : null}
  </>
}
