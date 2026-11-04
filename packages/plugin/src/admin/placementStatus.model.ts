import type { PageTestStatus } from '../types/endpoints.js'

export function pageStatusCopy(test: PageTestStatus): string | null {
  if (test.pagesReleased) return null
  const winner = `${test.winnerLabel ?? 'the winner'}${test.winnerTitle ? ` (${test.winnerTitle})` : ''}`
  switch (test.status) {
    case 'draft': return `This page is ${test.armLabel} in the draft test ${test.name}.`
    case 'stopped': {
      const visitors = test.role === 'original' ? 'Visitors see this page.' : !test.originalPath ? 'Visitors see the Original.'
        : `Visitors to ${test.originalPath === '/' ? 'the homepage (/)' : test.originalPath} see the Original.`
      return `This page is ${test.armLabel} in the stopped test ${test.name}. ${visitors}`
    }
    case 'running': return `This page is the ${test.armLabel} of a running test: ${test.name}.`
    case 'decided': return `This page is ${test.armLabel} of a decided test; ${test.rollout ? `most visitors see ${winner}; a holdout still sees the Original` : `visitors see ${winner}`}.`
    case 'archived': return test.winner
      ? `This page is also shown at the other versions' addresses because test ${test.name} made it the winner. To free it, open the test and choose "Release pages".`
      : test.role === 'original'
        ? `This page's address now shows the winner of test ${test.name}. To free it, open the test and choose "Release pages".`
        : `This page's address now shows ${winner}. To show this page again, open the test and choose "Release pages".`
  }
}
