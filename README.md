# Magento Extension Check

Checks a Magento 2 extension against one Magento Open Source release and one PHP version. Combine it with [Magento Version Matrix](https://github.com/lbajsarowicz/github-action-magento-matrix) to cover every supported release.

Status: proof of concept.

## Checks

| Check | What it does | Needs Magento |
|---|---|---|
| `validate` | `composer validate`; `registration.php` and `etc/module.xml` agree on the module name | no |
| `lint` | PHP syntax of every `.php` and `.phtml` file | no |
| `phpcs` | Magento coding standard; fails at severity 10, reports the rest | no |
| `install` | Installs the release from the Mage-OS mirror with your checkout as a Composer path package, then proves the installed and registered module is the checkout | yes |
| `compile` | `module:enable --all` and `setup:di:compile`, without a database | yes |
| `unit` | PHPUnit shipped with that release, on `Test/Unit` | yes |
| `phpstan` | PHPStan shipped with that release; your `phpstan.neon(.dist)` when present | yes |

A check with nothing to run is reported as `skipped`. `compile`, `unit` and `phpstan` are `blocked` when `install` fails.

## Usage

```yaml
name: Magento Check
on:
  pull_request:
  push:
    branches: [main]
permissions: {}
jobs:
  static:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: lbajsarowicz/github-action-magento-extension@v0
        with:
          php-version: '8.3'

  matrix:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions: {}
    outputs:
      matrix: ${{ steps.matrix.outputs.matrix }}
    steps:
      - id: matrix
        uses: lbajsarowicz/github-action-magento-matrix@v0

  magento:
    needs: matrix
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.matrix.outputs.matrix) }}
    name: Magento ${{ matrix.magento }} / PHP ${{ matrix.php }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: lbajsarowicz/github-action-magento-extension@v0
        with:
          magento-version: ${{ matrix.magento }}
          php-version: ${{ matrix.php }}
          checks: install,compile,unit,phpstan
```

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `php-version` | required | PHP minor, such as `8.4` |
| `magento-version` | empty | Exact release, such as `2.4.8-p5`; empty runs static checks only |
| `checks` | `default` | Comma-separated list; `default` is every check the inputs allow |
| `path` | `.` | Directory with the extension's `composer.json` |
| `phpcs-severity` | `10` | Findings at or above this severity fail `phpcs` |
| `phpstan-level` | `1` | Level used when the extension ships no PHPStan config |

Private Composer repositories: set `COMPOSER_AUTH` in the step's `env`.

## Outputs

| Output | Meaning |
|---|---|
| `status` | `passed` or `failed` |
| `result-path` | Directory with `results.json` and one log per check |

## Permissions

`contents: read` for the checkout. The action itself uses no token.

## Known limits of this proof of concept

- One Composer package with one module per run; Magento Open Source only.
- The release's own development dependencies are installed together with the extension, in one dependency graph.
- Composer's block on packages with published advisories is switched off inside the temporary Magento project, because older release lines would not resolve otherwise.
- The extension's own `phpunit.xml`, `require-dev` and `autoload-dev` are not honoured yet.
- No integration tests, no pull-request comment.

## Releases

Every merge to `main` publishes a release candidate (`vX.Y.Z-rc.N`). Marking a candidate as a full release retags it to `vX.Y.Z` and moves the major tag.

## License

MIT
