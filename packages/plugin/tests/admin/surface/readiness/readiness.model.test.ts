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
  'goal-in-some-versions': ['win', { metricId: 1, name: 'Join' }, "Join appears in some versions but not all, so the comparison wouldn't be fair. Add it to every version, or choose another goal."],
  'placement-unchecked': ['versions', { path: '/landing' }, "/landing couldn't be checked, so the test can't confirm every version shows the same goals. Check that you can open it."],
  'invalid-status': ['header', undefined, null],
  'no-placements': ['what', undefined, 'Not on a page yet. Open a page, add an Experiment block and choose this test.'],
  'placement-unpublished': ['versions', [{ title: 'Landing' }], "The block you're testing is only on a draft of Landing. Publish the page before you start."],
  'duplicate-version-row': ['versions', [{ title: 'Landing' }], 'The Experiment block on Landing has the same version twice. Remove one of them, then save.'],
  'interacting-tests': ['versions', [{ path: '/landing', name: 'Other', status: 'decided' }], 'This test uses /landing, which the decided test Other also changes. Finish one of them first.'],
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
  'page-in-use': ['versions', { paths: ['/original', '/variant'] }, 'Another running or decided test already uses /original. Choose a different page, or finish that test first.'],
  'page-no-targets': ['versions', undefined, 'Choose a page for each version.'],
  'unknown-collection': ['versions', undefined, "That page type isn't set up for tests."],
  'version-identical': ['versions', { arm: 'variantA', path: '/version' }, '/version looks the same as the Original, so the test would compare nothing. Change it before you start.'],
  'version-same-address': ['versions', { arm: 'variantA', otherArm: 'control', path: '/' }, 'Short headline has the same address (/) as Original. Choose a different page.'],
  'page-target-unpublished': ['versions', '/variant', "/variant isn't a published page yet. Publish it, or choose another page."],
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

test('covers every literal start check and every member of both source unions (35 including health)', () => {
  const source = readFileSync(new URL('../../../../src/transitions/checkStart.ts', import.meta.url), 'utf8')
  const endpoints = readFileSync(new URL('../../../../src/types/endpoints.ts', import.meta.url), 'utf8')
  const literals = [...source.matchAll(/add\('([^']+)'/g)].map(match => match[1])
  const readinessUnion = source.split('export type ReadinessCode = ArmIssueCode')[1]!.split('export interface')[0]!
  const armUnion = endpoints.split('export type ArmIssueCode =')[1]!.split('\n')[0]!
  const members = [...`${readinessUnion} ${armUnion}`.matchAll(/'([^']+)'/g)].map(match => match[1])
  expect(literals).toHaveLength(29)
  expect(ARM_CHECK_ORDER).toHaveLength(10)
  expect(members).toHaveLength(43)
  expect(Object.keys(READINESS).sort()).toEqual(members.sort())
  expect(Object.keys(READINESS).sort()).toEqual([...literals, ...ARM_CHECK_ORDER, 'placement-unchecked', 'version-identical', 'version-page-unavailable', 'version-page-unchecked'].sort())
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


test('page conflict readiness names the next action and tolerates missing path detail', () => {
  expect(nextStep(preflight([{ code: 'page-in-use', ok: false, detail: { paths: ['/original'] } }]), ctx))
    .toEqual({ section: 'versions', code: 'page-in-use', sentence: fixtures['page-in-use'][2], nextStep: 'Choose pages' })
  for (const detail of [undefined, {}, { paths: [] }, { paths: [null] }]) {
    expect(READINESS['page-in-use'].next(detail, ctx)).toBe('Another running or decided test already uses this page. Choose a different page, or finish that test first.')
  }
})

test('identical-version action names the page to edit', () => {
  const action = READINESS['version-identical'].nextStep
  expect(typeof action).toBe('function')
  expect(typeof action === 'function' && action({ arm: 'variantA', path: '/version' }, ctx)).toBe('Edit /version')
})

// Measured below 100 ms locally; cap leaves CI headroom.
test('placement copy lists every draft page and names edit actions exactly', () => {
  expect(READINESS['placement-unpublished'].next([{ title: 'Landing' }, { title: 'About' }], ctx)).toBe(
    "The block you're testing is only on a draft of Landing. Publish the page before you start.\nThe block you're testing is only on a draft of About. Publish the page before you start.")
  expect(nextStep(preflight([{ code: 'duplicate-version-row', ok: false, detail: [{ title: 'Landing' }] }]), ctx)?.nextStep).toBe('Edit Landing')
  expect(nextStep(preflight([{ code: 'interacting-tests', ok: false, detail: [{ path: '/version', name: 'Other', status: 'running', version: true }] }]), ctx)).toMatchObject({
    sentence: 'This test uses /version, which the running test Other also changes. Finish one of them first, or remove its block from /version.',
    nextStep: 'Open Other\nEdit /version',
  })
}, 5000)

test('asymmetry refusal names every goal on its own line in readiness and the server refusal', async () => {
  const { refuse } = await import('../../../../src/transitions/start.js')
  const detail = [{ metricId: 1, name: 'Join' }, { metricId: 2, name: 'Donate' }]
  const expected = ["Join appears in some versions but not all, so the comparison wouldn't be fair. Add it to every version, or choose another goal.",
    "Donate appears in some versions but not all, so the comparison wouldn't be fair. Add it to every version, or choose another goal."].join('\n')
  expect(READINESS['goal-in-some-versions'].next(detail, ctx)).toBe(expected)
  expect(() => refuse('goal-in-some-versions', detail)).toThrow(expected)
}, 5_000) // Measured 588 ms locally; cap exceeds 3×.
test.each([
  [true, false, "/copy isn't published, so it can't be the Original. Publish it, or choose another page."],
  [true, true, "/copy isn't published, so it can't be the Original. Publish it, or choose another page."],
  [false, true, '/copy is still a draft. Publish it in Pages, then start the test.'],
  [false, false, "/copy isn't published yet, or no page has that address. Publish it in Pages, or choose another page."],
] as const)('unpublished readiness distinguishes original=%s found=%s', (original, found, expected) => {
  const key = original ? 'control' : 'variantA'
  const context = { ...ctx, collectionLabel: 'Pages', arms: ctx.arms.map(arm => ({ ...arm, pageTarget: arm.key === key ? '/copy/' : '/other' })),
    pagePlacements: [{ arm: key, path: '/copy/', id: found ? 1 : null, published: false, collection: 'pages' }] }
  expect(READINESS['page-target-unpublished'].next('/copy', context)).toBe(expected)
  expect(nextStep(preflight([{ code: 'page-target-unpublished', ok: false, detail: '/copy' }]), context)).toMatchObject({ nextStep: 'Choose pages', arm: key })
})
test('page conflicts normalize raw targets and distinguish versions from the Original', () => {
  const context = { ...ctx, collectionLabel: 'Pages', arms: ctx.arms.map(arm => ({ ...arm, pageTarget: arm.kind === 'control' ? '/original/' : '/copy/' })) }
  expect(READINESS['page-in-use'].next({ paths: ['/copy'] }, context)).toBe('/copy is already in another running or decided test. Make a new copy of the Original for this version, or finish that test first.')
  expect(READINESS['page-in-use'].next({ paths: ['/original'] }, context)).toBe('Another running or decided test already uses /original. Choose a different page, or finish that test first.')
  expect(READINESS['version-same-address'].next({ arm: 'variantA', otherArm: 'control', path: '/original' }, context)).toBe('Short headline has the same address (/original) as Original. Choose a different page. Give the copy its own address in Pages, publish it, then choose it.')
})
test('unpublished readiness without a known collection uses the server sentence', () => {
  expect(READINESS['page-target-unpublished'].next('/copy', { ...ctx, pagePlacements: [{ arm: 'variantA', path: '/copy', id: 1, published: false }] })).toBe("/copy isn't a published page yet. Publish it, or choose another page.")
})
test.each([false, true])('unpublished readiness matches the arm before the path and only calls published=false a draft (%s)', published => {
  const context = { ...ctx, collectionLabel: 'Articles', arms: ctx.arms.map(arm => ({ ...arm, pageTarget: arm.key === 'variantA' ? '/copy/' : '/other' })), pagePlacements: [
    { arm: 'variantB', path: '/copy', id: 99, published: !published },
    { arm: 'variantA', path: '/old-path', id: 1, published },
  ] }
  const expected = published ? "/copy isn't published yet, or no page has that address. Publish it in Articles, or choose another page." : '/copy is still a draft. Publish it in Articles, then start the test.'
  expect(READINESS['page-target-unpublished'].next('/copy', context)).toBe(expected)
  expect(READINESS['page-target-unpublished'].next({ arm: 'variantA', path: '/copy' }, context)).toBe(expected)
})

test('unknown failing codes target What and keep that section incomplete', () => {
  const value = preflight([{ code: 'future-code', ok: false }] as unknown as ReturnType<typeof preflight>['checks'])
  expect(nextStep(value, ctx)).toEqual({ section: 'what', sentence: 'Review setup', code: 'future-code' })
  expect(sectionDone({ preflight: value }).what).toBe(false)
})
