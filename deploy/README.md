# `deploy/` — FaceTrack production deployment kit

Everything needed to take FaceTrack from a fresh server to running, in one place.
Start with **[`../DEPLOYMENT.md`](../DEPLOYMENT.md)** for the full walkthrough; this
file is the quick index of *what each piece is for*.

## The 60-second version

```bash
cp backend/.env.example backend/.env   # fill in DATABASE_URL, SECRET_KEY, AGENT_TOKEN…
./deploy/preflight.sh                   # verify the box has everything
./deploy/deploy.sh                      # build+run dashboard, then install the agent
./deploy/deploy.sh status               # confirm all components are healthy
```

## What each file is for

| File | Purpose | You run it? |
|---|---|---|
| **`../DEPLOYMENT.md`** | The complete production guide — prerequisites, config, TLS, first-run, day-2 ops, troubleshooting. | Read it |
| **`deploy.sh`** | One-command entrypoint. Subcommands: `all` (default), `app`, `agent`, `status`, `preflight`. Use it to deploy **and** to push updates. | ✅ yes |
| **`preflight.sh`** | Pre-deploy checks — Docker, compose, GPU runtime, DB reachability, `backend/.env`, token. Fails loudly on anything missing. | ✅ yes (first) |
| **`install-agent.sh`** | Installs the **pipeline agent** as a systemd service and force-syncs `AGENT_TOKEN` between the agent and the dashboard. This is the piece that makes the **Start** button actually launch pipelines. | ✅ `sudo` |
| **`lib.sh`** | Shared helpers + config resolution (paths, `.env` reading). Sourced by the others. | ❌ sourced only |
| **`agent.env.example`** | Template for `/etc/facetrack/agent.env` (the agent's `DASHBOARD_URL` + `AGENT_TOKEN`). `install-agent.sh` writes the real one for you. | ❌ reference |
| **`systemd/facetrack-agent.service`** | The agent's systemd unit (**critical** — without it, Start clicks pile up as `pending` and nothing runs). Installed by `install-agent.sh`. | ❌ installed for you |
| **`systemd/facetrack.service`** | **Optional** wrapper so `systemctl` controls the dashboard container. The compose file already has `restart: always`, so this is only for single-point lifecycle control. | ❌ optional |

## How the pieces fit together

```
preflight.sh ──► deploy.sh app ──► dashboard container (:5002, restart: always)
                        │
                        └─► deploy.sh agent ──► install-agent.sh
                                                     ├─ writes /etc/facetrack/agent.env  (token synced from backend/.env)
                                                     └─ installs + starts facetrack-agent.service
                                                                       │
                                                                       └─ drains pipeline_jobs → runs deepstream-<company> containers
```

## Configuration knobs (env overrides for the scripts)

All optional — sensible defaults are auto-detected. Set them inline when your prod
layout differs from the dev box:

| Var | Default | When to set |
|---|---|---|
| `DEEPSTREAM_DIR` | `/home/meta/deploy/deepstream` | DeepStream repo (has `pipeline_agent.py`) lives elsewhere |
| `DASHBOARD_URL` | `http://localhost:5002` | Agent runs on a **different host** than the dashboard |
| `RUN_USER` | current/`sudo` user | Agent should run as a specific user (must be in `docker` group) |
| `AGENT_ENV` | `/etc/facetrack/agent.env` | Custom agent env location |

Example (agent on a separate GPU host):
```bash
DASHBOARD_URL=http://10.0.0.5:5002 DEEPSTREAM_DIR=/srv/deepstream sudo -E ./deploy/install-agent.sh
```
