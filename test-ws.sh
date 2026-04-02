#!/bin/bash
# Test WebSocket connection

{
  echo '{"type":"subscribe","symbol":"BTCUSDT"}'
  sleep 5
} | websocat ws://localhost:3001
