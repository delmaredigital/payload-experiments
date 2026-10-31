export {}
declare const payload: any
declare const k: string
payload.find({ overrideAccess: false, [k]: true })
payload.find({ overrideAccess: false, ['override' + 'Access']: true })
// @ts-expect-error Intentional duplicate key reproduces the access-gate evasion.
payload.find({ overrideAccess: false, [`overrideAccess`]: true })
