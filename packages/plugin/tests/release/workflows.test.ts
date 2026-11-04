import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { parse } from 'yaml'

type Step = {
  uses?: string
  with?: Record<string, unknown>
}

type Workflow = {
  permissions?: Record<string, string> | string
  jobs: Record<string, {
    permissions?: Record<string, string> | string
    uses?: string
    steps?: Step[]
  }>
}

const workflowsDirectory = new URL('../../../../.github/workflows/', import.meta.url)
const workflows = readdirSync(workflowsDirectory)
  .filter(file => /\.ya?ml$/.test(file))
  .map(file => ({
    file,
    workflow: parse(readFileSync(new URL(file, workflowsDirectory), 'utf8')) as Workflow,
  }))

test('discovers workflow files', () => {
  expect(workflows.length).toBeGreaterThan(0)
})

test.each(workflows)('$file pins every external action and reusable workflow to a commit sha', ({ workflow }) => {
  const references = Object.values(workflow.jobs).flatMap(job => [
    ...(job.uses ? [job.uses] : []),
    ...(job.steps ?? []).flatMap(step => step.uses ? [step.uses] : []),
  ])
  const external = references.filter(reference => !reference.startsWith('./'))
  expect(external.filter(reference => !/@[0-9a-f]{40}$/.test(reference))).toEqual([])
})

test('an action pinned in several workflows uses one commit everywhere', () => {
  const shas = new Map<string, Set<string>>()
  for (const { workflow } of workflows) {
    for (const job of Object.values(workflow.jobs)) {
      for (const reference of [job.uses, ...(job.steps ?? []).map(step => step.uses)]) {
        if (!reference || reference.startsWith('./')) continue
        const [action, sha] = reference.split('@') as [string, string]
        shas.set(action, (shas.get(action) ?? new Set()).add(sha))
      }
    }
  }
  expect([...shas].filter(([, pins]) => pins.size > 1).map(([action]) => action)).toEqual([])
})

test.each(workflows)('$file grants no workflow-wide write permissions', ({ file, workflow }) => {
  // Publish must have no workflow-level grant for its reusable CI call to inherit.
  expect(workflow.permissions).toEqual(file === 'publish.yml' ? undefined : { contents: 'read' })
})

test.each(workflows)('$file declares only the required permissions on every job', ({ file, workflow }) => {
  expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0)
  for (const [name, job] of Object.entries(workflow.jobs)) {
    const expected: Record<string, string> = { contents: 'read' }
    if (file === 'publish.yml' && name === 'publish') {
      expected.contents = 'write' // gh release create
      expected['id-token'] = 'write' // npm trusted publishing
    } else if (file === 'gbstats-parity.yml' && name === 'drift') {
      expected.issues = 'write' // gh issue create
    }
    // An explicit map also rejects omitted permissions and write-all shorthand.
    expect(job.permissions, `${file}: ${name}`).toEqual(expected)
  }
})

test.each(workflows)('$file disables persisted credentials on every checkout', ({ file, workflow }) => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith('actions/checkout@')) {
        expect(step.with?.['persist-credentials'], `${file}: ${name}`).toBe(false)
      }
    }
  }
})
