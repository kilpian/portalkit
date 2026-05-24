import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5175'
const API_URL = 'http://localhost:3001'

async function runTests() {
  const browser = await chromium.launch({ headless: false })
  const page = await browser.newPage()
  const results = []

  async function test(name, fn) {
    try {
      await fn()
      results.push({ name, status: '✅ PASS' })
      console.log(`✅ PASS: ${name}`)
    } catch (err) {
      results.push({ name, status: '❌ FAIL', error: err.message })
      console.log(`❌ FAIL: ${name} — ${err.message}`)
    }
  }

  // ── CORE TESTS ──────────────────────────────────────────────

  await test('Landing page loads', async () => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
  })

  await test('Signin page loads', async () => {
    await page.goto(`${BASE_URL}/signin`)
    await page.waitForSelector('input[type="email"]', { timeout: 5000 })
  })

  await test('Dashboard redirects to signin when not logged in', async () => {
    await page.goto(`${BASE_URL}/dashboard`)
    await page.waitForURL('**/signin**', { timeout: 5000 })
  })

  await test('Backend API is reachable', async () => {
    const response = await page.request.get(`${API_URL}/api/health`)
    const data = await response.json()
    if (data.status !== 'ok') throw new Error('Health check failed')
  })

  await test('Client portal loads', async () => {
    await page.goto(`${BASE_URL}/portal/test-token`)
    await page.waitForLoadState('networkidle')
    const content = await page.content()
    if (!content.includes('portal') && !content.includes('Portal')) {
      throw new Error('Portal page not rendering')
    }
  })

  // ── SECURITY TESTS ──────────────────────────────────────────

  await test('API rejects unauthenticated /api/clients', async () => {
    const response = await page.request.get(`${API_URL}/api/clients`)
    if (response.status() !== 401) throw new Error(`Expected 401, got ${response.status()}`)
  })

  await test('API rejects unauthenticated /api/contracts', async () => {
    const response = await page.request.get(`${API_URL}/api/contracts`)
    if (response.status() !== 401) throw new Error(`Expected 401, got ${response.status()}`)
  })

  await test('API rejects unauthenticated /api/invoices', async () => {
    const response = await page.request.get(`${API_URL}/api/invoices`)
    if (response.status() !== 401) throw new Error(`Expected 401, got ${response.status()}`)
  })

  await test('API rejects unauthenticated /api/files', async () => {
    const response = await page.request.get(`${API_URL}/api/files`)
    if (response.status() !== 401) throw new Error(`Expected 401, got ${response.status()}`)
  })

  await test('API rejects unauthenticated /api/messages', async () => {
    const response = await page.request.get(`${API_URL}/api/messages?client_id=1`)
    if (response.status() !== 401) throw new Error(`Expected 401, got ${response.status()}`)
  })

  await test('XSS: Script tags in portal token do not execute', async () => {
    const dialogs = []
    page.once('dialog', d => { dialogs.push(d); d.dismiss() })
    await page.goto(`${BASE_URL}/portal/%3Cscript%3Ealert(1)%3C%2Fscript%3E`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    if (dialogs.length > 0) throw new Error('XSS vulnerability: dialog appeared')
  })

  await test('Invalid portal token returns 404 not data', async () => {
    const response = await page.request.get(`${API_URL}/api/portals/INVALID_TOKEN_XYZ_12345`)
    if (response.status() === 200) throw new Error('Should not return 200 for invalid token')
  })

  // ── PERFORMANCE TEST ────────────────────────────────────────

  await test('Landing page loads in under 3 seconds', async () => {
    const start = Date.now()
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    const duration = Date.now() - start
    if (duration > 3000) throw new Error(`Too slow: ${duration}ms`)
  })

  await browser.close()

  console.log('\n=== TEST RESULTS ===')
  results.forEach(r => console.log(`${r.status}: ${r.name}${r.error ? ` (${r.error})` : ''}`))
  const passed = results.filter(r => r.status.includes('PASS')).length
  console.log(`\n${passed}/${results.length} tests passed`)
}

runTests().catch(console.error)
