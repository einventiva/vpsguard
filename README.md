# VPSGuard

**Real-time multi-server monitoring and management dashboard.**

Monitor your VPS fleet from a single dashboard: live CPU, memory, disk metrics, Docker containers, crontab management, script execution, and automated server provisioning — all streamed in real-time via WebSocket.

---

[English](#english) | [Español](#español)

---

## English

### Features

- **Real-time Monitoring** — CPU, memory, disk, uptime, and load average for all servers via WebSocket with HTTP polling fallback
- **Docker Management** — List containers with live CPU/RAM/Disk I/O stats, status badges, and log viewer
- **Script Execution** — Create, edit, and run shell scripts remotely with live terminal output streaming
- **Crontab Manager** — View, create, toggle, and delete cron jobs with preset schedules and human-readable descriptions
- **Log Viewer** — Browse container logs per server with auto-scroll and copy support
- **Server Management** — Full CRUD for servers with SSH connectivity testing
- **Setup Wizard** — Provision a virgin server from scratch: creates user, configures sudo, generates SSH keys, copies public key, updates `~/.ssh/config`, and registers it in the dashboard — all streamed step-by-step
- **Trend Charts** — Historical charts with click-drag range analysis (min/avg/max), brush navigator for time panning, and per-process/per-container resource breakdown at peak CPU timestamps
- **Container Logs** — Double-click any container in the detail view to see its logs inline with color-coded output (error/warn/info)
- **Alert System** — Toast notifications when thresholds are exceeded (CPU >80%, Memory >85%, Disk >90%, server offline)
- **macOS Widget** — (Experimental) Übersicht desktop widget for at-a-glance monitoring

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
│   │   │   ├── DockerPanel.tsx          # Docker container management
│   │   │   ├── ScriptsPanel.tsx         # Script CRUD + execution
│   │   │   ├── CrontabPanel.tsx         # Crontab manager
│   │   │   ├── LogViewer.tsx            # Container log viewer
│   │   │   ├── ServersPanel.tsx         # Server CRUD
│   │   │   ├── SetupWizardPanel.tsx     # Automated server provisioning
│   │   │   ├── ErrorBoundary.tsx        # Error boundary wrapper
│   │   │   └── ui/                      # 40+ Radix UI components
│   │   ├── hooks/
│   │   │   ├── useServerData.ts         # Real-time metrics via shared socket
│   │   │   ├── useAlerts.ts             # Threshold alert listener
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
│   │   ├── docker.js                    # Containers + logs
│   │   ├── scripts.js                   # Script CRUD
│   │   ├── servers.js                   # Server CRUD + SSH test
│   │   ├── crontab.js                   # Crontab CRUD + toggle
│   │   └── history.js                   # Metrics history + drill-down
│   ├── services/
│   │   ├── ssh.js                       # SSH command execution
│   │   ├── metrics.js                   # Metrics parsing + collection
│   │   ├── cache.js                     # In-memory response cache
│   │   ├── alerts.js                    # Threshold alert logic
│   │   ├── crontab.js                   # Crontab file parsing
│   │   ├── backgroundJobs.js            # Periodic collection + pruning
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
| GET | `/api/docker/:server` | Docker containers + stats |
| GET | `/api/docker/:server/:container/logs` | Container logs |
| GET | `/api/history/:server` | Metrics history |
| GET | `/api/history/:server/detail?ts=TIMESTAMP` | Drill-down detail |
| GET | `/api/scripts` | List scripts |
| POST | `/api/scripts` | Create script |
| PUT | `/api/scripts/:id` | Update script |
| DELETE | `/api/scripts/:id` | Delete script |
| GET | `/api/executions` | Script execution history |
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
| `alerts` | Server → Client | Threshold alerts |
| `execute:script` | Client → Server | Run a script |
| `script:output` | Server → Client | Live script output |
| `wizard:setup` | Client → Server | Start server provisioning |
| `wizard:step` | Server → Client | Wizard step progress |
| `wizard:output` | Server → Client | Wizard live output |

### Configuration

All configuration is done via environment variables. Servers are stored in SQLite and managed from the UI. The `.env` server variables (`SERVER_*`) are only used as initial seed when the database is empty.

### License

MIT

---

## Español

### Características

- **Monitoreo en tiempo real** — CPU, memoria, disco, uptime y load average de todos los servidores vía WebSocket con fallback HTTP polling
- **Gestión Docker** — Lista de containers con estadísticas en vivo de CPU/RAM/Disco, badges de estado y visor de logs
- **Ejecución de Scripts** — Crea, edita y ejecuta scripts de shell remotamente con salida en terminal en tiempo real
- **Gestor de Crontab** — Ver, crear, activar/desactivar y eliminar cron jobs con presets y descripciones legibles
- **Visor de Logs** — Navega logs de containers por servidor con auto-scroll y copia
- **Gestión de Servidores** — CRUD completo con prueba de conectividad SSH
- **Setup Wizard** — Provisiona un servidor virgen desde cero: crea usuario, configura sudo, genera claves SSH, copia la clave pública, actualiza `~/.ssh/config` y registra el servidor — todo streameado paso a paso
- **Gráficas de Tendencia** — Gráficas históricas con análisis de rango por click-drag (min/avg/max), brush navigator para navegar en el tiempo, y desglose por proceso/container en el pico de CPU
- **Logs de Containers** — Doble-click en cualquier container en la vista de detalle para ver sus logs inline con colores por nivel (error/warn/info)
- **Sistema de Alertas** — Notificaciones toast cuando se exceden umbrales (CPU >80%, Memoria >85%, Disco >90%, servidor offline)
- **Widget macOS** — (Experimental) Widget para Übersicht para monitoreo de un vistazo

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
│   │   │   ├── DockerPanel.tsx          # Gestión de containers Docker
│   │   │   ├── ScriptsPanel.tsx         # CRUD de scripts + ejecución
│   │   │   ├── CrontabPanel.tsx         # Gestor de crontab
│   │   │   ├── LogViewer.tsx            # Visor de logs de containers
│   │   │   ├── ServersPanel.tsx         # CRUD de servidores
│   │   │   ├── SetupWizardPanel.tsx     # Provisionamiento automático
│   │   │   ├── ErrorBoundary.tsx        # Wrapper de error boundary
│   │   │   └── ui/                      # 40+ componentes Radix UI
│   │   ├── hooks/
│   │   │   ├── useServerData.ts         # Métricas en tiempo real vía socket
│   │   │   ├── useAlerts.ts             # Listener de alertas de umbrales
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
│   │   ├── docker.js                    # Containers + logs
│   │   ├── scripts.js                   # CRUD de scripts
│   │   ├── servers.js                   # CRUD de servidores + test SSH
│   │   ├── crontab.js                   # CRUD de crontab + toggle
│   │   └── history.js                   # Historial de métricas + drill-down
│   ├── services/
│   │   ├── ssh.js                       # Ejecución de comandos SSH
│   │   ├── metrics.js                   # Parsing + recolección de métricas
│   │   ├── cache.js                     # Caché en memoria
│   │   ├── alerts.js                    # Lógica de alertas por umbral
│   │   ├── crontab.js                   # Parsing de archivos crontab
│   │   ├── backgroundJobs.js            # Recolección periódica + limpieza
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
| GET | `/api/docker/:server` | Containers Docker + stats |
| GET | `/api/docker/:server/:container/logs` | Logs de container |
| GET | `/api/history/:server` | Historial de métricas |
| GET | `/api/history/:server/detail?ts=TIMESTAMP` | Detalle drill-down |
| GET | `/api/scripts` | Listar scripts |
| POST | `/api/scripts` | Crear script |
| PUT | `/api/scripts/:id` | Actualizar script |
| DELETE | `/api/scripts/:id` | Eliminar script |
| GET | `/api/executions` | Historial de ejecuciones |
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
| `alerts` | Server → Client | Alertas de umbrales |
| `execute:script` | Client → Server | Ejecutar un script |
| `script:output` | Server → Client | Salida en vivo del script |
| `wizard:setup` | Client → Server | Iniciar provisionamiento |
| `wizard:step` | Server → Client | Progreso del wizard |
| `wizard:output` | Server → Client | Salida en vivo del wizard |

### Configuración

Toda la configuración se hace mediante variables de entorno. Los servidores se almacenan en SQLite y se gestionan desde la interfaz. Las variables de servidor en `.env` (`SERVER_*`) solo se usan como seed inicial cuando la base de datos está vacía.

### Licencia

MIT

---

**Built by [Einventiva](https://einventiva.com)**
