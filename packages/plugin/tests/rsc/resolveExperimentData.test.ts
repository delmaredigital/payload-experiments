import { expect, test } from 'vitest'
import { assignments, experiment, manifest } from './helpers.js'
import { resolveExperimentData } from '../../src/server/resolveExperimentData.js'
import type { Data } from '@puckeditor/core'

const text = (value: string) => ({ type: 'Text', props: { id: value, text: value } })
const slot = (slug: string | null = 'hero', patch = {}) => ({ type: 'ExperimentSlot', props: {
  id: `slot-${slug}`, experiment: slug ? { id: 7, slug } : null,
  control: [text('ORIGINAL')], variantA: [text('WINNER')], variantB: [text('LOSER-B')], variantC: [text('LOSER-C')], ...patch,
} })
const data = (node = slot()) => ({ content: [node], root: { props: {} } }) as Data

test('only assigned slot survives JSON; input unchanged', () => {
  const input = data(), before = JSON.stringify(input)
  const result = resolveExperimentData(input, assignments())
  expect(JSON.stringify(result.data)).toContain('WINNER')
  for (const unassigned of ['ORIGINAL', 'LOSER-B', 'LOSER-C']) expect(JSON.stringify(result.data)).not.toContain(unassigned)
  expect(result.rendered).toEqual([{ slug: 'hero', phase: 1, arm: 'variantA' }])
  expect(JSON.stringify(input)).toBe(before); expect(result.data).not.toBe(input)
})
test('walks nested selected slots and legacy Puck zones, never visits dropped branches', () => {
  const m = manifest([experiment(), experiment({ id: 8, slug: 'nested' })])
  const input = { ...data(slot('hero', { variantA: [slot('nested')], control: [slot('dropped')] })), zones: { 'legacy:zone': [slot('nested')] } } as Data
  const result = resolveExperimentData(input, assignments(m))
  expect(result.rendered.map(e => e.slug)).toEqual(['hero', 'nested'])
  expect(JSON.stringify(result.data)).not.toContain('dropped')
  expect(JSON.stringify(result.data)).not.toContain('LOSER-B')
})
test('holdout renders control slot and is measured', () => {
  const a = assignments(); a.bySlug.hero!.arm = 'holdout'
  const result = resolveExperimentData(data(), a)
  expect(result.data.content[0]!.props).toMatchObject({ xpSlot: 'control', xpArm: 'holdout' })
  expect(JSON.stringify(result.data)).toContain('ORIGINAL'); expect(JSON.stringify(result.data)).not.toContain('WINNER')
  expect(result.rendered).toEqual([{ slug: 'hero', arm: 'holdout', phase: 1 }])
})
test('viewport renders content and xpExpose without entering rendered', () => {
  const a = assignments(); a.bySlug.hero!.policy = 'viewport'
  const result = resolveExperimentData(data(), a)
  expect(result.rendered).toEqual([])
  expect(result.data.content[0]!.props).toMatchObject({ xpSlot: 'variantA', xpExpose: { slug: 'hero', arm: 'variantA', phase: 1 } })
})
test('unenrolled renders control and never enters rendered', () => {
  const result = resolveExperimentData(data(), assignments(manifest([experiment({ coverage: 0 })])) )
  expect(result.data.content[0]!.props.xpSlot).toBe('control'); expect(result.rendered).toEqual([])
})
test.each(['archived', 'unknown', null])('%s uses archived winner or control and records nothing', slug => {
  const result = resolveExperimentData(data(slot(slug)), assignments())
  expect(result.data.content[0]!.props.xpSlot).toBe(slug === 'archived' ? 'variantB' : 'control')
  expect(result.rendered).toEqual([])
})
test.each(['staff', 'bot', 'preview'] as const)('%s suppresses rendered and viewport exposure', flag => {
  const a = assignments(); a[flag] = true
  expect(resolveExperimentData(data(), a).rendered).toEqual([])
  a.bySlug.hero!.policy = 'viewport'
  expect(resolveExperimentData(data(), a).data.content[0]!.props).not.toHaveProperty('xpExpose')
})
test.each(['hero', 'unknown', null])('hostile stored runtime props reset on %s', slug => {
  const a = assignments(); a.bySlug.hero!.exposable = false; a.bySlug.hero!.arm = 'control'
  const input = data(slot(slug, { xpSlot: 'variantC', xpArm: 'evil', xpExpose: { slug: 'evil', arm: 'variantC', phase: 999 } }))
  const result = resolveExperimentData(input, a)
  const props = result.data.content[0]!.props
  expect(props.xpSlot).toBe('control'); expect(props.xpArm).toBe(slug === 'hero' ? 'control' : undefined)
  expect(props).not.toHaveProperty('xpExpose')
  expect(JSON.stringify(result.data)).not.toContain('LOSER-C')
})
test('manifest arm slot mapping is respected', () => {
  const m = manifest(); m.experiments[0]!.arms[1]!.slot = 'variantB'
  const result = resolveExperimentData(data(), assignments(m))
  expect(result.data.content[0]!.props.xpSlot).toBe('variantB')
  expect(JSON.stringify(result.data)).not.toContain('WINNER')
})

test.each(['self', 'slot', 'zone', 'sizes'] as const)('fully hidden %s renders no subtree and records no render or viewport exposure without a host wrapper', mode => {
  const hidden = slot('hero', { _visibility: mode === 'sizes' ? { hideOn: ['phone', 'tablet', 'desktop'] } : mode === 'self' ? { hidden: true } : undefined })
  const input = { root: { props: {} }, content: mode === 'self' || mode === 'sizes' ? [hidden]
    : [{ type: 'Container', props: { id: 'parent', _visibility: { hidden: true }, ...(mode === 'slot' ? { children: [hidden] } : {}) } }],
    zones: mode === 'zone' ? { 'parent:children': [hidden] } : undefined } as Data
  for (const policy of ['render', 'viewport'] as const) {
    const assigned = assignments(); assigned.bySlug.hero!.policy = policy
    const result = resolveExperimentData(input, assigned)
    expect(result.data.content).toEqual([])
    expect(result.rendered).toEqual([])
    expect(JSON.stringify(result.data)).not.toMatch(/WINNER|xpExpose|ExperimentSlot/)
  }
})
test('partial hiding keeps content and render exposures in the HTML', () => {
  const result = resolveExperimentData(data(slot('hero', { _visibility: { hideOn: ['phone'] } })), assignments())
  expect(JSON.stringify(result.data)).toContain('WINNER')
  expect(result.rendered).toHaveLength(1)
})

test('a modern slot named zones cannot bypass hiding and exposure suppression', () => {
  const input = { root: { props: {} }, content: [{ type: 'Container', props: { id: 'container', zones: [slot('hero', { _visibility: { hidden: true } })] } }] } as Data
  const result = resolveExperimentData(input, assignments())
  expect(result.data.content[0]!.props.zones).toEqual([])
  expect(result.rendered).toEqual([])
})
