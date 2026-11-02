import type { CollectionConfig, Field, FieldAccess, FieldBase } from 'payload'
import type { Arm, ExperimentKind, ResolvedOptions } from '../../types/contracts.js'
import type { EditableField } from '../../types/admin.js'
import * as paths from '../../admin/paths.js'
import { TAB_DESCRIPTIONS } from '../../admin/copy/tabs.js'
import { managedAccess } from '../access.js'
import { serializeAttributeKeys, serializeFlagPoints } from '../serialize.js'
import { TARGETING_OPS, isOpValid } from '../../targeting/ops.js'
import { createDefaults } from './createDefaults.js'
import { flagControlParams } from './flagControlParams.js'
import { lockHook } from './lockHook.js'
import { deleteGuard, deleteGuardAfter } from './deleteGuard.js'
import { checkArms } from './armInvariants.js'
import { XpNotImplemented } from '../../errors.js'

type FieldAdmin = NonNullable<FieldBase['admin']>
type ValidationContext = { data?: { kind?: unknown; exposurePolicy?: unknown }; siblingData?: { attribute?: string; op?: string } }
const locked = (field: EditableField, admin: FieldAdmin = {}): FieldAdmin => ({
  ...admin, custom: { ...admin.custom, field },
  components: { ...admin.components, Description: paths.XP_LOCKED_NOTICE },
})
const positiveInteger = (value: number | null | undefined) => (value != null && Number.isInteger(value) && value > 0) || 'Enter a positive whole number.'

export function experimentsCollection(options: ResolvedOptions): CollectionConfig {
  const flagPoints = serializeFlagPoints(options)
  const attributeKeys = serializeAttributeKeys(options)
  const adminOnly: FieldAccess = async ({ req }) => (await (options.access.admin ?? options.access.manage)({ req })) === true
  const metric = (name: string, hasMany = false): Field => hasMany
    ? { name, type: 'relationship', relationTo: 'xp-metrics', hasMany: true }
    : { name, type: 'relationship', relationTo: 'xp-metrics', hasMany: false }
  return {
    slug: 'xp-experiments', graphQL: false, disableDuplicate: true, versions: { drafts: false, maxPerDoc: 50 },
    access: {
      ...managedAccess(options),
      delete: async ({ req }) => (await options.access.manage({ req })) === true
        ? { status: { in: ['draft', 'archived'] } } : false,
    },
    admin: {
      // group:false hides navigation while keeping custom view routes reachable (hidden causes 404s).
      group: false, useAsTitle: 'name', defaultColumns: ['name', 'status', 'kind', 'flagPoint'],
      components: { views: { list: { Component: paths.XP_TESTS_LIST_REDIRECT }, edit: {
        default: { Component: paths.XP_TEST_EDIT_REDIRECT },
        results: { Component: paths.XP_TEST_EDIT_REDIRECT, path: '/results', tab: { label: 'Results', href: '/results' } },
      } } },
    },
    hooks: { beforeValidate: [createDefaults], beforeChange: [flagControlParams, lockHook], beforeDelete: [deleteGuard], afterDelete: [deleteGuardAfter] },
    fields: [
      { name: 'actions', type: 'ui', admin: { position: 'sidebar', components: { Field: paths.XP_ACTIONS } } },
      { name: 'status', type: 'select', defaultValue: 'draft', required: true, options: ['draft', 'running', 'stopped', 'decided', 'archived'], admin: { position: 'sidebar', readOnly: true, components: { Cell: paths.XP_STATUS_CELL } } },
      { name: 'phaseHistory', type: 'ui', admin: { position: 'sidebar', components: { Field: paths.XP_PHASE_HISTORY } } },
      { type: 'tabs', tabs: [
        { label: 'What', description: TAB_DESCRIPTIONS.What, fields: [
          { name: 'name', type: 'text', required: true, admin: locked('name') },
          { name: 'slug', type: 'text', required: true, unique: true },
          { name: 'hypothesis', type: 'textarea', admin: locked('hypothesis') },
          { name: 'kind', type: 'select', required: true, options: ['block', 'page', 'flag', 'code'], access: { read: async args => args.doc?.kind !== 'code' || adminOnly(args) } },
          { name: 'flagPoint', type: 'text', admin: locked('flagPoint', { components: { Field: paths.XP_FLAG_POINT_SELECT }, custom: { flagPoints } }),
            validate: (value: unknown, { data }: ValidationContext) => (!value && data?.kind !== 'flag') || flagPoints.some(point => point.id === value) || 'Choose a registered flag point.' },
          { name: 'exposurePolicy', type: 'select', required: true, options: ['render', 'viewport', 'pageview', 'manual'], admin: locked('exposurePolicy'),
            validate: (value: unknown, { data }: ValidationContext) => {
              const allowed = data?.kind === 'block' ? ['render', 'viewport'] : data?.kind === 'page' ? ['pageview'] : ['manual']
              return allowed.includes(value as string) || 'Choose an exposure policy supported by this experiment kind.'
            } },
        ] },
        { label: 'Who', description: TAB_DESCRIPTIONS.Who, fields: [
          { name: 'unitType', type: 'select', required: true, defaultValue: 'visitor', options: ['visitor', 'user'],
            validate: (value: unknown, { data }: ValidationContext) => (value === 'visitor' || value === 'user') && (data?.kind !== 'page' || value === 'visitor') || 'Page experiments require visitors.' },
          { name: 'allocation', type: 'number', required: true, defaultValue: 100, min: 1, max: 100, validate: (value: number | null | undefined) => positiveInteger(value) === true && value! <= 100 || 'Enter a whole percentage from 1 to 100.', admin: locked('allocation', { components: { Field: paths.XP_ALLOCATION_FIELD } }) },
          { name: 'layer', type: 'relationship', relationTo: 'xp-layers' },
          { name: 'targeting', type: 'array', admin: locked('targeting'), fields: [
            { name: 'attribute', type: 'text', required: true, validate: (value: unknown) => (typeof value === 'string' && Object.hasOwn(attributeKeys, value)) || 'Choose a registered attribute.', admin: { components: { Field: paths.XP_TARGETING_ATTRIBUTE }, custom: { attributeKeys } } },
            { name: 'op', type: 'select', required: true, options: [...new Set(Object.values(TARGETING_OPS).flat())],
              validate: (value: unknown, { siblingData }: ValidationContext) => isOpValid(attributeKeys[siblingData?.attribute ?? '']?.type ?? '', value as string) || 'Choose an operator supported by this attribute.', admin: { components: { Field: paths.XP_TARGETING_OP }, custom: { attributeKeys } } },
            { name: 'value', type: 'json', required: true,
              validate: (value: unknown, { siblingData }: ValidationContext) => {
                const type = attributeKeys[siblingData?.attribute ?? '']?.type
                const op = siblingData?.op ?? ''
                if (!type || !isOpValid(type, op)) return 'Choose a registered attribute and supported operator.'
                const valid = type === 'string' && (op === 'in' || op === 'nin')
                  ? Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string')
                  : typeof value === type && (type !== 'number' || Number.isFinite(value))
                if (!valid && type === 'string' && (op === 'in' || op === 'nin') && Array.isArray(value) && value.length === 0) return 'Add at least one value; an empty list matches nobody.'
                return valid || 'Enter a value of the type required by this attribute and operator.'
              },
              admin: { components: { Field: paths.XP_TARGETING_VALUE }, custom: { attributeKeys } } },
          ] },
        ] },
        { label: 'Groups', description: TAB_DESCRIPTIONS.Groups, fields: [
          { name: 'arms', type: 'array', required: true,
            validate: (value: unknown[] | null | undefined, { siblingData, data }: { siblingData: { kind?: ExperimentKind }; data: { kind?: ExperimentKind } }) => {
              try {
                const issues = checkArms(value as Arm[], (siblingData.kind ?? data.kind) as ExperimentKind)
                return issues.length ? issues.map(issue => issue.message).join('; ') : true
              } catch (error) {
                // TODO(CORE-03 merged): remove the temporary stub allowance.
                if (error instanceof XpNotImplemented) return true
                throw error
              }
            },
            admin: locked('arms', { components: { Field: paths.XP_ARMS_FIELD }, custom: { flagPoints } }), fields: [
            { name: 'key', type: 'select', required: true, options: ['control', 'variantA', 'variantB', 'variantC', 'holdout'] },
            { name: 'label', type: 'text', required: true },
            { name: 'weight', type: 'number', required: true, min: 0, max: 100, validate: (value: number | null | undefined) => value != null && Number.isInteger(value) && value >= 0 && value <= 100 || 'Enter a whole percentage from 0 to 100.' },
            { name: 'kind', type: 'select', required: true, options: ['control', 'variant', 'holdout'] },
            { name: 'slot', type: 'select', options: ['control', 'variantA', 'variantB', 'variantC'] },
            { name: 'params', type: 'json' }, { name: 'pageTarget', type: 'text' },
          ] },
        ] },
        { label: 'Metrics', description: TAB_DESCRIPTIONS.Metrics, fields: [
          { name: 'metrics', type: 'group', admin: locked('metrics'), fields: [metric('primary'), metric('secondary', true), metric('guardrails', true)] },
          { name: 'analysis', type: 'group', admin: locked('analysis'), fields: [
            { name: 'method', type: 'select', defaultValue: 'sequential', options: ['sequential', 'bayesian'], access: { read: adminOnly } },
            { name: 'cuped', type: 'select', defaultValue: 'auto', options: ['auto', 'off'] },
            { name: 'minExposuresPerArm', type: 'number', defaultValue: 200, min: 1, validate: positiveInteger },
            { name: 'plannedDurationDays', type: 'number', min: 1, validate: (value: number | null | undefined) => value == null || positiveInteger(value) },
            { name: 'attributionWindowHours', type: 'number', min: 1 },
            { name: 'sequentialTuningParameter', type: 'number', min: 0 },
            { name: 'reachPerDay', type: 'number', min: 1, validate: (value: number | null | undefined) => value == null || positiveInteger(value) },
          ] },
        ] },
        { label: 'Review', description: TAB_DESCRIPTIONS.Review, fields: [{ name: 'review', type: 'ui', admin: { components: { Field: paths.XP_REVIEW_PANEL } } }] },
      ] },
      { name: 'layerSlices', type: 'json', admin: { hidden: true } },
      { name: 'phase', type: 'number', defaultValue: 0, admin: { hidden: true } },
      { name: 'seed', type: 'text', admin: { hidden: true } },
      ...['startedAt', 'stoppedAt', 'decidedAt', 'archivedAt'].map((name): Field => ({ name, type: 'date', admin: { hidden: true } })),
      { name: 'decision', type: 'group', admin: { hidden: true }, fields: [
        { name: 'winnerArm', type: 'text' }, { name: 'verdictCode', type: 'text' }, { name: 'note', type: 'textarea' },
        // The frozen options contract has no auth collection or host config at factory time.
        { name: 'decidedBy', type: 'text' }, { name: 'snapshotId', type: 'text' },
        { name: 'discardedAt', type: 'date' }, { name: 'contentReport', type: 'json' }, { name: 'holdoutReleasedAt', type: 'date' },
      ] },
    ],
  }
}
