#!/bin/bash
set -e

# Setup SSH keys for passwordless deploy
SCRIPT_DIR="$(dirname "$0")"
if [ ! -f "${SCRIPT_DIR}/.deploy.env" ]; then
    echo "Error: deploy/.deploy.env not found. Copy deploy/.deploy.env.example and fill in your values."
    exit 1
fi
source "${SCRIPT_DIR}/.deploy.env"

echo "=== Setup SSH keys for deployment ==="

# Проверяем наличие SSH ключа
if [ ! -f ~/.ssh/id_ed25519.pub ]; then
    echo "Generating SSH key..."
    ssh-keygen -t ed25519 -C "deploy@sclr" -f ~/.ssh/id_ed25519 -N ""
fi

# Копируем ключ на сервер
echo "Copying SSH key to server..."
echo "You will be asked for password one last time."
ssh-copy-id -i ~/.ssh/id_ed25519.pub ${USER}@${SERVER}

# Проверяем подключение
echo "Testing connection..."
ssh -o BatchMode=yes ${USER}@${SERVER} "echo 'SSH key auth working!'"

echo ""
echo "=== Done! ==="
echo "Now you can run: pnpm deploy"
