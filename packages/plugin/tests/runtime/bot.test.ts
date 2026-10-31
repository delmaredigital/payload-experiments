import { expect, test } from 'vitest'
import { isBot } from '../../src/runtime/bot.js'

test.each(['Googlebot/2.1', 'bingbot', 'DuckDuckBot', 'Baiduspider', 'YandexBot', 'Slurp', 'facebookexternalhit/1.1', 'Twitterbot', 'Google-InspectionTool', 'HeadlessChrome', 'Lighthouse', 'UptimeRobot'])('built-in bot UA: %s', ua => {
  expect(isBot(ua)).toBe(true)
})
test.each([undefined, null, '', 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1', 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36'])('ordinary or missing UA: %s', ua => {
  expect(isBot(ua)).toBe(false)
})
