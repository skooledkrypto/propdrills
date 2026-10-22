// Generates public/privacy.html and public/terms.html from docs/PRIVACY.md and
// docs/TERMS.md (the public copies of src/core/legal.ts). Runs as part of
// `npm run build` so the deployed pages can never drift from the docs.
import { readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

const PAGES = [
  { src: 'docs/PRIVACY.md', out: 'public/privacy.html', title: 'PropDrills — Privacy Policy' },
  { src: 'docs/TERMS.md', out: 'public/terms.html', title: 'PropDrills — Terms of Use' },
  { src: 'docs/ABOUT.md', out: 'public/about.html', title: 'PropDrills — About (Veteran Built, Owned & Operated)' },
];

const shell = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark light" />
<title>${title}</title>
<style>
  :root { color-scheme: dark light; }
  body {
    margin: 0 auto; max-width: 720px; padding: 40px 22px 60px;
    font: 15px/1.65 system-ui, -apple-system, 'Segoe UI', sans-serif;
    background: #0a0e12; color: #e6edf3;
  }
  a { color: #21c77a; }
  h1 { font-size: 26px; letter-spacing: 0.3px; }
  li { margin-bottom: 10px; }
  .home { display: inline-block; margin-bottom: 18px; font-size: 13px; text-decoration: none; }
  @media (prefers-color-scheme: light) {
    body { background: #ffffff; color: #0b0f14; }
    a { color: #0b7a55; }
  }
</style>
</head>
<body>
<a class="home" href="/">← PropDrills</a>
${body}
</body>
</html>
`;

for (const { src, out, title } of PAGES) {
  const md = readFileSync(src, 'utf8')
    .split('\n')
    .filter((l) => !l.includes('<!--'))
    .join('\n');
  writeFileSync(out, shell(title, marked.parse(md)));
  console.log(`${src} → ${out}`);
}
