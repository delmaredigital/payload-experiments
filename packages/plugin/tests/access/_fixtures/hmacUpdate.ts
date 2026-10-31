import { createHmac } from 'node:crypto'
declare const message: string
createHmac('sha256', 'fixture-only').update(message)
