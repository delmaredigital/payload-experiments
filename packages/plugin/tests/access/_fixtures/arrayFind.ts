export {}
const values = ['one', 'two']
declare const predicate: (value: string) => boolean
values.find(predicate)
