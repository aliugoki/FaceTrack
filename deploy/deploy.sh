#!/usr/bin/env bash
# FaceTrack — one-command deploy / update.
#
#   ./deploy/deploy.sh              # preflight → build+run dashboard → install agent
#   ./deploy/deploy.sh app          # just (re)build & start the dashboard container
#   ./deploy/deploy.sh agent        # just install/refresh the pipeline agent
#   ./deploy/deploy.sh status       # show health of every component
#   ./deploy/deploy.sh preflight    # only run the pre-checks
#
# Safe to re-run: it's how you deploy AND how you push updates (git pull first).
# Env overrides: DEEPSTREAM_DIR, DASHBOARD_URL, RUN_USER, AGENT_ENV.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

deploy_app() {
  need docker
  [ -f "$BACKEND_ENV" ] || die "backend/.env missing — cp backend/.env.example backend/.env and fill it in"
  c_info "building + starting the dashboard container…"
  ( cd "$REPO_DIR" && docker compose up -d --build )
  c_info "waiting for http://localhost:$(env_get PORT 2>/dev/null || echo 5002)/ …"
  local port; port="$(env_get PORT)"; port="${port:-5002}"
  for _ in $(seq 1 30); do
    if curl -fsS -o /dev/null "http://localhost:$port/"; then c_ok "dashboard healthy on :$port"; return 0; fi
    sleep 1
  done
  c_warn "dashboard didn't answer on :$port yet — check: docker logs -f attendance-system"
}

deploy_agent() { "$DEPLOY_DIR/install-agent.sh"; }

show_status() {
  echo "── Dashboard ────────────────────────────────────────────────────"
  docker ps --format '{{.Names}}\t{{.Status}}' | grep -i attendance || c_warn "attendance-system container not running"
  local port; port="$(env_get PORT)"; port="${port:-5002}"
  curl -fsS -o /dev/null "http://localhost:$port/" && c_ok "HTTP :$port responding" || c_warn "HTTP :$port not responding"
  echo "── Pipeline agent ───────────────────────────────────────────────"
  if systemctl list-unit-files 2>/dev/null | grep -q '^facetrack-agent'; then
    systemctl is-active --quiet facetrack-agent && c_ok "facetrack-agent: active" || c_warn "facetrack-agent: $(systemctl is-active facetrack-agent 2>/dev/null)"
    systemctl --no-pager -o cat status facetrack-agent 2>/dev/null | tail -3
  else
    c_warn "facetrack-agent service not installed — run: ./deploy/deploy.sh agent"
  fi
  echo "── GPU pipelines (health :9108+idx) ─────────────────────────────"
  docker ps --format '{{.Names}}\t{{.Status}}' | grep -i deepstream || c_info "no deepstream-* pipeline containers running"
}

cmd="${1:-all}"
case "$cmd" in
  preflight) "$DEPLOY_DIR/preflight.sh" ;;
  app)       deploy_app ;;
  agent)     deploy_agent ;;
  status)    show_status ;;
  all)       "$DEPLOY_DIR/preflight.sh"; deploy_app; deploy_agent; echo; show_status ;;
  *)         die "unknown command: $cmd  (use: all | app | agent | status | preflight)" ;;
esac
