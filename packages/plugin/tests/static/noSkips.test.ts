import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'

// No exceptions remain. The former "known-pending stats tests are skipped"
// helper self-test deliberately threw in its skipped callback; it was removed
// with the retired helper, rather than preserving a stats-dependent skip.
const ALLOWED_SKIPS: Array<{ file: string; line: string; reason: string }> = []
const skipPattern = () => new RegExp(String.raw`\.skip\s*(?:\(|\.)|\bskip` + String.raw`If\s*\(|\bskip` + 'UntilStats\\b', 'g')

test('plugin tests contain no unapproved skips or retired stats guards', () => {
  const root = new URL('../', import.meta.url)
  const violations = readdirSync(root, { recursive: true }).flatMap(String).filter(file => /\.tsx?$/.test(file)).flatMap(file => {
    return readFileSync(new URL(file, root), 'utf8').split('\n').flatMap((line, index) => {
      if (!skipPattern().test(line) || ALLOWED_SKIPS.some(allowed => allowed.file === file && allowed.line === line && allowed.reason)) return []
      return [`${file}:${index + 1}: ${line.trim()}`]
    })
  })
  expect(violations).toEqual([])
})

test('skip scan catches direct, conditional, parameterized and legacy stats skips', () => {
  for (const source of ['test.' + 'skip(', 'it.' + 'skip(', 'test.' + 'skip.each(', 'test.skip' + 'If(', 'skip' + 'UntilStats']) {
    expect(skipPattern().test(source)).toBe(true)
  }
})
