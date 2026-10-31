export {}
declare const receiver: any
const dbAlias = receiver.db
const { db } = receiver
const { db: renamed } = receiver
function read({ db: parameter }: any) { return parameter }
receiver['db']
let assigned: any
;({ db: assigned } = receiver)
void [dbAlias, db, renamed, read]
