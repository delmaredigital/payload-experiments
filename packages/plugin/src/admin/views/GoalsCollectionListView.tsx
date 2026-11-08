import type { ListViewServerProps } from 'payload'
import { renderCollectionList } from './renderCollectionList.js'

export async function GoalsCollectionListView(props: ListViewServerProps) {
  return renderCollectionList(props, 'goals')
}
