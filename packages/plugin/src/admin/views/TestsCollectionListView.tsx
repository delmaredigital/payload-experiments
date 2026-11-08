import type { ListViewServerProps } from 'payload'
import { renderCollectionList } from './renderCollectionList.js'

export async function TestsCollectionListView(props: ListViewServerProps) {
  return renderCollectionList(props, 'home')
}
