'use client'
import type { ReactNode } from 'react'
import type { PageCollection } from './pagePicker.model.js'
import { PAGE_COPY as C, openCollectionCopy, openOriginalCopy } from '../../copy/pages.js'

export function CopyRoute({ collection, children }: { collection: PageCollection; children?: ReactNode }) {
  const link = <a href={collection.copyUrl} target="_blank" rel="noopener">{collection.copyLabel ?? openCollectionCopy(collection.label)}</a>
  return <div className="xp-copy-route">
    {/* ADM-L4a2 puts Duplicate the Original here, with the manual route in a disclosure below. Empty means no space in 0.4.0. */}
    <div className="xp-copy-route-action" />
    {collection.copyHint ? <><p>{collection.copyHint}{' '}{link}</p><p>{C.ownAddress}</p></> : <ol>
      <li>{openOriginalCopy(collection.label)}{' '}{link}</li><li>{C.duplicateStep}</li><li>{C.ownAddress}</li>
    </ol>}
    <p>{C.thenChoose}</p>{children}
  </div>
}
