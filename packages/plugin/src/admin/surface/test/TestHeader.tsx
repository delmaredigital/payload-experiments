'use client'
import { formatAdminURL } from 'payload/shared'
import { SURFACE_COPY } from '../../copy/surface.js'
import type { SectionProps } from '../contracts.js'
import { readinessParts } from '../readiness/parts.js'
import { statusPill } from '../../status.model.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { FieldErrors, reasonFor, save, TextEdit } from './fields.js'

export function TestHeader({ test, surface, resultsVersion, view = 'setup' }: SectionProps & { view?: 'setup' | 'results' }) {
  const doc = test.doc
  if (!doc) return null
  const pill = statusPill({ status: doc.status, arms: doc.arms, decision: doc.decision as Parameters<typeof statusPill>[0]['decision'] })
  return <header className="xp-test-header">
    <TextEdit label={C.name} value={doc.name} reason={reasonFor(test, 'name')} onCommit={value => save(test, 'name', () => ({ name: value }))} />
    <FieldErrors test={test} path="name" />
    {view === 'results' ? <><div className="xp-header-meta"><span className="xp-kind-chip">{C.kinds[doc.kind]}</span>
      <span className={`xp-status-pill xp-status-pill--${pill.tone}`} title={pill.tooltip}>{pill.label}</span>
      <readinessParts.SaveStatus test={test} />
      {view === 'results' ? <a href={formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/${encodeURIComponent(String(doc.id))}` })}>{SURFACE_COPY.backToSetup}</a> : surface.canReadResults && ['running', 'stopped', 'decided'].includes(doc.status)
        ? <a href={`${surface.adminRoute}/experiments/${encodeURIComponent(String(doc.id))}/results`}>{C.results}</a> : null}</div>
    <readinessParts.Banner test={test} surface={surface} resultsVersion={resultsVersion} /></> : null}
  </header>
}
