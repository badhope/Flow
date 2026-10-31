#!/usr/bin/env bash
# Flow 全链路 E2E（对应 CI smoke job，但使用本机受限令牌启动的 PG 5433）
set -e
set -o pipefail
cd "$(dirname "$0")/.."

DB_URL="postgresql://flow:flow_pass@127.0.0.1:5433/flow"
APP_A=3430
APP_B=3431
MOCK_PORT=4870

cleanup() {
  for P in $APP_A $APP_B; do
    PID=$(netstat -ano | grep ":$P" | grep LISTENING | awk '{print $5}' | head -1)
    [ -n "$PID" ] && taskkill //PID $PID //F >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

echo "[e2e] reset database (fresh-container semantics, same as CI)..."
node -e "
const postgres=require('postgres');
const sql=postgres('postgresql://flow:flow_pass@127.0.0.1:5433/postgres',{max:1});
(async()=>{ await sql\`DROP DATABASE IF EXISTS flow\`; await sql\`CREATE DATABASE flow\`; await sql.end({timeout:5}); console.log('reset ok'); })().catch(e=>{ console.error(e.message); process.exit(1); });
"
DATABASE_URL="$DB_URL" node scripts/db/migrate.mjs > /dev/null 2>&1
echo "[e2e] migrations applied"

echo "[e2e] boot instance A (no keys, seed)..."
PORT=$APP_A DATABASE_URL="$DB_URL" NODE_ENV=development \
  JWT_SECRET="local-dev-secret-at-least-32-characters-long" \
  SEED_DEMO_DATA=true SELLER_REGISTRATION_CODE=smoke-secret \
  node dist-server/server/main.js > .tmp-e2e-a.log 2>&1 &
for i in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$APP_A/api/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$APP_A/api/health" >/dev/null || { echo "A not healthy"; exit 1; }

echo "[e2e] workflows + degraded + transaction..."
DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_A" node scripts/smoke-workflows.mjs 2>&1 | tail -2
DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_A" node scripts/smoke-ai-degraded.mjs 2>&1 | tail -2
DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_A" SMOKE_SELLER_CODE=smoke-secret node scripts/smoke.mjs 2>&1 | tail -2

echo "[e2e] boot mock + instance B (mock providers + mock LLM)..."
MPID=$(netstat -ano | grep ":$MOCK_PORT" | grep LISTENING | awk '{print $5}' | head -1)
[ -n "$MPID" ] && taskkill //PID $MPID //F >/dev/null 2>&1 || true
APP_WEBHOOK_BASE="http://127.0.0.1:$APP_B" MOCK_PORT=$MOCK_PORT \
  STRIPE_WEBHOOK_SECRET=whsec_mock PAYPAL_WEBHOOK_ID=mock-wh \
  node scripts/mock-providers.mjs > .tmp-e2e-mock.log 2>&1 &
sleep 2

PORT=$APP_B DATABASE_URL="$DB_URL" NODE_ENV=development \
  JWT_SECRET="local-dev-secret-at-least-32-characters-long" \
  SELLER_REGISTRATION_CODE=smoke-secret \
  LLM_BASE_URL="http://127.0.0.1:$MOCK_PORT/llm" LLM_API_KEY=mock-key LLM_MODEL=mock-model \
  STRIPE_SECRET_KEY=sk_test_mock STRIPE_WEBHOOK_SECRET=whsec_mock \
  STRIPE_API_BASE="http://127.0.0.1:$MOCK_PORT/stripe" \
  PAYPAL_CLIENT_ID=mock-cid PAYPAL_CLIENT_SECRET=mock-sec \
  PAYPAL_WEBHOOK_ID=mock-wh PAYPAL_API_BASE="http://127.0.0.1:$MOCK_PORT/paypal" \
  node dist-server/server/main.js > .tmp-e2e-b.log 2>&1 &
for i in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$APP_B/api/health" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$APP_B/api/health" >/dev/null || { echo "B not healthy"; exit 1; }

echo "[e2e] providers + copilot + shopper..."
DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_B" MOCK_BASE="http://127.0.0.1:$MOCK_PORT" node scripts/smoke-providers.mjs 2>&1 | tail -2
DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_B" MOCK_BASE="http://127.0.0.1:$MOCK_PORT" node scripts/smoke-copilot.mjs 2>&1 | tail -2
DATABASE_URL="$DB_URL" SMOKE_BASE="http://127.0.0.1:$APP_B" MOCK_BASE="http://127.0.0.1:$MOCK_PORT" node scripts/smoke-shopper.mjs 2>&1 | tail -2

echo "[e2e] ALL 6 SUITES PASSED"
