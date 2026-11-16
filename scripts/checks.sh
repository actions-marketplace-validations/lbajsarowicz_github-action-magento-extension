#!/usr/bin/env bash
# Sourced by run.sh. Every check_* function runs in a subshell with `set -e`:
# exit 0 = passed, 78 = skipped (nothing to run), anything else = failed.

note() { printf '%s' "$1" > "$NOTE_FILE"; }

check_validate() {
  composer validate --no-check-lock --working-dir="$EXT"
  [[ -n "$MODULE_NAMES" ]] || { note "no etc/module.xml declaring a module was found"; return 1; }
  local module missing=""
  for module in $MODULE_NAMES; do
    grep -rqs --include=registration.php "$module" "$EXT" --exclude-dir=vendor || missing="$missing $module"
  done
  [[ -z "$missing" ]] || { note "no registration.php registers:${missing}"; return 1; }
  note "${EXT_NAME} registers ${MODULE_NAMES}"
}

check_lint() {
  local count
  count="$(find "$EXT" -type f \( -name '*.php' -o -name '*.phtml' \) -not -path '*/vendor/*' | wc -l | tr -d ' ')"
  [[ "$count" -gt 0 ]] || { note "no PHP files found"; return "$SKIPPED"; }
  find "$EXT" -type f \( -name '*.php' -o -name '*.phtml' \) -not -path '*/vendor/*' -print0 \
    | xargs -0 -n1 -P4 php -l 2>&1 | { grep -v '^No syntax errors detected' || true; }
  note "${count} files"
}

check_phpcs() {
  local list="$WORK/phpcs-files.txt" scope="every file"
  if [[ "$MEC_PHPCS_SCOPE" == "changed" && -f "$WORK/changed-files.txt" ]]; then
    scope="changed files"
    : > "$list"
    local file
    while IFS= read -r file; do
      [[ "$file" =~ \.(php|phtml)$ ]] || continue
      [[ "$GITHUB_WORKSPACE/$file" == "$EXT/"* && -f "$GITHUB_WORKSPACE/$file" ]] || continue
      printf '%s\n' "$GITHUB_WORKSPACE/$file" >> "$list"
    done < "$WORK/changed-files.txt"
    [[ -s "$list" ]] || { note "no PHP file changed"; return "$SKIPPED"; }
  else
    find "$EXT" -type f \( -name '*.php' -o -name '*.phtml' \) -not -path '*/vendor/*' > "$list"
    [[ -s "$list" ]] || { note "no PHP files found"; return "$SKIPPED"; }
  fi

  mkdir -p "$TOOLS"
  composer --working-dir="$TOOLS" init --quiet --name=magento-extension-check/tools
  composer --working-dir="$TOOLS" config allow-plugins.dealerdirect/phpcodesniffer-composer-installer true
  composer --working-dir="$TOOLS" require --no-progress --quiet magento/magento-coding-standard
  local package
  for package in magento/magento-coding-standard squizlabs/php_codesniffer; do
    composer --working-dir="$TOOLS" show "$package" | grep -E '^(name|versions)'
  done

  local report="$RESULTS/phpcs.json"
  "$TOOLS/vendor/bin/phpcs" --standard=Magento2 --severity=1 -s --file-list="$list" \
    --report-full --report-json="$report" || true
  local totals
  totals="$(php -r '
    $report = json_decode((string) file_get_contents($argv[1]), true);
    if (!is_array($report)) { echo "error"; exit; }
    $failing = 0; $other = 0;
    foreach ($report["files"] as $file) {
        foreach ($file["messages"] as $message) {
            (int) $message["severity"] >= (int) $argv[2] ? $failing++ : $other++;
        }
    }
    echo $failing . " " . $other;
  ' "$report" "$MEC_PHPCS_SEVERITY")"
  [[ "$totals" != "error" ]] || { note "PHPCS produced no report"; return 1; }
  local failing other
  read -r failing other <<< "$totals"
  note "$(wc -l < "$list" | tr -d ' ') ${scope}: ${failing} at severity ${MEC_PHPCS_SEVERITY}+, ${other} below"
  [[ "$failing" -eq 0 ]]
}

check_install() {
  composer create-project --no-install --no-progress --repository-url="$MIRROR" \
    "magento/project-community-edition=${MEC_MAGENTO_VERSION}" "$MAGENTO_ROOT"
  mkdir -p "$MAGENTO_ROOT/app/etc"
  php "$SCRIPTS/prepare-project.php" "$MAGENTO_ROOT/composer.json" "$EXT" "$EXT_NAME" "$MIRROR"
  cd "$MAGENTO_ROOT"
  # Old release lines carry dependencies with published advisories; Composer 2.9 would refuse to
  # resolve them, which says nothing about the extension under test.
  composer config audit.block-insecure false
  composer update --no-progress --no-audit

  local installed module registered
  installed="$(cd "$(composer show --path "$EXT_NAME" | awk '{print $2}')" && pwd -P)"
  [[ "$installed" == "$EXT" ]] || { note "Composer installed ${EXT_NAME} from ${installed}, not from the checkout"; return 1; }
  for module in $MODULE_NAMES; do
    registered="$(php -r '
      require $argv[1] . "/vendor/autoload.php";
      $path = (new \Magento\Framework\Component\ComponentRegistrar())->getPath("module", $argv[2]);
      echo $path ? realpath($path) : "";
    ' "$MAGENTO_ROOT" "$module")"
    [[ "$registered" == "$EXT" || "$registered" == "$EXT/"* ]] \
      || { note "${module} is not registered from the checkout (found: ${registered:-nowhere})"; return 1; }
  done

  composer show magento/product-community-edition | grep -E '^versions'
  note "Composer $(composer --version --no-ansi | awk '{print $3}'), ${EXT_NAME} symlinked from the checkout"
}

check_compile() {
  cd "$MAGENTO_ROOT"
  php bin/magento module:enable --all --no-ansi | tail -n 3
  local module
  for module in $MODULE_NAMES; do
    php bin/magento module:status --no-ansi "$module" | grep -qi 'enabled' || { note "${module} is not enabled"; return 1; }
  done
  php -d memory_limit=-1 bin/magento setup:di:compile --no-ansi
  note "no database; enabled: ${MODULE_NAMES}"
}

check_unit() {
  local directories
  directories="$(find "$EXT" -maxdepth 6 -type d -path '*/Test/Unit' -not -path '*/vendor/*' | sort)"
  [[ -n "$directories" ]] || { note "no Test/Unit directory"; return "$SKIPPED"; }
  cd "$MAGENTO_ROOT"
  local config="$MAGENTO_ROOT/dev/tests/unit/phpunit.extension-check.xml" directory
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<phpunit bootstrap="./framework/bootstrap.php" colors="false">'
    echo '    <testsuites>'
    echo '        <testsuite name="extension">'
    while IFS= read -r directory; do
      echo "            <directory>${directory}</directory>"
    done <<< "$directories"
    echo '        </testsuite>'
    echo '    </testsuites>'
    echo '    <php>'
    echo '        <ini name="date.timezone" value="UTC"/>'
    echo '    </php>'
    echo '</phpunit>'
  } > "$config"
  local junit="$RESULTS/unit.junit.xml" code=0
  vendor/bin/phpunit --version
  vendor/bin/phpunit -c "$config" --log-junit "$junit" || code=$?
  local summary
  summary="$(php -r '
    $x = @simplexml_load_file($argv[1]);
    $s = $x ? ($x->testsuite[0] ?? null) : null;
    echo $s ? (int) $s["tests"] . " " . (int) $s["assertions"] . " " . ((int) $s["failures"] + (int) $s["errors"]) : "0 0 0";
  ' "$junit")"
  local count assertions broken
  read -r count assertions broken <<< "$summary"
  if [[ "$count" -eq 0 ]]; then
    note "PHPUnit ran no tests from Test/Unit"
    return 1
  fi
  note "${count} tests, ${assertions} assertions, ${broken} failing"
  return "$code"
}

check_phpstan() {
  cd "$MAGENTO_ROOT"
  [[ -x vendor/bin/phpstan ]] || { note "this Magento release ships no PHPStan"; return "$SKIPPED"; }
  local config=""
  for candidate in phpstan.neon phpstan.neon.dist phpstan.dist.neon; do
    if [[ -f "$EXT/$candidate" ]]; then config="$EXT/$candidate"; break; fi
  done
  if [[ -z "$config" ]]; then
    config="$WORK/phpstan.neon"
    {
      echo "parameters:"
      echo "    level: ${MEC_PHPSTAN_LEVEL}"
      echo "    tmpDir: ${WORK}/phpstan-tmp"
      echo "    paths:"
      echo "        - ${EXT}"
      echo "    excludePaths:"
      echo "        analyseAndScan:"
      echo "            - ${EXT}/vendor/* (?)"
      if [[ -d "$MAGENTO_ROOT/generated/code" ]]; then
        echo "    scanDirectories:"
        echo "        - ${MAGENTO_ROOT}/generated/code"
      fi
    } > "$config"
    note "generated config, level ${MEC_PHPSTAN_LEVEL}"
  else
    note "config ${config#"$EXT"/}"
  fi
  vendor/bin/phpstan --version
  local report="$RESULTS/phpstan.json" code=0
  vendor/bin/phpstan analyse --no-progress --memory-limit=-1 --configuration="$config" --error-format=json > "$report" || code=$?
  php -r '
    $report = json_decode((string) file_get_contents($argv[1]), true);
    if (!is_array($report)) { echo file_get_contents($argv[1]); exit; }
    foreach ($report["errors"] ?? [] as $error) { echo $error, "\n"; }
    foreach ($report["files"] ?? [] as $path => $file) {
        foreach ($file["messages"] as $message) {
            echo $path, ":", $message["line"] ?? "?", "  ", $message["message"], "\n";
        }
    }
    echo ($report["totals"]["file_errors"] ?? 0) + ($report["totals"]["errors"] ?? 0), " error(s)\n";
  ' "$report"
  return "$code"
}
