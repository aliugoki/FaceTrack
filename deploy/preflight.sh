#!/usr/bin/env bash
# Pre-deployment sanity checks. Run this FIRST on a fresh prod box — it fails
# loudly on anything that would otherwise turn into a silent "nothing starts".
#
#   ./deploy/preflight.sh
#
# Exits non-zero if any hard requirement is missing. Warnings (yellow) are
# non-fatal but worth fixing.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

fail=0
mark() { if [ "$1" -eq 0 ]; then c_ok "$2"; else c_err "$2"; fail=1; fi; }

echo "── Host requirements ────────────────────────────────────────────"
command -v docker >/dev/null 2>&1; mark $? "docker installed"
docker compose version >/dev/null 2>&1; mark $? "docker compose v2 available"
docker info >/dev/null 2>&1; mark $? "docker daemon reachable by $(id -un) (in 'docker' group)"
command -v python3 >/dev/null 2>&1; mark $? "python3 installed (for the agent)"
python3 -c 'import requests' 2>/dev/null; \
  if [ $? -eq 0 ]; then c_ok "python3 'requests' module (agent dependency)"; \
  else c_warn "python3 'requests' missing — install: sudo apt install -y python3-requests"; fi

echo "── Dashboard config ─────────────────────────────────────────────"
[ -f "$BACKEND_ENV" ]; mark $? "backend/.env present ($BACKEND_ENV)"
if [ -f "$BACKEND_ENV" ]; then
  [ -n "$(env_get DATABASE_URL)" ]; mark $? "DATABASE_URL set"
  [ -n "$(env_get SECRET_KEY)" ] && [ "$(env_get SECRET_KEY)" != "change-me-in-env" ]; \
    mark $? "SECRET_KEY set (not the default)"
  [ -n "$(env_get AGENT_TOKEN)" ]; mark $? "AGENT_TOKEN set (needed for pipeline launch)"
  [ -n "$(env_get SUPERADMIN_USERS)" ]; mark $? "SUPERADMIN_USERS set"
fi

echo "── Database reachability ────────────────────────────────────────"
DBURL="$(env_get DATABASE_URL)"
if [ -n "$DBURL" ] && command -v psql >/dev/null 2>&1; then
  psql "$DBURL" -tAc 'select 1' >/dev/null 2>&1; mark $? "Postgres reachable via DATABASE_URL"
else
  c_warn "skipping live DB check (psql not installed or DATABASE_URL empty)"
fi

echo "── GPU / DeepStream host (only needed where pipelines run) ───────"
if command -v nvidia-smi >/dev/null 2>&1; then
  c_ok "nvidia-smi: $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
  docker info 2>/dev/null | grep -qi 'Runtimes.*nvidia'; \
    if [ $? -eq 0 ]; then c_ok "docker nvidia runtime present"; \
    else c_warn "nvidia container runtime not found — install nvidia-container-toolkit"; fi
else
  c_warn "no nvidia-smi — fine if this box only runs the dashboard, not pipelines"
fi
[ -d "$DEEPSTREAM_DIR" ]; \
  if [ $? -eq 0 ]; then c_ok "DeepStream repo at $DEEPSTREAM_DIR"; \
  else c_warn "DeepStream repo not at $DEEPSTREAM_DIR (set DEEPSTREAM_DIR=... if elsewhere)"; fi

echo "─────────────────────────────────────────────────────────────────"
if [ "$fail" -eq 0 ]; then c_ok "preflight passed"; else die "preflight FAILED — fix the ✗ items above"; fi
