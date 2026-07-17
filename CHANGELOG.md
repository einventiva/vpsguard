# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

[English](#english) | [Español](#español)

---

## English

### [1.10.1] — 2026-07-17

#### Fixed
- **AI interpretation contradicting the action plan**: a plan step said "run docker-stats to investigate the memory trend" but the interpretation, blind to that reason, replied "todo ok" — a contradiction. The alert→script and plan→script bridges now carry the originating concern as `context`, and the interpretation prompt reconciles with it: it states whether the output confirms, rules out, or is inconclusive about that concern, and flags the tool-vs-question mismatch (a point-in-time snapshot can't confirm a trend → severity `info`, points to the trend charts) instead of a naked "ok"

### [1.10.0] — 2026-07-17

#### Added
- **AI interpretation of script output (A4)**: an "Interpretar con IA" button on any script result (live output and expanded history) sends the output to the AI module and renders an actionable verdict inline — summary, severity, key points, and a recommended action — closing the loop when the AI suggests running a diagnostic script (`POST /ai/interpret`, by execution id or inline output; output is masked and truncated before leaving the box). The AI interprets and recommends; the human decides

### [1.9.0] — 2026-07-17

#### Added
- **AI module A3 — proactive prevention**: the analysis now returns a consolidated **action plan** (steps grouped by horizon — 🔥 now / 📅 this week / 👁 watch — with dependencies between steps and a script button per step, reusing the alert→script bridge), reports **evolution** vs the previous analysis (each finding tagged worse/improved/new/persisting, fed the prior summary + finding titles as memory), and understands **maintenance context** (recent safe-reboot runs and freshly-booted servers are treated as planned maintenance, not incidents). A **model selector** in the Prevención tab lists the models the provider/virtual-key allows (`GET /ai/models`) and persists the choice server-side (`settings` table) — no `.env` edit needed; the env value stays as the default fallback

### [1.8.0] — 2026-07-17

#### Added
- **Scheduled AI analyses (A2)**: `AI_ANALYSIS_SCHEDULE` (5-field cron, e.g. `0 9,12,15,18 * * *`) runs the fleet analysis automatically on a minute-aligned loop; results land via socket in the Prevención tab (with a toast) plus a desktop notification summarizing the findings
- **Optional `ai` alerts**: with `AI_OPEN_ALERTS=true`, warning/critical AI findings open per-server alerts of type `ai` through the standard pipeline (socket, native notification, webhook), auto-resolving when a later analysis comes back clean for that server; info findings never open alerts
- Prevención tab shows the active schedule and the open-alerts flag; manual runs share the same notification pipeline

### [1.7.0] — 2026-07-17

#### Added
- **AI Analysis & Prevention module (A1)**: a new "Prevención" tab runs LLM-powered fleet analysis on demand. A compact pre-aggregated snapshot (status, active/recent alerts, 24h/7d trends from rollups, projections, PostgreSQL summary, failing scheduled scripts — never raw script outputs) is sent to a configurable provider: any **OpenAI-compatible** endpoint (LiteLLM, OpenAI, xAI/Grok, local Ollama) or the **native Anthropic API**. The model returns an executive summary and prioritized findings with concrete actions and suggested scripts (wired to the v1.6 alert→script bridge). Every analysis is persisted (`ai_analyses`) with token usage and duration; robust JSON parsing tolerates fences and prose; secrets stay in `.env` and never touch the UI. The AI recommends — it never executes anything

### [1.6.0] — 2026-07-17

#### Added
- **ANSI colors in script output**: tools like lynis, apt and docker emit terminal color codes that rendered as `[1;32m` garbage — the live output and the stored execution history now parse SGR sequences into real colors (foreground, background, bold, dim), with style state carried across streamed chunks; other control sequences are stripped
- **Alert → script bridge**: scripts can be tagged with the alert types they help diagnose or remediate (`alert_types`, editable as chips in the editor; seeds pre-tagged — disk-usage/clean-logs/docker-prune for disk & disk-eta, docker-stats for cpu/memory/flapping, certbot-renew for ssl). Every **active** alert now shows shortcut buttons to its matching scripts (red if destructive); clicking one jumps to the Scripts tab with the script **and the alert's server** preselected. Detect → diagnose → remediate without leaving the dashboard — all v1.4 guards (sudo password, typed destructive confirmation) still apply

### [1.5.1] — 2026-07-17

#### Security
- **Sudo password leaked into script output**: the password injection blindly rewrote every occurrence of the word `sudo` — including inside quoted strings like safe-reboot's final `echo "... Run: sudo shutdown -c ..."` — so the password was printed verbatim in the live output and, since v1.4, persisted in the execution history. Injection now only wraps `sudo` at command positions (start, `;`, `&`, `|`, `(`), and as defense in depth the password is masked (`••••`) in every output stream, stored execution, API response and server log. If you ran a sudo script whose command mentions "sudo" inside a string, purge old outputs: `UPDATE script_executions SET output='(redacted)' WHERE output LIKE '%| sudo -S%';`

### [1.5.0] — 2026-07-17

#### Added
- **Scheduled scripts**: any script can carry a 5-field cron `schedule` and a target-server list; a minute-aligned loop runs due scripts over SSH in parallel and persists them in the same execution history (tagged `auto`). Diagnostics stop depending on someone remembering to click them
- **`script` alert**: when a scheduled script's latest run fails on a server, an alert opens through the standard pipeline (socket, native notification, webhook) and auto-resolves on the next passing run — or within a minute of unscheduling it
- Editor gains schedule presets (hourly/6h/daily/weekly) and per-server targeting; cards show a schedule badge; cron expressions are validated on save (400 on malformed input)
- Note: scheduled runs execute without password injection — `sudo` scripts need passwordless sudo on the target servers (the editor warns about this)

### [1.4.1] — 2026-07-17

#### Fixed
- **Scripts timing out at 60 s with exit 255**: `SCRIPT_TIMEOUT` was hardcoded to 60 s, killing any longer run (system updates, security audits, prunes) while the remote command silently kept running. Default raised to 10 min and made configurable via `SCRIPT_TIMEOUT_MS`; when a timeout does hit, the output now ends with an explicit notice instead of a bare exit 255
- Docs and test fixtures now use generic example names throughout

### [1.4.0] — 2026-07-17

#### Added
- **Persistent script execution history**: every run (REST or streamed) now stores its output (last 50 KB) in `script_executions`; the Scripts tab shows a history that survives reloads, with expandable output, duration, and exit code per row (`GET /executions`, `/executions/:id`, `/executions/latest`)
- **Last-run badges on script cards**: each card shows ✓/✗, how long ago, and duration of its latest execution on the selected server — the grid doubles as a status board (e.g. spot that a check hasn't run in weeks)
- **Destructive script guard**: scripts can be flagged `destructive` (seeded for `docker-prune`, `apply-updates`, `safe-reboot`); they get a red border/badge and executing them requires typing the script id
- **Run on all servers**: execute a script on the whole fleet at once with side-by-side live output panes and per-server exit status
- **stderr coloring**: stderr streams render in amber in the live output, distinct from stdout

#### Fixed
- **Delete without confirmation**: removing a script now requires a two-step confirmation (arms for 4 s), both on the grid and in the editor
- `api.getScriptHistory` was a stub returning `[]` (tech debt from #26) — now wired to the real `/executions` endpoint

### [1.3.0] — 2026-07-17

#### Added
- **Container flapping alert**: the hourly check snapshots per-container restart counts and opens a `flapping` alert when they grow between passes (critical if OOM-killed), auto-resolving when restarts stop; first pass after a dashboard restart is a baseline — no false alarms
- **PostgreSQL replication lag alert**: `pg-replication` opens when a standby's lag exceeds `PG_REPL_LAG_ALERT_MB` (100 MB; critical at 4×), fed by the existing 5-min sampler

#### Changed
- Per-process/container detail is now stored every ~60s instead of every 15s (4× less `metrics_detail` growth); the drill-down transparently finds the nearest stored sample via the existing window search

#### Fixed
- ServerCard no longer crashes when rendering a server status shape from an older bundle (defensive defaults for the newer signal fields)

### [1.2.1] — 2026-07-16

#### Fixed
- **PostgreSQL replicas without `POSTGRES_USER`** failed with `FATAL: role "postgres" does not exist`: containers created from basebackups keep the primary's superuser (e.g. `app_admin`), so the role is now resolved by probing candidates in a single SSH call — `PG_USER_OVERRIDES` mapping → `POSTGRES_USER` → `postgres` → container-name-derived bases with `_admin`/`_user` suffix variants — and cached per container for 1 hour
- PostgreSQL panel errors now show only the meaningful `psql:`/`FATAL` line instead of the full SSH command dump
- The PostgreSQL sampler guards `pg_current_wal_lsn()` with `pg_is_in_recovery()`, so a streaming standby can no longer break the whole sample

#### Added
- `PG_USER_OVERRIDES` env var (JSON container → role) for roles auto-detection can't guess

### [1.2.0] — 2026-07-16

#### Added
- **System signals** in the 15s metrics cycle: swap usage (parsed from the existing `free -m` at zero extra cost), inode usage (`df -i /`), pending-reboot flag, and failed systemd units — surfaced as attention chips on each server card
- **New hysteresis-managed alert types**: `inodes` (critical over 90% — a disk can fill on inodes with free space left) and `systemd` (failed units, with unit names in the message)
- **SSH latency** per server, measured as the metrics round-trip (no extra command), shown next to Load Avg and colored on deviation from baseline
- **SSL certificate watch**: hourly `sudo -n certbot certificates` check with an `ssl` alert when any certificate expires within `SSL_ALERT_DAYS` (14; critical ≤ 7 days), auto-resolving after renewal; silent without passwordless sudo (no false alarms)

### [1.1.0] — 2026-07-16

#### Added
- **Persistent alert system**: alerts stored in SQLite with full lifecycle (open → acknowledge → auto-resolve), hysteresis (opens after 2 consecutive breaching samples, resolves after 4 clean ones), recovery notifications, Alerts tab with unacknowledged badge, and optional webhook (`ALERT_WEBHOOK_URL`) on every transition
- **Per-server alert thresholds** with cascading resolution (server → global → built-in defaults), editable from the UI, hot-applied without restart
- **Long-range trends**: hourly rollups kept for a year (`metrics_rollup`), range selector 1h → 90d, bounded chart payloads (`?range=` on history endpoints)
- **Predictive monitoring**: disk-full ETA per server ("≈ Nd until full" with `disk-eta` alert under 14 days) and sustained memory-climb detection via linear regression
- **Cron execution watch**: real executions parsed from syslog, per-job last run + OVERDUE badge, hourly `cron` alert for silent jobs
- **PostgreSQL history**: 5-min sampler (one JSON query per container), per-container trend charts (connections vs `max_connections`, size growth), `pg-connections` saturation alert
- **Container health**: restart counts and OOM-kill flags in the Docker panel
- Auto-refresh for Docker (30s) and PostgreSQL (60s) panels; disk included in global health; configurable backend URL (`VITE_API_URL`)

#### Fixed
- Database bloat: incremental auto_vacuum + separate short retention for per-process detail (real DB shrank from 2.3 GB to ~2 MB)
- Shared-socket listener leak on hook cleanup; silent history-fetch failures now surface in the UI
- Real exit codes recorded for failed script executions; SSH multiplexing in WebSocket script/crontab streams; periodic in-memory cache sweep
- Cron log files greped oldest-first so `tail` keeps the newest executions

#### Security
- Übersicht widget reads the API token from `~/.config/vpsguard/token` instead of hardcoding it in versioned source

### [1.0.0] — 2026-03-06

#### Added
- Real-time multi-server monitoring (CPU, memory, disk, uptime, load average) via WebSocket
- Docker container management with live CPU/RAM/Disk stats
- Container log viewer — double-click any container in detail view for inline logs with color-coded output (error/warn/info)
- Script CRUD and remote execution with live terminal streaming
- Crontab manager with presets, human-readable descriptions, and enable/disable toggle
- Server CRUD with SSH connectivity testing
- Setup Wizard for automated server provisioning (user creation, SSH keys, config)
- Trend charts with click-drag range analysis (min/avg/max), brush navigator, and peak CPU breakdown
- Alert system with configurable thresholds (CPU >80%, Memory >85%, Disk >90%)
- Bearer token authentication (HTTP + WebSocket)
- Modular backend architecture: routes, services, middleware, websocket handlers
- Modular frontend: shared socket singleton, parsers, formatters, custom hooks
- Error boundary for graceful error recovery
- SQLite database with 12 pre-loaded scripts
- Docker deployment support
- macOS Ubersicht widget (experimental)

---

## Español

### [1.10.1] — 2026-07-17

#### Corregido
- **La interpretación IA contradecía el plan de acción**: un paso del plan decía "corre docker-stats para investigar la tendencia de memoria" pero la interpretación, ciega a ese motivo, respondía "todo ok" — una contradicción. Los puentes alerta→script y plan→script ahora llevan el motivo original como `context`, y el prompt de interpretación reconcilia con él: indica si el output confirma, descarta o es inconcluso respecto a ese motivo, y señala el desajuste herramienta-vs-pregunta (una foto puntual no puede confirmar una tendencia → severidad `info`, apunta a las gráficas de tendencia) en vez de un "ok" pelado

### [1.10.0] — 2026-07-17

#### Agregado
- **Interpretación IA del output de scripts (A4)**: un botón "Interpretar con IA" en cualquier resultado de script (output en vivo e historial expandido) manda el output al módulo de IA y renderiza un veredicto accionable inline — resumen, severidad, puntos clave y acción recomendada — cerrando el ciclo cuando la IA sugiere correr un script de diagnóstico (`POST /ai/interpret`, por id de ejecución u output inline; el output se enmascara y trunca antes de salir del servidor). La IA interpreta y recomienda; el humano decide

### [1.9.0] — 2026-07-17

#### Agregado
- **Módulo IA A3 — prevención proactiva**: el análisis ahora devuelve un **plan de acción** consolidado (pasos agrupados por horizonte — 🔥 ahora / 📅 esta semana / 👁 monitorear — con dependencias entre pasos y un botón de script por paso, reusando el puente alertas→scripts), reporta **evolución** vs el análisis anterior (cada hallazgo etiquetado empeoró/mejoró/nuevo/persiste, alimentado con el resumen + títulos previos como memoria), y entiende **contexto de mantenimiento** (los reboots recientes de safe-reboot y servidores recién arrancados se tratan como mantenimiento planeado, no incidentes). Un **selector de modelo** en la pestaña Prevención lista los modelos que el proveedor/virtual-key permite (`GET /ai/models`) y persiste la elección en el backend (tabla `settings`) — sin editar el `.env`; el valor del env queda como default

### [1.8.0] — 2026-07-17

#### Agregado
- **Análisis IA programados (A2)**: `AI_ANALYSIS_SCHEDULE` (cron de 5 campos, p.ej. `0 9,12,15,18 * * *`) ejecuta el análisis de la flota automáticamente en un loop alineado al minuto; los resultados llegan por socket a la pestaña Prevención (con toast) más una notificación de escritorio resumiendo los hallazgos
- **Alertas `ai` opcionales**: con `AI_OPEN_ALERTS=true`, los hallazgos warning/critical abren alertas tipo `ai` por servidor vía la tubería estándar (socket, notificación nativa, webhook), con auto-resolución cuando un análisis posterior sale limpio para ese servidor; los hallazgos info nunca abren alertas
- La pestaña Prevención muestra el schedule activo y el flag de alertas; las corridas manuales comparten la misma tubería de notificación

### [1.7.0] — 2026-07-17

#### Agregado
- **Módulo de Análisis y Prevención con IA (A1)**: la nueva pestaña "Prevención" ejecuta análisis de la flota con LLM bajo demanda. Se envía un snapshot compacto pre-agregado (estado, alertas activas/recientes, tendencias 24h/7d desde rollups, proyecciones, resumen PostgreSQL, scripts programados fallando — nunca outputs crudos de scripts) a un proveedor configurable: cualquier endpoint **OpenAI-compatible** (LiteLLM, OpenAI, xAI/Grok, Ollama local) o la **API nativa de Anthropic**. El modelo devuelve un resumen ejecutivo y hallazgos priorizados con acciones concretas y scripts sugeridos (conectados al puente alertas→scripts de v1.6). Cada análisis se persiste (`ai_analyses`) con tokens y duración; el parseo JSON tolera fences y prosa; los secretos viven en `.env` y nunca pasan por la UI. La IA recomienda — nunca ejecuta nada

### [1.6.0] — 2026-07-17

#### Agregado
- **Colores ANSI en el output de scripts**: herramientas como lynis, apt y docker emiten códigos de color de terminal que se veían como basura `[1;32m` — el output en vivo y el historial almacenado ahora parsean las secuencias SGR a colores reales (texto, fondo, bold, dim), con el estado de estilo cruzando chunks del stream; otras secuencias de control se eliminan
- **Puente alertas → scripts**: los scripts pueden etiquetarse con los tipos de alerta que ayudan a diagnosticar o remediar (`alert_types`, editable como chips en el editor; seeds pre-etiquetados — disk-usage/clean-logs/docker-prune para disk y disk-eta, docker-stats para cpu/memory/flapping, certbot-renew para ssl). Cada alerta **activa** muestra ahora botones de acceso directo a sus scripts correspondientes (rojos si son destructivos); el clic salta a la pestaña Scripts con el script **y el servidor de la alerta** preseleccionados. Detectar → diagnosticar → remediar sin salir del dashboard — todas las guardas de v1.4 (password de sudo, confirmación destructiva tipeada) siguen aplicando

### [1.5.1] — 2026-07-17

#### Seguridad
- **El password de sudo se filtraba al output de scripts**: la inyección reescribía a ciegas cada ocurrencia de la palabra `sudo` — incluidas las de strings entrecomillados como el `echo "... Run: sudo shutdown -c ..."` final de safe-reboot — así que el password se imprimía literal en el output en vivo y, desde v1.4, quedaba persistido en el historial. La inyección ahora solo envuelve `sudo` en posición de comando (inicio, `;`, `&`, `|`, `(`), y como defensa en profundidad el password se enmascara (`••••`) en todo stream de output, ejecución almacenada, respuesta de API y log del servidor. Si ejecutaste un script sudo cuyo comando menciona "sudo" dentro de un string, purga los outputs viejos: `UPDATE script_executions SET output='(redacted)' WHERE output LIKE '%| sudo -S%';`

### [1.5.0] — 2026-07-17

#### Agregado
- **Scripts programados**: cualquier script puede llevar un `schedule` cron de 5 campos y una lista de servidores destino; un loop alineado al minuto ejecuta los scripts due por SSH en paralelo y los persiste en el mismo historial (etiquetados `auto`). Los diagnósticos dejan de depender de que alguien se acuerde de ejecutarlos
- **Alerta `script`**: cuando la última corrida programada de un script falla en un servidor, se abre una alerta por la tubería estándar (socket, notificación nativa, webhook) y se resuelve sola con la siguiente corrida exitosa — o al minuto de quitarle el schedule
- El editor gana presets de schedule (hourly/6h/daily/weekly) y selección de servidores destino; las cards muestran badge de schedule; las expresiones cron se validan al guardar (400 si son inválidas)
- Nota: las corridas programadas ejecutan sin inyección de contraseña — los scripts con `sudo` requieren sudo sin contraseña en los servidores destino (el editor lo advierte)

### [1.4.1] — 2026-07-17

#### Corregido
- **Scripts cortados a los 60 s con exit 255**: `SCRIPT_TIMEOUT` estaba hardcodeado en 60 s y mataba cualquier ejecución más larga (updates del sistema, auditorías de seguridad, prunes) mientras el comando remoto seguía corriendo en silencio. Default subido a 10 min y configurable vía `SCRIPT_TIMEOUT_MS`; cuando el timeout sí ocurre, el output termina con un aviso explícito en vez de un exit 255 pelado
- La documentación y los fixtures de tests ahora usan nombres de ejemplo genéricos

### [1.4.0] — 2026-07-17

#### Agregado
- **Historial persistente de ejecuciones de scripts**: cada ejecución (REST o streaming) guarda su output (últimos 50 KB) en `script_executions`; la pestaña Scripts muestra un historial que sobrevive recargas, con output expandible, duración y exit code por fila (`GET /executions`, `/executions/:id`, `/executions/latest`)
- **Badges de última ejecución en las cards**: cada card muestra ✓/✗, hace cuánto y duración de su última ejecución en el servidor seleccionado — el grid funciona como tablero de estado (p. ej. detectar que un chequeo no se corre hace semanas)
- **Guarda de scripts destructivos**: los scripts pueden marcarse `destructive` (seed para `docker-prune`, `apply-updates`, `safe-reboot`); llevan borde/badge rojo y ejecutarlos exige tipear el id del script
- **Run on all servers**: ejecuta un script en toda la flota a la vez con paneles de output en vivo lado a lado y exit status por servidor
- **Color para stderr**: los streams de stderr se pintan en ámbar en el output en vivo, distintos de stdout

#### Corregido
- **Borrado sin confirmación**: eliminar un script ahora requiere confirmación en dos pasos (armada por 4 s), tanto en el grid como en el editor
- `api.getScriptHistory` era un stub que retornaba `[]` (deuda de #26) — ahora conectado al endpoint real `/executions`

### [1.3.0] — 2026-07-17

#### Agregado
- **Alerta por flapping de containers**: el chequeo horario toma un snapshot de los conteos de reinicio por container y abre una alerta `flapping` cuando crecen entre pasadas (critical si hubo OOM-kill), con resolución automática cuando los reinicios paran; la primera pasada tras un reinicio del dashboard es baseline — sin falsas alarmas
- **Alerta por lag de replicación PostgreSQL**: `pg-replication` abre cuando el lag de un standby supera `PG_REPL_LAG_ALERT_MB` (100 MB; critical a 4×), alimentada por el muestreador existente de 5 min

#### Cambiado
- El detalle por proceso/container ahora se guarda cada ~60s en vez de cada 15s (4× menos crecimiento de `metrics_detail`); el drill-down encuentra la muestra más cercana de forma transparente vía la búsqueda por ventana existente

#### Corregido
- ServerCard ya no falla al renderizar un estado de servidor con la forma de un bundle anterior (defaults defensivos para los campos de señales nuevos)

### [1.2.1] — 2026-07-16

#### Corregido
- **Réplicas de PostgreSQL sin `POSTGRES_USER`** fallaban con `FATAL: role "postgres" does not exist`: los contenedores creados desde basebackups conservan el superusuario del primario (p.ej. `app_admin`), así que el rol ahora se resuelve probando candidatos en una sola llamada SSH — mapeo `PG_USER_OVERRIDES` → `POSTGRES_USER` → `postgres` → derivados del nombre del contenedor con variantes `_admin`/`_user` — y se cachea por contenedor durante 1 hora
- Los errores del panel PostgreSQL ahora muestran solo la línea relevante `psql:`/`FATAL` en vez del volcado completo del comando SSH
- El muestreador de PostgreSQL protege `pg_current_wal_lsn()` con `pg_is_in_recovery()`, de modo que un standby en streaming ya no rompe la muestra completa

#### Agregado
- Variable `PG_USER_OVERRIDES` (JSON contenedor → rol) para roles que la autodetección no puede adivinar

### [1.2.0] — 2026-07-16

#### Agregado
- **Señales de sistema** en el ciclo de métricas de 15s: uso de swap (parseado del `free -m` existente con costo cero), uso de inodos (`df -i /`), flag de reinicio pendiente y unidades systemd fallidas — mostrados como chips de atención en cada tarjeta de servidor
- **Nuevos tipos de alerta con histéresis**: `inodes` (critical sobre 90% — un disco puede llenarse de inodos con espacio libre) y `systemd` (unidades fallidas, con los nombres en el mensaje)
- **Latencia SSH** por servidor, medida como el round-trip de la recolección de métricas (sin comando extra), mostrada junto al Load Avg y coloreada por desviación del baseline
- **Vigilancia de certificados SSL**: chequeo horario con `sudo -n certbot certificates` y alerta `ssl` cuando algún certificado expira dentro de `SSL_ALERT_DAYS` (14; critical ≤ 7 días), con resolución automática tras renovar; silencioso sin sudo sin contraseña (sin falsas alarmas)

### [1.1.0] — 2026-07-16

#### Agregado
- **Sistema de alertas persistente**: alertas en SQLite con ciclo de vida completo (abre → reconoce → auto-resuelve), histéresis (abre tras 2 muestras consecutivas sobre umbral, resuelve tras 4 limpias), notificaciones de recuperación, pestaña Alerts con badge de no-reconocidas, y webhook opcional (`ALERT_WEBHOOK_URL`) en cada transición
- **Umbrales de alerta por servidor** con resolución en cascada (servidor → global → defaults), editables desde la UI, aplicados en caliente sin reiniciar
- **Tendencias largas**: rollups horarios conservados un año (`metrics_rollup`), selector de rango 1h → 90d, payloads de gráfica acotados (`?range=` en los endpoints de historial)
- **Monitoreo predictivo**: ETA de disco lleno por servidor ("≈ Nd until full" con alerta `disk-eta` bajo 14 días) y detección de subida sostenida de memoria vía regresión lineal
- **Vigilancia de ejecución de crons**: ejecuciones reales parseadas de syslog, última corrida + badge OVERDUE por job, alerta horaria `cron` para jobs silenciosos
- **Histórico de PostgreSQL**: muestreador cada 5 min (una query JSON por container), gráficas de tendencia por container (conexiones vs `max_connections`, crecimiento de tamaño), alerta `pg-connections` por saturación
- **Salud de containers**: conteo de reinicios y flags de OOM-kill en el panel Docker
- Auto-refresh en paneles Docker (30s) y PostgreSQL (60s); disco incluido en la salud global; URL del backend configurable (`VITE_API_URL`)

#### Corregido
- Crecimiento sin control de la base de datos: auto_vacuum incremental + retención corta separada para el detalle por proceso (la BD real pasó de 2.3 GB a ~2 MB)
- Fuga de listeners del socket compartido en el cleanup de hooks; los fallos silenciosos al cargar historial ahora se muestran en la UI
- Exit codes reales registrados en ejecuciones fallidas de scripts; multiplexing SSH en los streams de scripts/crontab por WebSocket; barrido periódico del caché en memoria
- Archivos de log de cron grepeados del más viejo al más nuevo para que `tail` conserve las ejecuciones recientes

#### Seguridad
- El widget de Übersicht lee el token de API desde `~/.config/vpsguard/token` en vez de tenerlo hardcodeado en el código versionado

### [1.0.0] — 2026-03-06

#### Agregado
- Monitoreo multi-servidor en tiempo real (CPU, memoria, disco, uptime, load average) via WebSocket
- Gestion de containers Docker con estadisticas en vivo de CPU/RAM/Disco
- Visor de logs de containers — doble-click en cualquier container en la vista de detalle para ver logs inline con colores por nivel (error/warn/info)
- CRUD de scripts y ejecucion remota con streaming de terminal en vivo
- Gestor de crontab con presets, descripciones legibles y toggle de activar/desactivar
- CRUD de servidores con prueba de conectividad SSH
- Setup Wizard para provisionamiento automatico de servidores (creacion de usuario, claves SSH, config)
- Graficas de tendencia con analisis de rango por click-drag (min/avg/max), brush navigator y breakdown en pico de CPU
- Sistema de alertas con umbrales configurables (CPU >80%, Memoria >85%, Disco >90%)
- Autenticacion por Bearer token (HTTP + WebSocket)
- Arquitectura modular del backend: routes, services, middleware, websocket handlers
- Frontend modular: socket singleton compartido, parsers, formateadores, hooks personalizados
- Error boundary para recuperacion elegante de errores
- Base de datos SQLite con 12 scripts pre-cargados
- Soporte para despliegue con Docker
- Widget macOS Ubersicht (experimental)

---

**Built by [Einventiva](https://einventiva.com)**
