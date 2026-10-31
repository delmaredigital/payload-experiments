import { expect, test } from 'vitest'
import { isBot } from '../../src/runtime/bot.js'

test.each(['Googlebot/2.1', 'bingbot', 'DuckDuckBot', 'Baiduspider', 'YandexBot', 'Slurp', 'facebookexternalhit/1.1', 'Twitterbot', 'Google-InspectionTool', 'HeadlessChrome', 'Lighthouse', 'UptimeRobot', 'Pinterestbot/1.0', 'curl/8.10.1', 'Mozilla/5.0 (compatible; AhrefsBot/7.0)', 'GPTBot/1.2', 'ClaudeBot/1.0', 'Amazonbot/0.1', 'MJ12bot/v1.4.8', 'AdsBot-Google', 'PetalBot', 'DotBot/1.2', 'archive.org_bot', 'python-requests/2.32', 'Wget/1.21', 'Go-http-client/2.0'])('built-in bot UA: %s', ua => {
  expect(isBot(ua)).toBe(true)
})
test.each([undefined, null, '', 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1', 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36', 'Mozilla/5.0 (Linux; Android 14; CUBOT X70) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36', 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 [Pinterest/iOS] Pinterest/12.0'])('ordinary or missing UA: %s', ua => {
  expect(isBot(ua)).toBe(false)
})
