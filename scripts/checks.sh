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

# install_tools <phpcs|phpstan> <default package>...
# Installs the tool into its own directory, outside the Magento project. Packages the extension
# asks for in require-dev take precedence; when they cannot be installed, the defaults are used.
install_tools() {
  local tool="$1"; shift
  local dir="$TOOLS/$tool" own
  rm -rf "$dir" && mkdir -p "$dir"
  composer --working-dir="$dir" init --quiet --name="magento-extension-check/${tool}-tools"
  composer --working-dir="$dir" config allow-plugins.dealerdirect/phpcodesniffer-composer-installer true
  composer --working-dir="$dir" config allow-plugins.phpstan/extension-installer true
  mapfile -t own < <(php "$SCRIPTS/tool-packages.php" "$EXT/composer.json" "$tool")
  TOOLS_SOURCE="action defaults"
  if [[ "${#own[@]}" -gt 0 ]]; then
    if composer --working-dir="$dir" require --no-progress --quiet "${own[@]}" "$@" 2>&1; then
      TOOLS_SOURCE="versions from the extension's require-dev"
    else
      echo "The extension's require-dev tool versions could not be installed; using the defaults."
      rm -f "$dir/composer.lock" && rm -rf "$dir/vendor"
      composer --working-dir="$dir" init --quiet --name="magento-extension-check/${tool}-tools"
      composer --working-dir="$dir" config allow-plugins.dealerdirect/phpcodesniffer-composer-installer true
      composer --working-dir="$dir" config allow-plugins.phpstan/extension-installer true
      composer --working-dir="$dir" require --no-progress --quiet "$@"
    fi
  else
    composer --working-dir="$dir" require --no-progress --quiet "$@"
  fi
  composer --working-dir="$dir" show --no-ansi | awk '{print "  " $1 " " $2}'
}

# resolve_config <input value> <candidate file>...
# Sets CONFIG (absolute path, empty for the action default) and CONFIG_LABEL.
resolve_config() {
  local requested="$1"; shift
  CONFIG=""; CONFIG_LABEL="action default"
  if [[ -n "$requested" ]]; then
    local path
    path="$(cd "$GITHUB_WORKSPACE" && realpath -q "$requested" || true)"
    [[ -n "$path" && -f "$path" && "$path" == "$(cd "$GITHUB_WORKSPACE" && pwd -P)/"* ]] \
      || { note "configured file '${requested}' does not exist in the workspace"; return 1; }
    CONFIG="$path"; CONFIG_LABEL="configured ${requested}"
  else
    local candidate
    for candidate in "$@"; do
      if [[ -f "$EXT/$candidate" ]]; then
        CONFIG="$EXT/$candidate"; CONFIG_LABEL="repository ${candidate}"
        break
      fi
    done
  fi
  if [[ -n "$CONFIG" && -f "$WORK/changed-files.txt" ]] \
    && grep -qxF "${CONFIG#"$GITHUB_WORKSPACE"/}" "$WORK/changed-files.txt"; then
    CONFIG_LABEL="${CONFIG_LABEL}, changed in this pull request"
  fi
}

check_phpcs() {
  resolve_config "$MEC_PHPCS_CONFIG" .phpcs.xml phpcs.xml .phpcs.xml.dist phpcs.xml.dist
  local standard="${CONFIG:-$SCRIPTS/../defaults/phpcs.xml}" threshold="$MEC_PHPCS_SEVERITY"
  # The action default fails at severity 10 as Adobe's Marketplace review does; a repository
  # ruleset decides for itself what is an error.
  if [[ -z "$threshold" ]]; then
    if [[ -z "$CONFIG" ]]; then threshold="10"; else threshold="errors"; fi
  fi
  echo "$threshold" > "$RESULTS/phpcs.threshold"

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

  install_tools phpcs magento/magento-coding-standard
  local report="$RESULTS/phpcs.json"
  cd "$EXT"
  "$TOOLS/phpcs/vendor/bin/phpcs" --standard="$standard" -s --file-list="$list" \
    --report-full --report-json="$report" || true
  local totals
  totals="$(php -r '
    $report = json_decode((string) @file_get_contents($argv[1]), true);
    if (!is_array($report) || !isset($report["files"])) { echo "error"; exit; }
    $failing = 0; $other = 0;
    foreach ($report["files"] as $file) {
        foreach ($file["messages"] as $message) {
            $fails = $argv[2] === "errors" ? $message["type"] === "ERROR" : (int) $message["severity"] >= (int) $argv[2];
            $fails ? $failing++ : $other++;
        }
    }
    echo $failing . " " . $other;
  ' "$report" "$threshold")"
  [[ "$totals" != "error" ]] || { note "PHPCS configuration could not be loaded (${CONFIG_LABEL})"; return 1; }
  local failing other rule="severity ${threshold}+"
  [[ "$threshold" == "errors" ]] && rule="errors"
  read -r failing other <<< "$totals"
  note "${CONFIG_LABEL}; $(wc -l < "$list" | tr -d ' ') ${scope}: ${failing} ${rule}, ${other} other"
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
  local module status
  for module in $MODULE_NAMES; do
    status="$(php bin/magento module:status --no-ansi "$module" 2>&1)" || {
      echo "$status"
      note "bin/magento stops with an error once the extension is enabled: $(echo "$status" | grep -m1 -iE 'fatal|error|exception' | cut -c1-180)"
      return 1
    }
    echo "$status" | grep -qi 'enabled' || { note "${module} is not enabled"; return 1; }
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
  resolve_config "$MEC_PHPSTAN_CONFIG" phpstan.neon phpstan.neon.dist phpstan.dist.neon
  local config="$CONFIG" label="$CONFIG_LABEL"
  install_tools phpstan phpstan/phpstan bitexpert/phpstan-magento
  if [[ -z "$config" ]]; then
    local baseline=""
    if [[ -n "$MEC_PHPSTAN_BASELINE" ]]; then
      baseline="$(cd "$GITHUB_WORKSPACE" && realpath -q "$MEC_PHPSTAN_BASELINE" || true)"
      [[ -n "$baseline" && -f "$baseline" ]] || { note "baseline '${MEC_PHPSTAN_BASELINE}' does not exist in the workspace"; return 1; }
      label="${label} with baseline ${MEC_PHPSTAN_BASELINE}"
    fi
    config="$WORK/phpstan.neon"
    {
      echo "includes:"
      echo "    - ${TOOLS}/phpstan/vendor/bitexpert/phpstan-magento/extension.neon"
      [[ -z "$baseline" ]] || echo "    - ${baseline}"
      echo "parameters:"
      echo "    level: ${MEC_PHPSTAN_LEVEL}"
      echo "    tmpDir: ${WORK}/phpstan-tmp"
      echo "    paths:"
      echo "        - ${EXT}"
      echo "    excludePaths:"
      echo "        analyseAndScan:"
      echo "            - ${EXT}/vendor/* (?)"
    } > "$config"
    label="${label}, level ${MEC_PHPSTAN_LEVEL}"
  fi
  cd "$MAGENTO_ROOT"
  local report="$RESULTS/phpstan.json" code=0
  "$TOOLS/phpstan/vendor/bin/phpstan" analyse --no-progress --memory-limit=-1 --configuration="$config" \
    --autoload-file="$MAGENTO_ROOT/vendor/autoload.php" --error-format=json > "$report" || code=$?
  local count
  count="$(php -r '
    $report = json_decode((string) @file_get_contents($argv[1]), true);
    if (!is_array($report) || !isset($report["totals"])) { echo "unloadable"; exit; }
    foreach ($report["errors"] ?? [] as $error) { fwrite(STDERR, $error . "\n"); }
    foreach ($report["files"] ?? [] as $path => $file) {
        foreach ($file["messages"] as $message) {
            fwrite(STDERR, $path . ":" . ($message["line"] ?? "?") . "  " . $message["message"] . "\n");
        }
    }
    echo ($report["totals"]["file_errors"] ?? 0) + ($report["totals"]["errors"] ?? 0);
  ' "$report")"
  if [[ "$count" == "unloadable" ]]; then
    cat "$report"
    rm -f "$report"
    note "PHPStan configuration could not be loaded (${label})"
    return 1
  fi
  note "${label}; ${count} finding(s); tools: ${TOOLS_SOURCE}"
  return "$code"
}
