import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const distTagScript = join(repoRoot, 'scripts/release/dist-tag.sh')
const validateScript = join(repoRoot, 'scripts/release/validate-release.sh')

describe('npm dist-tag from the prerelease identifier', () => {
  test.each([
    ['0.2.0-rc.4', 'rc'],
    ['0.20.0-next.0', 'next'],
    ['0.3.0', 'latest'],
    ['0.1.0-beta.2', 'beta'],
    ['0.3.0-latest.0', null],
    ['0.3.0-RC.1', null],
    ['0.3.0-1', null],
    ['', null],
    ['v0.3.0', null],
  ] as const)('%j → %s', (version, expected) => {
    const result = spawnSync('bash', [distTagScript, version], { encoding: 'utf8' })
    expect(result.error).toBeUndefined()
    if (expected === null) {
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('::error::')
      expect(result.stderr).toContain(`'${version}'`)
      expect(result.stderr).toContain('X.Y.Z-next.0')
    } else {
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe(`${expected}\n`)
      expect(result.stderr).toBe('')
    }
  })

  test('rejects a missing argument', () => {
    const result = spawnSync('bash', [distTagScript], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::')
  })
})

describe('release validation against an isolated repository fixture', () => {
  let root: string
  const pluginVersion = '0.2.0-rc.4'
  const statsVersion = '0.3.0'
  const notes = '\n### plugin\n\n- Release candidate changes.\n\n'

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'xp-release-'))
    for (const [pkg, version] of [['plugin', pluginVersion], ['stats', statsVersion]] as const) {
      const directory = join(root, 'packages', pkg)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }))
    }
    writeFileSync(join(root, 'CHANGELOG.md'),
      `# Changelog\n\n## [Unreleased]\n\nNot released.\n\n## [${pluginVersion}] - 2026-11-03\n${notes}` +
      `## [${statsVersion}] - 2026-11-02\n\n### stats\n\n- Stable changes.\n`)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function validate(tag: string, githubEnv = '') {
    return spawnSync('bash', [validateScript, tag, '--root', root], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ENV: githubEnv },
    })
  }

  test('accepts a matching plugin tag and extracts only its notes', () => {
    const result = validate(`plugin-v${pluginVersion}`)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe(
      `PKG=packages/plugin\nVER=${pluginVersion}\nNPM_TAG=rc\nPRERELEASE_ARG=--prerelease\n`,
    )
    expect(readFileSync(join(root, 'release-notes.md'), 'utf8')).toBe(notes)
  })

  test('rejects a tag/package version mismatch and reports both versions', () => {
    const result = validate('plugin-v0.2.0-rc.5')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::')
    expect(result.stderr).toContain('0.2.0-rc.5')
    expect(result.stderr).toContain(pluginVersion)
    expect(result.stdout).toBe('')
  })

  test('rejects a missing CHANGELOG section', () => {
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\nPending.\n')
    const result = validate(`plugin-v${pluginVersion}`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::')
    expect(result.stderr).toContain(`No non-empty CHANGELOG section found for [${pluginVersion}]`)
    expect(result.stdout).toBe('')
  })

  test.each(['', '\n \t\n'])('rejects an empty CHANGELOG section (%j)', body => {
    writeFileSync(join(root, 'CHANGELOG.md'), `## [${pluginVersion}]\n${body}## [${statsVersion}]\nOther notes.\n`)
    const result = validate(`plugin-v${pluginVersion}`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::')
  })

  test('does not match dots in the version as regex wildcards', () => {
    writeFileSync(join(root, 'CHANGELOG.md'), '## [0x2x0-rcx4]\nWrong version.\n')
    expect(validate(`plugin-v${pluginVersion}`).status).toBe(1)
  })

  test('rejects an unknown tag prefix', () => {
    const result = validate(`other-v${pluginVersion}`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::Unknown release tag')
  })

  test.each([
    ['0.20.0-rc.0', 1, ''],
    ['0.20.0', 1, ''],
    ['0.20.0-next.0', 0, 'NPM_TAG=next\n'],
  ])('Payload 4 line %s publishes only under next', (version, status, output) => {
    writeFileSync(join(root, 'packages/plugin/package.json'), JSON.stringify({ version }))
    writeFileSync(join(root, 'CHANGELOG.md'), `## [${version}]\n${notes}`)
    const result = validate(`plugin-v${version}`)
    expect(result.status, result.stderr).toBe(status)
    expect(result.stdout).toContain(output)
    if (status) expect(result.stderr).toContain('Payload 4 line')
  })

  test.each([
    '### stats\n\n- Stats only.\n\n### plugin\n\n',
    '### plugin\n\n### stats\n\n- Stats only.\n',
    '### stats\n\n- Stats only.\n',
  ])('rejects a shared section without its own non-empty subsection (%j)', body => {
    writeFileSync(join(root, 'CHANGELOG.md'), `## [${pluginVersion}]\n\n${body}`)
    const result = validate(`plugin-v${pluginVersion}`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("no non-empty '### plugin' subsection")
  })

  test('accepts fourth-level subheadings inside the package subsection', () => {
    writeFileSync(join(root, 'CHANGELOG.md'), `## [${pluginVersion}]\n\n### plugin\n\n#### Fixed\n\n- A fix.\n`)
    const result = validate(`plugin-v${pluginVersion}`)
    expect(result.status, result.stderr).toBe(0)
  })

  test('accepts a stable stats tag with latest and no prerelease argument', () => {
    const result = validate(`stats-v${statsVersion}`)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe(
      `PKG=packages/stats\nVER=${statsVersion}\nNPM_TAG=latest\nPRERELEASE_ARG=\n`,
    )
    expect(readFileSync(join(root, 'release-notes.md'), 'utf8')).toBe('\n### stats\n\n- Stable changes.\n')
  })

  test('appends release outputs to GITHUB_ENV when set', () => {
    const githubEnv = join(root, 'github-env')
    writeFileSync(githubEnv, 'EXISTING=value\n')
    const result = validate(`plugin-v${pluginVersion}`, githubEnv)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
    expect(readFileSync(githubEnv, 'utf8')).toBe(
      `EXISTING=value\nPKG=packages/plugin\nVER=${pluginVersion}\nNPM_TAG=rc\nPRERELEASE_ARG=--prerelease\n`,
    )
  })
})

describe('release workflow wiring', () => {
  test('validates before install/build and always supplies release notes', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/publish.yml'), 'utf8')
    const validation = workflow.indexOf('scripts/release/validate-release.sh "$TAG"')
    expect(validation).toBeGreaterThan(-1)
    expect(validation).toBeLessThan(workflow.indexOf('pnpm install --frozen-lockfile'))
    expect(validation).toBeLessThan(workflow.indexOf('pnpm build'))
    expect(workflow).toContain('npm publish "$TARBALL" --access public --provenance --tag "$NPM_TAG"')
    expect(workflow).not.toContain('NPM_TAG=next')
    expect(workflow).toContain('gh release create "$TAG" --notes-file release-notes.md $PRERELEASE_ARG --generate-notes')
  })

  test('runs push CI for both release lines', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')
    expect(workflow).toMatch(/push:\s*\n\s+branches: \[main, payload-4\]/)
  })
})
