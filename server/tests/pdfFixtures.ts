import PDFDocument from 'pdfkit';

function render(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  draw(doc);
  doc.end();
  return done;
}

const isHeading = (s: string) => Boolean(s) && s === s.toUpperCase() && !s.includes('@') && /[A-Z]/.test(s);

/**
 * A typical two-column template (fake person): sidebar on the left, main content on the right,
 * with rows at the same height so naive text extraction interleaves the columns line by line.
 */
export function twoColumnResumePdf(): Promise<Buffer> {
  const left = [
    'CONTACT', 'meera.demo@example.com', '+91 91234 56789', 'Pune, India', 'linkedin.com/in/meera-demo', '',
    'SKILLS', 'Python', 'SQL', 'Power BI', 'Excel', 'Tableau', 'Pandas', '',
    'EDUCATION', 'B.Sc in Statistics', 'Fergusson College', '2015 - 2018',
  ];
  const right = [
    'SUMMARY', 'Data analyst with 4 years of experience turning retail and', 'supply chain data into dashboards and decisions.', '',
    'EXPERIENCE', 'Senior Data Analyst | Demo Retail', 'Mar 2021 - Present',
    '• Built Power BI dashboards used by 40 store managers',
    '• Cut weekly reporting time by 70% by automating SQL pipelines',
    '• Forecasted demand for 1,200 products with Python models', '',
    'Data Analyst | Demo Logistics', 'Jul 2018 - Feb 2021',
    '• Analyzed delivery data for 3 warehouses to reduce delays',
    '• Created Excel models that saved 10 hours per week', '',
    'PROJECTS', 'Sales Forecasting App', '• Built a Streamlit app to forecast weekly sales',
  ];
  return render((doc) => {
    doc.font('Helvetica-Bold').fontSize(22).text('MEERA DEMO', 40, 40);
    doc.font('Helvetica').fontSize(11).text('Data Analyst', 40, 68);
    let y = 110;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (left[i]) doc.font(isHeading(left[i]) ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(left[i], 40, y, { width: 170, lineBreak: false });
      if (right[i]) doc.font(isHeading(right[i]) ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(right[i], 230, y, { width: 320, lineBreak: false });
      y += 15;
    }
  });
}

/** Right-hand sidebar variant: main content on the left, narrow sidebar on the right. */
export function rightSidebarResumePdf(): Promise<Buffer> {
  const main = [
    'SUMMARY', 'Frontend engineer focused on accessible React apps.', '',
    'EXPERIENCE', 'Frontend Engineer | Demo Media', 'Jan 2022 - Present',
    '• Rebuilt the article page in React, improving load time by 35%',
    '• Led accessibility fixes across 120 components',
  ];
  const side = ['SKILLS', 'React', 'TypeScript', 'CSS', '', 'EDUCATION', 'B.Tech in Computer Science', 'Demo University', '2017 - 2021'];
  return render((doc) => {
    doc.font('Helvetica-Bold').fontSize(22).text('ROHAN DEMO', 40, 40);
    doc.font('Helvetica').fontSize(10).text('rohan.demo@example.com | +91 99887 76655 | Mumbai, India', 40, 68);
    let y = 110;
    for (let i = 0; i < Math.max(main.length, side.length); i++) {
      if (main[i]) doc.font(isHeading(main[i]) ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(main[i], 40, y, { width: 330, lineBreak: false });
      if (side[i]) doc.font(isHeading(side[i]) ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(side[i], 400, y, { width: 150, lineBreak: false });
      y += 15;
    }
  });
}
