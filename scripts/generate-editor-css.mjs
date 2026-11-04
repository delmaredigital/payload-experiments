import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const src = join(root, 'packages/plugin/src')
const require = createRequire(join(src, 'options.ts'))
const entry = require.resolve('@payloadcms/ui')
const dist = entry.slice(0, entry.lastIndexOf('/dist/') + 5)
const declarations = source => Object.fromEntries([...source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim().replace(/\s+/g, ' ')]))
function resolve(value, variables, stack = []) {
  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => {
    if (!(name in variables) || stack.includes(name)) throw new Error(`Unresolved or cyclic CSS token ${[...stack, name].join(' -> ')}`)
    return resolve(variables[name], variables, [...stack, name])
  })
}
/** Resolve the installed reference palette, without compiling or hardcoding its snapshot. */
export function referencePalette(mode) {
  const colors = readFileSync(join(dist, 'scss/colors.scss'), 'utf8')
  const app = readFileSync(join(dist, 'scss/app.scss'), 'utf8')
  const split = colors.indexOf("html[data-theme='dark']")
  const variables = declarations(colors.slice(0, split))
  Object.assign(variables, declarations(app.slice(app.indexOf(':root'), app.indexOf('// --z-popup'))))
  if (mode === 'dark') {
    Object.assign(variables, declarations(colors.slice(split)))
    const dark = app.match(/&\[data-theme='dark'\]\s*\{([^}]+)/)?.[1]
    Object.assign(variables, declarations(dark ?? ''))
  }
  return variables
}
/** All new and compatibility tokens, recursively reduced to literal values. */
export function resolvedTokens(mode) {
  const theme = readFileSync(join(src, 'admin/theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const split = theme.indexOf('[data-theme="dark"]')
  const tokens = declarations(theme.slice(0, split))
  if (mode === 'dark') Object.assign(tokens, declarations(theme.slice(split)))
  const variables = { ...referencePalette(mode), ...tokens }
  return Object.fromEntries(Object.entries(tokens).map(([name, value]) => [name, resolve(value, variables)]))
}
const block = (selector, mode) => `${selector} {\n${Object.entries(resolvedTokens(mode)).map(([name, value]) => `  ${name}: ${value};`).join('\n')}\n}\n`
export function generateEditorCss() {
  return '/* generated — do not edit. Run pnpm generate:editor-css. Reference: Payload 3.90.2. */\n'
    + block('.xp-slot-root', 'light') + '\n' + block("[data-theme='dark'] .xp-slot-root,\n.dark .xp-slot-root", 'dark')
    + '\n' + readFileSync(join(src, 'ui/ui.css'), 'utf8') + '\n' + readFileSync(join(src, 'puck/editor/editor.chrome.css'), 'utf8')
}
/** The sidebar lives in the host document, outside the canvas token scope. */
export function generateFieldCss() {
  // Nest the shared rules so no selector can affect UI outside the field.
  const ui = readFileSync(join(src, 'ui/ui.css'), 'utf8')
  return '/* generated — do not edit. Run pnpm generate:editor-css. Reference: Payload 3.90.2. */\n'
    + block('.xp-puck-field', 'light') + '\n' + block("[data-theme='dark'] .xp-puck-field", 'dark')
    + '\n.xp-puck-field {\n' + ui + '\n}\n'
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(join(src, 'puck/editor/editor.css'), generateEditorCss())
  writeFileSync(join(src, 'puck/field.css'), generateFieldCss())
}
