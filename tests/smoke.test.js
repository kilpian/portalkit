import { chromium } from 'playwright'

const BASE_URL = 'http://localhost:5175'

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

  // Test 1: Landing page loads
  await test('Landing page loads', async () => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
  })

  // Test 2: Signin page loads
  await test('Signin page loads', async () => {
    await page.goto(`${BASE_URL}/signin`)
    await page.waitForSelector('input[type="email"]', { timeout: 5000 })
  })

  // Test 3: Dashboard redirects when not logged in
  await test('Dashboard redirects to signin when not logged in', async () => {
    await page.goto(`${BASE_URL}/dashboard`)
    await page.waitForURL('**/signin**', { timeout: 5000 })
  })

  // Test 4: Backend health check
  await test('Backend API is reachable', async () => {
    const response = await page.request.get('http://localhost:3001/api/health')
    const data = await response.json()
    if (data.status !== 'ok') throw new Error('Health check failed')
  })

  // Test 5: Portal page loads with valid token
  await test('Client portal loads', async () => {
    await page.goto(`${BASE_URL}/portal/test-token`)
    await page.waitForLoadState('networkidle')
    const content = await page.content()
    if (!content.includes('portal') && !content.includes('Portal')) {
      throw new Error('Portal page not rendering')
    }
  })

  await browser.close()

  console.log('\n=== TEST RESULTS ===')
  results.forEach(r => console.log(`${r.status}: ${r.name}${r.error ? ` (${r.error})` : ''}`))
  const passed = results.filter(r => r.status.includes('PASS')).length
  console.log(`\n${passed}/${results.length} tests passed`)
}

runTests().catch(console.error)
