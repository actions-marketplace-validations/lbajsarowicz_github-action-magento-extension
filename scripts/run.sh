#!/usr/bin/env bash
set -uo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIRROR="https://mirror.mage-os.org/"
ALL_CHECKS="validate lint phpcs install compile unit phpstan"
MAGENTO_CHECKS="install compile unit phpstan"
SKIPPED=78

fail_config() {
  echo "::error title=Magento Extension Check::$1"
  exit 1
}

[[ "$MEC_PHP_VERSION" =~ ^[0-9]+\.[0-9]+$ ]] || fail_config "php-version must be a minor such as 8.4, got '${MEC_PHP_VERSION}'."
[[ -z "$MEC_MAGENTO_VERSION" || "$MEC_MAGENTO_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-p[0-9]+)?$ ]] \
  || fail_config "magento-version must be a release such as 2.4.8-p5, got '${MEC_MAGENTO_VERSION}'."
[[ "$MEC_PHPCS_SEVERITY" =~ ^[0-9]+$ ]] || fail_config "phpcs-severity must be a whole number."
[[ "$MEC_PHPSTAN_LEVEL" =~ ^([0-9]|10|max)$ ]] || fail_config "phpstan-level must be 0-10 or max."
[[ "$MEC_PHPCS_SCOPE" =~ ^(changed|all)$ ]] || fail_config "phpcs-scope must be changed or all."
[[ "$MEC_ANNOTATIONS" =~ ^(true|false)$ ]] || fail_config "annotations must be true or false."

EXT="$(cd "${GITHUB_WORKSPACE}/${MEC_PATH}" 2>/dev/null && pwd -P)" || fail_config "path '${MEC_PATH}' does not exist in the workspace."
[[ "$EXT" == "$(cd "$GITHUB_WORKSPACE" && pwd -P)"* ]] || fail_config "path must stay inside the workspace."
[[ -f "$EXT/composer.json" ]] || fail_config "No composer.json in '${MEC_PATH}'."

WORK="$MEC_WORK_DIR"
RESULTS="$WORK/results"
MAGENTO_ROOT="$WORK/magento"
TOOLS="$WORK/tools"
rm -rf "$MAGENTO_ROOT" "$TOOLS" "$RESULTS"
mkdir -p "$RESULTS"
export EXT WORK RESULTS MAGENTO_ROOT TOOLS MIRROR SCRIPTS
export COMPOSER_NO_INTERACTION=1 COMPOSER_MEMORY_LIMIT=-1

contains() { [[ " $1 " == *" $2 "* ]]; }

requested="${MEC_CHECKS//,/ }"
if [[ "$(echo "$requested" | xargs)" == "default" ]]; then
  if [[ -n "$MEC_MAGENTO_VERSION" ]]; then requested="$ALL_CHECKS"; else requested="validate lint phpcs"; fi
fi
selected=""
for check in $requested; do
  contains "$ALL_CHECKS" "$check" || fail_config "Unknown check '${check}'. Available: ${ALL_CHECKS// /, }."
  if contains "$MAGENTO_CHECKS" "$check"; then
    [[ -n "$MEC_MAGENTO_VERSION" ]] || fail_config "Check '${check}' needs magento-version."
    contains "$selected" install || selected="$selected install"
  fi
  contains "$selected" "$check" || selected="$selected $check"
done
[[ -n "$selected" ]] || fail_config "No checks selected."
ordered=""
for check in $ALL_CHECKS; do
  if contains "$selected" "$check"; then ordered="$ordered $check"; fi
done

EXT_NAME="$(php -r 'echo json_decode(file_get_contents($argv[1]), true)["name"] ?? "";' "$EXT/composer.json")"
[[ "$EXT_NAME" =~ ^[a-z0-9]([_.-]?[a-z0-9]+)*/[a-z0-9]([_.-]?[a-z0-9]+)*$ ]] || fail_config "composer.json has no valid package name."
MODULE_NAMES="$(find "$EXT" -maxdepth 5 -type f -path '*/etc/module.xml' -not -path '*/vendor/*' -not -path '*/Test/*' -print0 \
  | xargs -0 -r -n1 php -r '$x = @simplexml_load_file($argv[1]); echo $x ? (string) ($x->module["name"] ?? "") : "", "\n";' \
  | grep -E '^[A-Za-z0-9]+_[A-Za-z0-9]+$' | sort -u | tr '\n' ' ')"
MODULE_NAMES="${MODULE_NAMES% }"
export EXT_NAME MODULE_NAMES

# shellcheck source=checks.sh
source "$SCRIPTS/checks.sh"

label="PHP ${MEC_PHP_VERSION}"
[[ -n "$MEC_MAGENTO_VERSION" ]] && label="Magento ${MEC_MAGENTO_VERSION} / PHP ${MEC_PHP_VERSION}"
install_status=""
overall="passed"
failures=()
: > "$RESULTS/results.tsv"

for check in $ordered; do
  log="$RESULTS/${check}.log"
  note_file="$RESULTS/${check}.note"
  : > "$note_file"
  started="$(date +%s)"
  if contains "compile unit phpstan" "$check" && [[ "$install_status" != "passed" ]]; then
    status="blocked"
    echo "install did not pass" > "$note_file"
  else
    echo "::group::${check}"
    # Output of the extension's own code must not be able to issue workflow commands.
    token="mec-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
    echo "::stop-commands::${token}"
    ( set -e; export NOTE_FILE="$note_file"; "check_${check}" ) 2>&1 | tee "$log"
    code="${PIPESTATUS[0]}"
    echo "::${token}::"
    echo "::endgroup::"
    if [[ "$MEC_ANNOTATIONS" == "true" && -f "$RESULTS/${check}.json" ]]; then
      php "$SCRIPTS/annotate.php" "$check" "$RESULTS/${check}.json" "$RESULTS" "$EXT" "$MEC_PHPCS_SEVERITY"
    fi
    case "$code" in
      0) status="passed" ;;
      "$SKIPPED") status="skipped" ;;
      *) status="failed" ;;
    esac
  fi
  [[ "$check" == "install" ]] && install_status="$status"
  seconds=$(( $(date +%s) - started ))
  note="$(head -c 300 "$note_file" | tr '\t\n' '  ')"
  printf '%s\t%s\t%s\t%s\n' "$check" "$status" "$seconds" "$note" >> "$RESULTS/results.tsv"
  if [[ "$status" == "failed" || "$status" == "blocked" ]]; then
    overall="failed"
    failures+=("::error title=${label}: ${check} ${status}::${note:-See the '${check}' group in the log.}")
  fi
done
# Printed last: inline findings come first in GitHub's limit of 10 errors per step.
for failure in "${failures[@]}"; do echo "$failure"; done

php "$SCRIPTS/report.php" "$RESULTS" "$label" "$overall" "$MEC_PHP_VERSION" "$MEC_MAGENTO_VERSION" "$EXT_NAME" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

{
  echo "status=${overall}"
  echo "result-path=${RESULTS}"
} >> "$GITHUB_OUTPUT"

[[ "$overall" == "passed" ]]
