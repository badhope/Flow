#!/usr/bin/env bash
set -e
set -o pipefail
cd "$(dirname "$0")/.."

DB_URL=${E2E_DATABASE_URL:-}
APP_A=3430
APP_B=3431
MOCK_PORT=4870

db_name=${DB_URL##*/}
if [ "${E2E_RESET_DATABASE:-}" != yes ] || [ "${#db_name}" -gt 63 ] || [[ ! "$DB_URL" =~ ^postgres(ql)?://[^/?#@]+@((127\.0\.0\.1)|(localhost))(:[0-9]+)?/flow_e2e_[a-z0-9_]+$ ]]; then
  printf '%s\n' '[e2e] Set E2E_RESET_DATABASE=yes and E2E_DATABASE_URL to a disposable local flow_e2e_<name> database URL without query parameters.' >&2
  exit 1
fi

pids=()
cleanup() {
  trap - EXIT INT TERM
  local pid
  for pid in "${pids[@]}"; do
    if jobs -pr | grep -qx "$pid"; then kill "$pid" 2>/dev/null || :; fi
  done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || :; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

clean_env=(env -i "PATH=$PATH" "HOME=${HOME:-}" "SystemRoot=${SystemRoot:-${SYSTEMROOT:-}}" "TEMP=${TEMP:-}" "TMP=${TMP:-}" DOTENV_CONFIG_PATH=/dev/null)
"${clean_env[@]}" node -e '
const net = require("net");
(async () => {
  for (const port of [3430, 3431, 4870]) {
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once("error", reject);
      server.listen({ port, host: "0.0.0.0", exclusive: true }, () => server.close(resolve));
    });
  }
})().catch(() => { console.error("[e2e] required port unavailable"); process.exit(1); });
'

printf '%s\n' '[e2e] reset explicitly selected disposable database...'
"${clean_env[@]}" E2E_DATABASE_URL="$DB_URL" node -e '
const postgres = require("postgres");
const url = new URL(process.env.E2E_DATABASE_URL);
const name = url.pathname.slice(1);
url.pathname = "/postgres";
const sql = postgres(url.toString(), {max: 1});
(async () => {
  try {
    await sql`DROP DATABASE IF EXISTS ${sql(name)}`;
    await sql`CREATE DATABASE ${sql(name)}`;
  } finally { await sql.end({timeout: 5}); }
})().catch(() => { console.error("[e2e] database reset failed"); process.exitCode = 1; });
'
"${clean_env[@]}" DATABASE_URL="$DB_URL" node scripts/db/migrate.mjs
printf '%s\n' '[e2e] migrations applied'

wait_health() {
  local pid=$1 port=$2 i
  for i in $(seq 1 30); do
    if ! kill -0 "$pid" 2>/dev/null; then return 1; fi
    if curl -sf "http://127.0.0.1:$port/api/health" >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

printf '%s\n' '[e2e] boot instance A (no keys, seed)...'
"${clean_env[@]}" HOST=127.0.0.1 PORT=$APP_A DATABASE_URL="$DB_URL" NODE_ENV=development \
  JWT_SECRET="local-dev-secret-at-least-32-characters-long" \
  SEED_DEMO_DATA=true SELLER_REGISTRATION_CODE=smoke-secret \
  node dist-server/server/main.js > .tmp-e2e-a.log 2>&1 &
pids+=("$!")
wait_health "${pids[0]}" "$APP_A" || { printf '%s\n' 'A not healthy' >&2; exit 1; }

printf '%s\n' '[e2e] workflows + degraded + transaction...'
"${clean_env[@]}" DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_A" node scripts/smoke-workflows.mjs 2>&1 | tail -2
"${clean_env[@]}" DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_A" node scripts/smoke-ai-degraded.mjs 2>&1 | tail -2
"${clean_env[@]}" DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_A" SMOKE_SELLER_CODE=smoke-secret node scripts/smoke.mjs 2>&1 | tail -2

printf '%s\n' '[e2e] boot mock + instance B (mock providers + mock LLM)...'
"${clean_env[@]}" MOCK_HOST=127.0.0.1 APP_WEBHOOK_BASE="http://127.0.0.1:$APP_B" MOCK_PORT=$MOCK_PORT \
  STRIPE_WEBHOOK_SECRET=whsec_mock PAYPAL_WEBHOOK_ID=mock-wh \
  node scripts/mock-providers.mjs > .tmp-e2e-mock.log 2>&1 &
pids+=("$!")
sleep 2
kill -0 "${pids[1]}" 2>/dev/null || { printf '%s\n' 'mock not running' >&2; exit 1; }

"${clean_env[@]}" HOST=127.0.0.1 PORT=$APP_B DATABASE_URL="$DB_URL" NODE_ENV=development \
  JWT_SECRET="local-dev-secret-at-least-32-characters-long" \
  SELLER_REGISTRATION_CODE=smoke-secret \
  LLM_BASE_URL="http://127.0.0.1:$MOCK_PORT/llm" LLM_API_KEY=mock-key LLM_MODEL=mock-model \
  STRIPE_SECRET_KEY=sk_test_mock STRIPE_WEBHOOK_SECRET=whsec_mock \
  STRIPE_API_BASE="http://127.0.0.1:$MOCK_PORT/stripe" \
  PAYPAL_CLIENT_ID=mock-cid PAYPAL_CLIENT_SECRET=mock-sec \
  PAYPAL_WEBHOOK_ID=mock-wh PAYPAL_API_BASE="http://127.0.0.1:$MOCK_PORT/paypal" \
  node dist-server/server/main.js > .tmp-e2e-b.log 2>&1 &
pids+=("$!")
wait_health "${pids[2]}" "$APP_B" || { printf '%s\n' 'B not healthy' >&2; exit 1; }

printf '%s\n' '[e2e] providers + copilot + shopper...'
"${clean_env[@]}" DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_B" MOCK_BASE="http://127.0.0.1:$MOCK_PORT" node scripts/smoke-providers.mjs 2>&1 | tail -2
"${clean_env[@]}" DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_B" MOCK_BASE="http://127.0.0.1:$MOCK_PORT" node scripts/smoke-copilot.mjs 2>&1 | tail -2
"${clean_env[@]}" DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_B" MOCK_BASE="http://127.0.0.1:$MOCK_PORT" node scripts/smoke-shopper.mjs 2>&1 | tail -2

printf '%s\n' '[e2e] ALL 6 SUITES PASSED'
