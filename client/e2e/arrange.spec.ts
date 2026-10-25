import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'

// Contact icons and drag-to-position on desktop. Fake person for tests only.
const RESUME_TXT = `ARJUN DEMO
Backend Developer
Bengaluru, India | +91 90000 11111 | arjun.demo@example.com | linkedin.com/in/arjun-demo | github.com/arjun-demo

SUMMARY
Backend developer with 2 years of experience building REST APIs with Node.js, Express and MongoDB.

EXPERIENCE
Software Developer | Demo Logistics
Jul 2023 - Present
• Built REST APIs in Node.js and Express serving 20,000 daily shipments
• Reduced report generation time by 60% using MongoDB aggregation pipelines

EDUCATION
B.Tech in Information Technology, Demo Institute of Technology
2019 - 2023
`

async function importResume(page: Page) {
  await page.goto('/register')
  await page.getByLabel('Full name').fill('Arjun Demo')
  await page.getByLabel('Email').fill(`e2e-arrange-${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!')
  await page.getByLabel('Confirm password').fill('Passw0rd!')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  await page.getByRole('link', { name: 'Upload', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'arjun-resume.txt', mimeType: 'text/plain', buffer: Buffer.from(RESUME_TXT) })
  await page.getByRole('button', { name: /Import my resume/i }).click()
  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
  await page.getByRole('button', { name: /Save resume/i }).click()
  await expect(page).toHaveURL(/\/resumes\/[a-f0-9]{24}/)
  await expect(page.getByText('All changes saved')).toBeVisible()
}

test('contact icons are clickable and any block can be dragged into place', async ({ page }) => {
  await importResume(page)

  await page.getByRole('radiogroup', { name: 'Contact links' }).getByRole('radio', { name: 'Badges' }).click()
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })

  // With a mouse, dragging is on from the start.
  await expect(page.getByRole('button', { name: 'Done moving' })).toHaveAttribute('aria-pressed', 'true')
  const name = page.getByRole('button', { name: 'Move Name' })
  await expect(name).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Move LinkedIn icon' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Move Work Experience section' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Move Bullet: Built REST APIs/ })).toBeVisible()

  // Drag the name 60px right and 20px down; after the re-render it stays there.
  const before = (await name.boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2 + 10, { steps: 4 })
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 20, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Reset all positions (1)' })).toBeVisible()
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  await expect.poll(async () => Math.round((await name.boundingBox())!.x - before.x), { timeout: 10_000 }).toBeGreaterThanOrEqual(58)
  const after = (await name.boundingBox())!
  expect(Math.abs(after.x - before.x - 60)).toBeLessThan(3)
  expect(Math.abs(after.y - before.y - 20)).toBeLessThan(3)

  // Arrow keys nudge the selected block; Reset on its tag puts it back.
  await name.focus()
  await page.keyboard.press('Shift+ArrowDown')
  await expect.poll(async () => Math.round((await name.boundingBox())!.y - after.y), { timeout: 10_000 }).toBeGreaterThan(3)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByRole('button', { name: /Reset all positions/ })).toHaveCount(0)
  await expect.poll(async () => Math.round((await name.boundingBox())!.x - before.x), { timeout: 10_000 }).toBe(0)

  // Move a whole section by its heading, then check it survives a reload.
  const section = page.getByRole('button', { name: 'Move Education section' })
  await section.scrollIntoViewIfNeeded()
  const s = (await section.boundingBox())!
  await page.mouse.move(s.x + 30, s.y + 6)
  await page.mouse.down()
  await page.mouse.move(s.x + 30, s.y + 46, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('button', { name: 'Reset all positions (1)' })).toBeVisible()
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/arrange.png`, fullPage: true })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Reset all positions (1)' })).toBeVisible()

  // The downloaded PDF carries the links behind the icons.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'PDF' }).click()])
  const pdf = fs.readFileSync((await download.path())!).toString('latin1')
  expect(pdf).toContain('https://linkedin.com/in/arjun-demo')
  expect(pdf).toContain('https://github.com/arjun-demo')
  expect(pdf).toContain('mailto:arjun.demo@example.com')

  // Dropping one line on another swaps them instead of stacking them: bullets, then whole sections.
  const dragOnto = async (from: string | RegExp, to: string | RegExp) => {
    await page.getByRole('button', { name: from }).scrollIntoViewIfNeeded()
    const a = (await page.getByRole('button', { name: from }).boundingBox())!
    const b = (await page.getByRole('button', { name: to }).boundingBox())!
    // Grab near the top: on a section that is its heading (its entries sit on top of the rest).
    await page.mouse.move(a.x + 20, a.y + Math.min(a.height / 2, 6))
    await page.mouse.down()
    await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 8 })
    await expect(page.locator('.pdf-block.is-drop-target')).toHaveCount(1)
    await page.mouse.up()
  }
  await dragOnto(/Move Bullet: Built REST APIs/, /Move Bullet: Reduced report/)
  await expect(page.getByLabel('Achievements bullet 1')).toHaveValue(/^Reduced report generation/)
  await expect(page.getByLabel('Achievements bullet 2')).toHaveValue(/^Built REST APIs/)
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  const top = async (name: string | RegExp) => (await page.getByRole('button', { name }).boundingBox())!.y
  await expect.poll(async () => (await top(/Move Bullet: Reduced report/)) < (await top(/Move Bullet: Built REST APIs/)), { timeout: 10_000 }).toBe(true)

  await page.getByRole('button', { name: /Reset all positions/ }).click()
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  await dragOnto('Move Education section', 'Move Work Experience section')
  await expect.poll(async () => (await top('Move Education section')) < (await top('Move Work Experience section')), { timeout: 10_000 }).toBe(true)
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/swapped.png` })
  const [again] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'DOCX' }).click()])
  expect(again.suggestedFilename()).toMatch(/\.docx$/)

})
