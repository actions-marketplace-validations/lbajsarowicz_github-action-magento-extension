#!/usr/bin/env bash
# Sourced by run.sh. Every check_* function runs in a subshell with `set -e`:
# exit 0 = passed, 78 = skipped (nothing to run), anything else = failed.

note() { printf '%s' "$1" > "$NOTE_FILE"; }

check_validate() {
  composer validate --no-check-lock --working-dir="$EXT"
  [[ -f "$EXT/registration.php" ]] || { note "registration.php is missing"; return 1; }
  [[ -n "$MODULE_NAME" ]] || { note "etc/module.xml is missing or declares no module name"; return 1; }
  grep -q "$MODULE_NAME" "$EXT/registration.php" || {
    note "registration.php does not register ${MODULE_NAME} declared in etc/module.xml"
    return 1
  }
  note "${EXT_NAME} registers ${MODULE_NAME}"
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
  mkdir -p "$TOOLS"
  composer --working-dir="$TOOLS" init --quiet --name=magento-extension-check/tools
  composer --working-dir="$TOOLS" config allow-plugins.dealerdirect/phpcodesniffer-composer-installer true
  composer --working-dir="$TOOLS" require --no-progress --quiet magento/magento-coding-standard
  local package
  for package in magento/magento-coding-standard squizlabs/php_codesniffer; do
    composer --working-dir="$TOOLS" show "$package" | grep -E '^(name|versions)'
  done
  local phpcs=("$TOOLS/vendor/bin/phpcs" --standard=Magento2 "--extensions=php,phtml" --ignore='*/vendor/*' -s)
  local totals
  totals="$("${phpcs[@]}" --severity=1 --report=json "$EXT" \
    | php -r '$r = json_decode(stream_get_contents(STDIN), true)["totals"] ?? []; echo ($r["errors"] ?? "?") . " errors, " . ($r["warnings"] ?? "?") . " warnings at any severity";' || true)"
  note "${totals}; failing at severity ${MEC_PHPCS_SEVERITY}+"
  "${phpcs[@]}" --severity="$MEC_PHPCS_SEVERITY" "$EXT"
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

  local installed registered
  installed="$(cd "$(composer show --path "$EXT_NAME" | awk '{print $2}')" && pwd -P)"
  [[ "$installed" == "$EXT" ]] || { note "Composer installed ${EXT_NAME} from ${installed}, not from the checkout"; return 1; }
  registered="$(php -r '
    require $argv[1] . "/vendor/autoload.php";
    $path = (new \Magento\Framework\Component\ComponentRegistrar())->getPath("module", $argv[2]);
    echo $path ? realpath($path) : "";
  ' "$MAGENTO_ROOT" "$MODULE_NAME")"
  [[ "$registered" == "$EXT" ]] || { note "${MODULE_NAME} is not registered from the checkout (found: ${registered:-nowhere})"; return 1; }

  composer show magento/product-community-edition | grep -E '^versions'
  note "Composer $(composer --version --no-ansi | awk '{print $3}'), ${EXT_NAME} symlinked from the checkout"
}

check_compile() {
  cd "$MAGENTO_ROOT"
  php bin/magento module:enable --all --no-ansi | tail -n 3
  php bin/magento module:status --no-ansi "$MODULE_NAME" | grep -qi 'enabled' || { note "${MODULE_NAME} is not enabled"; return 1; }
  php -d memory_limit=-1 bin/magento setup:di:compile --no-ansi
  note "no database, ${MODULE_NAME} enabled"
}

check_unit() {
  local tests="$EXT/Test/Unit"
  [[ -d "$tests" ]] || { note "no Test/Unit directory"; return "$SKIPPED"; }
  cd "$MAGENTO_ROOT"
  local config="$MAGENTO_ROOT/dev/tests/unit/phpunit.extension-check.xml"
  cat > "$config" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<phpunit bootstrap="./framework/bootstrap.php" colors="false">
    <testsuites>
        <testsuite name="extension">
            <directory>${tests}</directory>
        </testsuite>
    </testsuites>
    <php>
        <ini name="date.timezone" value="UTC"/>
    </php>
</phpunit>
XML
  local junit="$RESULTS/unit.junit.xml" code=0
  vendor/bin/phpunit --version
  vendor/bin/phpunit -c "$config" --log-junit "$junit" || code=$?
  local summary
  summary="$(php -r '
    $x = @simplexml_load_file($argv[1]);
    $s = $x ? ($x->testsuite[0] ?? null) : null;
    echo $s ? (int) $s["tests"] . " " . (int) $s["assertions"] . " " . ((int) $s["failures"] + (int) $s["errors"]) : "0 0 0";
  ' "$junit")"
  read -r count assertions broken <<< "$summary"
  if [[ "$count" -eq 0 ]]; then
    note "PHPUnit discovered no tests in Test/Unit"
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
  vendor/bin/phpstan analyse --no-progress --memory-limit=-1 --configuration="$config"
}
