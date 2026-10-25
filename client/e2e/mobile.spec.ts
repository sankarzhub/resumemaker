import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Runs at phone size (see the "mobile" project in playwright.config.ts). Fake person for tests only.
const RESUME_TXT = `ARJUN DEMO
Backend Developer
Bengaluru, India | +91 90000 11111 | arjun.demo@example.com

EXPERIENCE
Software Developer | Demo Logistics
Jul 2023 - Present
- Built REST APIs in Node.js and Express serving 20,000 daily shipments for partner teams across three regions
- Reduced report generation time by 60% using MongoDB aggregation pipelines

EDUCATION
B.Tech in Information Technology, Demo Institute of Technology
2019 - 2023

SKILLS
JavaScript, TypeScript, Node.js, Express, MongoDB
`

const LINKEDIN_TXT = `Contact
arjun.demo@example.com
www.linkedin.com/in/arjun-demo (LinkedIn)
Top Skills
GraphQL
Arjun Demo
Backend Developer
Experience
Demo Logistics
Software Developer
August 2023 - Present (1 year 3 months)
Designed a shipment tracking service handling 1M events per day.
Page 1 of 1
`

const SHOTS = process.env.E2E_SHOTS_DIR

/** Phone checks for whatever is on screen: no sideways scroll, no iOS focus zoom, finger-sized controls. */
async function auditMobile(page: Page, name: string) {
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `mobile-${name}.png`), fullPage: true })
  }
  const report = await page.evaluate(() => {
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const label = (el: Element) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40)
    const fields = [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select')]
      .filter(visible)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map(label)
    const small = [...document.querySelectorAll('button, a.btn, [role=tab]')]
      .filter(visible)
      .filter((el) => el.getBoundingClientRect().height < 40)
      .map((el) => `${label(el)} (${Math.round(el.getBoundingClientRect().height)}px)`)
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, fields, small }
  })
  expect.soft(report.overflow, `${name}: page scrolls sideways`).toBeLessThanOrEqual(0)
  expect.soft(report.fields, `${name}: inputs under 16px make iOS zoom on focus`).toEqual([])
  expect.soft(report.small, `${name}: controls shorter than 40px`).toEqual([])
}

test('the whole flow works at phone size', async ({ page }) => {
  await page.goto('/login')
  await auditMobile(page, 'login')
  await page.goto('/register')
  await auditMobile(page, 'register')
  await page.getByLabel('Full name').fill('Arjun Demo')
  await page.getByLabel('Email').fill(`e2e-mobile-${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!')
  await page.getByLabel('Confirm password').fill('Passw0rd!')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await auditMobile(page, 'dashboard')

  // Header icons have names even though their text is hidden on phones.
  await expect(page.getByRole('link', { name: 'Upload', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible()

  await page.getByRole('link', { name: 'Upload', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles([
    { name: 'arjun-resume.txt', mimeType: 'text/plain', buffer: Buffer.from(RESUME_TXT) },
    { name: 'linkedin-profile.txt', mimeType: 'text/plain', buffer: Buffer.from(LINKEDIN_TXT) },
  ])
  await page.getByLabel('Document type for arjun-resume.txt').selectOption('resume')
  await auditMobile(page, 'import')
  await page.getByRole('button', { name: /Merge 2 documents/i }).click()
  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
  await expect(page.getByText('Needs your choice')).toBeVisible()
  await auditMobile(page, 'review-conflict')

  await page.getByRole('radio', { name: /Aug 2023/ }).click()
  await expect(page.getByText('All differences confirmed')).toBeVisible()

  // The preview sits under the form on phones; the floating button jumps there and back.
  const y = await page.evaluate(() => window.scrollY)
  await page.getByRole('button', { name: 'Preview' }).click()
  await expect(page.locator('#live-preview')).toBeInViewport()
  await page.getByRole('button', { name: 'Back to editing' }).click()
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(Math.round(y))

  await page.getByRole('button', { name: /Save resume/i }).click()
  await expect(page).toHaveURL(/\/resumes\//)
  await expect(page.getByText('All changes saved')).toBeVisible()
  await auditMobile(page, 'editor')

  // Bullets grow to show their whole text instead of clipping it.
  const bullets = page.getByLabel(/Achievements bullet \d+/)
  await expect(bullets.first()).toBeVisible()
  for (const b of await bullets.all()) {
    const { client, scroll } = await b.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
    expect(scroll).toBeLessThanOrEqual(client + 1)
  }

  for (const tab of [/ATS check/i, /Job match/i, /AI boost/i]) {
    await page.getByRole('tab', { name: tab }).click()
    await auditMobile(page, `editor-${String(tab).replace(/\W+/g, '-')}`)
  }
})

test('on a phone, press-and-hold drags a block and a quick swipe still scrolls', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Full name').fill('Arjun Demo')
  await page.getByLabel('Email').fill(`e2e-mobile-drag-${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!')
  await page.getByLabel('Confirm password').fill('Passw0rd!')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await page.getByRole('link', { name: 'Upload', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'arjun-resume.txt', mimeType: 'text/plain', buffer: Buffer.from(RESUME_TXT) })
  await page.getByRole('button', { name: /Import my resume/i }).click()
  await page.getByRole('button', { name: /Save resume/i }).click()
  await expect(page.getByText('All changes saved')).toBeVisible()

  await page.getByRole('button', { name: 'Preview' }).click()
  await page.getByRole('radiogroup', { name: 'Contact links' }).getByRole('radio', { name: 'Icons + text' }).click()
  await page.getByRole('button', { name: 'Move items' }).click()
  await auditMobile(page, 'arrange')
  const block = page.getByRole('button', { name: /Move Experience: Software Developer/ })
  await block.scrollIntoViewIfNeeded()
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })

  // A quick swipe over a block scrolls the page and moves nothing.
  let b = (await block.boundingBox())!
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await touch('touchStart', b.x + 40, b.y + 10)
  for (let i = 1; i <= 6; i++) await touch('touchMove', b.x + 40, b.y + 10 - i * 15)
  await touch('touchEnd', 0, 0)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore + 40)
  await expect(page.getByRole('button', { name: /Reset all positions/ })).toHaveCount(0)

  // Press and hold, then drag: the entry moves.
  await block.scrollIntoViewIfNeeded()
  b = (await block.boundingBox())!
  await touch('touchStart', b.x + 40, b.y + 10)
  await page.waitForTimeout(450)
  for (let i = 1; i <= 6; i++) await touch('touchMove', b.x + 40 + i * 3, b.y + 10 + i * 5)
  await touch('touchEnd', 0, 0)
  await expect(page.getByRole('button', { name: 'Reset all positions (1)' })).toBeVisible()
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  await auditMobile(page, 'arranged')
})
