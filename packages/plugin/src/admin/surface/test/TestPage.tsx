'use client'
import type { DocId } from '../../../types/contracts.js'
import type { SurfaceProps } from '../contracts.js'
import { useTestDocument } from '../useTestDocument.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { pageBlockParts } from '../pageBlock/parts.js'
import { settingParts } from '../setting/parts.js'
import { pageParts } from './pageParts.js'
import { TestHeader } from './TestHeader.js'
import { Section } from './Section.js'
import { Hypothesis } from './fields.js'
import { VersionsSection } from './VersionsSection.js'
import { GoalSection } from './GoalSection.js'
import { TargetingSection } from './TargetingSection.js'
import { LengthSection } from './LengthSection.js'
import { AdvancedSection } from './AdvancedSection.js'
import './testPage.css'

export function TestPage({ id, surface }: { id: DocId; surface: SurfaceProps }) {
  const test = useTestDocument(id, { apiRoute: surface.apiRoute })
  if (test.loadState !== 'ready' || !test.doc) return <div className="xp-test-page" role={test.loadState === 'error' ? 'alert' : 'status'}>
    <p>{test.loadState === 'forbidden' ? C.forbidden : test.loadState === 'missing' ? C.missing : test.loadState === 'error' ? C.error : C.loading}</p>
    {test.loadState === 'error' ? <button type="button" onClick={() => void test.reload()}>{C.retry}</button> : null}
  </div>
  const parts = test.doc.kind === 'block' ? pageBlockParts : test.doc.kind === 'page' ? pageParts : settingParts
  const props = { test, surface }
  return <div className="xp-test-page"><TestHeader {...props} />
    {test.errors._section ? <div role="alert"><p>{test.errors._section}</p>
      {test.stale ? <button type="button" onClick={() => void test.reload()}>{C.reload}</button> : null}
    </div> : null}
    {test.preflightError ? <p role="alert">{test.preflightError}</p> : null}
    <Section test={test} sectionId="what"><parts.Binding {...props} /><Hypothesis {...props} /></Section>
    <VersionsSection {...props} parts={parts} /><GoalSection {...props} /><TargetingSection {...props} />
    <LengthSection {...props} /><AdvancedSection {...props} />
  </div>
}
