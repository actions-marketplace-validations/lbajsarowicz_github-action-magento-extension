'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CheckFailed } = require('../errors');

/** A file of the workspace given by an input, or null when it is not a file inside the workspace. */
function workspaceFile(workspace, requested) {
  try {
    const real = fs.realpathSync(path.resolve(workspace, requested));
    return real.startsWith(workspace + path.sep) && fs.statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/**
 * Picks the configuration of a tool: the input, then a file of the extension, then the action default.
 *
 * @returns {{file: ?string, label: string}} `file` is null for the action default
 */
function resolveToolConfig(ctx, requested, candidates) {
  const { workspace, extension } = ctx.config;
  let file = null;
  let label = 'action default';
  if (requested) {
    file = workspaceFile(workspace, requested);
    if (!file) {
      throw new CheckFailed(`configured file '${requested}' does not exist in the workspace`);
    }
    label = `configured ${requested}`;
  } else {
    const candidate = candidates.find((name) => fs.existsSync(path.join(extension, name)));
    if (candidate) {
      file = path.join(extension, candidate);
      label = `repository ${candidate}`;
    }
  }
  if (file && ctx.changed && ctx.changed.has(path.relative(workspace, file))) {
    label += ', changed in this pull request';
  }
  return { file, label };
}

module.exports = { resolveToolConfig, workspaceFile };
