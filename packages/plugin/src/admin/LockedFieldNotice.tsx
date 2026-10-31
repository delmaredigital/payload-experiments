'use client'

import { useFormFields } from '@payloadcms/ui'
import type { FieldDescriptionClientProps } from 'payload'
import type { Status } from '../types/contracts.js'
import { EDITABLE_BY_STATUS } from '../collections/experiments/editability.js'
import { lockedReason } from './lockedNotice.model.js'

export function LockedFieldNotice(props: FieldDescriptionClientProps) {
  const status = useFormFields(([fields]) => fields.status?.value) as Status | undefined
  if (!status) return null
  const customField = props.field.admin?.custom?.field
  const field = typeof customField === 'string' ? customField : props.path
  const reason = lockedReason(status, field, EDITABLE_BY_STATUS)
  return reason ? <p className="xp-locked-notice">{reason}</p> : null
}
