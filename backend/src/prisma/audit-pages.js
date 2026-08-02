const fs = require('fs');
const path = require('path');

function walk(d, r = []) {
  fs.readdirSync(d).forEach(i => {
    const f = path.join(d, i);
    try {
      if (fs.statSync(f).isDirectory()) walk(f, r);
      else if (i === 'page.tsx') r.push(f);
    } catch (e) {}
  });
  return r;
}

const base = path.join(__dirname, '../../../frontend/src/app/(dashboard)');
const pages = walk(base);
const issues = [];

pages.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  const name = f.replace(base + path.sep, '').replace(path.sep + 'page.tsx', '').replace(/\\/g, '/');

  const checks = {
    hasLoading: c.includes('isLoading') || c.includes('Skeleton') || c.includes('animate-pulse') || c.includes('PageLoader'),
    hasError: c.includes('isError') || c.includes('ErrorState') || c.includes('onError') || c.includes('destructive'),
    hasTitle: c.includes('<h1') || c.includes('font-bold'),
    hasUseClient: c.startsWith("'use client'"),
  };

  const missing = Object.entries(checks).filter(([k, v]) => !v).map(([k]) => k);
  if (missing.length > 0) issues.push({ name, missing });
});

console.log('=== PAGE AUDIT ===');
if (issues.length === 0) {
  console.log('All ' + pages.length + ' pages OK!');
} else {
  issues.forEach(i => console.log('  ' + i.name + ': missing ' + i.missing.join(', ')));
  console.log('\nTotal issues: ' + issues.length + '/' + pages.length + ' pages');
}
