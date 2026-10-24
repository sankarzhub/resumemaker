import PDFDocument from 'pdfkit';
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';

/*
 * A corpus of realistic resume layouts (all fake people) used to check the rule-based reader works
 * across real-world formats, not just one template.
 */

type Pdf = PDFKit.PDFDocument;

function pdf(draw: (doc: Pdf) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  draw(doc);
  doc.end();
  return done;
}

const put = (doc: Pdf, s: string, x: number, y: number, o: { bold?: boolean; size?: number; width?: number } = {}) =>
  doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size ?? 10).text(s, x, y, { width: o.width ?? 500, lineBreak: false });

/** Single column with a left "gutter" holding dates and locations (Canva/Novoresume style). */
export function dateGutterPdf() {
  return pdf((doc) => {
    put(doc, 'KAVYA DEMO', 36, 40, { bold: true, size: 18 });
    put(doc, 'kavya.demo@example.com    https://linkedin.com/in/kavya-demo', 72, 66);
    put(doc, 'https://github.com/kavya-demo    9876543210', 72, 80);
    let y = 110;
    const head = (s: string) => {
      put(doc, s, 36, y, { bold: true, size: 11 });
      y += 22;
    };
    const row = (left: string, right: string, o: { bold?: boolean } = {}) => {
      if (left) put(doc, left, 44, y, { width: 100 });
      if (right) put(doc, right, 160, y, { width: 380, bold: o.bold });
      y += 14;
    };
    head('EDUCATION');
    row('2019 – 2023', 'Demo Institute of Technology - Bachelor of Engineering', { bold: true });
    row('Salem', 'Electronics and Communication Engineering');
    row('', 'CGPA-8.2');
    y += 6;
    head('ACADEMIC PROJECTS');
    put(doc, 'SMART PARKING SYSTEM', 36, y, { bold: true });
    y += 16;
    put(doc, 'Technologies Used: Arduino, Python', 54, y);
    y += 14;
    put(doc, 'Description: Built a sensor based parking tracker that shows free slots on a web page.', 54, y);
    y += 14;
    put(doc, 'Impact: Reduced the time to find a slot during campus events.', 54, y);
    y += 20;
    head('SKILLS & CERTIFICATIONS');
    put(doc, 'Technical Skills: Python, C, Embedded Systems, MATLAB', 54, y);
    y += 14;
    put(doc, 'Languages Known: English, Tamil, Hindi', 54, y);
    y += 14;
    put(doc, 'Certifications & Training:', 54, y, { bold: true });
    y += 14;
    put(doc, 'IoT Fundamentals - Cisco Networking Academy 2022', 54, y);
    y += 20;
    head('PROFESSIONAL EXPERIENCE');
    row('2023/01', 'Embedded intern -Demo Electronics private limited', { bold: true });
    row('Salem', 'Tested firmware for temperature sensors.');
    row('', 'Assisted in writing test reports for 12 product batches');
    y += 6;
    head('ACTIVITIES');
    put(doc, 'ROBOTICS CLUB: Team lead', 54, y);
    y += 14;
    put(doc, 'Organised a district level robotics workshop for 80 students.', 54, y);
  });
}

/** LinkedIn "Save to PDF": sidebar on the left, name/headline/main content on the right. */
export function linkedinLikePdf() {
  return pdf((doc) => {
    const L = 36;
    const R = 220;
    let ly = 60;
    const side = (s: string, o: { size?: number; bold?: boolean } = {}) => {
      put(doc, s, L, ly, { width: 150, size: o.size ?? 9.5, bold: o.bold });
      ly += (o.size ?? 9.5) + 6;
    };
    side('Contact', { size: 13 });
    side('arun.demo@example.com');
    side('www.linkedin.com/in/arun-demo');
    side('(LinkedIn)');
    ly += 8;
    side('Top Skills', { size: 13 });
    side('Kubernetes');
    side('Go');
    side('Terraform');
    ly += 8;
    side('Certifications', { size: 13 });
    side('Certified Kubernetes Administrator');
    side('AWS Solutions Architect Associate');
    let ry = 60;
    const main = (s: string, o: { size?: number; bold?: boolean } = {}) => {
      put(doc, s, R, ry, { width: 330, size: o.size ?? 10, bold: o.bold });
      ry += (o.size ?? 10) + 6;
    };
    main('Arun Demo', { size: 24 });
    main('DevOps Engineer | Kubernetes · Terraform · AWS', { size: 11 });
    main('Pune, Maharashtra, India', { size: 9 });
    ry += 8;
    main('Summary', { size: 14 });
    main('DevOps engineer who builds reliable delivery pipelines and cloud platforms for fintech');
    main('teams, with a focus on automation and observability.');
    ry += 8;
    main('Experience', { size: 14 });
    main('Demo Payments', { size: 11 });
    main('2 years 6 months', { size: 9 });
    main('Senior DevOps Engineer', { size: 10.5 });
    main('January 2024 - Present (10 months)', { size: 9 });
    main('Pune, Maharashtra, India', { size: 9 });
    main('Migrated 40 services to Kubernetes and cut deployment time from hours to minutes.');
    main('DevOps Engineer', { size: 10.5 });
    main('May 2022 - December 2023 (1 year 8 months)', { size: 9 });
    main('Built Terraform modules used by 6 product teams.');
    main('Demo Cloud Labs', { size: 11 });
    main('Cloud Intern', { size: 10.5 });
    main('June 2021 - December 2021 (7 months)', { size: 9 });
    main('Automated nightly backups with Python scripts.');
    ry += 8;
    main('Education', { size: 14 });
    main('Demo University', { size: 11 });
    main('Bachelor of Technology - BTech, Computer Science · (2017 - 2021)', { size: 9.5 });
    put(doc, 'Page 1 of 1', 270, 800, { size: 8 });
  });
}

/** Dates right-aligned on the same row as the title; company on the next line. */
export function rightAlignedDatesPdf() {
  return pdf((doc) => {
    put(doc, 'Neha Demo', 36, 40, { bold: true, size: 20 });
    put(doc, 'Product Designer  |  neha.demo@example.com  |  +91 98450 12345  |  Bengaluru, India', 36, 66, { size: 9.5 });
    let y = 100;
    const head = (s: string) => {
      put(doc, s, 36, y, { bold: true, size: 12 });
      y += 20;
    };
    head('Experience');
    put(doc, 'Senior Product Designer', 36, y, { bold: true });
    put(doc, 'Mar 2022 – Present', 470, y);
    y += 14;
    put(doc, 'Demo Retail Technologies, Bengaluru', 36, y);
    y += 14;
    put(doc, '• Redesigned the checkout flow, lifting conversion by 12%', 46, y);
    y += 14;
    put(doc, '• Ran 30 usability sessions to shape the 2023 roadmap', 46, y);
    y += 20;
    put(doc, 'Product Designer', 36, y, { bold: true });
    put(doc, 'Jul 2019 – Feb 2022', 470, y);
    y += 14;
    put(doc, 'Demo Studio, Chennai', 36, y);
    y += 14;
    put(doc, '• Designed a design system with 60 components', 46, y);
    y += 20;
    head('Education');
    put(doc, 'B.Des in Interaction Design', 36, y, { bold: true });
    put(doc, '2015 – 2019', 470, y);
    y += 14;
    put(doc, 'Demo Institute of Design, Ahmedabad', 36, y);
    y += 20;
    head('Skills');
    put(doc, 'Figma, User Research, Prototyping, Design Systems, HTML, CSS', 36, y);
  });
}

/** Word template built from a 2-column table: sidebar cell + main cell, real Word headings and lists. */
export function tableTwoColumnDocx() {
  const p = (text: string, opts: { bold?: boolean; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; bullet?: boolean } = {}) =>
    new Paragraph({ heading: opts.heading, bullet: opts.bullet ? { level: 0 } : undefined, children: [new TextRun({ text, bold: opts.bold })] });
  const sidebar = [
    p('Contact', { heading: HeadingLevel.HEADING_2 }),
    p('rahul.demo@example.com'),
    p('+91 99001 22334'),
    p('Kochi, Kerala'),
    p('Skills', { heading: HeadingLevel.HEADING_2 }),
    p('Java', { bullet: true }),
    p('Spring Boot', { bullet: true }),
    p('PostgreSQL', { bullet: true }),
    p('Docker', { bullet: true }),
    p('Languages', { heading: HeadingLevel.HEADING_2 }),
    p('English, Malayalam'),
  ];
  const main = [
    p('Profile', { heading: HeadingLevel.HEADING_2 }),
    p('Backend developer with 3 years of experience building Java microservices for logistics companies.'),
    p('Work Experience', { heading: HeadingLevel.HEADING_2 }),
    p('Backend Developer | Demo Freight Pvt Ltd', { bold: true }),
    p('Aug 2021 – Present'),
    p('Built shipment tracking APIs in Spring Boot handling 2M requests per day', { bullet: true }),
    p('Cut database load by 35% with query tuning and caching', { bullet: true }),
    p('Education', { heading: HeadingLevel.HEADING_2 }),
    p('B.Tech in Information Technology', { bold: true }),
    p('Demo College of Engineering, Kochi'),
    p('2017 – 2021'),
  ];
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: 'Rahul Demo', bold: true, size: 40 })] }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [new TableRow({ children: [new TableCell({ children: sidebar }), new TableCell({ children: main })] })],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

export const INDIAN_FRESHER_TXT = `CURRICULUM VITAE
PRIYA DEMO
Email: priya.demo@example.com | Mobile: +91-90031 45678
Address: 12, Gandhi Street, Anna Nagar, Madurai - 625020

CAREER OBJECTIVE
To obtain a challenging position as a software developer where I can use my skills in Java and web development.

ACADEMIC QUALIFICATION
Degree | Institution | Board/University | Year | Percentage
B.E (CSE) | Demo College of Engineering | Anna University | 2024 | 8.1 CGPA
HSC | Demo Matric Hr Sec School | State Board | 2020 | 92%
SSLC | Demo Matric Hr Sec School | State Board | 2018 | 95%

TECHNICAL SKILLS
Programming Languages: Java, Python, C
Web Technologies: HTML, CSS, JavaScript
Database: MySQL

PROJECTS
Title: Library Management System
Description: Developed a web application to manage book issue and return for the college library.
Technologies: Java, MySQL

Title: Attendance Tracker
Description: Built an Android app to record class attendance using QR codes.

AREA OF INTEREST
Web Development
Software Testing

STRENGTHS
Quick learner
Team player

PERSONAL DETAILS
Date of Birth : 01/01/2002
Father's Name : Demo Kumar
Gender : Female
Marital Status : Single
Languages Known : English, Tamil

DECLARATION
I hereby declare that the above information is true to the best of my knowledge.
Place: Madurai
`;

export const US_STYLE_TXT = `JORDAN DEMO
Austin, TX | (512) 555-0147 | jordan.demo@example.com | jordandemo.dev

PROFESSIONAL SUMMARY
Product manager with 8 years of experience launching B2B SaaS products from discovery to scale.

WORK HISTORY
Senior Product Manager, Globex Corporation — Austin, TX | Jan 2019 – Present
- Led a team of 9 engineers and 2 designers to launch an analytics suite used by 1,200 customers
- Grew annual recurring revenue by 30% through pricing experiments

Product Manager, Initech Inc. — Dallas, TX | Jun 2015 – Dec 2018
- Shipped the first mobile app, reaching 50,000 downloads in six months

EDUCATION
MBA, University of Texas at Austin, 2015
B.S. in Computer Science, Texas Demo University, 2012

TECHNICAL PROFICIENCIES
SQL, Jira, Figma, Amplitude, A/B Testing

HONORS & AWARDS
President's Club, Globex Corporation, 2021
`;

export const ICONS_TXT = `🌟 SAM DEMO 🌟
📧 sam.demo@example.com   ☎ +91 98765 11223   📍 Hyderabad, Telangana
🔗 github.com/sam-demo

🎓 EDUCATION
M.Sc in Data Science — Demo University (2021 – 2023)

💼 EXPERIENCE
Data Analyst @ Demo Insights | Jun 2023 – Present
➤ Built churn dashboards in Power BI for 5 regional teams
➤ Automated weekly reports with Python, saving 6 hours a week

🛠 SKILLS
✓ Python ✓ SQL ✓ Power BI ✓ Pandas
`;

export const SPACED_HEADINGS_TXT = `MEERA DEMO
meera.demo@example.com | +91 90000 12345

S U M M A R Y
Teacher with 6 years of experience teaching mathematics to high school students.

E X P E R I E N C E
Mathematics Teacher
Demo Public School, Chennai
June 2018 - Present
- Raised class pass rate from 78% to 96% over three years
- Coordinated the school maths olympiad for 300 students

E D U C A T I O N
B.Ed, Demo College of Education, 2018
M.Sc in Mathematics, Demo University, 2016

S K I L L S
Lesson Planning, Classroom Management, MS Office
`;
