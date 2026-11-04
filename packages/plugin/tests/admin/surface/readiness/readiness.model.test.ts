import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { ReadinessCode } from '../../../../src/transitions/checkStart.js'
import { ARM_CHECK_ORDER } from '../../../../src/transitions/checkStart.js'
import { SECTION_ORDER } from '../../../../src/admin/surface/contracts.js'
import { READINESS, daysRemaining, displayDate, nextStep, sectionDone } from '../../../../src/admin/surface/readiness/readiness.model.js'
import { doc, preflight } from './fixtures.js'

type Fixture = [string, unknown, string | null]
const fixtures = {
  'make-content-unsupported': ['header', 'Landing page', "Landing page has more than one language, so Make it the content isn't available for it; you'll copy the winning version by hand."],
  'invalid-status': ['header', undefined, null],
  'no-placements': ['what', undefined, 'Not on a page yet. Open a page, add an Experiment block and choose this test.'],
  'empty-slot': ['versions', [{ slots: { control: 1, variantA: 0 } }], 'Add content for Short headline on the page.'],
  'flag-no-point': ['what', undefined, 'Choose the setting to test.'],
  'flag-params-invalid': ['versions', [{ arm: 'variantA', field: 'headline' }], 'Set a value for Headline text on Short headline.'],
  'flag-point-busy': ['what', undefined, 'Another test is already running on this setting. Stop it first.'],
  'flag-placement-missing': ['versions', { missing: ['variantA'], placements: [{ arm: 'variantA', ok: false, detail: 'add a donation form' }] }, 'Add content for Short headline wherever this setting is used: add a donation form.'],
  'no-primary-metric': ['win', undefined, 'Choose a goal.'],
  'unknown-metric-source': ['win', undefined, "This goal's data source isn't available. Choose another goal."],
  'unit-source-mismatch': ['win', undefined, "This goal can't be measured for visitors. Choose another goal."],
  'no-planned-duration': ['length', undefined, 'Choose how long to run it.'],
  'no-reach-per-day': ['length', undefined, 'Enter how many people reach this per day.'],
  'layer-full': ['versions', undefined, "This test's group is full. Lower how many people take part, or create the test again without the group."],
  'layer-unit-mismatch': ['header', undefined, "This test's group counts different people. Create the test again without the group."],
  'page-no-targets': ['versions', undefined, 'Add a page address for each version.'],
  'page-target-unpublished': ['versions', '/variant', "/variant isn't a published page. Publish it, or pick another page."],
  'page-targets-unchecked': ['versions', undefined, "Version pages aren't checked; make sure each one is published."],
  'version-page-unavailable': ['versions', '/variant', "/variant isn't published, so visitors assigned to it see an error. Republish it, or stop the test."],
  'version-page-unchecked': ['versions', '/variant', "Couldn't check whether /variant is published. Check that it is still published, or stop the test."],
  'page-user-unit': ['header', undefined, 'Whole-page tests count visitors. Create the test again counting visitors.'],
  'block-path-rule': ['who', { rules: [1] }, 'Remove the page-path rule in Who takes part; page block tests run on their page.'],
  'invalid-targeting-rule': ['who', { attributes: ['country'] }, 'Fix the rule: country.'],
  'undeclared-targeting-key': ['who', { attributes: ['country'] }, "Remove the rule on country: it isn't available."],
  'weights-total': ['versions', [{ message: 'Group shares must total 100.' }], 'Fix the versions: Group shares must total 100.'],
  'control-count': ['versions', [{ message: 'Exactly one Original is required.' }], 'Fix the versions: Exactly one Original is required.'],
  'control-first': ['versions', [{ message: 'The Original must be first.' }], 'Fix the versions: The Original must be first.'],
  'holdout-count': ['versions', [{ message: 'Only one Holdout is allowed.' }], 'Fix the versions: Only one Holdout is allowed.'],
  'holdout-last': ['versions', [{ message: 'The Holdout must be the last group.' }], 'Fix the versions: The Holdout must be the last group.'],
  'variant-count': ['versions', [{ message: 'At most three variants are allowed.' }], 'Fix the versions: At most three variants are allowed.'],
  'invalid-key': ['versions', [{ message: 'Use the standard names.' }], 'Fix the versions: Use the standard names.'],
  'duplicate-key': ['versions', [{ message: 'Each group can appear only once.' }], 'Fix the versions: Each group can appear only once.'],
  'slot-required': ['versions', [{ message: 'Each version needs content.' }], 'Fix the versions: Each version needs content.'],
  'duplicate-slot': ['versions', [{ message: 'Two groups cannot share content.' }], 'Fix the versions: Two groups cannot share content.'],
} satisfies Record<ReadinessCode, Fixture>
const ctx = { ...doc, flagPoint: 'ask', flagPoints: [{ id: 'ask', params: { headline: { type: 'text' as const, label: 'Headline text' } } }] }

test('covers every literal start check and every member of both source unions (34 including health)', () => {
  const source = readFileSync(new URL('../../../../src/transitions/checkStart.ts', import.meta.url), 'utf8')
  const endpoints = readFileSync(new URL('../../../../src/types/endpoints.ts', import.meta.url), 'utf8')
  const literals = [...source.matchAll(/add\('([^']+)'/g)].map(match => match[1])
  const readinessUnion = source.split('export type ReadinessCode = ArmIssueCode')[1]!.split('export interface')[0]!
  const armUnion = endpoints.split('export type ArmIssueCode =')[1]!.split('\n')[0]!
  const members = [...`${readinessUnion} ${armUnion}`.matchAll(/'([^']+)'/g)].map(match => match[1])
  expect(literals).toHaveLength(22)
  expect(ARM_CHECK_ORDER).toHaveLength(10)
  expect(members).toHaveLength(34)
  expect(Object.keys(READINESS).sort()).toEqual(members.sort())
  expect(Object.keys(READINESS).sort()).toEqual([...literals, ...ARM_CHECK_ORDER, 'version-page-unavailable', 'version-page-unchecked'].sort())
  expect(Object.keys(fixtures).sort()).toEqual(Object.keys(READINESS).sort())
})
test('block path readiness names the removal step', () => {
  expect(READINESS['block-path-rule'].nextStep).toBe('Remove rule')
  expect(nextStep(preflight([{ code: 'block-path-rule', ok: false, detail: { rules: [1] } }]), ctx))
    .toEqual({ section: 'who', code: 'block-path-rule', sentence: fixtures['block-path-rule'][2], nextStep: 'Remove rule' })
})
for (const code of Object.keys(fixtures) as ReadinessCode[]) {
  test(`${code} maps to its exact section and sentence`, () => {
    const [section, detail, sentence] = fixtures[code]
    expect(READINESS[code].section).toBe(section)
    expect(READINESS[code].next(detail, ctx)).toBe(sentence)
  })
}
test('header first, then contract section order, rather than checkStart order', () => {
  const codes: ReadinessCode[] = ['no-planned-duration', 'invalid-targeting-rule', 'no-primary-metric', 'empty-slot', 'flag-no-point', 'page-user-unit']
  const checks = codes.map(code => ({ code, ok: false }))
  const expected = ['header', ...SECTION_ORDER.filter(section => section !== 'advanced')]
  for (const section of expected) {
    const next = nextStep(preflight(checks), ctx)!
    expect(next.section).toBe(section)
    checks.splice(checks.findIndex(check => check.code === next.code), 1)
  }
  expect(nextStep(preflight(checks), ctx)).toBeNull()
  expect(nextStep(preflight([{ code: 'invalid-status', ok: false }]), ctx)).toBeNull()
})
test('sectionDone uses failing checks only and defaults Who and Advanced to done', () => {
  expect(sectionDone({ preflight: null })).toEqual({ what: false, versions: false, win: false, who: true, length: false, advanced: true })
  expect(sectionDone({ preflight: preflight() })).toEqual(Object.fromEntries(SECTION_ORDER.map(section => [section, true])))
  expect(sectionDone({ preflight: preflight([{ code: 'empty-slot', ok: false }, { code: 'no-primary-metric', ok: true }, { code: 'undeclared-targeting-key', ok: false }]) }))
    .toEqual({ what: true, versions: false, win: true, who: false, length: true, advanced: true })
})
test('fills both people types, direct detail messages, and missing placement groups', () => {
  expect(READINESS['unit-source-mismatch'].next(null, { ...ctx, unitType: 'user' })).toBe("This goal can't be measured for signed-in users. Choose another goal.")
  expect(READINESS['flag-placement-missing'].next({ missing: ['control'], placements: [] }, ctx)).toBe('Add content for Original wherever this setting is used.')
  expect(READINESS['flag-placement-missing'].next({ missing: ['variantA'], placements: [{ arm: 'variantA', ok: false }] }, ctx)).toBe('Add content for Short headline wherever this setting is used.')
  expect(READINESS['flag-placement-missing'].next('Host setup failed.', ctx)).toBe("Couldn't check where this test is used. Try again.")
  expect(READINESS['invalid-targeting-rule'].next({ message: 'Choose a number.' }, ctx)).toBe('Fix the rule: Choose a number.')
})
test('status helpers omit unknown dates and duration, clamp a finished duration', () => {
  expect(displayDate('2026-11-01T10:00:00Z')).toBe('1 Nov 2026')
  expect(displayDate('bad')).toBeNull()
  expect(daysRemaining(doc, Date.now())).toBeNull()
  expect(daysRemaining({ ...doc, startedAt: '2026-10-01T00:00:00Z' }, Date.parse('2026-11-02'))).toBe(0)
})
