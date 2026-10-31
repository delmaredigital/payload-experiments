export {}
declare const someClient: { find(options: { collection: string }): void }
someClient.find({ collection: 'x' })
