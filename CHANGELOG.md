# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

[English](#english) | [Español](#español)

---

## English

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
