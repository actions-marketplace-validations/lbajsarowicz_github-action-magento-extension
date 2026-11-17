'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');

class CommandFailed extends Error {
  constructor(command, code) {
    super(`${command} exited with ${code}`);
    this.code = code;
  }
}

/**
 * Runs commands for one check. Output goes to `write` (the job log and the check's log file)
 * unless `echo` is false; it is always returned.
 */
function createShell(write) {
  /**
   * @param {{cwd?: string, env?: Object, echo?: boolean, allowFailure?: boolean, stdoutFile?: string}} options
   * @returns {Promise<{code: number, stdout: string, output: string}>}
   */
  function exec(command, args = [], options = {}) {
    const { cwd, env, echo = true, allowFailure = false, stdoutFile } = options;
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let output = '';
      const file = stdoutFile ? fs.createWriteStream(stdoutFile) : null;
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        output += chunk;
        if (file) {
          file.write(chunk);
        } else if (echo) {
          write(chunk.toString());
        }
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
        if (echo) {
          write(chunk.toString());
        }
      });
      child.on('error', (error) => reject(new CommandFailed(`${command}: ${error.message}`, 127)));
      child.on('close', (code) => {
        const finish = () => (code === 0 || allowFailure
          ? resolve({ code, stdout, output })
          : reject(new CommandFailed(command, code)));
        if (file) {
          file.end(finish);
        } else {
          finish();
        }
      });
    });
  }

  return { exec };
}

module.exports = { createShell, CommandFailed };
