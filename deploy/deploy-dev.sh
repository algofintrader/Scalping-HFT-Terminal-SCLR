#!/bin/bash
set -e

# Load deploy config
SCRIPT_DIR="$(dirname "$0")"
if [ ! -f "${SCRIPT_DIR}/.deploy.env" ]; then
    echo -e "\033[0;31mError: deploy/.deploy.env not found. Copy deploy/.deploy.env.example and fill in your values.\033[0m"
    exit 1
fi
source "${SCRIPT_DIR}/.deploy.env"

SERVER_PATH="${SERVER_PATH_DEV}/server"
WEB_PATH="${SERVER_PATH_DEV}/web"
DOMAIN="${DOMAIN_DEV}"

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd "$(dirname "$0")/.."
ROOT_DIR=$(pwd)

echo -e "${YELLOW}=== SCLR Deploy (DEV) ===${NC}"

# 1. Сборка web
echo -e "${GREEN}[1/7] Building web...${NC}"
npx pnpm --filter @sclr/web build

# 2. Синхронизация server
echo -e "${GREEN}[2/7] Syncing server...${NC}"
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'data' \
  apps/server/ ${USER}@${SERVER}:${SERVER_PATH}/

# 3. Синхронизация shared package
echo -e "${GREEN}[3/7] Syncing shared package...${NC}"
ssh ${USER}@${SERVER} "mkdir -p ${SERVER_PATH}/packages/shared"
rsync -avz --delete \
  --exclude 'node_modules' \
  packages/shared/ ${USER}@${SERVER}:${SERVER_PATH}/packages/shared/

# 4. Синхронизация web dist
echo -e "${GREEN}[4/7] Syncing web dist...${NC}"
rsync -avz --delete \
  apps/web/dist/ ${USER}@${SERVER}:${WEB_PATH}/dist/

# 5. Деплой nginx и systemd конфигурации
echo -e "${GREEN}[5/7] Deploying infrastructure configs...${NC}"
scp deploy/nginx/dev.sclr.trade.conf ${USER}@${SERVER}:/etc/nginx/sites-available/dev.sclr.trade
scp deploy/systemd/sclr-server-dev.service ${USER}@${SERVER}:/etc/systemd/system/sclr-server-dev.service

# 6. Установка зависимостей и перезапуск сервисов
echo -e "${GREEN}[6/7] Installing deps & restarting services...${NC}"
ssh ${USER}@${SERVER} << 'ENDSSH'
set -e

# Fix permissions
chown -R sclr:sclr ${SERVER_PATH_DEV}

# Создаём package.json с workspace ссылкой на локальный shared
su - sclr -c 'cat > /opt/sclr-dev/server/package.json << '"'"'PKGJSON'"'"'
{
  "name": "@sclr/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch src/index.ts",
    "start": "bun src/index.ts"
  },
  "dependencies": {
    "@sclr/shared": "file:./packages/shared",
    "decimal.js": "^10.4.3",
    "hono": "^4.6.14",
    "mongodb": "^7.0.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "bun-types": "^1.3.5",
    "typescript": "^5.7.2"
  }
}
PKGJSON'

# Установка зависимостей
su - sclr -c "cd /opt/sclr-dev/server/packages/shared && ~/.bun/bin/bun install"
su - sclr -c "cd /opt/sclr-dev/server && ~/.bun/bin/bun install"

# Активируем nginx site (если ещё не активирован)
if [ ! -L /etc/nginx/sites-enabled/dev.sclr.trade ]; then
    ln -sf /etc/nginx/sites-available/dev.sclr.trade /etc/nginx/sites-enabled/dev.sclr.trade
fi

# Проверяем nginx конфигурацию
nginx -t

# Перезагружаем nginx
systemctl reload nginx

# Перезагружаем systemd daemon
systemctl daemon-reload

# Перезапуск backend сервиса
systemctl restart sclr-server-dev
sleep 3
systemctl status sclr-server-dev --no-pager || true
ENDSSH

# 7. Проверка что всё работает
echo -e "${GREEN}[7/7] Verifying deployment...${NC}"

echo -n "  Health check... "
HEALTH=$(curl -sf "https://${DOMAIN}/api/health" 2>/dev/null || echo "FAILED")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
    echo "  Response: $HEALTH"
fi

echo -n "  Symbols API... "
SYMBOLS=$(curl -sf "https://${DOMAIN}/api/symbols" 2>/dev/null || echo "FAILED")
if echo "$SYMBOLS" | grep -q '"symbols"'; then
    COUNT=$(echo "$SYMBOLS" | grep -o 'USDT' | wc -l)
    echo -e "${GREEN}OK${NC} ($COUNT symbols)"
else
    echo -e "${RED}FAILED${NC}"
fi

echo -n "  Guest API... "
TEST_UUID="00000000-0000-0000-0000-000000000000"
GUEST=$(curl -sf "https://${DOMAIN}/api/guest/${TEST_UUID}/settings" 2>/dev/null || echo "FAILED")
if echo "$GUEST" | grep -q 'instruments'; then
    echo -e "${GREEN}OK${NC}"
elif echo "$GUEST" | grep -q '404'; then
    echo -e "${RED}FAILED (404)${NC}"
else
    echo -e "${RED}FAILED${NC}"
    echo "  Response: $GUEST"
fi

echo ""
echo -e "${GREEN}=== Deploy (DEV) complete! ===${NC}"
echo "Web: https://${DOMAIN}"
echo "API: https://${DOMAIN}/api/health"
echo "Logs: ssh ${USER}@${SERVER} journalctl -u sclr-server-dev -f"
