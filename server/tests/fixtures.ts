import type { ResumeContent } from '../src/types/resume.js';

// Fake person for tests only.
export const SAMPLE_RESUME_TEXT = `PRIYA RAMAN
Full Stack Developer
Chennai, India | +91 98765 43210 | priya.raman@example.com | linkedin.com/in/priya-raman-demo | github.com/priya-demo

PROFESSIONAL SUMMARY
Full stack developer with 3 years of experience building web applications with React, Node.js and MongoDB. Focused on clean APIs, performance and accessible user interfaces.

SKILLS
Languages: JavaScript, TypeScript, Python
Frameworks: React, Node.js, Express
Databases: MongoDB, PostgreSQL
Tools: Git, Docker, AWS

WORK EXPERIENCE
Software Engineer | Acme Fintech Pvt Ltd
Jun 2022 - Present
• Built a payments dashboard in React and TypeScript used by 12,000 merchants
• Reduced API response time by 40% by adding Redis caching and query indexes
• Mentored 3 junior developers through code reviews

Junior Developer | Bright Apps
Jan 2021 - May 2022
• Developed REST APIs with Node.js and Express for a food delivery app
• Wrote unit tests with Jest, raising coverage from 45% to 80%

PROJECTS
Resume Analyzer (React, Node.js, MongoDB)
• Created a tool that scores resumes against job descriptions
Tech: React, Express

EDUCATION
B.E. in Computer Science, Anna University, Chennai
2016 - 2020
CGPA: 8.4/10

CERTIFICATIONS
AWS Certified Cloud Practitioner - Amazon Web Services, 2023
`;

// Shaped like LinkedIn's "Save to PDF" export for the same fake person, with extra and conflicting facts:
// - an earlier internship not on the resume, extra skills, a certification
// - the Bright Apps start date differs (Feb 2021 vs Jan 2021 on the resume)
export const SAMPLE_LINKEDIN_TEXT = `Contact
priya.raman@example.com
www.linkedin.com/in/priya-raman-demo (LinkedIn)
Top Skills
GraphQL
Redis
Jest
Certifications
Meta Front-End Developer
Priya Raman
Full Stack Developer at Acme Fintech
Chennai, Tamil Nadu, India
Summary
I build fast, accessible web products for fintech teams.
Experience
Acme Fintech Pvt Ltd
Software Engineer
June 2022 - Present (2 years 5 months)
Chennai, Tamil Nadu, India
Led migration of the merchant onboarding flow to React Query, cutting page load
time in half.
Bright Apps
Junior Developer
February 2021 - May 2022 (1 year 4 months)
Developed REST APIs with Node.js and Express for a food delivery app
Demo Labs
Software Intern
May 2020 - December 2020 (8 months)
Built internal dashboards with React and Chart.js.
Page 1 of 2
Education
Anna University
Bachelor of Engineering - BE, Computer Science · (2016 - 2020)
Page 2 of 2
`;

export function sampleResume(): ResumeContent {
  return {
    targetJobTitle: 'Full Stack Developer',
    personalInfo: {
      fullName: 'Priya Raman',
      email: 'priya.raman@example.com',
      phone: '+91 98765 43210',
      location: 'Chennai, India',
      linkedin: 'linkedin.com/in/priya-raman-demo',
      github: 'github.com/priya-demo',
      portfolio: '',
    },
    summary:
      'Full stack developer with 3 years of experience building web applications with React, Node.js and MongoDB. Focused on clean APIs, performance and accessible user interfaces for fintech and consumer products, with a strong record of mentoring and shipping reliable features.',
    skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Express', 'MongoDB', 'PostgreSQL', 'Git', 'Docker', 'AWS'],
    experience: [
      {
        company: 'Acme Fintech Pvt Ltd',
        jobTitle: 'Software Engineer',
        location: 'Chennai, India',
        startDate: 'Jun 2022',
        endDate: '',
        current: true,
        description: [
          'Built a payments dashboard in React and TypeScript used by 12,000 merchants',
          'Reduced API response time by 40% by adding Redis caching and query indexes',
          'Mentored 3 junior developers through weekly code reviews and pairing sessions',
        ],
      },
      {
        company: 'Bright Apps',
        jobTitle: 'Junior Developer',
        location: 'Chennai, India',
        startDate: 'Jan 2021',
        endDate: 'May 2022',
        current: false,
        description: [
          'Developed REST APIs with Node.js and Express for a food delivery app serving 50,000 users',
          'Wrote unit tests with Jest, raising coverage from 45% to 80%',
        ],
      },
    ],
    education: [
      { institution: 'Anna University', degree: 'B.E.', field: 'Computer Science', location: 'Chennai', startDate: '2016', endDate: '2020', grade: 'CGPA: 8.4/10' },
    ],
    projects: [
      { name: 'Resume Analyzer', description: ['Created a tool that scores 500+ resumes against job descriptions'], technologies: ['React', 'Express'], url: '' },
    ],
    certifications: [{ name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services', date: '2023', url: '' }],
    additionalSections: [{ title: 'Achievements', items: ['Won first place at a state-level hackathon with a team of 4'] }],
  };
}

export const SAMPLE_JD = `Senior Frontend Engineer

Requirements:
- 3+ years of experience with React and TypeScript
- Experience building REST APIs with Node.js
- Strong knowledge of GraphQL

Nice to have:
- Experience with Docker and Kubernetes
- Familiarity with AWS
`;
