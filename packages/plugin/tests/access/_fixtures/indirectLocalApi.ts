export {}
declare const payload: any
declare const options: any
declare const m: string
payload.find.call(payload, options)
payload.find.apply(payload, [options])
const bound = payload.find.bind(payload)
bound(options)
Reflect.apply(payload.find, payload, [options])
payload[`find`]({ overrideAccess: false })
payload[m]({ overrideAccess: false })
const computed = payload[m]
computed(options)
;(payload[m] as any)(options)
const alias = payload.find
alias(options)
let assigned: any
assigned = payload.find
assigned(options)
;(payload.find satisfies Function)(options)
;(payload.find as any)(options)
const { find } = payload
find.call(payload, options)
