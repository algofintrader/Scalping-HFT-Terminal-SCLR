#!/bin/bash
# Быстрая проверка API endpoints без деплоя

DOMAIN="${1:-sclr.trade}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}=== SCLR API Verification: ${DOMAIN} ===${NC}"
echo ""

# Health
echo -n "Health check (/api/health)... "
HEALTH=$(curl -sf "https://${DOMAIN}/api/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
    echo "  Response: ${HEALTH:-connection failed}"
fi

# Symbols
echo -n "Symbols API (/api/symbols)... "
SYMBOLS=$(curl -sf "https://${DOMAIN}/api/symbols" 2>/dev/null)
if echo "$SYMBOLS" | grep -q '"symbols"'; then
    COUNT=$(echo "$SYMBOLS" | grep -o 'USDT' | wc -l)
    echo -e "${GREEN}OK${NC} ($COUNT symbols)"
else
    echo -e "${RED}FAILED${NC}"
    echo "  Response: ${SYMBOLS:-connection failed}"
fi

# Guest GET
TEST_UUID="00000000-0000-0000-0000-000000000000"
echo -n "Guest GET (/api/guest/:id/settings)... "
GUEST_GET=$(curl -sf "https://${DOMAIN}/api/guest/${TEST_UUID}/settings" 2>/dev/null)
if echo "$GUEST_GET" | grep -q 'instruments'; then
    echo -e "${GREEN}OK${NC}"
elif echo "$GUEST_GET" | grep -q 'Invalid guest ID'; then
    echo -e "${GREEN}OK${NC} (validation works)"
else
    echo -e "${RED}FAILED${NC}"
    echo "  Response: ${GUEST_GET:-connection failed}"
fi

# Guest PUT
REAL_UUID=$(cat /proc/sys/kernel/random/uuid)
echo -n "Guest PUT (/api/guest/:id/settings)... "
GUEST_PUT=$(curl -sf -X PUT "https://${DOMAIN}/api/guest/${REAL_UUID}/settings" \
    -H "Content-Type: application/json" \
    -d '{"instruments":[{"id":"test","symbol":"BTCUSDT"}],"autoScrollEnabled":true}' 2>/dev/null)
if echo "$GUEST_PUT" | grep -q 'success'; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC}"
    echo "  Response: ${GUEST_PUT:-connection failed}"
fi

# Auth check
echo -n "Auth check (/api/auth/me)... "
AUTH=$(curl -sf "https://${DOMAIN}/api/auth/me" 2>/dev/null)
if echo "$AUTH" | grep -q 'Unauthorized\|error\|token'; then
    echo -e "${GREEN}OK${NC} (auth required - expected)"
else
    echo -e "${YELLOW}UNKNOWN${NC}"
    echo "  Response: ${AUTH:-connection failed}"
fi

# WebSocket
echo -n "WebSocket endpoint... "
WS_CHECK=$(curl -sf -I "https://${DOMAIN}/ws" 2>/dev/null | head -1)
if echo "$WS_CHECK" | grep -q '426\|101\|400'; then
    echo -e "${GREEN}OK${NC} (upgrade required - expected)"
else
    echo -e "${YELLOW}UNKNOWN${NC}"
    echo "  Response: ${WS_CHECK:-connection failed}"
fi

echo ""
echo -e "${YELLOW}=== Verification complete ===${NC}"
