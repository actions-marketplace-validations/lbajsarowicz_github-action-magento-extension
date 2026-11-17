#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { ConfigError } = require('./errors');
const { readConfig } = require('./config');
const { runChecks, writeStepSummary } = require('./run');
const { detectPrepared } = require('./workdir');
const { changedFiles } = require('./changed-files');

function output(values) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join(''));
  }
}

function job(env) {
  return `${env.GITHUB_RUN_ID || '0'}-${env.GITHUB_RUN_ATTEMPT || '0'}-${env.GITHUB_JOB || 'job'}`;
}

const commands = {
  async run() {
    const config = readConfig(process.env);
    process.env.COMPOSER_NO_INTERACTION = '1';
    process.env.COMPOSER_MEMORY_LIMIT = '-1';
    const phpRuntime = execFileSync('php', ['-r', 'echo PHP_VERSION;'], { encoding: 'utf8' });
    const result = await runChecks(config, require('./checks'), { phpRuntime });
    writeStepSummary(config, result, process.env.GITHUB_STEP_SUMMARY);
    output({ status: result.status, 'result-path': config.results });
    return result.status === 'passed' ? 0 : 1;
  },

  async prepare() {
    const env = process.env;
    const prepared = detectPrepared({
      work: env.MEC_WORK_DIR,
      job: job(env),
      phpVersion: env.MEC_PHP_VERSION,
      profile: env.MEC_PROFILE,
      cacheId: env.MEC_CACHE_ID,
    });
    output(prepared);
    return 0;
  },

  async 'changed-files'() {
    const env = process.env;
    const target = path.join(env.MEC_WORK_DIR, 'changed-files.txt');
    fs.mkdirSync(env.MEC_WORK_DIR, { recursive: true });
    fs.rmSync(target, { force: true });
    let event = {};
    try {
      event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    } catch {
      event = {};
    }
    const files = await changedFiles({
      event,
      repository: env.GITHUB_REPOSITORY,
      api: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
      token: env.MEC_TOKEN,
    });
    if (files === null) {
      console.log('Changed files are not known; checks that depend on them cover every file.');
      return 0;
    }
    fs.writeFileSync(target, files.length > 0 ? `${files.join('\n')}\n` : '');
    console.log(`${files.length} changed file(s)`);
    return 0;
  },
};

async function main() {
  const command = commands[process.argv[2]];
  if (!command) {
    throw new ConfigError(`Unknown command '${process.argv[2]}'.`);
  }
  return command();
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    const message = error instanceof ConfigError ? error.message : `${error.stack || error}`;
    console.log(`::error title=Magento Extension Check::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    process.exitCode = 1;
  },
);
