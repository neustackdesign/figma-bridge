import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../analytics.js', import.meta.url), 'utf8')
test('Consent Mode v2 defaults denied before GA4 config', () => {
  const defaultAt = src.indexOf("window.gtag('consent', 'default'")
  const configAt = src.indexOf("window.gtag('config', GA_ID)")
  assert.ok(defaultAt !== -1 && configAt > defaultAt)
  assert.match(src, /ad_personalization: 'denied'/)
  assert.match(src, /ad_user_data: 'denied'/)
  assert.match(src, /analytics_storage: 'denied'/)
})
test('One consent decision is shared with Neustack subdomains', () => {
  assert.match(src, /Domain=\.neustackstudio\.com/)
  assert.match(src, /SameSite=Lax/)
  assert.match(src, /Accept analytics/)
  assert.match(src, /Decline/)
  assert.match(src, /window\.gtag\('consent', 'update'/)
})
