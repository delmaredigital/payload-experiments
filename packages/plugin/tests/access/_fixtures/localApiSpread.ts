export {}
declare const payload: any
declare const options: any
payload.find({ ...options, overrideAccess: false })
payload.find({ overrideAccess: false, ...options })
