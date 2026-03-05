const fs   = require('fs');
const path = require('path');

const assets = [
  'visualization.template.html',
  'visualization.template.css',
  'visualization.template.browser.js',
];

assets.forEach(name => {
  const src = path.join(__dirname, '../src/output', name);
  const dst = path.join(__dirname, '../dist/output', name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`Copied ${name} → dist/output/`);
});
