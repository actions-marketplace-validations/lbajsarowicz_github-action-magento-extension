# Magento Extension Check

Checks a Magento 2 extension against one Magento Open Source release and one PHP version. Combine it with [Magento Version Matrix](https://github.com/lbajsarowicz/github-action-magento-matrix) to cover every supported release.

Status: proof of concept.

## Checks

| Check | What it does | Needs Magento |
|---|---|---|
| `validate` | `composer validate`; `registration.php` and `etc/module.xml` agree on the module name | no |
| `lint` | PHP syntax of every `.php` and `.phtml` file | no |
| `phpcs` | PHPCS on the PHP files changed by the pull request or push, with the repository's ruleset or the official Magento 2 coding standard | no |
| `install` | Installs the release from the Mage-OS mirror with your checkout as a Composer path package, then proves the installed and registered module is an exact copy of the checkout | yes |
| `compile` | `module:enable --all` and `setup:di:compile`, without a database | yes |
| `unit` | PHPUnit shipped with that release, on `Test/Unit` | yes |
| `phpstan` | PHPStan with the repository's configuration, or a default that loads `bitexpert/phpstan-magento` | yes |

A check with nothing to run is reported as `skipped`. `compile`, `unit` and `phpstan` are `blocked` when `install` fails.

## Actions in this repository

One action per kind of check, so every job in the pull request says what it does.

| Reference | Runs | Needs |
|---|---|---|
| `lbajsarowicz/github-action-magento-extension/static` | `composer validate`, module metadata, PHP syntax | PHP only |
| `lbajsarowicz/github-action-magento-extension/phpcs` | Coding standard on changed files | Magento release |
| `lbajsarowicz/github-action-magento-extension/phpstan` | Static analysis | Magento release |
| `lbajsarowicz/github-action-magento-extension/compile` | `setup:di:compile` and `setup:static-content:deploy`, without a database | Magento release |
| `lbajsarowicz/github-action-magento-extension/phpunit` | Unit tests (`suite: unit`) or integration tests (`suite: integration`) | Magento release; integration also MariaDB/MySQL and OpenSearch services |
| `lbajsarowicz/github-action-magento-extension/install` | Installs the release with the extension, for later steps of the same job | Magento release |
| `lbajsarowicz/github-action-magento-extension/report` | One table with the results of every job; fails when any check failed | Result artifacts of the check jobs |
| `lbajsarowicz/github-action-magento-extension` | Several of the above in one job (`checks` input) | Magento release |

Each action that needs a Magento release installs it first and proves the installed module is your checkout.

## Usage

The matrix action supplies every distinct PHP version for the static checks and every Magento and PHP combination for the rest. Job names follow the pattern `Compile: Magento 2.4.9 @ PHP 8.5`.

```yaml
name: Magento Check
on:
  pull_request:
  push:
    branches: [main]
permissions: {}
jobs:
  matrix:
    name: Version matrix
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions: {}
    outputs:
      matrix: ${{ steps.matrix.outputs.matrix }}
      php: ${{ steps.matrix.outputs.php }}
    steps:
      - id: matrix
        uses: lbajsarowicz/github-action-magento-matrix@v0

  static:
    name: "Static checks @ PHP ${{ matrix.php }}"
    needs: matrix
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix:
        php: ${{ fromJSON(needs.matrix.outputs.php) }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: lbajsarowicz/github-action-magento-extension/static@v0
        with:
          php-version: ${{ matrix.php }}
          checks: validate,lint

  compile:
    name: "Compile: Magento ${{ matrix.magento }} @ PHP ${{ matrix.php }}"
    needs: matrix
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.matrix.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: lbajsarowicz/github-action-magento-extension/compile@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}

  unit:
    name: "Unit tests: Magento ${{ matrix.magento }} @ PHP ${{ matrix.php }}"
    needs: matrix
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.matrix.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: lbajsarowicz/github-action-magento-extension/phpunit@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}
          suite: unit
```

`phpcs` and `phpstan` jobs have the same shape with `annotations: ${{ strategy.job-index == 0 }}` added. An integration job adds two service containers, whose versions also come from the matrix:

```yaml
  integration:
    name: "Integration tests: Magento ${{ matrix.magento }} @ PHP ${{ matrix.php }}"
    needs: matrix
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.matrix.outputs.matrix) }}
    services:
      mariadb:
        image: mariadb:${{ matrix.mariadb }}
        env:
          MARIADB_ROOT_PASSWORD: magento
        ports:
          - 3306:3306
        options: >-
          --health-cmd "healthcheck.sh --connect --innodb_initialized"
          --health-interval 10s --health-timeout 5s --health-retries 12
      opensearch:
        image: opensearchproject/opensearch:${{ matrix.opensearch }}
        env:
          discovery.type: single-node
          DISABLE_SECURITY_PLUGIN: 'true'
          DISABLE_INSTALL_DEMO_CONFIG: 'true'
          OPENSEARCH_JAVA_OPTS: -Xms512m -Xmx512m
        ports:
          - 9200:9200
        options: >-
          --health-cmd "curl -fs http://localhost:9200/_cluster/health"
          --health-interval 10s --health-timeout 5s --health-retries 30
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: lbajsarowicz/github-action-magento-extension/phpunit@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}
          suite: integration
          db-password: magento
```

## One job per version combination

The sub-actions can also be steps of one job. The pull request then shows one row per Magento and PHP combination, and a `Result` row with a table of every check.

- Magento is installed once per job. Each later step reuses the install, PHP and the Composer cache of the steps before it.
- A step that fails names the check that failed. The steps that depend on it are skipped: nothing runs after a failed install, unit tests and PHPStan need a successful compilation, integration tests need passing unit tests.
- `report` reads the results of all jobs and writes one table to the run summary. Make `Result` the required check in branch protection.

```yaml
jobs:
  matrix:
    # as in Usage above

  check:
    name: "Magento ${{ matrix.magento }} @ PHP ${{ matrix.php }}"
    needs: matrix
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    permissions:
      contents: read
      pull-requests: read # list the files changed by the pull request
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.matrix.outputs.matrix) }}
    env:
      # The Result job shows one table for the whole run instead of one per step.
      MAGENTO_EXTENSION_CHECK_SUMMARY: 'false'
    services:
      mariadb:
        image: mariadb:${{ matrix.mariadb }}
        env:
          MARIADB_ROOT_PASSWORD: magento
        ports:
          - 3306:3306
        options: >-
          --health-cmd "healthcheck.sh --connect --innodb_initialized"
          --health-interval 10s --health-timeout 5s --health-retries 12
      opensearch:
        image: opensearchproject/opensearch:${{ matrix.opensearch }}
        env:
          discovery.type: single-node
          DISABLE_SECURITY_PLUGIN: 'true'
          DISABLE_INSTALL_DEMO_CONFIG: 'true'
        ports:
          - 9200:9200
        options: >-
          --health-cmd "curl -fs http://localhost:9200/_cluster/health"
          --health-interval 10s --health-timeout 5s --health-retries 30
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false

      - name: Composer and syntax
        id: static
        uses: lbajsarowicz/github-action-magento-extension/static@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}
          checks: validate,lint

      - name: Install Magento ${{ matrix.magento }}
        id: install
        uses: lbajsarowicz/github-action-magento-extension/install@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}

      - name: PHPCS
        id: phpcs
        uses: lbajsarowicz/github-action-magento-extension/phpcs@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}
          annotations: ${{ strategy.job-index == 0 }}

      - name: Compile and static content
        id: compile
        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
        uses: lbajsarowicz/github-action-magento-extension/compile@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}

      - name: Unit tests
        id: unit
        if: ${{ !cancelled() && steps.compile.outcome == 'success' }}
        uses: lbajsarowicz/github-action-magento-extension/phpunit@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}
          suite: unit
          testdox: true

      - name: Integration tests
        id: integration
        if: ${{ !cancelled() && steps.unit.outcome == 'success' }}
        uses: lbajsarowicz/github-action-magento-extension/phpunit@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}
          suite: integration
          testdox: true
          db-password: magento

      - name: PHPStan
        id: phpstan
        if: ${{ !cancelled() && steps.compile.outcome == 'success' }}
        uses: lbajsarowicz/github-action-magento-extension/phpstan@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}
          annotations: ${{ strategy.job-index == 0 }}

      - name: Upload results
        if: ${{ always() && steps.static.outputs.result-path != '' }}
        uses: actions/upload-artifact@v7
        with:
          name: magento-check-${{ matrix.magento }}-php${{ matrix.php }}
          path: ${{ steps.static.outputs.result-path }}
          retention-days: 7

  result:
    name: Result
    if: ${{ always() }}
    needs: [matrix, check]
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions: {}
    steps:
      - uses: actions/download-artifact@v8
        with:
          pattern: magento-check-*
          path: magento-check-results
      - uses: lbajsarowicz/github-action-magento-extension/report@v0
        with:
          matrix: ${{ needs.matrix.outputs.matrix }}
      - name: Fail unless every job succeeded
        if: ${{ always() }}
        env:
          RESULTS: ${{ join(needs.*.result, ' ') }}
        run: |
          echo "Jobs: $RESULTS"
          [[ ! "$RESULTS" =~ (failure|cancelled|skipped) ]]
```

`MAGENTO_EXTENSION_CHECK_SUMMARY: 'false'` turns off the per-step summaries, so the table of the `Result` job is the only one.

| Mark | Meaning |
|---|---|
| ✅ | passed |
| ❌ | failed; the reason and the end of the log are below the table |
| ➖ | nothing to run, such as no `Test/Unit` directory |
| ⛔ | blocked by a failed install |
| ⚪ | not run because an earlier check failed |
| ❔ | the job uploaded no result |

## Inputs

These are the inputs of the root action. Each sub-action takes the subset that applies to it, with shorter names where there is no ambiguity (`config`, `severity`, `scope`, `level`, `baseline`); see its `action.yml`.

The static action takes `php-version`, `checks`, `path`, `phpcs-config`, `phpcs-severity`, `phpcs-scope`, `annotations` and `github-token` with the same meaning.

| Input | Default | Meaning |
|---|---|---|
| `php-version` | required | PHP minor, such as `8.4` |
| `magento-version` | empty | Exact release, such as `2.4.8-p5`; empty runs static checks only |
| `checks` | `default` | Comma-separated list; `default` is every check the inputs allow |
| `path` | `.` | Directory with the extension's `composer.json` |
| `phpcs-config` | empty | Path to a PHPCS ruleset; see Configuration |
| `phpcs-severity` | empty | Findings at or above this severity fail `phpcs`; see Configuration |
| `phpstan-config` | empty | Path to a PHPStan configuration; see Configuration |
| `phpstan-baseline` | empty | Baseline loaded on top of the default PHPStan configuration |
| `phpcs-scope` | `changed` | `changed` checks files touched by the pull request or push, `all` checks every file |
| `annotations` | `true` | Show PHPCS and PHPStan findings inline in the pull request diff |
| `github-token` | `github.token` | Only reads the list of changed files |
| `phpstan-level` | `1` | Level of the default PHPStan configuration |
| `phpunit-testdox` | `false` | Print every test name as a readable sentence (PHPUnit `--testdox`); `testdox` in the `phpunit` action |

Private Composer repositories: set `COMPOSER_AUTH` in the step's `env`.

## Configuration

PHPCS and PHPStan use the first of these that exists:

| Order | PHPCS | PHPStan |
|---|---|---|
| 1. Input | `phpcs-config` | `phpstan-config` |
| 2. File in the extension | `.phpcs.xml`, `phpcs.xml`, `.phpcs.xml.dist`, `phpcs.xml.dist` | `phpstan.neon`, `phpstan.neon.dist`, `phpstan.dist.neon` |
| 3. Default | Official `Magento2` standard from `magento/magento-coding-standard`, unchanged | `bitexpert/phpstan-magento` at `phpstan-level` |

A path given by input that does not exist fails the check. The job summary names the configuration that was used, and says so when the pull request itself changed it.

With the default ruleset `phpcs` fails at severity 10 and reports the rest as warnings. With a repository ruleset it fails on what that ruleset reports as errors. `phpcs-severity` overrides both.

A repository PHPStan configuration brings its baseline through its own `includes:`. Without a configuration, `phpstan-baseline` loads a baseline on top of the default.

## Tool versions

Every Magento release declares its own development tools, and the checks use them:

| Tool | Version used |
|---|---|
| PHPUnit | The one the release under test resolves (9.6 on 2.4.7, 10.5 on 2.4.8, 12.5 on 2.4.9 today) |
| PHPStan | From the extension's `require-dev` when it lists PHPStan packages; otherwise the release's own PHPStan with the `bitexpert/phpstan-magento` version that fits it |
| PHPCS and coding standard | From the extension's `require-dev` when it lists them; otherwise what the release resolves; in the static action, which installs no Magento, current releases |

The summary of every check names the version it ran and where it came from.

## Inline findings

PHPCS and PHPStan findings appear as annotations on the affected lines in the pull request's "Files changed" tab. PHPStan analyses the whole extension, but only findings in changed files are annotated. GitHub keeps 10 errors and 10 warnings per step, so findings in changed files are listed first; the complete list is in the job log and in `result-path`.

When the same check runs in several matrix jobs, switch `annotations` off in all but one, or every finding appears once per job:

```yaml
annotations: ${{ strategy.job-index == 0 }}
```

## Outputs

| Output | Meaning |
|---|---|
| `status` | `passed` or `failed` |
| `result-path` | Directory with `results.json` and one log per check |

## Permissions

`contents: read` for the checkout. In a private repository add `pull-requests: read` so the action can list the changed files; without it PHPCS checks every file.

## Known limits of this proof of concept

- One Composer package per run (it may hold several modules); Magento Open Source only.
- The release's own development dependencies are installed together with the extension, in one dependency graph.
- Composer's block on packages with published advisories is switched off inside the temporary Magento project, because older release lines would not resolve otherwise.
- The extension's own `phpunit.xml`, `require-dev` and `autoload-dev` are not honoured yet.
- Every job installs Magento again, which costs 30 to 45 seconds per job.
- No pull-request comment.

## Releases

Every merge to `main` publishes a release candidate (`vX.Y.Z-rc.N`). Marking a candidate as a full release retags it to `vX.Y.Z` and moves the major tag.

## License

MIT
