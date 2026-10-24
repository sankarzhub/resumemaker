import { describe, expect, it } from 'vitest';
import { parseResumeFile, structureResumeText } from '../../src/services/resumeParser.service.js';
import { dateGutterPdf, ICONS_TXT, INDIAN_FRESHER_TXT, linkedinLikePdf, rightAlignedDatesPdf, SPACED_HEADINGS_TXT, tableTwoColumnDocx, US_STYLE_TXT } from '../corpus.js';
import { rightSidebarResumePdf, twoColumnResumePdf } from '../pdfFixtures.js';
import { depersonalize, starterSummary } from '../../src/services/parsing/structure.js';
import { emptyResumeContent } from '../../src/types/resume.js';

const titles = (r: { content: { additionalSections: Array<{ title: string }> } }) => r.content.additionalSections.map((s) => s.title);

describe('deterministic polish', () => {
  it('removes first-person voice without changing meaning', () => {
    expect(depersonalize("I'm a Full-Stack Developer at Demo Co, working with PHP. I develop dashboards for sales teams.Alongside my work, I'm pursuing an M.E. I'm passionate about learning.")).toBe(
      'Full-Stack Developer at Demo Co, working with PHP. Develop dashboards for sales teams. Alongside work, pursuing an M.E. Passionate about learning.',
    );
  });

  it('writes a factual starter summary only from parsed fields', () => {
    const s = starterSummary({
      ...emptyResumeContent(),
      targetJobTitle: 'Junior Software Developer',
      skills: ['Java', 'SQL', 'React'],
      experience: [{ jobTitle: 'Java Intern', company: 'Demo Soft', location: '', startDate: '', endDate: '', current: false, description: [] }],
      education: [{ degree: 'Bachelor of Engineering', field: 'Computer Science', institution: 'Demo Institute', location: '', startDate: '', endDate: '', grade: '' }],
    });
    expect(s).toBe('Junior Software Developer skilled in Java, SQL and React. Experience includes Java Intern at Demo Soft. Holds a Bachelor of Engineering in Computer Science from Demo Institute.');
  });
});

describe('heading detection', () => {
  it('does not mistake bold job titles for section headings', () => {
    const r = structureResumeText(`Asha Demo\nasha@example.com\nWORK EXPERIENCE\nSoftware Engineer\nJun 2022 - Present\nDemo Labs\n• Built APIs\nTraining Coordinator\nJan 2020 - May 2022\nDemo Academy\n• Ran sessions\nSKILLS\nJava, SQL`);
    expect(r.content.experience.map((e) => e.jobTitle)).toEqual(['Software Engineer', 'Training Coordinator']);
    expect(r.content.skills).toEqual(['Java', 'SQL']);
  });
});

describe('real-world layouts (rule-based, no AI)', () => {
  it('two-column PDF with a left sidebar', async () => {
    const r = await parseResumeFile(await twoColumnResumePdf(), 'twocol.pdf');
    const c = r.content;
    expect(r.notes.join(' ')).toMatch(/multi-column/);
    expect(c.personalInfo).toMatchObject({ fullName: 'Meera Demo', email: 'meera.demo@example.com', location: 'Pune, India' });
    expect(c.personalInfo.phone).toContain('91234');
    expect(c.skills).toEqual(expect.arrayContaining(['Python', 'SQL', 'Power BI', 'Excel', 'Tableau', 'Pandas']));
    expect(c.summary).toMatch(/^Data analyst with 4 years/);
    expect(c.experience.map((e) => [e.jobTitle, e.company, e.startDate])).toEqual([
      ['Senior Data Analyst', 'Demo Retail', 'Mar 2021'],
      ['Data Analyst', 'Demo Logistics', 'Jul 2018'],
    ]);
    expect(c.experience[0].description).toHaveLength(3);
    expect(c.education[0]).toMatchObject({ degree: 'B.Sc', field: 'Statistics', institution: 'Fergusson College', startDate: '2015', endDate: '2018' });
    expect(c.projects[0].name).toBe('Sales Forecasting App');
  });

  it('two-column PDF with a right sidebar', async () => {
    const c = (await parseResumeFile(await rightSidebarResumePdf(), 'right.pdf')).content;
    expect(c.personalInfo.fullName).toBe('Rohan Demo');
    expect(c.skills).toEqual(['React', 'TypeScript', 'CSS']);
    expect(c.experience[0]).toMatchObject({ jobTitle: 'Frontend Engineer', company: 'Demo Media', startDate: 'Jan 2022', current: true });
    expect(c.experience[0].description).toHaveLength(2);
    expect(c.education[0]).toMatchObject({ degree: 'B.Tech', field: 'Computer Science', institution: 'Demo University' });
  });

  it('date-gutter layout (dates and cities in a left column)', async () => {
    const r = await parseResumeFile(await dateGutterPdf(), 'gutter.pdf');
    const c = r.content;
    expect(c.personalInfo).toMatchObject({ fullName: 'Kavya Demo', email: 'kavya.demo@example.com', phone: '9876543210' });
    expect(c.education[0]).toMatchObject({
      institution: 'Demo Institute of Technology',
      degree: 'Bachelor of Engineering',
      field: 'Electronics and Communication Engineering',
      location: 'Salem',
      startDate: '2019',
      endDate: '2023',
      grade: 'CGPA: 8.2',
    });
    expect(c.projects[0]).toMatchObject({ name: 'Smart Parking System', technologies: ['Arduino', 'Python'] });
    expect(c.projects[0].description).toHaveLength(2);
    expect(c.skills).toEqual(expect.arrayContaining(['Python', 'C', 'Embedded Systems', 'MATLAB']));
    expect(c.certifications[0]).toMatchObject({ name: 'IoT Fundamentals', issuer: 'Cisco Networking Academy', date: '2022' });
    expect(c.experience[0]).toMatchObject({ jobTitle: 'Embedded Intern', company: 'Demo Electronics Private Limited', location: 'Salem', startDate: 'Jan 2023' });
    expect(c.experience[0].description).toHaveLength(2);
    expect(titles(r)).toEqual(expect.arrayContaining(['Activities', 'Languages']));
    expect(c.additionalSections.find((s) => s.title === 'Languages')!.items).toEqual(['English', 'Tamil', 'Hindi']);
  });

  it('LinkedIn profile PDF (sidebar first, grouped roles)', async () => {
    const r = await parseResumeFile(await linkedinLikePdf(), 'Profile.pdf');
    const c = r.content;
    expect(r.role).toBe('linkedin');
    expect(c.personalInfo).toMatchObject({ fullName: 'Arun Demo', email: 'arun.demo@example.com', location: 'Pune, Maharashtra, India' });
    expect(c.targetJobTitle).toBe('DevOps Engineer');
    expect(c.skills).toEqual(['Kubernetes', 'Go', 'Terraform']);
    expect(c.certifications.map((x) => x.name)).toEqual(['Certified Kubernetes Administrator', 'AWS Solutions Architect Associate']);
    expect(c.summary).toMatch(/^DevOps engineer who builds .* observability\.$/);
    expect(c.experience.map((e) => [e.jobTitle, e.company, e.startDate, e.endDate, e.current])).toEqual([
      ['Senior DevOps Engineer', 'Demo Payments', 'Jan 2024', '', true],
      ['DevOps Engineer', 'Demo Payments', 'May 2022', 'Dec 2023', false],
      ['Cloud Intern', 'Demo Cloud Labs', 'Jun 2021', 'Dec 2021', false],
    ]);
    expect(c.experience[0].location).toBe('Pune, Maharashtra, India');
    expect(c.education[0]).toMatchObject({ institution: 'Demo University', degree: 'Bachelor of Technology', field: 'Computer Science', startDate: '2017', endDate: '2021' });
  });

  it('dates right-aligned on the title row', async () => {
    const c = (await parseResumeFile(await rightAlignedDatesPdf(), 'neha.pdf')).content;
    expect(c.personalInfo).toMatchObject({ fullName: 'Neha Demo', location: 'Bengaluru, India' });
    expect(c.targetJobTitle).toBe('Product Designer');
    expect(c.experience.map((e) => [e.jobTitle, e.company, e.location, e.startDate, e.current])).toEqual([
      ['Senior Product Designer', 'Demo Retail Technologies', 'Bengaluru', 'Mar 2022', true],
      ['Product Designer', 'Demo Studio', 'Chennai', 'Jul 2019', false],
    ]);
    expect(c.experience[0].description).toHaveLength(2);
    expect(c.education[0]).toMatchObject({ degree: 'B.Des', field: 'Interaction Design', institution: 'Demo Institute of Design', location: 'Ahmedabad' });
  });

  it('Word template built from a two-column table', async () => {
    const r = await parseResumeFile(await tableTwoColumnDocx(), 'rahul.docx');
    const c = r.content;
    expect(c.personalInfo).toMatchObject({ fullName: 'Rahul Demo', email: 'rahul.demo@example.com', location: 'Kochi, Kerala' });
    expect(c.skills).toEqual(['Java', 'Spring', 'PostgreSQL', 'Docker']);
    expect(c.summary).toMatch(/^Backend developer with 3 years/);
    expect(c.experience[0]).toMatchObject({ jobTitle: 'Backend Developer', company: 'Demo Freight Pvt Ltd', startDate: 'Aug 2021', current: true });
    expect(c.experience[0].description).toHaveLength(2);
    expect(c.education[0]).toMatchObject({ degree: 'B.Tech', field: 'Information Technology', institution: 'Demo College of Engineering', location: 'Kochi' });
    expect(titles(r)).toContain('Languages');
  });

  it('Indian fresher CV with an academic table, personal details and declaration', () => {
    const r = structureResumeText(INDIAN_FRESHER_TXT);
    const c = r.content;
    expect(c.personalInfo).toMatchObject({ fullName: 'Priya Demo', email: 'priya.demo@example.com', location: 'Anna Nagar, Madurai' });
    expect(c.personalInfo.phone).toContain('90031');
    expect(c.summary).toMatch(/^To obtain a challenging position/);
    expect(c.education.map((e) => [e.degree, e.institution, e.endDate, e.grade])).toEqual([
      ['B.E (CSE)', 'Demo College of Engineering', '2024', 'CGPA: 8.1'],
      ['HSC', 'Demo Matric Hr Sec School', '2020', '92%'],
      ['SSLC', 'Demo Matric Hr Sec School', '2018', '95%'],
    ]);
    expect(c.skills).toEqual(expect.arrayContaining(['Java', 'Python', 'C', 'HTML', 'CSS', 'JavaScript', 'MySQL']));
    expect(c.projects.map((p) => p.name)).toEqual(['Library Management System', 'Attendance Tracker']);
    expect(c.projects[0].technologies).toEqual(['Java', 'MySQL']);
    expect(titles(r)).toEqual(expect.arrayContaining(['Interests', 'Strengths']));
    // Personal details stay out of the resume; spoken languages are kept.
    const all = JSON.stringify(c);
    expect(all).not.toMatch(/Date of Birth|Father|Marital|declare/i);
    expect(c.additionalSections.find((s) => s.title === 'Languages')?.items).toEqual(['English', 'Tamil']);
    expect(r.notes.join(' ')).toMatch(/personal details/);
  });

  it('LinkedIn profile pasted as plain text (no fonts, no location line)', () => {
    const r = structureResumeText(`Contact
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
Designed a shipment tracking service handling 1M events per day.`);
    expect(r.content.personalInfo.fullName).toBe('Arjun Demo');
    expect(r.content.targetJobTitle).toBe('Backend Developer');
    expect(r.content.skills).toEqual(['GraphQL', 'Redis']);
  });

  it('US style with inline company, location and dates', () => {
    const r = structureResumeText(US_STYLE_TXT);
    const c = r.content;
    expect(c.personalInfo).toMatchObject({ fullName: 'Jordan Demo', email: 'jordan.demo@example.com', location: 'Austin, TX', portfolio: 'jordandemo.dev' });
    expect(c.personalInfo.phone).toBe('(512) 555-0147');
    expect(c.experience.map((e) => [e.jobTitle, e.company, e.location, e.startDate, e.endDate, e.current])).toEqual([
      ['Senior Product Manager', 'Globex Corporation', 'Austin, TX', 'Jan 2019', '', true],
      ['Product Manager', 'Initech Inc.', 'Dallas, TX', 'Jun 2015', 'Dec 2018', false],
    ]);
    expect(c.education.map((e) => [e.degree, e.institution, e.endDate])).toEqual([
      ['MBA', 'University of Texas at Austin', '2015'],
      ['B.S.', 'Texas Demo University', '2012'],
    ]);
    expect(c.skills).toEqual(expect.arrayContaining(['SQL', 'Jira', 'Figma', 'A/B Testing']));
    expect(titles(r)).toContain('Achievements');
  });

  it('icons, emoji and decorative bullets', () => {
    const c = structureResumeText(ICONS_TXT).content;
    expect(c.personalInfo).toMatchObject({ fullName: 'Sam Demo', email: 'sam.demo@example.com', location: 'Hyderabad, Telangana', github: 'github.com/sam-demo' });
    expect(c.experience[0]).toMatchObject({ jobTitle: 'Data Analyst', company: 'Demo Insights', startDate: 'Jun 2023', current: true });
    expect(c.experience[0].description).toHaveLength(2);
    expect(c.education[0]).toMatchObject({ degree: 'M.Sc', field: 'Data Science', institution: 'Demo University', startDate: '2021', endDate: '2023' });
    expect(c.skills).toEqual(['Python', 'SQL', 'Power BI', 'Pandas']);
    expect(JSON.stringify(c)).not.toMatch(/[🌟📧☎📍🔗🎓💼🛠✓➤]/u);
  });

  it('letter-spaced headings and title/company on separate lines', () => {
    const c = structureResumeText(SPACED_HEADINGS_TXT).content;
    expect(c.summary).toMatch(/^Teacher with 6 years/);
    expect(c.experience[0]).toMatchObject({ jobTitle: 'Mathematics Teacher', company: 'Demo Public School', location: 'Chennai', startDate: 'Jun 2018', current: true });
    expect(c.education.map((e) => e.degree)).toEqual(['B.Ed', 'M.Sc']);
    expect(c.skills).toEqual(['Lesson Planning', 'Classroom Management', 'MS Office']);
  });
});
