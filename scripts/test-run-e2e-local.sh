#!/usr/bin/env bash
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
T=$(mktemp -d "$ROOT/.e2e-script-test.XXXXXXXX")
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/project/scripts"
cp "$ROOT/scripts/run-e2e-local.sh" "$T/project/scripts/run-e2e-local.sh"
REAL_SLEEP=$(command -v sleep)
REAL_NODE=$(command -v node)
printf '%s\n' "$REAL_NODE" > "$T/real-node"
printf '%s\n' 'E2E_DOTENV_PROBE=loaded' > "$T/project/.env"
printf '%s\n' "$ROOT/node_modules/dotenv/config.js" > "$T/dotenv"
if [ "$(uname -s | cut -c1-5)" = MINGW ]; then
  dotenv_win=$(cygpath -w "$ROOT/node_modules/dotenv/config.js")
  printf '%s\n' "$dotenv_win" > "$T/dotenv"
  (cd "$T/project" && env -u DOTENV_CONFIG_PATH -u E2E_DOTENV_PROBE "$REAL_NODE" -e 'require(process.argv[1]); if (process.platform !== "win32" || process.env.E2E_DOTENV_PROBE !== "loaded") process.exit(1)' "$dotenv_win") || { printf '%s\n' 'FAIL: Windows dotenv positive control' >&2; exit 1; }
else
  rm "$T/real-node"
fi
export REAL_SLEEP TEST_LOG="$T/calls"
cat > "$T/bin/node" <<'STUB'
#!/usr/bin/env bash
TEST_LOG="$(dirname "$(dirname "$0")")/calls"
printf '%s\n' "$*" >> "$TEST_LOG"
case "${1:-}" in
  -e)
    if [[ "$2" == *'required port unavailable'* ]]; then
      [ ! -f "$(dirname "$TEST_LOG")/busy" ] || exit 1
      if [ -f "$(dirname "$TEST_LOG")/real-node" ]; then
        IFS= read -r real_node < "$(dirname "$TEST_LOG")/real-node"
        IFS= read -r dotenv < "$(dirname "$TEST_LOG")/dotenv"
        "$real_node" -e 'require(process.argv[1]); if (!process.env.SystemRoot || process.env.E2E_DOTENV_PROBE) process.exit(1)' "$dotenv" || exit 1
      fi
    fi
    exit 0 ;;
  scripts/smoke-workflows.mjs)
    [ ! -f "$(dirname "$TEST_LOG")/smoke-fails" ] || exit 1
    exit 0 ;;
  dist-server/server/main.js|scripts/mock-providers.mjs)
    printf 'child %s %s %s %s %s %s\n' "$$" "${PORT:-mock}" "${LLM_API_KEY-unset}" "${DOTENV_CONFIG_PATH-unset}" "${HOST-unset}" "${MOCK_HOST-unset}" >> "$TEST_LOG"
    exec /usr/bin/sleep 30 ;;
  *) exit 0 ;;
esac
STUB
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$T/bin/sleep" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$T/bin/netstat" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
cat > "$T/bin/taskkill" <<'STUB'
#!/usr/bin/env bash
printf 'unexpected taskkill\n' >> "$TEST_LOG"
exit 1
STUB
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" LLM_API_KEY=real-inherited-key
run() { bash "$T/project/scripts/run-e2e-local.sh" >"$T/output" 2>&1; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
unset E2E_DATABASE_URL E2E_RESET_DATABASE || true
if run; then fail 'missing opt-in accepted'; fi
[ ! -s "$TEST_LOG" ] || fail 'commands executed without opt-in'
export E2E_DATABASE_URL='postgresql://u:p@127.0.0.1:5433/flow_e2e_test'
if run; then fail 'URL without reset opt-in accepted'; fi
[ ! -s "$TEST_LOG" ] || fail 'commands executed without reset opt-in'
export E2E_RESET_DATABASE=yes
for url in 'postgresql://u:p@127.0.0.1:5433/flow' 'postgresql://u:p@remote:5433/flow_e2e_test' 'postgresql://u:p@127.0.0.1:5433/flow_e2e_test?host=remote'; do
  export E2E_DATABASE_URL="$url"
  if run; then fail "unsafe URL accepted: $url"; fi
  [ ! -s "$TEST_LOG" ] || fail 'commands executed for unsafe URL'
done
export E2E_DATABASE_URL='postgresql://u:p@127.0.0.1:5433/flow_e2e_test'
: > "$T/busy"
if run; then fail 'occupied port accepted'; fi
if grep -q 'DROP DATABASE' "$TEST_LOG"; then fail 'database reset started with occupied port'; fi
rm "$T/busy"
: > "$TEST_LOG"
: > "$T/smoke-fails"
if run; then fail 'smoke failure ignored'; fi
while read -r kind pid rest; do
  [ "$kind" = child ] || continue
  if kill -0 "$pid" 2>/dev/null; then fail "child $pid survived failure"; fi
done < "$TEST_LOG"
rm "$T/smoke-fails"
: > "$TEST_LOG"
"$REAL_SLEEP" 30 &
sentinel=$!
run || { kill "$sentinel" 2>/dev/null || :; wait "$sentinel" 2>/dev/null || :; fail 'valid run failed'; }
if ! kill -0 "$sentinel" 2>/dev/null; then fail 'unrelated process was terminated'; fi
kill "$sentinel"
wait "$sentinel" 2>/dev/null || :
grep -q '^child [0-9]* 3430 unset /dev/null 127.0.0.1 unset$' "$TEST_LOG" || fail 'instance A environment or listener host incorrect'
grep -q '^child [0-9]* 3431 mock-key /dev/null 127.0.0.1 unset$' "$TEST_LOG" || fail 'instance B listener host incorrect'
grep -q '^child [0-9]* mock unset /dev/null unset 127.0.0.1$' "$TEST_LOG" || fail 'mock listener host incorrect'
grep -q 'ALL 6 SUITES PASSED' "$T/output" || fail 'suites did not finish'
while read -r kind pid rest; do
  [ "$kind" = child ] || continue
  if kill -0 "$pid" 2>/dev/null; then fail "child $pid survived cleanup"; fi
done < "$TEST_LOG"
printf '%s\n' 'PASS: opt-in, URL restrictions, isolation, successful run and child cleanup'
