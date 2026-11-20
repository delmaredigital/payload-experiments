import { expect, test } from 'vitest'
import { nestedTestCopy } from '../../src/puck/nestedTestCopy.js'
import { editorCopy } from '../../src/puck/editor/copy.js'
import { READINESS } from '../../src/testSurface/surface/readiness/readiness.model.js'
import { refuse } from '../../src/transitions/start.js'

const context = { arms: [], unitType: 'visitor' as const }
const cases = [
  ['Outer', 'Inner', '“Inner” is inside a version of “Outer”.', '“Inner”'],
  ['Outer', undefined, 'An Experiment block with no test chosen is inside a version of “Outer”.', 'that block'],
  [undefined, 'Inner', '“Inner” is inside a version of another test.', '“Inner”'],
  [undefined, undefined, 'An Experiment block with no test chosen is inside a version of another test.', 'that block'],
] as const
for (const [outer, inner, location, move] of cases) {
  test(`context copy for outer=${outer} inner=${inner}`, () => {
    const start = `${location} A test can't go inside another test's version. Move ${move} out of that version before you start either test.`
    expect(editorCopy.nested(outer, inner)).toBe(inner ? start : start.replace('An Experiment block with no test chosen', 'This test').replace('Move that block', 'Move this test'))
    const detail = [{ outer: outer ?? '', inner: inner ?? '' }]
    expect(READINESS['nested-tests'].next(detail, context)).toBe(start)
    expect(() => refuse('nested-tests', detail)).toThrow(start)
    expect(nestedTestCopy.publish(outer, inner)).toBe(`${location} A test can't go inside another test's version, so this page can't be published. Move ${move} out of that version, then publish.`)
    expect(editorCopy.nestedHidden(outer)).toBe(`This test is inside a version of ${outer ? `“${outer}”` : 'another test'}. It is hidden, so nothing is blocked now. If you show it again, the page can't be published until you move it out of that version.`)
  })
}
test('readiness and Start refusal name every page and affected languages', () => {
  const detail = [
    { outer: 'Outer', inner: 'Inner', title: 'Home · All languages' },
    { outer: 'Outer', inner: 'Inner', title: 'About · Languages: French' },
  ]
  const expected = detail.map(pair => `On ${pair.title}: ${editorCopy.nested(pair.outer, pair.inner)}`).join('\n')
  expect(READINESS['nested-tests'].next(detail, context)).toBe(expected)
  expect(() => refuse('nested-tests', detail)).toThrow(expected)
})


test.each([undefined, null, {}, 'invalid', [], [null], [42], ['invalid'], [[]], [{}], [{ outer: 'Outer' }], [{ inner: 'Inner' }], [{ outer: 1, inner: ' ' }], [{ outer: 'Outer', inner: false }]].map(detail => ({ detail })))('missing or malformed readiness detail keeps neutral fallback copy ($detail)', ({ detail }) => {
  const expected = "A test is inside another test's version on this page. A test can't go inside another test's version. Move the inner test out of that version before you start either test."
  expect(nestedTestCopy.readinessFallback).toBe(expected)
  expect(READINESS['nested-tests'].next(detail, context)).toBe(expected)
  expect(() => refuse('nested-tests', detail)).toThrow(expected)
})

test('malformed readiness detail keeps its page title without claiming an unbound block', () => {
  expect(nestedTestCopy.readiness([{ title: 'Home', outer: 1, inner: null }]))
    .toBe(`On Home: ${nestedTestCopy.readinessFallback}`)
})
