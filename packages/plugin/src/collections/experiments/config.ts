import type { CollectionConfig, Field, FieldAccess } from 'payload'
import type { Arm, ExperimentKind, ResolvedOptions } from '../../types/contracts.js'
import * as paths from '../../admin/paths.js'
import { managedAccess } from '../access.js'
import { serializeAttributeKeys, serializeFlagPoints } from '../serialize.js'
import { TARGETING_OPS, isOpValid } from '../../targeting/ops.js'
import { readListValue } from '../../targeting/values.js'
import { createDefaults } from './createDefaults.js'
import { flagControlParams } from './flagControlParams.js'
import { pickExperimentSlug } from './pickSlug.js'
import { lockHook } from './lockHook.js'
import { deleteGuard, deleteGuardAfter } from './deleteGuard.js'
import { checkArms } from './armInvariants.js'
import { XpNotImplemented, XpRefusal } from '../../errors.js'

type TargetingRow = { id?: string | number; attribute?: string; op?: string; value?: unknown }
type ValidationContext = { data?: { kind?: unknown; status?: unknown; exposurePolicy?: unknown }; siblingData?: TargetingRow }
const targetingValue = (rule: TargetingRow) => rule.op === 'in' || rule.op === 'nin' ? readListValue(rule.value) : rule.value
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
    hooks: {
      beforeValidate: [createDefaults], beforeChange: [flagControlParams, lockHook, pickExperimentSlug], beforeDelete: [deleteGuard], afterDelete: [deleteGuardAfter],
      afterError: [({ error }) => {
        // Payload preserves public Error status/message, but omits custom codes.
        if (error instanceof XpRefusal && error.code === 'stale-edit') {
          return { status: error.status, response: { errors: [{ code: error.code, message: error.message }] } }
        }
      }],
    },
    fields: [
      { name: 'status', type: 'select', defaultValue: 'draft', required: true, options: ['draft', 'running', 'stopped', 'decided', 'archived'], admin: { position: 'sidebar', readOnly: true } },
      { type: 'tabs', tabs: [
        { label: 'What', fields: [
          { name: 'name', type: 'text', required: true },
          { name: 'slug', type: 'text', required: true, unique: true },
          { name: 'hypothesis', type: 'textarea' },
          { name: 'kind', type: 'select', required: true, options: ['block', 'page', 'flag', 'code'], access: { read: async args => args.doc?.kind !== 'code' || adminOnly(args) } },
          { name: 'pageCollection', type: 'text', validate: (value: unknown) => value == null || value === '' || options.pages?.collections.some(entry => entry.slug === value) || 'Choose a registered page collection.' },
          { name: 'flagPoint', type: 'text',
            validate: (value: unknown, { data }: ValidationContext) => (!value && data?.kind !== 'flag') || flagPoints.some(point => point.id === value) || 'Choose a registered flag point.' },
          { name: 'exposurePolicy', type: 'select', required: true, options: ['render', 'viewport', 'pageview', 'manual'],
            validate: (value: unknown, { data }: ValidationContext) => {
              const allowed = data?.kind === 'block' ? ['render', 'viewport'] : data?.kind === 'page' ? ['pageview'] : ['manual']
              return allowed.includes(value as string) || 'Choose an exposure policy supported by this experiment kind.'
            } },
        ] },
        { label: 'Who', fields: [
          { name: 'unitType', type: 'select', required: true, defaultValue: 'visitor', options: ['visitor', 'user'],
            validate: (value: unknown, { data }: ValidationContext) => (value === 'visitor' || value === 'user') && (data?.kind !== 'page' || value === 'visitor') || 'Page experiments require visitors.' },
          { name: 'allocation', type: 'number', required: true, defaultValue: 100, min: 1, max: 100, validate: (value: number | null | undefined) => positiveInteger(value) === true && value! <= 100 || 'Enter a whole percentage from 1 to 100.' },
          { name: 'layer', type: 'relationship', relationTo: 'xp-layers' },
          { name: 'targeting', type: 'array', validate: (value: unknown[] | null | undefined, { data, previousValue }: ValidationContext & { previousValue?: unknown[] | null }) => {
            // Payload 3.90.2 beforeChange/promise.js passes merged document data
            // and this document's stored array as previousValue, including in bulk updates.
            const status = data?.status ?? 'draft'
            if (data?.kind === 'block' && (status === 'draft' || status === 'stopped')) {
              for (const rule of (value ?? []) as TargetingRow[]) {
                if (rule.attribute !== 'path') continue
                const previous = rule.id == null ? undefined
                  : (previousValue as TargetingRow[] | null | undefined)?.find(stored => stored.id != null && String(stored.id) === String(rule.id))
                if (!previous || previous.attribute !== rule.attribute || previous.op !== rule.op
                  || JSON.stringify(targetingValue(previous)) !== JSON.stringify(targetingValue(rule))) {
                  return 'Page block tests run on their page; remove the page-path rule.'
                }
              }
            }
            return true
          }, fields: [
            { name: 'attribute', type: 'text', required: true,
              validate: (value: unknown) => (typeof value === 'string' && Object.hasOwn(attributeKeys, value)) || 'Choose a registered attribute.' },
            { name: 'op', type: 'select', required: true, options: [...new Set(Object.values(TARGETING_OPS).flat())],
              validate: (value: unknown, { siblingData }: ValidationContext) => isOpValid(attributeKeys[siblingData?.attribute ?? '']?.type ?? '', value as string) || 'Choose an operator supported by this attribute.' },
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
              } },
          ] },
        ] },
        { label: 'Groups', fields: [
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
            fields: [
            { name: 'key', type: 'select', required: true, options: ['control', 'variantA', 'variantB', 'variantC', 'holdout'] },
            { name: 'label', type: 'text', required: true },
            { name: 'weight', type: 'number', required: true, min: 0, max: 100, validate: (value: number | null | undefined) => value != null && Number.isInteger(value) && value >= 0 && value <= 100 || 'Enter a whole percentage from 0 to 100.' },
            { name: 'kind', type: 'select', required: true, options: ['control', 'variant', 'holdout'] },
            { name: 'slot', type: 'select', options: ['control', 'variantA', 'variantB', 'variantC'] },
            { name: 'params', type: 'json' }, { name: 'pageTarget', type: 'text' },
          ] },
        ] },
        { label: 'Metrics', fields: [
          { name: 'metrics', type: 'group', fields: [metric('primary'), metric('secondary', true), metric('guardrails', true)] },
          { name: 'analysis', type: 'group', fields: [
            { name: 'method', type: 'select', defaultValue: 'sequential', options: ['sequential', 'bayesian'], access: { read: adminOnly } },
            { name: 'cuped', type: 'select', defaultValue: 'auto', options: ['auto', 'off'] },
            { name: 'minExposuresPerArm', type: 'number', defaultValue: 200, min: 1, validate: positiveInteger },
            { name: 'plannedDurationDays', type: 'number', min: 1, validate: (value: number | null | undefined) => value == null || positiveInteger(value) },
            { name: 'attributionWindowHours', type: 'number', min: 1 },
            { name: 'sequentialTuningParameter', type: 'number', min: 0 },
            { name: 'reachPerDay', type: 'number', min: 1, validate: (value: number | null | undefined) => value == null || positiveInteger(value) },
          ] },
        ] },
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
        { name: 'pagesReleasedAt', type: 'date' }, { name: 'pagesReleasedBy', type: 'text' },
      ] },
    ],
  }
}
