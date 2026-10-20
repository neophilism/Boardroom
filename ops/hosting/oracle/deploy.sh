#!/bin/sh
# Run from a private directory on the existing Oracle Always Free VM.
# Does not create or upgrade cloud resources or open paid usage.
set -eu
cd "$(dirname "$0")"
test -f .env || { echo 'Missing private .env; see env.example' >&2; exit 1; }
chmod 600 .env
# Do not source .env in a shell: connection strings/PEM values can contain
# shell metacharacters. Docker Compose parses env_file securely.
image=$(sed -n 's/^BOARDROOM_IMAGE=//p' .env | tail -n 1)
host=$(sed -n 's/^BOARDROOM_HOSTNAME=//p' .env | tail -n 1)
case "$image" in
  ghcr.io/neophilism/boardroom:sha-*)
    value=${image##*sha-}
    ;;
  ghcr.io/neophilism/boardroom@sha256:*)
    value=${image##*sha256:}
    ;;
  *)
    echo 'BOARDROOM_IMAGE must use the Boardroom GHCR package and an exact source SHA or digest' >&2
    exit 1
    ;;
esac
if ! printf '%s' "$value" | grep -Eq '^[0-9a-f]{40}$|^[0-9a-f]{64}
case "$host" in
  *.*) ;;
  *) echo 'BOARDROOM_HOSTNAME must be a valid DNS hostname with TLS' >&2; exit 1;;
esac
docker compose --env-file .env config --quiet
docker compose --env-file .env pull
docker compose --env-file .env up -d --no-build
docker compose --env-file .env ps
echo "Deployment started; verify HTTPS readiness and authorization with the public smoke workflow."
; then
  echo 'BOARDROOM_IMAGE SHA or digest is malformed' >&2
  exit 1
fi
case "$host" in
  *.*) ;;
  *) echo 'BOARDROOM_HOSTNAME must be a valid DNS hostname with TLS' >&2; exit 1;;
esac
docker compose --env-file .env config --quiet
docker compose --env-file .env pull
docker compose --env-file .env up -d --no-build
docker compose --env-file .env ps
echo "Deployment started; verify HTTPS readiness and authorization with the public smoke workflow."
