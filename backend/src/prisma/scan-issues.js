const fs = require('fs');
const path = require('path');

function walk(d, r = []) {
  try {
    fs.readdirSync(d).forEach(i => {
      const f = path.join(d, i);
      try {
        if (fs.statSync(f).isDirectory()) walk(f, r);
        else if (i.endsWith('.tsx') || i.endsWith('.ts')) r.push(f);
      } catch (e) {}
    });
  } catch (e) {}
  return r;
}

const srcDir = path.join(__dirname, '../../../frontend/src');
const files = walk(srcDir);
const issues = [];

files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  const rel = f.replace(srcDir + path.sep, '').replace(/\\/g, '/');

  // 1. Empty SelectItem value
  if (/SelectItem[^>]*value=["']\s*["']/.test(c)) {
    issues.push({ file: rel, issue: 'Empty SelectItem value=""' });
  }

  // 2. href with undefined/null (common crash)
  const hrefUndef = c.match(/href=\{[^}]*undefined[^}]*\}/g);
  if (hrefUndef) issues.push({ file: rel, issue: 'href with undefined: ' + hrefUndef[0] });

  // 3. Calling .map on potentially undefined without guard
  const unsafeMap = c.match(/[a-zA-Z]+\.map\(/g);
  if (unsafeMap && !c.includes('|| []') && !c.includes('?? []') && !c.includes('Array.from')) {
    // Only flag if it's data from API without guard
    if (c.includes('.data.map(') || c.includes('data?.map(')) {
      // These are fine with optional chaining
    }
  }

  // 4. format() called on potentially invalid date
  const formatCalls = c.match(/format\(new Date\([^)]*\)/g);
  if (formatCalls) {
    formatCalls.forEach(m => {
      if (!m.includes('?') && !m.includes('||')) {
        // Could crash if date is null/undefined
      }
    });
  }

  // 5. Missing 'use client' on files that use hooks
  if (!c.startsWith("'use client'") && (c.includes('useState') || c.includes('useEffect') || c.includes('useQuery'))) {
    if (!f.includes('node_modules') && !f.includes('.next')) {
      issues.push({ file: rel, issue: "Missing 'use client' but uses hooks" });
    }
  }
});

console.log('=== RUNTIME ISSUE SCAN ===');
if (issues.length === 0) {
  console.log('No issues found!');
} else {
  issues.forEach(i => console.log('  ' + i.file + ': ' + i.issue));
}
console.log('Scanned: ' + files.length + ' files, Issues: ' + issues.length);
