export type ManagePermissions = {
  collections?: { 'xp-experiments'?: { update?: boolean | { permission?: boolean } } }
}
export function canManage(permissions: ManagePermissions | null | undefined): boolean {
  const update = permissions?.collections?.['xp-experiments']?.update
  return update === true || (typeof update === 'object' && update !== null && update.permission === true)
}
