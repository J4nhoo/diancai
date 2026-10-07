'use strict';

/**
 * 轻量语法检查：解析全部 JS 文件，捕获语法错误（不执行，避免连库等副作用）。
 *
 *   npm run check
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'src'),
  path.join(ROOT, 'scripts'),
  path.resolve(ROOT, '..', 'web', 'js'),
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = TARGETS.flatMap(walk);
let failed = 0;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    // eslint-disable-next-line no-new
    new vm.Script(source, { filename: file });
  } catch (err) {
    failed += 1;
    console.error(`✗ ${path.relative(ROOT, file)}`);
    console.error(`  ${err.message}`);
  }
}

if (failed) {
  console.error(`\n语法检查未通过：${failed}/${files.length} 个文件有错误`);
  process.exit(1);
}

console.log(`全部文件语法检查通过 ✓（共 ${files.length} 个文件）`);
