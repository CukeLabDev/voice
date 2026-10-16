#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ -e .env ]; then
  echo '.env already exists; edit it directly to keep existing secrets.' >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo 'OpenSSL is required to generate secrets.' >&2
  exit 1
fi

printf 'Website domain (for example voice.example.com): '
read -r app_domain
printf 'LiveKit domain (for example rtc.example.com): '
read -r livekit_domain

valid_domain() {
  case "$1" in
    *.*) ;;
    *) return 1 ;;
  esac
  case "$1" in
    *[!a-zA-Z0-9.-]*|.*|-*|*..*|*.-*|*-.*|*.) return 1 ;;
  esac
  return 0
}

if ! valid_domain "$app_domain" || ! valid_domain "$livekit_domain" || [ "$app_domain" = "$livekit_domain" ]; then
  echo 'Enter two different DNS hostnames using only letters, digits, dots, and hyphens.' >&2
  exit 1
fi

umask 077
cat > .env <<EOF
APP_DOMAIN=$app_domain
LIVEKIT_DOMAIN=$livekit_domain
SOURCE_URL=https://github.com/CukeLabDev/voice
AUTH_PROVIDERS=local
MUTSAKI_CLIENT_ID=
MUTSAKI_CLIENT_SECRET=
POSTGRES_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
LIVEKIT_API_KEY=koe$(openssl rand -hex 12)
LIVEKIT_API_SECRET=$(openssl rand -hex 32)
EOF

echo '.env created with random secrets. Point both DNS records to this server, then run docker compose up -d --build.'
