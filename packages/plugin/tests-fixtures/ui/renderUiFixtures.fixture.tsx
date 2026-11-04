// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { Button } from '../../src/ui/Button.js'
import { TextInput, NumberInput, SearchInput, Select, Toggle, Textarea, Checkbox, CheckboxList, Range } from '../../src/ui/Inputs.js'
import { ChipsInput } from '../../src/ui/ChipsInput.js'
import { Card, SectionCard } from '../../src/ui/Card.js'
import { Tabs } from '../../src/ui/Tabs.js'
import { StatusChip, statusLabels } from '../../src/ui/Feedback.js'
import { Banner, EmptyState } from '../../src/ui/Feedback.js'
import { Dialog } from '../../src/ui/Dialog.js'
import { Breadcrumb } from '../../src/ui/Breadcrumb.js'
import { accentStyles } from '../../src/ui/accent.js'
const require = createRequire(import.meta.url)
const entry = require.resolve('@payloadcms/ui')
const payloadCss = join(entry.slice(0, entry.lastIndexOf('/dist/') + 5), 'styles.css')
const adminCss = require.resolve('@payloadcms/next/css')
const src = join(dirname(fileURLToPath(import.meta.url)), '../../src')
const noop = () => {}
function Group({ title, children }: { title: string; children: ReactNode }) { return <section className="fixture-group"><h2>{title}</h2><div className="fixture-items">{children}</div></section> }
function Primitives() {
  return <>
    <Group title="Breadcrumb"><Breadcrumb items={[{ label: 'Tests', href: '#' }, { label: 'Registration donation ask' }]} /></Group>
    <Group title="Buttons">{(['primary', 'secondary', 'quiet', 'link', 'danger'] as const).map(variant => (['md', 'sm'] as const).map(size =>
      <div key={`${variant}-${size}`} className="fixture-row"><span>{variant} / {size}</span>
        <Button variant={variant} size={size}>Normal</Button><Button variant={variant} size={size} disabled>Disabled</Button>
        <Button variant={variant} size={size} busy>Saving…</Button><Button variant={variant} size={size} href="#">Link</Button>
        <Button variant={variant} size={size} href="#" disabled>Disabled link</Button></div>))}</Group>
    <Group title="Inputs"><TextInput id="name" label="Name" defaultValue="Registration donation ask" help="A name your team recognises." />
      <TextInput id="error" label="Name with error" defaultValue="" error="Give this test a name." />
      <TextInput id="disabled" label="Disabled input" defaultValue="Registration donation ask" disabled />
      <TextInput id="readonly" label="Read-only input" value="registration-donation" readOnly />
      <NumberInput id="number" label="Share of people" defaultValue={50} help="A percentage from 1 to 100." />
      <SearchInput id="search" label="Search tests" placeholder="Search tests" />
      <Select id="goal" label="Goal" help="Choose what counts as a win." defaultValue="donation"><option value="donation">Donation completed</option><option value="register">Registration completed</option></Select>
      <Select id="goal-error" label="Goal with error" error="Choose a goal."><option>Choose a goal</option></Select>
      <Toggle id="toggle-on" label="Toggle on" defaultChecked /><Toggle id="toggle-off" label="Toggle off" />
      <Toggle id="toggle-disabled" label="Toggle disabled" defaultChecked disabled />
      <ChipsInput id="chips" label="Page paths" value={['/registration', '/thank-you']} onChange={noop} description="Add one value per chip." placeholder="Type a value and press Enter" />
      <ChipsInput id="chips-error" label="Chips with error" value={[]} onChange={noop} error="Add at least one value." />
      <ChipsInput id="chips-disabled" label="Chips disabled" value={['/registration']} onChange={noop} disabled />
    </Group>
    <Group title="New controls">
      <Textarea id="why" label="Why are you testing this?" defaultValue="We believe a shorter ask will raise donations." help="A sentence for your team." />
      <Textarea id="why-error" label="Notes with error" error="Add a sentence." /><Textarea id="why-disabled" label="Notes disabled" disabled />
      <Checkbox id="include" label="Include this goal" defaultChecked help="Track this alongside the main goal." />
      <Checkbox id="check-error" label="Checkbox with error" error="Choose this option." /><Checkbox id="check-disabled" label="Checkbox disabled" disabled />
      <CheckboxList id="watch" label="Also watch" value={['donation']} options={[{ value: 'donation', label: 'Donation amount' }, { value: 'register', label: 'Registrations' }]} onChange={noop} help="Pick the goals to watch." />
      <Range id="range" label="How many people take part" min={1} max={100} defaultValue={40} help="40% of visitors take part." />
      <Range id="range-error" label="Range with error" error="Choose a share." /><Range id="range-disabled" label="Range disabled" disabled />
    </Group>
    <Group title="Containers"><Card>A plain card.</Card><SectionCard number={1} title="What you're testing" complete>Ready to go.</SectionCard>
      <SectionCard number={2} title="What counts as a win">Choose a goal.</SectionCard>
      <Tabs label="Versions" items={[{ id: 'original', label: 'Original', content: 'Original content.' }, { id: 'variant', label: 'Variant A', content: 'Variant content.' }, { id: 'disabled', label: 'Unavailable', content: '', disabled: true }]} /></Group>
    <Group title="Status chips"><div className="fixture-row">{(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map(status => <StatusChip key={status} status={status} />)}</div></Group>
    <Group title="Feedback">{(['info', 'warning', 'error'] as const).map(tone => <Banner key={tone} tone={tone} action={<Button size="sm">Review</Button>}>{tone}: Check the test before continuing.</Banner>)}
      <EmptyState action={<Button variant="primary">New test</Button>}>Create a test to learn what works.</EmptyState></Group>
  </>
}
function Chrome() { return <div className="xp-slot-chrome"><header className="xp-slot-header"><h2 className="xp-slot-title">Registration donation ask</h2><span className="xp-slot-status" data-status="running">Running</span></header>
  <p className="xp-slot-notice">People see one version.</p><div className="xp-slot-tabs" role="tablist"><button className="xp-slot-tab" role="tab" aria-selected="true">Original</button><button className="xp-slot-tab" role="tab" aria-selected="false">Variant A</button></div>
  <div className="xp-slot-actions"><button className="xp-slot-button xp-slot-button-primary">Set up the test</button><button className="xp-slot-button" disabled>Disabled</button></div>
  <div className="xp-slot-field"><label className="xp-slot-label" htmlFor="chrome-name">Test name</label><input className="xp-slot-input" id="chrome-name" defaultValue="Registration donation ask" /></div></div> }
test('writes the complete UI, accent, dialog and isolated editor fixtures in both themes', () => {
  const output = process.env.XP_FIXTURE_OUT ?? ''
  if (!isAbsolute(output)) throw new Error('XP_FIXTURE_OUT must be an absolute path')
  for (const css of [payloadCss, adminCss]) readFileSync(css)
  mkdirSync(output, { recursive: true })
  const paths: string[] = []
  for (const theme of ['light', 'dark'] as const) for (const kind of ['ui', 'ui-accent', 'ui-accent-limit', 'ui-dialog', 'editor'] as const) {
    const editor = kind === 'editor'
    const links = editor ? [join(src, 'puck/editor/editor.css')] : [adminCss, payloadCss, join(src, 'admin/theme.css'), join(src, 'ui/ui.css')]
    let html = '<!DOCTYPE html>' + renderToStaticMarkup(<html lang="en" data-theme={theme}><head>
      <meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>{kind} — {theme}</title>
      {links.map(path => <link key={path} rel="stylesheet" href={pathToFileURL(path).href} />)}
      {kind.startsWith('ui-accent') ? <style>{accentStyles(kind === 'ui-accent-limit' ? '#3377cc' : '#1f3a68')}</style> : null}
      <style>{`body { margin: 0; } main { box-sizing: border-box; width: 100%; min-width: 0; padding: 32px; background: var(--xp-bg); color: var(--xp-text); font: var(--xp-text-body); min-height: 100vh; } .fixture-group { margin-bottom: 32px; max-width: 960px; } .fixture-group > h2 { font: var(--xp-text-title); margin: 0 0 16px; } .fixture-items { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; } .fixture-hover { background: var(--xp-accent-hover) !important; border-color: var(--xp-accent-hover) !important; } .fixture-active { background: var(--xp-accent-active) !important; border-color: var(--xp-accent-active) !important; } .fixture-row { min-width: 0; max-width: 100%; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }`}</style>
    </head><body><main className={editor ? 'xp-slot-root' : undefined}>{kind === 'ui-dialog'
      ? <Dialog open title="Stop the test?" onClose={noop}><p>Everyone will see the Original.</p><Button>Keep running</Button><Button variant="danger">Stop test</Button></Dialog>
      : <>{editor ? <Chrome /> : null}{kind.startsWith('ui-accent') ? <Group title="Primary button states"><div className="fixture-row"><Button variant="primary">Rest</Button><Button variant="primary" className="fixture-hover">Hover</Button><Button variant="primary" className="fixture-active">Pressed</Button></div></Group> : null}<Primitives /></>}</main></body></html>)
    // Effects do not run in static HTML; show the actual Dialog markup for visual review.
    if (kind === 'ui-dialog') html = html.replace('<dialog ', '<dialog open="" ')
    const path = join(output, `${kind}-${theme}.html`)
    writeFileSync(path, html); paths.push(path)
    if (editor) expect(html).not.toContain('theme.css')
  }
  expect(paths).toHaveLength(10)
  console.log(paths.join('\n'))
})
