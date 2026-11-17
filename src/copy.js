'use strict';

const fs = require('node:fs');
const path = require('node:path');

function skipped(relative) {
  const parts = relative.split(path.sep);
  return parts.includes('.git') || parts[0] === 'vendor';
}

function listFiles(root, directory = root, found = new Map()) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full);
    if (skipped(relative)) {
      continue;
    }
    if (entry.isDirectory()) {
      listFiles(root, full, found);
    } else {
      found.set(relative, full);
    }
  }
  return found;
}

/**
 * Makes `target` hold exactly the files of `source`, leaving out `.git` and a top-level `vendor`.
 */
function mirrorDirectory(source, target) {
  for (const entry of fs.readdirSync(target)) {
    if (entry !== 'vendor') {
      fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    }
  }
  fs.cpSync(source, target, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (from) => from === source || !skipped(path.relative(source, from)),
  });
}

/**
 * Relative paths that exist on one side only or differ in content, at most `limit` of them.
 */
function differences(source, target, limit = 5) {
  const left = listFiles(source);
  const right = listFiles(target);
  const found = [];
  for (const relative of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (found.length >= limit) {
      break;
    }
    if (!left.has(relative) || !right.has(relative)) {
      found.push(`${relative}: only in the ${left.has(relative) ? 'checkout' : 'installed copy'}`);
      continue;
    }
    const [a, b] = [fs.lstatSync(left.get(relative)), fs.lstatSync(right.get(relative))];
    const same = a.isSymbolicLink() || b.isSymbolicLink()
      ? a.isSymbolicLink() && b.isSymbolicLink() && fs.readlinkSync(left.get(relative)) === fs.readlinkSync(right.get(relative))
      : a.size === b.size && fs.readFileSync(left.get(relative)).equals(fs.readFileSync(right.get(relative)));
    if (!same) {
      found.push(`${relative}: differs`);
    }
  }
  return found;
}

module.exports = { mirrorDirectory, differences };
