#!/usr/bin/env bash
# Tells a sub-action whether an earlier step of the same job already set up PHP and restored the
# Composer cache, so that several sub-actions used as steps of one job do that work once.
set -euo pipefail

mkdir -p "$MEC_WORK_DIR"
run="${GITHUB_RUN_ID:-0}-${GITHUB_RUN_ATTEMPT:-0}-${GITHUB_JOB:-job}"
php_wanted="${run} php${MEC_PHP_VERSION} ${MEC_PROFILE}"
# The Magento profile installs a superset of the extensions of the static profile.
php_superset="${run} php${MEC_PHP_VERSION} magento"
cache_wanted="${run} ${MEC_CACHE_ID}"

php_ready=false
php_current="$(cat "$MEC_WORK_DIR/prepared-php" 2>/dev/null || true)"
if [[ "$php_current" == "$php_wanted" || "$php_current" == "$php_superset" ]]; then
  php_ready=true
else
  printf '%s' "$php_wanted" > "$MEC_WORK_DIR/prepared-php"
fi

cache_ready=false
if [[ "$(cat "$MEC_WORK_DIR/prepared-cache" 2>/dev/null || true)" == "$cache_wanted" ]]; then
  cache_ready=true
else
  printf '%s' "$cache_wanted" > "$MEC_WORK_DIR/prepared-cache"
fi

{
  echo "php=${php_ready}"
  echo "cache=${cache_ready}"
} >> "$GITHUB_OUTPUT"
