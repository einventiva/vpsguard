# Contributing to VPSGuard

Thank you for your interest in contributing to VPSGuard! This guide will help you get started.

[English](#english) | [Español](#español)

---

## English

### Getting Started

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/your-username/vpsguard.git
   cd vpsguard
   ```
3. **Install dependencies** for both frontend and backend:
   ```bash
   cd einventiva-dashboard-server && npm install && cd ..
   cd einventiva-dashboard && npm install && cd ..
   ```
4. **Copy environment files**:
   ```bash
   cp einventiva-dashboard-server/.env.example einventiva-dashboard-server/.env
   cp einventiva-dashboard/.env.example einventiva-dashboard/.env
   ```
5. Set the same `API_TOKEN` / `VITE_API_TOKEN` in both `.env` files.

### Development Workflow

#### Running locally

```bash
# Terminal 1 — Backend
cd einventiva-dashboard-server
npm start

# Terminal 2 — Frontend
cd einventiva-dashboard
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API calls to the backend on port `3847`.

#### Running tests

```bash
# Backend tests
cd einventiva-dashboard-server
npm test

# Frontend tests
cd einventiva-dashboard
npm test
```

#### Type checking (frontend)

```bash
cd einventiva-dashboard
npx tsc --noEmit
```

### Project Architecture

| Directory | Description |
|-----------|-------------|
| `einventiva-dashboard-server/` | Node.js + Express backend |
| `einventiva-dashboard-server/routes/` | REST API route handlers |
| `einventiva-dashboard-server/services/` | Business logic (SSH, metrics, caching, alerts) |
| `einventiva-dashboard-server/websocket/` | Socket.IO event handlers |
| `einventiva-dashboard/src/components/` | React UI components |
| `einventiva-dashboard/src/hooks/` | React custom hooks |
| `einventiva-dashboard/src/lib/` | Utilities, API client, parsers, formatters |

### Code Style

- **Backend**: ES6+ JavaScript, CommonJS modules (`require`/`module.exports`)
- **Frontend**: TypeScript, ES Modules, React functional components with hooks
- **Styling**: TailwindCSS utility classes, dark theme (zinc/black palette)
- **UI Components**: Radix UI primitives wrapped in `src/components/ui/`
- Follow existing patterns — look at similar files before creating new ones

### Making Changes

1. Create a **feature branch** from `main`:
   ```bash
   git checkout -b feature/my-feature
   ```
2. Make your changes following the code style above
3. **Test** your changes:
   - Run existing tests (`npm test` in both dirs)
   - Verify TypeScript compiles (`npx tsc --noEmit` in frontend)
   - Test manually in the browser
4. **Commit** with clear, descriptive messages:
   ```bash
   git commit -m "Add container log viewer to ServerDetailPanel"
   ```
5. **Push** and open a Pull Request

### Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Describe **what** changed and **why**
- Include screenshots for UI changes
- Make sure tests pass and TypeScript compiles
- Update the README if you add new features or endpoints

### Adding a New API Endpoint

1. Create or modify a route file in `einventiva-dashboard-server/routes/`
2. Use the `createRouter(getServers, setServers)` factory pattern
3. Add the route in `monitor.js`
4. Add the corresponding API function in `einventiva-dashboard/src/lib/api.ts`
5. Update the API table in `README.md`

### Adding a New Frontend Component

1. Create the component in `einventiva-dashboard/src/components/`
2. Use existing UI primitives from `components/ui/`
3. Follow the dark theme palette: `bg-zinc-900`, `border-zinc-800`, `text-zinc-300`, etc.
4. Use `lucide-react` for icons
5. Wrap in `ErrorBoundary` if it's a top-level panel

### Reporting Issues

- Use [GitHub Issues](https://github.com/einventiva/vpsguard/issues)
- Include steps to reproduce
- Include browser/Node.js version
- Include relevant error messages or screenshots

### Security

If you find a security vulnerability, please **do not** open a public issue. Instead, email the project maintainers via GitHub Issues (marked as confidential) with details.

---

## Español

### Primeros Pasos

1. **Fork** el repositorio
2. **Clona** tu fork:
   ```bash
   git clone https://github.com/tu-usuario/vpsguard.git
   cd vpsguard
   ```
3. **Instala dependencias** del frontend y backend:
   ```bash
   cd einventiva-dashboard-server && npm install && cd ..
   cd einventiva-dashboard && npm install && cd ..
   ```
4. **Copia los archivos de entorno**:
   ```bash
   cp einventiva-dashboard-server/.env.example einventiva-dashboard-server/.env
   cp einventiva-dashboard/.env.example einventiva-dashboard/.env
   ```
5. Configura el mismo `API_TOKEN` / `VITE_API_TOKEN` en ambos archivos `.env`.

### Flujo de Desarrollo

#### Ejecutar localmente

```bash
# Terminal 1 — Backend
cd einventiva-dashboard-server
npm start

# Terminal 2 — Frontend
cd einventiva-dashboard
npm run dev
```

El frontend corre en `http://localhost:5173` y conecta al backend en el puerto `3847`.

#### Ejecutar tests

```bash
# Tests del backend
cd einventiva-dashboard-server
npm test

# Tests del frontend
cd einventiva-dashboard
npm test
```

#### Verificar tipos (frontend)

```bash
cd einventiva-dashboard
npx tsc --noEmit
```

### Arquitectura del Proyecto

| Directorio | Descripcion |
|------------|-------------|
| `einventiva-dashboard-server/` | Backend Node.js + Express |
| `einventiva-dashboard-server/routes/` | Handlers de rutas REST API |
| `einventiva-dashboard-server/services/` | Logica de negocio (SSH, metricas, cache, alertas) |
| `einventiva-dashboard-server/websocket/` | Handlers de eventos Socket.IO |
| `einventiva-dashboard/src/components/` | Componentes React de UI |
| `einventiva-dashboard/src/hooks/` | Hooks personalizados de React |
| `einventiva-dashboard/src/lib/` | Utilidades, cliente API, parsers, formateadores |

### Estilo de Codigo

- **Backend**: JavaScript ES6+, modulos CommonJS (`require`/`module.exports`)
- **Frontend**: TypeScript, ES Modules, componentes funcionales React con hooks
- **Estilos**: Clases utilitarias TailwindCSS, tema oscuro (paleta zinc/black)
- **Componentes UI**: Primitivos Radix UI encapsulados en `src/components/ui/`
- Sigue los patrones existentes — revisa archivos similares antes de crear nuevos

### Realizando Cambios

1. Crea una **rama** desde `main`:
   ```bash
   git checkout -b feature/mi-feature
   ```
2. Realiza tus cambios siguiendo el estilo de codigo
3. **Prueba** tus cambios:
   - Ejecuta los tests existentes (`npm test` en ambos directorios)
   - Verifica que TypeScript compile (`npx tsc --noEmit` en el frontend)
   - Prueba manualmente en el navegador
4. **Commitea** con mensajes claros y descriptivos:
   ```bash
   git commit -m "Add container log viewer to ServerDetailPanel"
   ```
5. **Push** y abre un Pull Request

### Guia para Pull Requests

- PRs enfocados — un feature o fix por PR
- Describe **que** cambio y **por que**
- Incluye capturas de pantalla para cambios de UI
- Asegurate de que los tests pasen y TypeScript compile
- Actualiza el README si agregas features nuevos o endpoints

### Agregar un Nuevo Endpoint API

1. Crea o modifica un archivo de ruta en `einventiva-dashboard-server/routes/`
2. Usa el patron factory `createRouter(getServers, setServers)`
3. Agrega la ruta en `monitor.js`
4. Agrega la funcion API correspondiente en `einventiva-dashboard/src/lib/api.ts`
5. Actualiza la tabla de API en `README.md`

### Agregar un Nuevo Componente Frontend

1. Crea el componente en `einventiva-dashboard/src/components/`
2. Usa los primitivos UI existentes de `components/ui/`
3. Sigue la paleta del tema oscuro: `bg-zinc-900`, `border-zinc-800`, `text-zinc-300`, etc.
4. Usa `lucide-react` para iconos
5. Envuelve en `ErrorBoundary` si es un panel de nivel superior

### Reportar Problemas

- Usa [GitHub Issues](https://github.com/einventiva/vpsguard/issues)
- Incluye pasos para reproducir
- Incluye version de navegador/Node.js
- Incluye mensajes de error o capturas de pantalla relevantes

### Seguridad

Si encuentras una vulnerabilidad de seguridad, por favor **no** abras un issue publico. En su lugar, envia un email a the project maintainers via GitHub Issues (marked as confidential) con los detalles.

---

**Built by [Einventiva](https://einventiva.com)**
