export const PAGE_COPY = {
  more: 'More', loading: 'Loading pages…', empty: 'There are no pages here yet.',
  error: "Couldn't load pages. Try again.", retry: 'Try again', draft: 'Draft', noPath: 'This page has no address yet.',
  choose: 'Choose a page', where: 'Where it shows', open: 'Open', preview: 'Preview',
  contentChecksOff: 'Content checks are off for this page type.',
  duplicateStep: "Choose Duplicate from the document's actions. Keep the Original's title on the copy, unless the title is what you're testing.",
  ownAddress: "Give the copy its own address and save it as a draft. Publish it when it's ready; the test can't start until it is.",
  thenChoose: 'Then choose the page you made.',
} as const
export const usedPageCopy = (label: string) => `This is ${label}.`
export const usedAddressCopy = (label: string, path: string, collection: string) => `Same address as ${label} (${path}). Change this page's address in ${collection}, publish it, then choose it.`
export const openOriginalCopy = (collection: string) => `Open the Original in ${collection}.`
export const openCollectionCopy = (collection: string) => `Open ${collection}`
export const pageStepCopy = (label: string) => `A page for ${label}`

export const pageNotFoundCopy = (path: string, collection: string) => `${path} isn't in ${collection}. Choose a page.`
export const pageFieldCopy = (label: string) => `Page for ${label}`
