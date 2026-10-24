# ResumeCraft

ResumeCraft is an ATS-friendly resume builder. You can upload an existing resume or any document about your background (PDF, DOCX or TXT), or paste text. It builds a clean, single-column resume from that, optionally rewritten by Claude, and you review and edit it before saving. It also checks quality with transparent rules, matches the resume against job descriptions, and exports selectable-text PDF and DOCX files.

The app UI uses a cinematic comic-book look. The resume itself (the preview and the exported files) stays plain and ATS-safe on purpose.

## Stack

| Layer | Tools |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, React Router, React Hook Form + Zod, Axios |
| Backend | Node.js, Express 5, TypeScript, Mongoose 9 / MongoDB |
| Parsing | `pdf-parse` (PDF), `mammoth` (DOCX) |
| AI | Claude API (`@anthropic-ai/sdk`, model `claude-opus-5-5`, structured outputs) |
| Export | `pdfkit` (PDF), `docx` (DOCX) |
| Security | Helmet, CORS allowlist, HTTP-only JWT cookie, double-submit CSRF token, rate limits, Zod validation, bcrypt |
| Tests | Vitest, Supertest, React Testing Library, Playwright |

## Setup (Windows)

Prerequisites: Node.js 20+ (tested on 22), npm, and MongoDB running locally (`mongodb://127.0.0.1:27017`) or a MongoDB Atlas URI.

```powershell
cd E:\Resume_Maker
npm install                      # root (concurrently)
npm install --prefix server
npm install --prefix client
copy server\.env.example server\.env   # then edit JWT_SECRET (and ANTHROPIC_API_KEY if you want AI)
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:5000, health check at http://localhost:5000/api/health

To generate a JWT secret:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Environment variables

`server/.env`

| Name | Required | Description |
|---|---|---|
| `PORT` | no | API port, default `5000` |
| `NODE_ENV` | no | `development` / `test` / `production` (production turns on `Secure` cookies) |
| `CLIENT_URL` | no | Allowed CORS origin, default `http://localhost:5173` |
| `MONGODB_URI` | no | Default `mongodb://127.0.0.1:27017/resumecraft` |
| `JWT_SECRET` | **yes** | 32+ random characters. The server refuses to start without it. |
| `ANTHROPIC_API_KEY` | no | Turns on AI features. Without it, everything else still works. |
| `ANTHROPIC_MODEL` | no | Default `claude-opus-5-5` |

`client/.env` (optional): `VITE_API_BASE_URL`, default `/api`. The Vite dev server proxies `/api` to the API, which keeps auth cookies first-party. Never put secrets in client variables.

## Scripts

From the repo root:

| Command | What it does |
|---|---|
| `npm run dev` | API + client with hot reload |
| `npm test` | Server tests (unit + integration) and client tests |
| `npm run typecheck` | TypeScript checks for both |
| `npm run build` | Production builds for both |
| `npm run test:e2e --prefix client` | Playwright end-to-end test. It starts its own API on :5050 against the `resumecraft_e2e` database and its own Vite on :5174. Run `npx playwright install chromium` once first. |

Tests only use databases named `resumecraft_test_*` / `resumecraft_e2e` and fake people. They never touch your dev data.

## How "upload → best resume" works

The import works well **without any AI key**. AI is an optional extra on top.

1. **Upload.** The file stays in memory and is never written to disk. Its type is checked by content (magic bytes), not by name. The limit is 5 MB. Supported: PDF, DOCX, TXT, plus PNG/JPG photos or scans when AI is on. Old `.doc` files get a "save as .docx" message.
2. **Layout-aware reading** (`server/src/services/pdfLayout.service.ts`, `parsing/docxLines.ts`):
   - PDFs are rebuilt line by line from text positions, keeping font size and bold.
   - Two-column pages (a sidebar with its own headings) are detected and each column is read top to bottom. Single-column pages with a date/location gutter are left alone.
   - DOCX keeps Word headings, bold, bullets, nested lists and tables. Table cells are read cell by cell, so two-column table templates work.
3. **Rule-based structuring** (`parsing/sections.ts`, `parsing/structure.ts`):
   - Headings are recognised by keyword plus style (bold, size, caps, colon), and by the document's own heading style. "Academic Projects" maps to projects, "Career Objective" to summary, and "Skills & Certifications" to skills, with certifications as a sub-section.
   - Entries are split using date anchors, with dates before, after or beside the title. Each line is classified as date, location, bullet, labelled field ("Description:", "Technologies Used:"), sentence or header.
   - LinkedIn exports are handled specifically: the sidebar comes first, roles are grouped under one company, and durations are noise.
   - Content outside the core sections (Achievements, Activities, Languages, Awards, Volunteering…) goes to **additional sections** instead of being lost.
   - Personal details (date of birth, marital status, father's name, declaration) are left out, with a note.
4. **Deterministic polish** (no AI):
   - Dates are normalised to `Mon YYYY` and ALL-CAPS text is tidied, keeping acronyms and initials. Skills get canonical names and duplicates are removed.
   - Simple first-person phrasing is removed ("I'm a … " → "…"), roles are sorted newest first, and wrapped lines are re-joined.
   - When no summary exists, a starter summary is written **only from parsed facts**, with a note asking the user to personalise it.
5. **AI draft (optional).** If AI is on, Claude receives the **original PDF or image** alongside the extracted text, so it reads complex layouts and scans itself. It then restructures and rewrites the content into an ATS-friendly resume: action-verb bullets, a tight summary, keyword skills and consistent dates. The prompt forbids inventing employers, dates, skills, metrics or achievements. Gaps show up under "Add these yourself" instead. Uploaded text and job descriptions are passed as untrusted data. If the AI call fails, the rule-based draft is used and the reason is shown.
6. **Review.** You edit everything next to a live preview. Nothing is saved until you click **Save**.

The rule-based reader is tested against a corpus of real-world layouts in `server/tests/corpus.ts`: left and right sidebars, a date gutter, a LinkedIn export, right-aligned dates, a Word table template, an Indian fresher CV with an academic table, a US-style resume, icons/emoji, and letter-spaced headings. When you find a resume that parses badly, add a fake-data version of its layout there.

### Multiple documents (resume + LinkedIn PDF)

You can upload up to 4 documents at once, for example your resume plus your LinkedIn profile export (LinkedIn → your profile → More → **Save to PDF**). Each file gets a role: *Resume*, *LinkedIn profile PDF*, *Other document*, or *Auto-detect*. LinkedIn exports are recognised by their layout.

- **Merge.** The resume is the primary source for contact details and wording. Other documents fill gaps. Roles at the same company are combined and their details de-duplicated. Roles, projects, education, certifications and skills found in only one document are added. Equivalent values aren't treated as differences, e.g. `B.E.` = `Bachelor of Engineering`, `Jun 2022` = `June 2022`, `Chennai, India` ⊂ `Chennai, Tamil Nadu, India`.
- **Conflicts.** When documents really disagree (start/end dates, job title, company, degree, email, phone), the review screen shows, for each one:
  - exactly where the field is (e.g. *Work Experience › QSpiders — Java Fullstack Development › Start date*);
  - each value with the file it came from;
  - what the resume currently uses, and a status: *Needs your choice*, *Confirmed* or *You edited it*.

  The same field is outlined in the form (red until settled, then green "Confirmed"), and its entry is outlined in the live preview. "Show me" scrolls to the field. Picking an option or typing your own value settles it. Clicking Save while items are open lists what's left instead of saving. Conflicts stay attached to the right entry even if you reorder or delete roles. The app never decides a disputed fact for you. If the names suggest the documents belong to different people, you get a warning.
- **Make it ATS-ready checklist.** The review screen lists what ATS checks expect but your draft lacks: roles with fewer than 2 bullets, projects without a description, missing end dates, missing contact details, and a summary or skills list that is too short. For roles and projects without bullets, it offers **sentences from your own documents** (for example, lines in your LinkedIn "About" text that mention that company), rewritten without "I", and adds one with a single click. Nothing is invented, and nothing is added unless you click. Fixed items stay listed with a tick.
- **With AI.** All documents go to Claude as separately labelled, untrusted sources. Claude merges and rewrites them and reports conflicts the same way. Conflict paths returned by the model are validated, and invalid ones are dropped.
- If one file can't be read (for example a scanned PDF), it is skipped with a warning and the others are still used.
- There is no LinkedIn login or scraping. Only files you download yourself are used.

## Templates, exact preview and one-page fit

- **6 templates**: Classic (Lato), Modern (Inter, blue), Compact, Executive (Source Serif 4), Minimal and Bold (teal header band). Each has a clear hierarchy: semibold job title with right-aligned dates, then company and location on the next line. They change only typography, colour and spacing. All are single-column with standard headings and embedded fonts (SIL Open Font License, bundled via `@fontsource`). There is no letter-spacing in the PDF, because tracked text extracts as "E X P E R I E N C E", which ATS parsers misread. A test parses every template's export back and checks names, roles, companies and dates.
- **Exact preview**: the preview column shows the real export PDF, rendered by the server (`POST /api/resumes/preview`) and drawn with pdf.js, so the page count and page breaks you see are exactly what you download. During import, a "Highlights" view also outlines details still to confirm.
- **Fit to one page**: the layout stays the same, only spacing and type size change. Spacing is reduced first, using a binary search so the page ends up full instead of half-empty. If that's not enough, it looks for the best balance of type size and breathing room: spacing never drops below 40%, and body text stays at or above 8.1pt (Inter) or 8.5–8.6pt (Lato/Source Serif). If the content still won't fit, the UI says so and suggests Compact or trimming. Roles without bullets use one row, and short lists (languages, interests) are shown inline. Fonts are parsed once and shared, and results are cached, so a fit takes a fraction of a second. The DOCX export uses the same scale.

## ATS-friendly output

Both exports share one layout: a single column, no tables, text boxes, images or icons, standard headings (Professional Summary, Skills, Work Experience, Projects, Education, Certifications), a standard font (Helvetica in PDF, Calibri in DOCX), real `•` bullets, selectable text, and readable links. A unit test parses our own exported PDF back with the same parser and checks that every section, the contact details and both roles come out intact.

## Scoring

**Quality score (0-100, estimated).** Points across six weighted categories: contact 15, sections 15, content 30, date consistency 15, skills 10, parsing safety 15. Each category returns earned/max points and plain-language reasons. Weights live in `server/src/services/atsChecker.service.ts`.

**Job match (0-100, estimated).** Uses a curated skill dictionary with aliases (`server/src/services/skills.data.ts`). Required skills are told apart from preferred ones. Each skill is classified as *proven* (listed and used in a bullet), *in experience*, *listed only*, *related* (e.g. React for Next.js, never counted as a match), or *not found*. Every match names where in the resume it was found.

Neither score is a real employer ATS score, and neither can predict hiring. The UI says so.

## API

All responses are either `{ "success": true, "data": … }` or `{ "success": false, "error": { "code", "message", "details?" } }`.
Auth is an HTTP-only `rc_token` cookie. Every state-changing request after login must send the `x-csrf-token` header with the value of the `rc_csrf` cookie (axios does this automatically).

| Method | Endpoint | Body / query | Notes |
|---|---|---|---|
| GET | `/api/health` | | 200 ok / 503 when the DB is down |
| GET | `/api/config` | | `{ aiAvailable }` (requires auth) |
| POST | `/api/auth/register` | `{ name, email, password }` | Password must be 8+ characters with a letter and a number. Returns 201. |
| POST | `/api/auth/login` | `{ email, password }` | 401 with a generic message on failure |
| POST | `/api/auth/logout` | | Clears cookies |
| GET | `/api/auth/me` | | Current user |
| DELETE | `/api/auth/me` | | Deletes the account plus all resumes and analyses |
| GET | `/api/resumes` | `?page=1&limit=20` (max 50) | Paginated list with estimated score |
| POST | `/api/resumes` | `{ title, ...content }` | 201 |
| GET | `/api/resumes/:id` | | 404 if missing **or owned by someone else** |
| PATCH | `/api/resumes/:id` | partial content | Arrays are replaced whole; omitted fields are untouched |
| DELETE | `/api/resumes/:id` | | Also deletes its analyses |
| POST | `/api/resumes/:id/duplicate` | | 201 |
| POST | `/api/resumes/upload` | multipart: `files` (1-4; a single `file` also works), `roles?` (JSON array of `resume`/`linkedin`/`other`/`auto`, in file order), `useAi?`, `jobDescription?` | Returns a merged draft plus `sources`, `conflicts` (`{ path, label, options[{source,value}], selected }`) and `mergeNotes`, and **does not save**. 400 bad type / too many files, 413 too large, 422 no readable text in any file |
| POST | `/api/resumes/import-text` | `{ text, useAi?, jobDescription? }` | Same as upload, for pasted text |
| POST | `/api/resumes/:id/analyze` | `{ jobDescription? }` | Quality report, stored as an analysis |
| POST | `/api/resumes/:id/job-match` | `{ jobDescription }` (30+ characters) | Match report, stored |
| POST | `/api/resumes/:id/improve` | `{ jobDescription? }` | AI suggestions only; nothing is saved. 503 `AI_UNAVAILABLE` without a key |
| GET | `/api/resumes/:id/analyses` | | Recent analyses |
| GET | `/api/analyses/:id` | | Owner only |
| GET | `/api/resumes/:id/export` | `?format=pdf\|docx` | File download; uses the resume's `templateId` and `fitToPage` |
| POST | `/api/resumes/preview` | resume content + `templateId`, `fitToPage` | The exact export PDF for unsaved content. Headers: `X-Page-Count`, `X-Fit-Scale`, `X-Fitted` |

Status codes: 400 validation, 401 unauthenticated, 403 CSRF, 404 not found or not owned, 409 duplicate email, 413 file too large, 422 unreadable document, 429 rate limited, 5xx unexpected or AI upstream errors.

## Data and privacy

- Passwords are bcrypt-hashed (cost 12) and never returned.
- Uploaded files are processed in memory and discarded. Only the resume content you save is stored.
- Resume text, passwords and tokens are never logged.
- Deleting a resume deletes its analyses. Deleting the account deletes everything.
- With AI on, resume text is sent to the Anthropic API. Review your organisation's data-retention settings before using real resumes.

## Deployment notes

- Use managed MongoDB with a least-privilege user. Set every env var through the host's secret manager.
- Serve the client and API under one site (for example, a reverse proxy routing `/api` to Node) so cookies stay first-party. If you split domains, set `CLIENT_URL` to the frontend origin and use `NODE_ENV=production` for `Secure` cookies.
- Use HTTPS, point health checks at `/api/health`, and keep backups.
- Run `npm test` and `npm run build` before each release.

## Known limitations

- Without AI, scanned PDFs and photos can't be read (there is no OCR). The user is told so. With AI on, Claude reads them.
- Without AI, bullet wording is kept as written and only cleaned, never rewritten. Weak bullets show up in the ATS report and in AI Boost suggestions.
- Rule-based merging matches roles by company name. When LinkedIn groups several roles under one company, later roles may lose the company name until you fill it in (the AI draft handles this).
- The rule-based parser handles common layouts. Unusual layouts (multi-column PDFs, tables) may need manual fixes in the review step, and the AI draft handles them much better.
- Job matching only recognises skills in the curated dictionary. Niche tools aren't detected until they're added there.
- The PDF export uses the standard Helvetica font, so characters outside Western European scripts are dropped (`₹` becomes `INR`). Use DOCX for other scripts.
- The AI integration is covered by tests with a fake provider and by a test of the no-key fallback. It has not been run against the live Claude API in this repository's test suite.
