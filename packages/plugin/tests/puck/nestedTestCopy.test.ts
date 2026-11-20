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
    expect(READINESS['nested-tests'].next([{ outer, inner }], context)).toBe(start)
    expect(() => refuse('nested-tests', [{ outer, inner }])).toThrow(start)
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


test.each([undefined, null, [], [null], [{ outer: 1, inner: ' ' }]].map(detail => ({ detail })))('missing or malformed readiness detail keeps natural fallback copy ($detail)', ({ detail }) => {
  expect(READINESS['nested-tests'].next(detail, context)).toBe(nestedTestCopy.start())
})
