import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Fake person for tests only.
const RESUME_TXT = `ARJUN DEMO
Backend Developer
Bengaluru, India | +91 90000 11111 | arjun.demo@example.com | github.com/arjun-demo

SUMMARY
Backend developer with 2 years of experience building REST APIs with Node.js, Express and MongoDB.

SKILLS
JavaScript, TypeScript, Node.js, Express, MongoDB, Docker, Git

EXPERIENCE
Software Developer | Demo Logistics
Jul 2023 - Present
• Built REST APIs in Node.js and Express serving 20,000 daily shipments
• Reduced report generation time by 60% using MongoDB aggregation pipelines

EDUCATION
B.Tech in Information Technology, Demo Institute of Technology
2019 - 2023
`

// Same fake person as exported from LinkedIn: one extra role, extra skills and a conflicting start date.
const LINKEDIN_TXT = `Contact
arjun.demo@example.com
www.linkedin.com/in/arjun-demo (LinkedIn)
Top Skills
GraphQL
Redis
Arjun Demo
Backend Developer
Experience
Demo Logistics
Software Developer
August 2023 - Present (1 year 3 months)
Bengaluru, Karnataka, India
Designed a shipment tracking service handling 1M events per day.
Demo Startup
Backend Intern
January 2023 - June 2023 (6 months)
Wrote Node.js scripts to automate invoice reconciliation.
Page 1 of 1
`

const SHOTS = process.env.E2E_SHOTS_DIR

async function shot(page: import('@playwright/test').Page, name: string) {
  if (!SHOTS) return
  fs.mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })
}

test('register → upload → review → save → ATS check → job match → export', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Welcome back!' })).toBeVisible()
  await shot(page, '01-login')

  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.getByLabel('Full name').fill('Arjun Demo')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!')
  await page.getByLabel('Confirm password').fill('Passw0rd!')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByText('No resumes yet!')).toBeVisible()
  await shot(page, '02-dashboard-empty')

  // Upload a TXT resume (AI is disabled in E2E, so the rule-based parser runs).
  await page.getByRole('link', { name: /Upload & transform/i }).click()
  await expect(page.getByRole('heading', { name: /Upload\. Transform\./ })).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: 'arjun.txt', mimeType: 'text/plain', buffer: Buffer.from(RESUME_TXT) })
  await expect(page.getByText('arjun.txt')).toBeVisible()
  await shot(page, '03-upload')
  await page.getByRole('button', { name: /Import my resume/i }).click()

  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
  await expect(page.getByLabel('Full name')).toHaveValue('Arjun Demo')
  await expect(page.getByLabel('Job title', { exact: true }).first()).toHaveValue('Software Developer')
  // The preview is the real export PDF, drawn page by page.
  await expect(page.getByRole('document', { name: 'Exact PDF preview, 1 page' })).toBeVisible()
  await expect(page.getByLabel('Page 1 of 1')).toBeVisible()
  await expect(page.getByText(/^\s*1 page$/)).toBeVisible()
  await shot(page, '04-review')

  await page.getByRole('button', { name: /Save resume/i }).click()
  await expect(page).toHaveURL(/\/resumes\/[a-f0-9]{24}/)
  await expect(page.getByText('All changes saved')).toBeVisible()

  // Edit + autosave
  await page.getByLabel('Location', { exact: true }).first().fill('Bengaluru, Karnataka, India')
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })

  // Make it long enough to spill onto a second page, then fit it back to one.
  for (let i = 0; i < 18; i++) {
    await page.getByRole('button', { name: 'Add bullet' }).first().click()
    await page.getByLabel(/Achievements bullet \d+/).last().fill(`Delivered improvement number ${i + 1} to the shipment tracking platform used by partner teams across regions, working with product, QA and operations to plan, build, test and roll out the change safely with monitoring and documentation`)
  }
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('document', { name: 'Exact PDF preview, 2 pages' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByLabel('Page 2 of 2')).toBeVisible()
  await shot(page, '05-editor-2pages')
  await page.getByLabel(/Fit to one page/).check()
  await expect(page.getByRole('document', { name: 'Exact PDF preview, 1 page' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/1 page \(fitted: /)).toBeVisible()
  await page.getByRole('radio', { name: 'Executive' }).click()
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 })
  await shot(page, '05-editor')

  // ATS check
  await page.getByRole('tab', { name: /ATS check/i }).click()
  await expect(page.getByRole('heading', { name: 'ATS Quality Check' })).toBeVisible()
  await expect(page.getByRole('img', { name: /Estimated score \d+ out of 100/ })).toBeVisible()
  await shot(page, '06-ats')

  // Job match
  await page.getByRole('tab', { name: /Job match/i }).click()
  await page.getByLabel('Job description').fill('Backend Engineer\nRequirements:\n- Node.js and Express\n- MongoDB\n- GraphQL\nNice to have:\n- Kubernetes')
  await page.getByRole('button', { name: /Match my resume/i }).click()
  await expect(page.getByRole('heading', { name: 'Job Match' })).toBeVisible()
  await expect(page.getByText('GraphQL', { exact: true })).toBeVisible()
  await shot(page, '07-job-match')

  // AI tab explains it is disabled rather than showing a dead button
  await page.getByRole('tab', { name: /AI boost/i }).click()
  await expect(page.getByText(/AI is not configured on this server/)).toBeVisible()

  // Export PDF
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'PDF' }).click()])
  expect(download.suggestedFilename()).toBe('Arjun_Demo_Resume.pdf')
  const file = await download.path()
  const bytes = fs.readFileSync(file!)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  // What the preview promised is what was downloaded: one page.
  expect((bytes.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(1)

  // Back on the dashboard the resume card shows up
  await page.getByRole('link', { name: 'Back to dashboard' }).click()
  await expect(page.getByText(/Arjun Demo resume/)).toBeVisible()
  await shot(page, '08-dashboard')

  // Logout protects private pages
  await page.getByRole('button', { name: /Logout/i }).click()
  await expect(page).toHaveURL(/\/login/)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})

test('resume + LinkedIn PDF are merged, and conflicts must be confirmed before saving', async ({ page }) => {
  await page.goto('/register')
  await page.getByLabel('Full name').fill('Arjun Demo')
  await page.getByLabel('Email').fill(`e2e-merge-${Date.now()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill('Passw0rd!')
  await page.getByLabel('Confirm password').fill('Passw0rd!')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/dashboard/)

  await page.goto('/import')
  await page.locator('input[type=file]').setInputFiles([
    { name: 'arjun-resume.txt', mimeType: 'text/plain', buffer: Buffer.from(RESUME_TXT) },
    { name: 'linkedin-profile.txt', mimeType: 'text/plain', buffer: Buffer.from(LINKEDIN_TXT) },
  ])
  await expect(page.getByLabel('Document type for linkedin-profile.txt')).toHaveValue('linkedin')
  await page.getByLabel('Document type for arjun-resume.txt').selectOption('resume')
  await shot(page, '09-multi-upload')
  await page.getByRole('button', { name: /Merge 2 documents/i }).click()

  await expect(page.getByRole('heading', { name: 'Review before saving' })).toBeVisible()
  await expect(page.getByText('Merged from your documents')).toBeVisible()
  const preview = page.getByRole('article', { name: 'Resume preview' })
  await expect(preview.getByText(/Backend Intern, Demo Startup/)).toBeVisible()
  await expect(preview.getByText(/GraphQL/)).toBeVisible()

  // Jul 2023 (resume) vs Aug 2023 (LinkedIn): the exact field is named, flagged in the form and preview,
  // and saving explains what's left instead of doing nothing.
  await expect(page.getByLabel(/Location: Work Experience, Demo Logistics — Software Developer, Start date/)).toBeVisible()
  await expect(page.getByText('Needs your choice')).toBeVisible()
  await expect(preview.getByText('⚠ Check start date')).toBeVisible()
  const startInput = page.locator('[data-path="experience[0].startDate"]')
  await expect(startInput).toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: /Save \(1 to confirm\)/ }).click()
  await expect(page.getByText(/Confirm 1 detail\(s\) where your documents disagree/)).toBeVisible()
  await expect(page).toHaveURL(/\/import/)
  await shot(page, '10-conflicts')

  await page.getByRole('radio', { name: /Aug 2023/ }).click()
  await expect(page.getByText('All differences confirmed')).toBeVisible()
  await expect(page.getByText(/Using “Aug 2023” from linkedin-profile\.txt/)).toBeVisible()
  await expect(preview.getByText('✓ Confirmed')).toBeVisible()
  await expect(preview.getByText('Aug 2023 - Present')).toBeVisible()
  await expect(startInput).not.toHaveAttribute('aria-invalid')
  // The exact PDF view is one click away.
  await page.getByRole('tab', { name: /Exact PDF/ }).click()
  await expect(page.getByRole('document', { name: /Exact PDF preview, \d page/ })).toBeVisible()

  // The checklist offers bullets from the LinkedIn text for the intern role that had none in the resume.
  await expect(page.getByRole('heading', { name: /Make it ATS-ready/ })).toBeVisible()
  await shot(page, '11-checklist')

  const save = page.getByRole('button', { name: /Save resume/i })
  await save.click()
  await expect(page).toHaveURL(/\/resumes\/[a-f0-9]{24}/)
  await expect(page.getByLabel('Start date').first()).toHaveValue('Aug 2023')
})
