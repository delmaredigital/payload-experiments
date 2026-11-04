'use client'
import { formatAdminURL } from 'payload/shared'
import { SURFACE_COPY } from '../../copy/surface.js'
import type { SectionProps } from '../contracts.js'
import { readinessParts } from '../readiness/parts.js'
import { statusPill } from '../../status.model.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { TestName } from './fields.js'

export function TestHeader({ test, surface, resultsVersion }: SectionProps) {
  const doc = test.doc
  if (!doc) return null
  const pill = statusPill({ status: doc.status, arms: doc.arms, decision: doc.decision as Parameters<typeof statusPill>[0]['decision'] })
  return <header className="xp-test-header">
    <TestName test={test} surface={surface} />
    <div className="xp-header-meta"><span className="xp-kind-chip">{C.kinds[doc.kind]}</span>
      <span className={`xp-status-pill xp-status-pill--${pill.tone}`} title={pill.tooltip}>{pill.label}</span>
      <readinessParts.SaveStatus test={test} />
      <a href={formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/${encodeURIComponent(String(doc.id))}` })}>{SURFACE_COPY.backToSetup}</a></div>
    <readinessParts.Banner test={test} surface={surface} resultsVersion={resultsVersion} />
  </header>
}
