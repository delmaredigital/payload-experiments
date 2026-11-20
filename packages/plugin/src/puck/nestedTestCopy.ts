export const nestedTestCopy = (outer: string, inner: string) =>
  `The test “${inner}” is inside a version of “${outer}”. Move “${inner}” out of that version before starting either test or publishing this new nesting.`
