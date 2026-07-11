#!/usr/bin/env bash
# Shared helpers + config resolution for the FaceTrack deploy scripts.
# Sourced by deploy.sh / install-agent.sh — not meant to be run directly.

set -euo pipefail

# --- pretty output ---------------------------------------------------------- #
c_ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
c_info() { printf '\033[36m•\033[0m %s\n' "$*"; }
c_warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
c_err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }
die()    { c_err "$*"; exit 1; }

# --- paths (override any of these via the environment) ---------------------- #
# REPO_DIR is resolved from this file's location so the scripts work no matter
# where the repo is checked out on the prod box.
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(cd "$DEPLOY_DIR/.." && pwd)}"
BACKEND_ENV="${BACKEND_ENV:-$REPO_DIR/backend/.env}"

# The DeepStream repo (where pipeline_agent.py + run_company_pipeline.sh live).
DEEPSTREAM_DIR="${DEEPSTREAM_DIR:-/home/meta/deploy/deepstream}"

# Internal dashboard URL the agent polls (skip the public TLS proxy on-box).
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:5002}"

# Where the agent's env + its systemd unit land.
AGENT_ENV="${AGENT_ENV:-/etc/facetrack/agent.env}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

# User the agent runs as — must be in the `docker` group.
RUN_USER="${RUN_USER:-${SUDO_USER:-$(id -un)}}"

# --- helpers ---------------------------------------------------------------- #
need() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

# Read one KEY=value from backend/.env (strips optional quotes). Empty if absent.
env_get() {
  local key="$1" file="${2:-$BACKEND_ENV}"
  [ -f "$file" ] || return 0
  sed -nE "s/^${key}=(.*)$/\1/p" "$file" | tail -n1 | sed -E 's/^["'"'"']//; s/["'"'"']$//'
}

# Run a command with sudo only when we are not already root.
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
