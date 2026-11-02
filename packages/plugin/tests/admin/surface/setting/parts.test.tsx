// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { SectionProps, SurfaceProps, TestDocApi } from '../../../../src/admin/surface/contracts.js'
import type { TestDocument } from '../../../../src/admin/surface/testDocument.model.js'
import type { SerializedFlagPoint } from '../../../../src/types/admin.js'
import type { Status } from '../../../../src/types/contracts.js'
import { payloadUiMock } from '../../_helpers/payloadUiMock.js'
import { settingParts } from '../../../../src/admin/surface/setting/parts.js'
import { lockedReason } from '../../../../src/admin/lockedNotice.model.js'
import { EDITABLE_BY_STATUS } from '../../../../src/collections/experiments/editability.js'

vi.mock('@payloadcms/ui', () => payloadUiMock())
afterEach(cleanup)
const { Binding, VersionContent } = settingParts
const points: SerializedFlagPoint[] = [{
  id: 'internal-hero', label: 'Welcome message', description: 'The message above the signup form.',
  params: {
    enabled: { type: 'checkbox', label: 'Show message', required: true },
    layout: { type: 'select', label: 'Layout', options: [{ label: 'Wide', value: 'wide' }, { label: 'Narrow', value: 'narrow' }] },
    color: { type: 'select', label: 'Colour', options: ['Red', 'Blue', 'Green', 'White', 'Black'].map(label => ({ label, value: label.toLowerCase() })) },
    amount: { type: 'number', label: 'Amount', min: 1, max: 10, required: true },
    title: { type: 'text', label: 'Heading', required: true },
    copy: { type: 'textarea', label: 'Message' },
  },
  defaultParams: { title: 'Old title' },
  effectiveDefaults: { enabled: true, layout: 'wide', color: 'red', amount: 2, title: 'Current title', copy: 'Current message' },
}, { id: 'internal-footer', label: 'Footer message', params: {}, defaultParams: {}, effectiveDefaults: { title: 'Footer title' } }]

function setup(status: Status = 'draft') {
  const doc: TestDocument = {
    id: '1', name: 'Example', slug: 'example', kind: 'flag', status, unitType: 'visitor', allocation: 100,
    flagPoint: points[0]!.id, exposurePolicy: 'manual',
    arms: [
      { key: 'control', kind: 'control', label: 'Original', weight: 45, params: { title: 'Stale title' } },
      { key: 'variantA', kind: 'variant', label: 'New message', weight: 45, params: { enabled: false, layout: 'wide', color: 'red', amount: 3, title: 'Variant title', copy: 'Variant message' } },
      { key: 'holdout', kind: 'holdout', label: 'Holdout', weight: 10 },
    ],
  }
  const testApi: TestDocApi = {
    doc, preflight: null, preflightError: null, errors: {}, saving: 'idle', loadState: 'ready', hasUnsaved: false,
    stage: vi.fn(), commit: vi.fn(async () => {}), reload: vi.fn(async () => {}),
  }
  const surface: SurfaceProps = {
    adminRoute: '/admin', apiRoute: '/api', canManage: true, canReadResults: true, isAdmin: false,
    flagPoints: points, attributeKeys: {}, metricSources: [],
  }
  const props: SectionProps = { test: testApi, surface }
  return { props, api: testApi, doc, surface }
}

test('picker shows setting labels, the description and defaults fallback without displaying ids', () => {
  const { props, api, doc } = setup()
  const view = render(<Binding {...props} />)
  expect(screen.getByRole('option', { name: 'Welcome message' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Footer message' })).toBeTruthy()
  expect(screen.getByText('The message above the signup form.')).toBeTruthy()
  expect(view.container.textContent).not.toContain('internal-')
  expect(view.container.textContent).toContain('Setting: Welcome message')
  api.doc = { ...doc, flagPoint: points[1]!.id }
  view.rerender(<Binding {...props} />)
  expect(screen.getByText('Footer message', { selector: 'p' })).toBeTruthy()
})

test('choosing a setting commits its id and the entire current versions array once', () => {
  const { props, api, doc } = setup()
  render(<Binding {...props} />)
  // A just-refused sibling edit must never reappear in a whole-group commit.
  api.doc = { ...doc, arms: doc.arms.map(arm => ({ ...arm, label: `${arm.label} saved` })) }
  fireEvent.change(screen.getByRole('combobox'), { target: { value: points[1]!.id } })
  expect(api.stage).toHaveBeenCalledExactlyOnceWith({ flagPoint: points[1]!.id, arms: [
    { ...api.doc.arms[0], params: { title: 'Footer title' } },
    { ...api.doc.arms[1], params: {} }, api.doc.arms[2],
  ] })
  expect(api.commit).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.stage).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.commit).mock.invocationCallOrder[0]!)
})

test('reselecting a setting preserves values; clearing removes the old values', () => {
  const { props, api } = setup()
  render(<Binding {...props} />)
  fireEvent.change(screen.getByRole('combobox'), { target: { value: points[0]!.id } })
  expect(api.stage).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
  expect(api.stage).toHaveBeenCalledWith({ flagPoint: '', arms: [
    { ...api.doc!.arms[0], params: {} }, { ...api.doc!.arms[1], params: {} }, api.doc!.arms[2],
  ] })
  expect(api.commit).toHaveBeenCalledTimes(1)
})

test.each(['stopped', 'running', 'decided', 'archived'] as const)('binding is read-only after draft: %s', status => {
  const { props, api } = setup(status)
  render(<Binding {...props} />)
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.getByText('Setting: Welcome message')).toBeTruthy()
  expect(screen.getByText(lockedReason(status, 'flagPoint', EDITABLE_BY_STATUS)!)).toBeTruthy()
  expect(api.stage).not.toHaveBeenCalled()
})

test('all parameter types have typed controls with option labels and numeric bounds', () => {
  const { props } = setup()
  render(<VersionContent {...props} armIndex={1} />)
  expect(screen.getByRole('checkbox', { name: 'Show message' })).toBeTruthy()
  expect(screen.getByRole('group', { name: 'Layout' })).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'Narrow' })).toBeTruthy()
  expect(screen.getByRole('combobox', { name: 'Colour' })).toBeTruthy()
  const number = screen.getByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement
  expect([number.min, number.max]).toEqual(['1', '10'])
  expect(screen.getByRole('textbox', { name: 'Heading' }).tagName).toBe('INPUT')
  expect(screen.getByRole('textbox', { name: 'Message' }).tagName).toBe('TEXTAREA')
})

test.each([
  ['checkbox', 'enabled', true], ['segmented', 'layout', 'narrow'], ['select', 'color', 'blue'],
] as const)('%s commits immediately with a coerced scalar in a complete group', (type, key, value) => {
  const { props, api } = setup()
  render(<VersionContent {...props} armIndex={1} />)
  if (type === 'checkbox') fireEvent.click(screen.getByRole('checkbox', { name: 'Show message' }))
  else if (type === 'segmented') fireEvent.click(screen.getByRole('radio', { name: 'Narrow' }))
  else fireEvent.change(screen.getByRole('combobox', { name: 'Colour' }), { target: { value } })
  expect(api.stage).toHaveBeenCalledExactlyOnceWith({ arms: api.doc!.arms.map((arm, index) => index === 1 ? { ...arm, params: { ...arm.params, [key]: value } } : arm) })
  expect(api.commit).toHaveBeenCalledTimes(1)
})

test.each([
  ['spinbutton', 'Amount', '7.5', 'amount', 7.5],
  ['textbox', 'Heading', 'New heading', 'title', 'New heading'],
  ['textbox', 'Message', 'New message', 'copy', 'New message'],
] as const)('%s %s only stages and saves on blur, using current sibling values', (role, label, input, key, value) => {
  const { props, api, doc } = setup()
  const view = render(<VersionContent {...props} armIndex={1} />)
  const control = screen.getByRole(role, { name: label })
  fireEvent.change(control, { target: { value: input } })
  expect(api.stage).not.toHaveBeenCalled()
  expect(api.commit).not.toHaveBeenCalled()
  api.doc = { ...doc, arms: doc.arms.map((arm, index) => index === 1 ? { ...arm, params: { ...arm.params, enabled: true } } : { ...arm, label: 'Saved label' }) }
  view.rerender(<VersionContent {...props} armIndex={1} />)
  fireEvent.blur(control)
  expect(api.stage).toHaveBeenCalledExactlyOnceWith({ arms: api.doc.arms.map((arm, index) => index === 1 ? { ...arm, params: { ...arm.params, [key]: value } } : arm) })
  expect(api.commit).toHaveBeenCalledTimes(1)
  fireEvent.blur(control)
  expect(api.commit).toHaveBeenCalledTimes(1)
})

test('Original displays effective defaults as read-only current values', () => {
  const { props, api } = setup()
  render(<VersionContent {...props} armIndex={0} />)
  for (const value of ['Yes', 'Wide', 'Red', '2', 'Current title', 'Current message']) expect(screen.getByText(`Current: ${value}`)).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(api.stage).not.toHaveBeenCalled()
})

test('holdout and unbound versions explain what to do', () => {
  const { props, api, doc } = setup()
  const view = render(<VersionContent {...props} armIndex={2} />)
  expect(screen.getByText('Sees the Original.')).toBeTruthy()
  api.doc = { ...doc, flagPoint: null }
  view.rerender(<VersionContent {...props} armIndex={1} />)
  expect(screen.getByText('Choose the setting first.')).toBeTruthy()
})

test.each(['running', 'decided', 'archived'] as const)('locked values render text and the status sentence: %s', status => {
  const { props, api } = setup(status)
  render(<VersionContent {...props} armIndex={1} />)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.getAllByText(lockedReason(status, 'arms', EDITABLE_BY_STATUS)!)).toHaveLength(6)
  expect(api.stage).not.toHaveBeenCalled()
})

test('stopped versions remain editable and readers cannot stage anything', () => {
  const { props, surface } = setup('stopped')
  const view = render(<VersionContent {...props} armIndex={1} />)
  expect(screen.getByRole('textbox', { name: 'Heading' })).toBeTruthy()
  surface.canManage = false
  view.rerender(<><Binding {...props} /><VersionContent {...props} armIndex={1} /></>)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('combobox')).toBeNull()
})

test('parameter validation, preflight detail and refused-save messages render inline without raw codes', () => {
  const { props, api, doc } = setup()
  api.preflight = { checks: [{ code: 'flag-params-invalid', ok: false, detail: [{ arm: 'variantA', field: 'layout' }] }], placements: [], baseline: null, trafficPerDay: null, estimate: null }
  api.errors = { 'arms.1.params.title': 'Use a shorter heading.' }
  api.doc = { ...doc, arms: doc.arms.map((arm, index) => index === 1 ? { ...arm, params: { ...arm.params, amount: 20 } } : arm) }
  render(<VersionContent {...props} armIndex={1} />)
  expect(screen.getByText('Amount must be at most 10.')).toBeTruthy()
  expect(screen.getByText('Set a value for Layout.')).toBeTruthy()
  expect(screen.getByText('Use a shorter heading.')).toBeTruthy()
  expect(screen.queryByText('flag-params-invalid')).toBeNull()
})

test('an unset required checkbox is invalid, while an explicit false is valid', () => {
  const { props, api, doc } = setup()
  const view = render(<VersionContent {...props} armIndex={1} />)
  expect(screen.queryByText('Enter a value for Show message.')).toBeNull()
  api.doc = { ...doc, arms: doc.arms.map((arm, index) => index === 1 ? { ...arm, params: { ...arm.params, enabled: undefined } } : arm) }
  view.rerender(<VersionContent {...props} armIndex={1} />)
  expect(screen.getByText('Enter a value for Show message.')).toBeTruthy()
})

test('a status lock discards local typing and shows the saved document value', () => {
  const { props, api, doc } = setup()
  const view = render(<VersionContent {...props} armIndex={1} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Heading' }), { target: { value: 'Uncommitted heading' } })
  api.doc = { ...doc, status: 'running' }
  view.rerender(<VersionContent {...props} armIndex={1} />)
  expect(screen.getByText('Variant title')).toBeTruthy()
  expect(screen.queryByText('Uncommitted heading')).toBeNull()
  api.doc = { ...doc, status: 'stopped' }
  view.rerender(<VersionContent {...props} armIndex={1} />)
  expect((screen.getByRole('textbox', { name: 'Heading' }) as HTMLInputElement).value).toBe('Variant title')
  expect(api.stage).not.toHaveBeenCalled()
  expect(api.commit).not.toHaveBeenCalled()
})
