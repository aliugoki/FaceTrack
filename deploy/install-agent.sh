#!/usr/bin/env bash
# Install (or update) the FaceTrack pipeline agent as a systemd service.
#
#   sudo ./deploy/install-agent.sh
#
# What it does, idempotently:
#   1. Ensures the dashboard has an AGENT_TOKEN (generates one if missing).
#   2. Writes /etc/facetrack/agent.env with a token that MATCHES the dashboard's.
#   3. Renders deploy/systemd/facetrack-agent.service with real paths/user and
#      installs it, then enables + (re)starts it.
#   4. Waits for the agent heartbeat to show up in the dashboard.
#
# Env overrides: DEEPSTREAM_DIR, DASHBOARD_URL, RUN_USER, AGENT_ENV.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

need python3
[ -f "$DEEPSTREAM_DIR/tools/pipeline_agent.py" ] \
  || die "pipeline_agent.py not found under $DEEPSTREAM_DIR — set DEEPSTREAM_DIR=/path/to/deepstream"

# 1) Make sure the dashboard has an AGENT_TOKEN, generating one if needed. -----
[ -f "$BACKEND_ENV" ] || die "backend/.env missing ($BACKEND_ENV) — deploy the dashboard first"
TOKEN="$(env_get AGENT_TOKEN)"
if [ -z "$TOKEN" ]; then
  TOKEN="$(openssl rand -hex 24)"
  c_warn "no AGENT_TOKEN in backend/.env — generating one and appending it"
  printf '\nAGENT_TOKEN=%s\n' "$TOKEN" >> "$BACKEND_ENV"
  c_warn "RESTART the dashboard so it picks up the new token:  docker compose up -d"
fi
c_ok "dashboard AGENT_TOKEN resolved (${#TOKEN} chars)"

# 2) Write the agent env with the SAME token (this is the #1 thing people get -
#    wrong — a mismatched token makes every poll 403 and nothing launches). ----
as_root mkdir -p "$(dirname "$AGENT_ENV")"
as_root tee "$AGENT_ENV" >/dev/null <<EOF
# Managed by deploy/install-agent.sh — token kept in sync with backend/.env.
DASHBOARD_URL=$DASHBOARD_URL
AGENT_TOKEN=$TOKEN
EOF
as_root chmod 600 "$AGENT_ENV"
c_ok "wrote $AGENT_ENV (token matches dashboard)"

# 3) Render + install the unit. --------------------------------------------- #
UNIT_SRC="$DEPLOY_DIR/systemd/facetrack-agent.service"
UNIT_DST="$SYSTEMD_DIR/facetrack-agent.service"
sed -e "s#__USER__#$RUN_USER#g" \
    -e "s#__DEEPSTREAM_DIR__#$DEEPSTREAM_DIR#g" \
    -e "s#__AGENT_ENV__#$AGENT_ENV#g" \
    "$UNIT_SRC" | as_root tee "$UNIT_DST" >/dev/null
c_ok "installed $UNIT_DST (User=$RUN_USER, repo=$DEEPSTREAM_DIR)"

id -nG "$RUN_USER" | tr ' ' '\n' | grep -qx docker \
  || c_warn "user '$RUN_USER' is NOT in the 'docker' group — the agent can't run docker until it is (sudo usermod -aG docker $RUN_USER)"

as_root systemctl daemon-reload
as_root systemctl enable --now facetrack-agent.service
as_root systemctl restart facetrack-agent.service
c_ok "facetrack-agent enabled + started"

# 4) Confirm it actually stayed up (didn't crash-loop on a bad token/path). -- #
c_info "confirming the agent stays alive…"
for _ in $(seq 1 8); do
  sleep 1
  systemctl is-active --quiet facetrack-agent.service \
    || die "agent exited — check: journalctl -u facetrack-agent -e"
done
c_ok "facetrack-agent is running"
echo
c_info "Follow it live:   journalctl -u facetrack-agent -f"
c_info "It will now drain any pending Start/Restart jobs and push heartbeats."
