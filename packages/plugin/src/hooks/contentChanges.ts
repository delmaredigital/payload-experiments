import type { CollectionAfterChangeHook } from 'payload'

// Installed on host collections: never throws (spec §7.1, §13 "LMS B3 H1").
// CORE-12 records the content-change marker; until then the hook passes the document through.
export const contentChangesHook: CollectionAfterChangeHook = ({ doc }) => doc
