// Refresh the no-JavaScript worked example; --check detects stale published numbers.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { values } = require('./model.js');
const file = path.join(__dirname, '../inventory-finance.html');
const html = fs.readFileSync(file, 'utf8');
const data = values('loss');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const rendered = html.replace(/(<([a-z0-9]+)\b[^>]*data-value="([^"]+)"[^>]*>)[\s\S]*?(<\/\2>)/g,
  (_, opening, tag, key, closing) => {
    if (!(key in data)) throw new Error('Unknown field: ' + key);
    return opening + escape(data[key]) + closing;
  });
if (process.argv.includes('--check')) {
  if (rendered !== html) throw new Error('Worked example is stale: run node notes/inventory-finance/build.js');
} else fs.writeFileSync(file, rendered);
