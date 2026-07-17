# VPSGuard

**Real-time multi-server monitoring and management dashboard — built for preventive action.**

Monitor your VPS fleet from a single dashboard: live CPU, memory, disk metrics, Docker containers, PostgreSQL, crontab management, script execution, and automated server provisioning — all streamed in real-time via WebSocket. Beyond real-time: persistent alerts with lifecycle, long-range trends, disk-full projections, and cron execution watching so problems surface *before* they hurt.

---

[English](#english) | [Español](#español)

---

## English

### Features

- **Real-time Monitoring** — CPU, memory, disk, uptime, load average, and SSH latency for all servers via WebSocket with HTTP polling fallback
- **Docker Management** — List containers with live CPU/RAM/Disk I/O stats, status badges, and log viewer
- **Script Execution** — Create, edit, and run shell scripts remotely with live terminal output streaming, persistent execution history with stored output, last-run badges per script, fleet-wide "Run on all" with side-by-side panes, and a typed-confirmation guard for destructive scripts
- **Scheduled Scripts** — Give any script a cron schedule and target servers; it runs automatically, lands in the same history, and a `script` alert fires when a scheduled run fails (auto-resolves on the next passing run)
- **Alert → Script Bridge** — Tag scripts with the alert types they remediate; active alerts show one-click shortcuts that open the script with the affected server preselected
- **AI Analysis (Prevention)** — LLM analysis of a compact, pre-aggregated fleet snapshot (status, alerts, trends, projections, PostgreSQL — never raw script outputs) via any OpenAI-compatible endpoint (LiteLLM, Ollama, OpenAI, xAI) or the native Anthropic API. Returns an executive summary, prioritized findings tagged by evolution vs the previous run (worse/improved/new/persisting), and a consolidated **action plan** grouped by horizon (now / this week / watch) with step dependencies and suggested scripts. Runs on demand or on a cron schedule (`AI_ANALYSIS_SCHEDULE`), with desktop notifications and optional per-server `ai` alerts (`AI_OPEN_ALERTS`). Model is selectable in the UI (persisted server-side); planned reboots are recognized as maintenance, not incidents. Secrets stay in `.env`; the AI recommends — it never executes anything
- **Crontab Manager** — View, create, toggle, and delete cron jobs with preset schedules and human-readable descriptions
- **Log Viewer** — Browse container logs per server with auto-scroll and copy support
- **Server Management** — Full CRUD for servers with SSH connectivity testing
- **Setup Wizard** — Provision a virgin server from scratch: creates user, configures sudo, generates SSH keys, copies public key, updates `~/.ssh/config`, and registers it in the dashboard — all streamed step-by-step
- **Trend Charts** — Historical charts with range selector (1h → 90d, backed by hourly rollups kept for a year), click-drag range analysis (min/avg/max), brush navigator, and per-process/per-container resource breakdown at peak CPU timestamps
- **Container Logs** — Double-click any container in the detail view to see its logs inline with color-coded output (error/warn/info)
- **Persistent Alert System** — Alerts with full lifecycle (open → acknowledge → auto-resolve) stored in SQLite, hysteresis to kill false positives (opens after ~30s over threshold, resolves after ~1min clean), recovery notifications, an Alerts tab with unacknowledged badge, and an optional **webhook** (`ALERT_WEBHOOK_URL`) that POSTs every transition to Slack/Telegram/n8n
- **Per-server Thresholds** — Editable from the Alerts tab with cascading resolution (server → global → defaults); changes apply hot on the next sample
- **Predictive Monitoring** — Linear-regression projections: *"disk full in ~N days"* on each server card (with a `disk-eta` alert when under 14 days) and sustained memory-climb detection for leak hunting
- **PostgreSQL Monitoring** — Auto-discovers Postgres containers: databases with size and connections, cache hit ratio, active queries, locks, replication — plus a 5-min sampler that powers per-container **trend charts** (connections vs `max_connections`, size growth), a `pg-connections` saturation alert, and a `pg-replication` alert when a standby's lag exceeds `PG_REPL_LAG_ALERT_MB`. Works with replicas too: the connecting role is resolved by probing candidates (`POSTGRES_USER` → `postgres` → name-derived), with a `PG_USER_OVERRIDES` escape hatch
- **Cron Execution Watch** — Reads real CRON executions from syslog: each job shows its last run and an OVERDUE badge when it stops running (2× its expected interval), with an hourly alert — so a silently failing backup is caught before you need it
- **Container Health** — Restart counts and OOM-kill flags per container, plus an hourly `flapping` alert when restart counts grow between passes: a crash-looping container can no longer hide behind "Up 2 minutes"
- **System Signals** — Failure modes CPU/mem/disk can't see: inode exhaustion (`inodes` alert at 90% — a disk can fill on inodes with free space left), failed systemd units (`systemd` alert with unit names), swap pressure, and pending-reboot flags, surfaced as attention chips on each server card
- **SSL Certificate Watch** — Hourly certbot check with an `ssl` alert when any certificate expires within 14 days (critical ≤ 7): a silently failing renewal is caught before the browser error
- **macOS Widget** — (Experimental) Übersicht desktop widget for at-a-glance monitoring (reads the API token from `~/.config/vpsguard/token`)

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS, Radix UI, Recharts, Socket.IO Client |
| Backend | Node.js, Express, Socket.IO, SQLite (better-sqlite3) |
| Communication | WebSocket (real-time) + REST API (fallback) |
| Auth | Bearer token (shared secret) |
| Server Access | SSH with key-based authentication |

### Project Structure

```
vpsguard/
├── einventiva-dashboard/            # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Overview.tsx             # Main dashboard with server cards + trends
│   │   │   ├── ServerDetailPanel.tsx    # Detailed server view with charts + logs
│   │   │   ├── ServerCard.tsx           # Server metric card with CPU gauge
│   │   │   ├── TrendChart.tsx           # Historical charts with drill-down
│   │   │   ├── DockerPanel.tsx          # Docker container management (+ restarts/OOM)
│   │   │   ├── PostgresPanel.tsx        # PostgreSQL monitoring
│   │   │   ├── PgTrends.tsx             # Per-container PG trend charts
│   │   │   ├── AlertsPanel.tsx          # Alert center (active/history + ack)
│   │   │   ├── PreventionPanel.tsx      # AI analysis: summary, action plan, findings
│   │   │   ├── ThresholdsEditor.tsx     # Per-server threshold editor
│   │   │   ├── ScriptsPanel.tsx         # Script CRUD + execution
│   │   │   ├── CrontabPanel.tsx         # Crontab manager (+ last run/overdue)
│   │   │   ├── LogViewer.tsx            # Container log viewer
│   │   │   ├── ServersPanel.tsx         # Server CRUD
│   │   │   ├── SetupWizardPanel.tsx     # Automated server provisioning
│   │   │   ├── ErrorBoundary.tsx        # Error boundary wrapper
│   │   │   └── ui/                      # 40+ Radix UI components
│   │   ├── hooks/
│   │   │   ├── useServerData.ts         # Real-time metrics via shared socket
│   │   │   ├── useAlerts.ts             # Alert state from API + socket events
│   │   │   ├── useThresholds.ts         # Effective thresholds per server
│   │   │   ├── useProjections.ts        # Disk-full ETA / memory slope
│   │   │   └── useAutoScroll.ts         # Auto-scroll for log viewers
│   │   ├── lib/
│   │   │   ├── config.ts               # SOCKET_URL, API_BASE, API_TOKEN
│   │   │   ├── api.ts                  # REST client with data transformations
│   │   │   ├── socket.ts              # Shared socket singleton (ref-counted)
│   │   │   ├── parsers.ts             # Metric data parsers
│   │   │   ├── formatters.ts          # Display formatters
│   │   │   └── utils.ts               # General utilities (cn classnames)
│   │   └── types.ts                    # TypeScript interfaces
│   └── package.json
├── einventiva-dashboard-server/     # Backend (Node.js + Express)
│   ├── monitor.js                       # Entry point (~100 lines)
│   ├── config.js                        # Constants, env parsing, thresholds
│   ├── db.js                            # SQLite schema + seed data
│   ├── middleware/
│   │   └── auth.js                      # HTTP Bearer + Socket.IO auth
│   ├── routes/
│   │   ├── health.js                    # Health check
│   │   ├── status.js                    # Server metrics
│   │   ├── docker.js                    # Containers + logs + restart counts
│   │   ├── postgres.js                  # PG stats, detailed view, history
│   │   ├── alerts.js                    # Alert list + acknowledge
│   │   ├── thresholds.js                # Per-server threshold CRUD
│   │   ├── projections.js               # Disk-full ETA / memory slope
│   │   ├── scripts.js                   # Script CRUD
│   │   ├── servers.js                   # Server CRUD + SSH test
│   │   ├── crontab.js                   # Crontab CRUD + execution watch
│   │   ├── history.js                   # Metrics history (ranges) + drill-down
│   │   └── ai.js                        # AI analysis, config, model selection
│   ├── services/
│   │   ├── ssh.js                       # SSH execution (ControlMaster mux)
│   │   ├── metrics.js                   # Metrics parsing + collection
│   │   ├── cache.js                     # In-memory response cache
│   │   ├── alerts.js                    # Threshold breach evaluation
│   │   ├── alertEngine.js               # Alert lifecycle with hysteresis
│   │   ├── thresholds.js                # Cascading threshold resolution
│   │   ├── projections.js               # Linear-regression projections
│   │   ├── cronWatch.js                 # Syslog CRON execution parsing
│   │   ├── sslCheck.js                  # Certbot certificate expiry check
│   │   ├── pg.js                        # Shared PG helpers
│   │   ├── pgHistory.js                 # PostgreSQL 5-min sampler
│   │   ├── notify.js                    # Alert webhook delivery
│   │   ├── crontab.js                   # Crontab file parsing
│   │   ├── scheduler.js                 # Cron parser for scheduled scripts + AI
│   │   ├── aiSample.js                  # Compact fleet snapshot for AI analysis
│   │   ├── aiProviders.js              # LLM client (OpenAI-compatible + Anthropic)
│   │   ├── aiAnalysis.js                # AI orchestration: prompt, parse, persist
│   │   ├── backgroundJobs.js            # Loops: metrics, rollups, prune, PG, checks, AI
│   │   └── logger.js                    # Logging utility
│   ├── websocket/
│   │   └── handlers.js                  # Script exec streaming, wizard
│   ├── test/                            # Unit tests
│   ├── Dockerfile
│   └── package.json
├── ubersicht-widget/                # macOS desktop widget (optional)
├── docker-compose.yml
└── .gitignore
```

### Prerequisites

- **Node.js** 18+
- **SSH access** to your servers (key-based recommended)
- **sshpass** (only needed for the Setup Wizard) — `brew install hudochenkov/sshpass/sshpass` (macOS) or `apt install sshpass` (Linux)
- Servers must have **Docker** installed (for container monitoring)

### Quick Start

#### 1. Clone the repository

```bash
git clone https://github.com/einventiva/vpsguard.git
cd vpsguard
```

#### 2. Setup the backend

```bash
cd einventiva-dashboard-server
npm install
cp .env.example .env
```

Edit `.env` with your configuration:

```env
API_TOKEN=your-secret-token-here
PORT=3847
CORS_ORIGINS=http://localhost:5173,http://localhost:4173

# Retention (days): raw metrics / per-process detail / hourly rollups / PG samples
PRUNE_KEEP_DAYS=30
DETAIL_KEEP_DAYS=3
ROLLUP_KEEP_DAYS=365
PG_KEEP_DAYS=90

# Alerting: hysteresis samples, disk-full ETA, SSL expiry, PG connection saturation
ALERT_SAMPLES_TO_OPEN=2
ALERT_SAMPLES_TO_RESOLVE=4
DISK_ETA_ALERT_DAYS=14
SSL_ALERT_DAYS=14
PG_CONN_ALERT_PCT=80
PG_REPL_LAG_ALERT_MB=100
# Optional: POST { event, alert, sentAt } on every alert transition
# ALERT_WEBHOOK_URL=https://example.com/webhook
# Optional: explicit container->role mapping when PG role auto-detection can't guess
# PG_USER_OVERRIDES={"pg-replica-foo":"foo_legacy_user"}
```

Start the backend:

```bash
npm start
```

The database is created automatically on first run with 12 example scripts.

#### 3. Setup the frontend

```bash
cd einventiva-dashboard
npm install
cp .env.example .env
```

Edit `.env`:

```env
VITE_API_TOKEN=your-secret-token-here
# Optional: backend URL if not http://localhost:3847
# VITE_API_URL=https://monitor.example.com
```

Start the dev server:

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

#### 4. Add your first server

**Option A: Setup Wizard (recommended for new servers)**

1. Go to the **Servers** tab
2. Click **Setup Wizard**
3. Enter the server IP, root password, and desired username
4. The wizard will automatically:
   - Create the user with sudo + docker access
   - Generate a dedicated ed25519 SSH keypair
   - Copy the public key to the server
   - Add the SSH config entry to `~/.ssh/config`
   - Register the server in the dashboard

**Option B: Manual setup (for servers with existing SSH access)**

1. Go to **Servers** → **New Server**
2. Fill in: key, display name, SSH alias (from your `~/.ssh/config`), IP, port, user
3. Click **Create Server**

#### 5. Docker deployment (optional)

```bash
docker-compose up -d
```

### Default Scripts

The dashboard comes with 12 pre-loaded scripts:

| Script | Description |
|--------|------------|
| Docker Prune | Remove unused Docker images, containers, and volumes |
| Clean Logs | Clean old log files and journal entries |
| Security Scan | Run Lynis security audit |
| Disk Usage | Show disk usage summary, top directories, and Docker disk usage |
| Restart Nginx | Restart nginx and show status |
| Certbot Renew | Test SSL certificate renewal |
| Fail2ban Status | Check fail2ban security status |
| Docker Stats | Show container resource statistics |
| Check Updates | Check for available system updates |
| Apply Updates | Apply all pending updates (sudo) |
| Safe Reboot | Pre-reboot checklist + scheduled reboot in 1 minute |
| Backup DB | Template for custom database backup |

You can create, edit, and delete scripts from the dashboard UI.

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | All server metrics |
| GET | `/api/health` | Health check |
| GET | `/api/docker/:server` | Docker containers + stats + restart counts |
| GET | `/api/docker/:server/:container/logs` | Container logs |
| GET | `/api/postgres/:server` | PostgreSQL containers + databases |
| GET | `/api/postgres/:server/detailed?container=NAME` | Cache hit, tables, queries, locks, replication |
| GET | `/api/postgres/:server/history?container=NAME&range=24h\|7d\|30d` | PG time series |
| GET | `/api/history/:server?range=1h\|6h\|24h\|7d\|30d\|90d\|1y` | Metrics history (bounded payloads) |
| GET | `/api/history/:server/detail?ts=TIMESTAMP&window=SECONDS` | Drill-down detail (nearest sample) |
| GET | `/api/alerts?active=1` | Alert history / active alerts |
| POST | `/api/alerts/:id/ack` | Acknowledge an alert |
| GET | `/api/thresholds` | Thresholds (builtin, global, per-server, effective) |
| PUT | `/api/thresholds/global` | Set global threshold overrides |
| PUT | `/api/thresholds/:server` | Set per-server threshold overrides |
| GET | `/api/projections` | Disk-full ETA + memory slope per server |
| GET | `/api/scripts` | List scripts |
| POST | `/api/scripts` | Create script |
| PUT | `/api/scripts/:id` | Update script |
| DELETE | `/api/scripts/:id` | Delete script |
| GET | `/api/executions` | Script execution history (filter by `server`, `script`) |
| POST | `/api/ai/analyze` | Run an AI fleet analysis (rate limited; optional one-off model) |
| GET | `/api/ai/analyses` | AI analysis history |
| GET | `/api/ai/analyses/:id` | Full analysis including its input snapshot |
| GET | `/api/ai/config` | AI module status (no secrets) |
| GET | `/api/ai/models` | Models the configured provider/key allows |
| POST | `/api/ai/interpret` | Interpret a script's output into a verdict |
| PUT | `/api/ai/model` | Persist the selected model (empty = env default) |
| GET | `/api/executions/latest` | Latest execution per script for a server |
| GET | `/api/executions/:id` | Full execution record with stored output |
| GET | `/api/crontab/:server` | List cron jobs |
| POST | `/api/crontab/:server` | Add cron job |
| PUT | `/api/crontab/:server/:index` | Edit cron job |
| DELETE | `/api/crontab/:server/:index` | Delete cron job |
| PATCH | `/api/crontab/:server/:index/toggle` | Enable/disable cron job |
| GET | `/api/servers` | List servers |
| POST | `/api/servers` | Create server |
| PUT | `/api/servers/:key` | Update server |
| DELETE | `/api/servers/:key` | Delete server |
| POST | `/api/servers/:key/test` | Test SSH connection |

### WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `metrics:update` | Server → Client | Real-time server metrics |
| `alert:opened` | Server → Client | Alert opened (full row) |
| `alert:resolved` | Server → Client | Alert auto-resolved |
| `execute:script` | Client → Server | Run a script |
| `script:output` | Server → Client | Live script output |
| `wizard:setup` | Client → Server | Start server provisioning |
| `wizard:step` | Server → Client | Wizard step progress |
| `wizard:output` | Server → Client | Wizard live output |

### Configuration

All configuration is done via environment variables (see `.env.example` for the full list). Servers are stored in SQLite and managed from the UI. The `.env` server variables (`SERVER_*`) are only used as initial seed when the database is empty. Alert thresholds are managed from the Alerts tab and stored in SQLite.

**Cron execution watch** reads `/var/log/syslog`, which requires the SSH user to be in the `adm` group on each monitored server: `sudo usermod -aG adm YOUR_USER`. Without it, cron entries show without last-run info (no false alarms are raised).

**SSL certificate watch** runs `sudo -n certbot certificates`, which requires passwordless sudo for the SSH user. Without it, no certificates are reported and no alerts fire.

### License

MIT

---

## Español

### Características

- **Monitoreo en tiempo real** — CPU, memoria, disco, uptime, load average y latencia SSH de todos los servidores vía WebSocket con fallback HTTP polling
- **Gestión Docker** — Lista de containers con estadísticas en vivo de CPU/RAM/Disco, badges de estado y visor de logs
- **Ejecución de Scripts** — Crea, edita y ejecuta scripts de shell remotamente con salida en terminal en tiempo real, historial persistente de ejecuciones con output almacenado, badges de última ejecución por script, "Run on all" para toda la flota con paneles lado a lado, y guarda de confirmación tipeada para scripts destructivos
- **Scripts Programados** — Dale a cualquier script un schedule cron y servidores destino; corre automáticamente, cae en el mismo historial, y una alerta `script` se dispara cuando una corrida programada falla (se resuelve sola con la siguiente corrida exitosa)
- **Puente Alertas → Scripts** — Etiqueta scripts con los tipos de alerta que remedian; las alertas activas muestran accesos de un clic que abren el script con el servidor afectado preseleccionado
- **Análisis con IA (Prevención)** — Análisis LLM de un snapshot compacto y pre-agregado de la flota (estado, alertas, tendencias, proyecciones, PostgreSQL — nunca outputs crudos de scripts) vía cualquier endpoint OpenAI-compatible (LiteLLM, Ollama, OpenAI, xAI) o la API nativa de Anthropic. Devuelve un resumen ejecutivo, hallazgos priorizados etiquetados por evolución vs la corrida anterior (empeoró/mejoró/nuevo/persiste), y un **plan de acción** consolidado agrupado por horizonte (ahora / esta semana / monitorear) con dependencias entre pasos y scripts sugeridos. Bajo demanda o programado por cron (`AI_ANALYSIS_SCHEDULE`), con notificaciones de escritorio y alertas `ai` por servidor opcionales (`AI_OPEN_ALERTS`). El modelo se elige en la UI (persistido en el backend); los reboots planeados se reconocen como mantenimiento, no incidentes. Los secretos viven en `.env`; la IA recomienda — nunca ejecuta nada
- **Gestor de Crontab** — Ver, crear, activar/desactivar y eliminar cron jobs con presets y descripciones legibles
- **Visor de Logs** — Navega logs de containers por servidor con auto-scroll y copia
- **Gestión de Servidores** — CRUD completo con prueba de conectividad SSH
- **Setup Wizard** — Provisiona un servidor virgen desde cero: crea usuario, configura sudo, genera claves SSH, copia la clave pública, actualiza `~/.ssh/config` y registra el servidor — todo streameado paso a paso
- **Gráficas de Tendencia** — Gráficas históricas con selector de rango (1h → 90d, respaldado por rollups horarios conservados un año), análisis de rango por click-drag (min/avg/max), brush navigator y desglose por proceso/container en el pico de CPU
- **Logs de Containers** — Doble-click en cualquier container en la vista de detalle para ver sus logs inline con colores por nivel (error/warn/info)
- **Sistema de Alertas Persistente** — Alertas con ciclo de vida completo (abre → reconoce → auto-resuelve) guardadas en SQLite, histéresis contra falsos positivos (abre tras ~30s sobre umbral, resuelve tras ~1min limpio), notificaciones de recuperación, pestaña Alerts con badge de no-reconocidas, y **webhook** opcional (`ALERT_WEBHOOK_URL`) que hace POST de cada transición a Slack/Telegram/n8n
- **Umbrales por Servidor** — Editables desde la pestaña Alerts con resolución en cascada (servidor → global → defaults); los cambios aplican en caliente en la siguiente muestra
- **Monitoreo Predictivo** — Proyecciones por regresión lineal: *"disco lleno en ~N días"* en cada tarjeta de servidor (con alerta `disk-eta` bajo 14 días) y detección de subida sostenida de memoria para cazar leaks
- **Monitoreo PostgreSQL** — Descubre containers de Postgres automáticamente: bases con tamaño y conexiones, cache hit ratio, queries activas, locks, replicación — más un muestreador cada 5 min que alimenta **gráficas de tendencia** por container (conexiones vs `max_connections`, crecimiento de tamaño), una alerta `pg-connections` por saturación y una alerta `pg-replication` cuando el lag de un standby supera `PG_REPL_LAG_ALERT_MB`. Funciona también con réplicas: el rol de conexión se resuelve probando candidatos (`POSTGRES_USER` → `postgres` → derivados del nombre), con `PG_USER_OVERRIDES` como escape
- **Vigilancia de Ejecución de Crons** — Lee las ejecuciones reales de CRON desde syslog: cada job muestra su última corrida y un badge OVERDUE cuando deja de correr (2× su intervalo esperado), con alerta horaria — un backup que falla en silencio se detecta antes de necesitarlo
- **Salud de Containers** — Conteo de reinicios y flag de OOM-kill por container, más una alerta `flapping` horaria cuando los reinicios crecen entre pasadas: un container en crash-loop ya no se esconde tras "Up 2 minutes"
- **Señales de Sistema** — Modos de fallo que CPU/mem/disco no ven: agotamiento de inodos (alerta `inodes` al 90% — un disco puede llenarse de inodos con espacio libre), unidades systemd fallidas (alerta `systemd` con los nombres), presión de swap y reinicio pendiente, mostrados como chips de atención en cada tarjeta
- **Vigilancia de Certificados SSL** — Chequeo horario vía certbot con alerta `ssl` cuando algún certificado expira en menos de 14 días (critical ≤ 7): una renovación que falla en silencio se detecta antes del error en el navegador
- **Widget macOS** — (Experimental) Widget para Übersicht para monitoreo de un vistazo (lee el token desde `~/.config/vpsguard/token`)

### Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19, TypeScript, Vite, TailwindCSS, Radix UI, Recharts, Socket.IO Client |
| Backend | Node.js, Express, Socket.IO, SQLite (better-sqlite3) |
| Comunicación | WebSocket (tiempo real) + REST API (fallback) |
| Autenticación | Bearer token (secreto compartido) |
| Acceso a Servidores | SSH con autenticación por clave |

### Estructura del Proyecto

```
vpsguard/
├── einventiva-dashboard/            # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Overview.tsx             # Dashboard principal con cards + tendencias
│   │   │   ├── ServerDetailPanel.tsx    # Vista detallada con gráficas + logs
│   │   │   ├── ServerCard.tsx           # Card de métricas con gauge de CPU
│   │   │   ├── TrendChart.tsx           # Gráficas históricas con drill-down
│   │   │   ├── DockerPanel.tsx          # Gestión de containers (+ restarts/OOM)
│   │   │   ├── PostgresPanel.tsx        # Monitoreo PostgreSQL
│   │   │   ├── PgTrends.tsx             # Gráficas de tendencia PG por container
│   │   │   ├── AlertsPanel.tsx          # Centro de alertas (activas/historial + ack)
│   │   │   ├── PreventionPanel.tsx      # Análisis IA: resumen, plan de acción, hallazgos
│   │   │   ├── ThresholdsEditor.tsx     # Editor de umbrales por servidor
│   │   │   ├── ScriptsPanel.tsx         # CRUD de scripts + ejecución
│   │   │   ├── CrontabPanel.tsx         # Gestor de crontab (+ last run/overdue)
│   │   │   ├── LogViewer.tsx            # Visor de logs de containers
│   │   │   ├── ServersPanel.tsx         # CRUD de servidores
│   │   │   ├── SetupWizardPanel.tsx     # Provisionamiento automático
│   │   │   ├── ErrorBoundary.tsx        # Wrapper de error boundary
│   │   │   └── ui/                      # 40+ componentes Radix UI
│   │   ├── hooks/
│   │   │   ├── useServerData.ts         # Métricas en tiempo real vía socket
│   │   │   ├── useAlerts.ts             # Estado de alertas desde API + socket
│   │   │   ├── useThresholds.ts         # Umbrales efectivos por servidor
│   │   │   ├── useProjections.ts        # ETA de disco lleno / pendiente memoria
│   │   │   └── useAutoScroll.ts         # Auto-scroll para visores de logs
│   │   ├── lib/
│   │   │   ├── config.ts               # SOCKET_URL, API_BASE, API_TOKEN
│   │   │   ├── api.ts                  # Cliente REST con transformaciones
│   │   │   ├── socket.ts              # Socket singleton compartido (ref-counted)
│   │   │   ├── parsers.ts             # Parsers de datos de métricas
│   │   │   ├── formatters.ts          # Formateadores de display
│   │   │   └── utils.ts               # Utilidades generales (cn classnames)
│   │   └── types.ts                    # Interfaces TypeScript
│   └── package.json
├── einventiva-dashboard-server/     # Backend (Node.js + Express)
│   ├── monitor.js                       # Punto de entrada (~100 líneas)
│   ├── config.js                        # Constantes, env parsing, umbrales
│   ├── db.js                            # Esquema SQLite + datos iniciales
│   ├── middleware/
│   │   └── auth.js                      # Auth HTTP Bearer + Socket.IO
│   ├── routes/
│   │   ├── health.js                    # Health check
│   │   ├── status.js                    # Métricas de servidores
│   │   ├── docker.js                    # Containers + logs + reinicios
│   │   ├── postgres.js                  # Stats PG, vista detallada, histórico
│   │   ├── alerts.js                    # Listado de alertas + acknowledge
│   │   ├── thresholds.js                # CRUD de umbrales por servidor
│   │   ├── projections.js               # ETA de disco lleno / pendiente memoria
│   │   ├── scripts.js                   # CRUD de scripts
│   │   ├── servers.js                   # CRUD de servidores + test SSH
│   │   ├── crontab.js                   # CRUD de crontab + vigilancia de ejecución
│   │   ├── history.js                   # Historial de métricas (rangos) + drill-down
│   │   └── ai.js                        # Análisis IA, config, selección de modelo
│   ├── services/
│   │   ├── ssh.js                       # Ejecución SSH (multiplexing ControlMaster)
│   │   ├── metrics.js                   # Parsing + recolección de métricas
│   │   ├── cache.js                     # Caché en memoria
│   │   ├── alerts.js                    # Evaluación de umbrales excedidos
│   │   ├── alertEngine.js               # Ciclo de vida de alertas con histéresis
│   │   ├── thresholds.js                # Resolución de umbrales en cascada
│   │   ├── projections.js               # Proyecciones por regresión lineal
│   │   ├── cronWatch.js                 # Parsing de ejecuciones CRON en syslog
│   │   ├── sslCheck.js                  # Chequeo de expiración de certificados (certbot)
│   │   ├── pg.js                        # Helpers PG compartidos
│   │   ├── pgHistory.js                 # Muestreador PostgreSQL cada 5 min
│   │   ├── notify.js                    # Entrega de webhook de alertas
│   │   ├── crontab.js                   # Parsing de archivos crontab
│   │   ├── scheduler.js                 # Parser cron para scripts programados + IA
│   │   ├── aiSample.js                  # Snapshot compacto de la flota para IA
│   │   ├── aiProviders.js              # Cliente LLM (OpenAI-compatible + Anthropic)
│   │   ├── aiAnalysis.js                # Orquestación IA: prompt, parseo, persistencia
│   │   ├── backgroundJobs.js            # Loops: métricas, rollups, prune, PG, chequeos, IA
│   │   └── logger.js                    # Utilidad de logging
│   ├── websocket/
│   │   └── handlers.js                  # Streaming de scripts, wizard
│   ├── test/                            # Tests unitarios
│   ├── Dockerfile
│   └── package.json
├── ubersicht-widget/                # Widget de escritorio macOS (opcional)
├── docker-compose.yml
└── .gitignore
```

### Requisitos Previos

- **Node.js** 18+
- **Acceso SSH** a tus servidores (autenticación por clave recomendada)
- **sshpass** (solo necesario para el Setup Wizard) — `brew install hudochenkov/sshpass/sshpass` (macOS) o `apt install sshpass` (Linux)
- Los servidores deben tener **Docker** instalado (para monitoreo de containers)

### Inicio Rápido

#### 1. Clonar el repositorio

```bash
git clone https://github.com/einventiva/vpsguard.git
cd vpsguard
```

#### 2. Configurar el backend

```bash
cd einventiva-dashboard-server
npm install
cp .env.example .env
```

Edita `.env` con tu configuración:

```env
API_TOKEN=tu-token-secreto-aqui
PORT=3847
CORS_ORIGINS=http://localhost:5173,http://localhost:4173

# Retención (días): métricas crudas / detalle por proceso / rollups horarios / muestras PG
PRUNE_KEEP_DAYS=30
DETAIL_KEEP_DAYS=3
ROLLUP_KEEP_DAYS=365
PG_KEEP_DAYS=90

# Alertas: muestras de histéresis, ETA de disco, expiración SSL, saturación de conexiones PG
ALERT_SAMPLES_TO_OPEN=2
ALERT_SAMPLES_TO_RESOLVE=4
DISK_ETA_ALERT_DAYS=14
SSL_ALERT_DAYS=14
PG_CONN_ALERT_PCT=80
PG_REPL_LAG_ALERT_MB=100
# Opcional: POST { event, alert, sentAt } en cada transición de alerta
# ALERT_WEBHOOK_URL=https://example.com/webhook
# Opcional: mapeo explícito contenedor->rol cuando la autodetección no puede adivinar
# PG_USER_OVERRIDES={"pg-replica-foo":"foo_legacy_user"}
```

Inicia el backend:

```bash
npm start
```

La base de datos se crea automáticamente en el primer inicio con 12 scripts de ejemplo.

#### 3. Configurar el frontend

```bash
cd einventiva-dashboard
npm install
cp .env.example .env
```

Edita `.env`:

```env
VITE_API_TOKEN=tu-token-secreto-aqui
# Opcional: URL del backend si no es http://localhost:3847
# VITE_API_URL=https://monitor.example.com
```

Inicia el servidor de desarrollo:

```bash
npm run dev
```

Abre **http://localhost:5173** en tu navegador.

#### 4. Agregar tu primer servidor

**Opción A: Setup Wizard (recomendado para servidores nuevos)**

1. Ve a la pestaña **Servers**
2. Click en **Setup Wizard**
3. Ingresa la IP del servidor, contraseña de root y el usuario deseado
4. El wizard automáticamente:
   - Crea el usuario con acceso sudo + docker
   - Genera un par de claves SSH ed25519 dedicadas
   - Copia la clave pública al servidor
   - Agrega la entrada en `~/.ssh/config`
   - Registra el servidor en el dashboard

**Opción B: Configuración manual (para servidores con SSH ya configurado)**

1. Ve a **Servers** → **New Server**
2. Llena: key, nombre, alias SSH (de tu `~/.ssh/config`), IP, puerto, usuario
3. Click en **Create Server**

#### 5. Despliegue con Docker (opcional)

```bash
docker-compose up -d
```

### Scripts Incluidos

El dashboard viene con 12 scripts pre-cargados:

| Script | Descripción |
|--------|------------|
| Docker Prune | Eliminar imágenes, containers y volúmenes Docker no usados |
| Clean Logs | Limpiar logs viejos y entradas del journal |
| Security Scan | Ejecutar auditoría de seguridad Lynis |
| Disk Usage | Resumen de uso de disco, directorios principales y Docker |
| Restart Nginx | Reiniciar nginx y mostrar estado |
| Certbot Renew | Probar renovación de certificados SSL |
| Fail2ban Status | Verificar estado de fail2ban |
| Docker Stats | Mostrar estadísticas de recursos por container |
| Check Updates | Verificar actualizaciones disponibles |
| Apply Updates | Aplicar todas las actualizaciones pendientes (sudo) |
| Safe Reboot | Checklist pre-reboot + reboot programado en 1 minuto |
| Backup DB | Plantilla para backup de base de datos personalizado |

Puedes crear, editar y eliminar scripts desde la interfaz del dashboard.

### Endpoints API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/status` | Métricas de todos los servidores |
| GET | `/api/health` | Health check |
| GET | `/api/docker/:server` | Containers Docker + stats + reinicios |
| GET | `/api/docker/:server/:container/logs` | Logs de container |
| GET | `/api/postgres/:server` | Containers PostgreSQL + bases |
| GET | `/api/postgres/:server/detailed?container=NAME` | Cache hit, tablas, queries, locks, replicación |
| GET | `/api/postgres/:server/history?container=NAME&range=24h\|7d\|30d` | Serie temporal PG |
| GET | `/api/history/:server?range=1h\|6h\|24h\|7d\|30d\|90d\|1y` | Historial de métricas (payloads acotados) |
| GET | `/api/history/:server/detail?ts=TIMESTAMP&window=SECONDS` | Detalle drill-down (muestra más cercana) |
| GET | `/api/alerts?active=1` | Historial de alertas / alertas activas |
| POST | `/api/alerts/:id/ack` | Reconocer una alerta |
| GET | `/api/thresholds` | Umbrales (builtin, global, por servidor, efectivos) |
| PUT | `/api/thresholds/global` | Definir overrides globales de umbrales |
| PUT | `/api/thresholds/:server` | Definir overrides por servidor |
| GET | `/api/projections` | ETA de disco lleno + pendiente de memoria por servidor |
| GET | `/api/scripts` | Listar scripts |
| POST | `/api/scripts` | Crear script |
| PUT | `/api/scripts/:id` | Actualizar script |
| DELETE | `/api/scripts/:id` | Eliminar script |
| GET | `/api/executions` | Historial de ejecuciones (filtros `server`, `script`) |
| POST | `/api/ai/analyze` | Ejecuta un análisis IA de la flota (rate limited; modelo puntual opcional) |
| GET | `/api/ai/analyses` | Historial de análisis IA |
| GET | `/api/ai/analyses/:id` | Análisis completo incluyendo su snapshot de entrada |
| GET | `/api/ai/config` | Estado del módulo IA (sin secretos) |
| GET | `/api/ai/models` | Modelos que el proveedor/clave configurados permiten |
| POST | `/api/ai/interpret` | Interpreta el output de un script en un veredicto |
| PUT | `/api/ai/model` | Persiste el modelo elegido (vacío = default del env) |
| GET | `/api/executions/latest` | Última ejecución por script para un servidor |
| GET | `/api/executions/:id` | Registro completo con el output almacenado |
| GET | `/api/crontab/:server` | Listar cron jobs |
| POST | `/api/crontab/:server` | Agregar cron job |
| PUT | `/api/crontab/:server/:index` | Editar cron job |
| DELETE | `/api/crontab/:server/:index` | Eliminar cron job |
| PATCH | `/api/crontab/:server/:index/toggle` | Activar/desactivar cron job |
| GET | `/api/servers` | Listar servidores |
| POST | `/api/servers` | Crear servidor |
| PUT | `/api/servers/:key` | Actualizar servidor |
| DELETE | `/api/servers/:key` | Eliminar servidor |
| POST | `/api/servers/:key/test` | Probar conexión SSH |

### Eventos WebSocket

| Evento | Dirección | Descripción |
|--------|-----------|-------------|
| `metrics:update` | Server → Client | Métricas en tiempo real |
| `alert:opened` | Server → Client | Alerta abierta (fila completa) |
| `alert:resolved` | Server → Client | Alerta auto-resuelta |
| `execute:script` | Client → Server | Ejecutar un script |
| `script:output` | Server → Client | Salida en vivo del script |
| `wizard:setup` | Client → Server | Iniciar provisionamiento |
| `wizard:step` | Server → Client | Progreso del wizard |
| `wizard:output` | Server → Client | Salida en vivo del wizard |

### Configuración

Toda la configuración se hace mediante variables de entorno (ver `.env.example` para la lista completa). Los servidores se almacenan en SQLite y se gestionan desde la interfaz. Las variables de servidor en `.env` (`SERVER_*`) solo se usan como seed inicial cuando la base de datos está vacía. Los umbrales de alerta se gestionan desde la pestaña Alerts y se guardan en SQLite.

**La vigilancia de ejecución de crons** lee `/var/log/syslog`, lo que requiere que el usuario SSH esté en el grupo `adm` en cada servidor monitoreado: `sudo usermod -aG adm TU_USUARIO`. Sin esto, las entradas de cron se muestran sin última corrida (no se generan falsas alarmas).

**La vigilancia de certificados SSL** ejecuta `sudo -n certbot certificates`, lo que requiere sudo sin contraseña para el usuario SSH. Sin esto, no se reportan certificados y no se generan alertas.

### Licencia

MIT

---

**Built by [Einventiva](https://einventiva.com)**
