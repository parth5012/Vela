#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, '..');
const coveragePath = path.join(clientRoot, 'e2e/ui/COVERAGE.md');
const specsDir = path.join(clientRoot, 'e2e/ui/specs');

if (!fs.existsSync(coveragePath)) {
  console.error(`COVERAGE.md not found at ${coveragePath}`);
  process.exit(1);
}

const content = fs.readFileSync(coveragePath, 'utf8');
const regex = /\|\s*\d+\s*\|\s*[^|]+\s*\|\s*`client\/e2e\/ui\/specs\/([^`]+)`/g;

const matchedFiles = [];
let match;
while ((match = regex.exec(content)) !== null) {
  matchedFiles.push(match[1]);
}

console.log(`Validating ${matchedFiles.length} feature specs from COVERAGE.md...`);

if (matchedFiles.length !== 20) {
  console.error(`Expected 20 feature specs in COVERAGE.md, but found ${matchedFiles.length}`);
  process.exit(1);
}

const missing = [];
for (const file of matchedFiles) {
  const fullPath = path.join(specsDir, file);
  if (!fs.existsSync(fullPath)) {
    missing.push(file);
  }
}

if (missing.length > 0) {
  console.error(`Missing spec files on disk:\n${missing.map((f) => ` - ${f}`).join('\n')}`);
  process.exit(1);
}

console.log(`All ${matchedFiles.length} feature specs exist on disk under client/e2e/ui/specs/!`);
process.exit(0);
