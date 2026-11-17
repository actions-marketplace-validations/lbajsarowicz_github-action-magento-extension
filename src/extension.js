'use strict';

const fs = require('node:fs');
const path = require('node:path');

function walk(directory, visit, { maxDepth = Infinity, skip = () => false }, depth = 1) {
  if (depth > maxDepth) {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (skip(entry.name, full)) {
        continue;
      }
      visit(full, entry, depth);
      walk(full, visit, { maxDepth, skip }, depth + 1);
    } else if (entry.isFile()) {
      visit(full, entry, depth);
    }
  }
}

/** Module names declared by `etc/module.xml` files of the extension, sorted. */
function moduleNames(extension) {
  const names = new Set();
  walk(extension, (file, entry) => {
    if (!entry.isFile() || entry.name !== 'module.xml' || path.basename(path.dirname(file)) !== 'etc') {
      return;
    }
    const match = /<module\b[^>]*\bname\s*=\s*["']([^"']+)["']/.exec(fs.readFileSync(file, 'utf8'));
    if (match && /^[A-Za-z0-9]+_[A-Za-z0-9]+$/.test(match[1])) {
      names.add(match[1]);
    }
  }, { maxDepth: 5, skip: (name) => name === 'vendor' || name === 'Test' });
  return [...names].sort();
}

/** PHP and template files of the extension, outside any vendor directory. */
function phpFiles(extension) {
  const files = [];
  walk(extension, (file, entry) => {
    if (entry.isFile() && /\.(php|phtml)$/.test(entry.name)) {
      files.push(file);
    }
  }, { skip: (name) => name === 'vendor' });
  return files.sort();
}

/** Modules that no `registration.php` of the extension mentions. */
function unregisteredModules(extension, modules) {
  const registrations = [];
  walk(extension, (file, entry) => {
    if (entry.isFile() && entry.name === 'registration.php') {
      registrations.push(fs.readFileSync(file, 'utf8'));
    }
  }, { skip: (name) => name === 'vendor' });
  return modules.filter((module) => !registrations.some((content) => content.includes(module)));
}

/** Directories such as `Test/Unit` inside the extension, at most six levels deep. */
function testDirectories(source, kind) {
  const found = [];
  walk(source, (directory, entry) => {
    if (entry.isDirectory() && entry.name === kind && path.basename(path.dirname(directory)) === 'Test') {
      found.push(directory);
    }
  }, { maxDepth: 6, skip: (name, full) => full === path.join(source, 'vendor') });
  return found.sort();
}

module.exports = { moduleNames, phpFiles, unregisteredModules, testDirectories };
