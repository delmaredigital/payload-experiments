const innerLabel = (inner?: string) => inner ? `“${inner}”` : 'An Experiment block with no test chosen'
const outerLabel = (outer?: string) => outer ? `“${outer}”` : 'another test'
const moveLabel = (inner?: string) => inner ? `“${inner}”` : 'that block'
const location = (outer?: string, inner?: string) => `${innerLabel(inner)} is inside a version of ${outerLabel(outer)}.`
const start = (outer?: string, inner?: string) =>
  `${location(outer, inner)} A test can't go inside another test's version. Move ${moveLabel(inner)} out of that version before you start either test.`
const readinessFallback = "A test is inside another test's version on this page. A test can't go inside another test's version. Move the inner test out of that version before you start either test."

export const nestedTestCopy = {
  start,
  readinessFallback,
  editor: (outer?: string, inner?: string) => inner ? start(outer, inner)
    : `This test is inside a version of ${outerLabel(outer)}. A test can't go inside another test's version. Move this test out of that version before you start either test.`,
  publish: (outer?: string, inner?: string) =>
    `${location(outer, inner)} A test can't go inside another test's version, so this page can't be published. Move ${moveLabel(inner)} out of that version, then publish.`,
  hidden: (outer?: string) =>
    `This test is inside a version of ${outerLabel(outer)}. It is hidden, so nothing is blocked now. If you show it again, the page can't be published until you move it out of that version.`,
  readiness: (detail: unknown) => (Array.isArray(detail) && detail.length ? detail : [{}]).map(value => {
    const pair = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
    const message = typeof pair.outer === 'string' && typeof pair.inner === 'string'
      ? start(text(pair.outer), text(pair.inner)) : readinessFallback
    const title = text(pair.title)
    return title ? `On ${title}: ${message}` : message
  }).join('\n'),
}
