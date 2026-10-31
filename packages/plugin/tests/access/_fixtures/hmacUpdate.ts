import { createHmac } from 'node:crypto'
createHmac('sha256', 'fixture-only').update('message')
