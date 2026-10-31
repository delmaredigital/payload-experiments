export {}
declare const payload: any
declare const overrideAccess: boolean
declare const flag: boolean
declare const req: any
payload.find({ overrideAccess })
payload.find({ overrideAccess: flag })
payload.find({ overrideAccess: !0 })
payload.find({ overrideAccess: req.context.trusted })
payload.find({ get overrideAccess() { return true } })
payload.find({ overrideAccess: 0 })
