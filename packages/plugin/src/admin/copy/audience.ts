export const WHO_COPY = { emptyListNote: "Add at least one value — an empty list can't be saved." } as const

export const STRING_OP_LABELS = { eq: 'is', neq: 'is not', in: 'is one of', nin: 'is not one of', contains: 'contains' } as const
export const NUMBER_OP_LABELS = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' } as const

export const participation = (allocation: string, people: string, groups: string) => `${allocation}% of ${people} take part: about ${groups}`
export const eachVersion = (share: string) => `${share}% see each version`
export const groupShare = (share: string, label: string) => `${share}% see ${label === 'Original' ? 'the Original' : label}`
export const uncounted = '; the rest see the Original and are not counted'
export const holdoutClause = (weight: string) => `; the holdout (${weight}% of them) sees the Original and is measured; everyone else sees the Original and is not counted.`
export const layerSentence = (name: string, used: number, free: number) => ` Uses ${used} of the 100 slices in layer ${name}; ${free} are free.`
export const peopleLabel = { visitor: 'visitors', user: 'signed-in users' } as const
