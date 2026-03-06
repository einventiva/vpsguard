# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

[English](#english) | [Español](#español)

---

## English

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
