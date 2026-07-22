import { useState } from 'react'
import { useServerData } from '@/hooks/useServerData'
import { useAlerts } from '@/hooks/useAlerts'
import { useThresholds } from '@/hooks/useThresholds'
import { useProjections } from '@/hooks/useProjections'
import { Overview } from '@/components/Overview'
import { DockerPanel } from '@/components/DockerPanel'
import { ScriptsPanel } from '@/components/ScriptsPanel'
import { LogViewer } from '@/components/LogViewer'
import { CrontabPanel } from '@/components/CrontabPanel'
import { ServersPanel } from '@/components/ServersPanel'
import { PostgresPanel } from '@/components/PostgresPanel'
import { AlertsPanel } from '@/components/AlertsPanel'
import { ServicesPanel } from '@/components/ServicesPanel'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { ServerDetailPanel } from '@/components/ServerDetailPanel'
import {
  Activity,
  Container,
  Database,
  Terminal,
  FileText,
  CalendarClock,
  Server,
  RefreshCw,
  Menu,
  X,
  Wifi,
  WifiOff,
  ArrowLeft,
  Bell,
  Sparkles,
  HeartPulse,
} from 'lucide-react'
import type { OpenScript, ScriptOrigin } from '@/components/PreventionPanel'
import { PreventionPanel } from '@/components/PreventionPanel'

type TabType = 'overview' | 'alerts' | 'prevention' | 'services' | 'docker' | 'postgres' | 'scripts' | 'crontab' | 'logs' | 'servers' | 'serverDetail'

const navItems: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <Activity className="w-4 h-4" /> },
  { id: 'alerts', label: 'Alerts', icon: <Bell className="w-4 h-4" /> },
  { id: 'prevention', label: 'Prevention', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'services', label: 'Services', icon: <HeartPulse className="w-4 h-4" /> },
  { id: 'docker', label: 'Docker', icon: <Container className="w-4 h-4" /> },
  { id: 'postgres', label: 'PostgreSQL', icon: <Database className="w-4 h-4" /> },
  { id: 'scripts', label: 'Scripts', icon: <Terminal className="w-4 h-4" /> },
  { id: 'crontab', label: 'Crontab', icon: <CalendarClock className="w-4 h-4" /> },
  { id: 'logs', label: 'Logs', icon: <FileText className="w-4 h-4" /> },
  { id: 'servers', label: 'Servers', icon: <Server className="w-4 h-4" /> },
]

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [selectedServer, setSelectedServer] = useState<string | null>(null)
  const { data, loading, error, refetch, wsConnected, servers, serverKeys, refetchServers } = useServerData(15000)
  const alertsApi = useAlerts()
  const thresholdsApi = useThresholds()
  const projections = useProjections()

  const navigateToServerDetail = (key: string) => {
    setSelectedServer(key)
    setActiveTab('serverDetail')
  }

  const navigateBack = () => {
    setSelectedServer(null)
    setActiveTab('overview')
  }

  // Alert → script bridge: jump to the Scripts tab with a script and
  // target server preselected (suggestion buttons on alert rows)
  // `context` carries WHY the script was suggested (the finding/step/alert)
  // so a later AI interpretation reconciles with it instead of contradicting
  // `origin` links back to the action-plan step that suggested it, so the AI
  // interpretation can close that step's loop
  const [scriptTarget, setScriptTarget] = useState<{
    script: string
    server: string
    context?: string
    origin?: ScriptOrigin
  } | null>(null)
  const openScript: OpenScript = (script, server, context, origin) => {
    setScriptTarget({ script, server, context, origin })
    setActiveTab('scripts')
  }

  const firstServer = serverKeys[0] || 'prod'

  return (
    <div className="h-screen bg-zinc-950 text-zinc-50 flex overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-48 bg-zinc-900 border-r border-zinc-800 transition-transform
          lg:relative lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="h-14 border-b border-zinc-800 flex items-center justify-between px-4">
          <h1 className="font-mono text-sm font-bold text-zinc-100 tracking-wider">
            VPSGUARD
          </h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="p-4 space-y-2">
          {navItems.map((item) => {
            const isActive = activeTab === item.id || (item.id === 'overview' && activeTab === 'serverDetail')
            return (
              <Button
                key={item.id}
                variant={isActive ? 'default' : 'ghost'}
                size="sm"
                onClick={() => {
                  setActiveTab(item.id)
                  if (item.id !== 'serverDetail') setSelectedServer(null)
                  setSidebarOpen(false)
                }}
                className={`w-full justify-start gap-3 ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-50 hover:bg-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
              >
                {item.icon}
                <span className="text-xs font-medium">{item.label}</span>
                {item.id === 'alerts' && alertsApi.unackedCount > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
                    {alertsApi.unackedCount}
                  </span>
                )}
              </Button>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-800">
          <div className="text-xs text-zinc-500 font-mono space-y-1">
            <p>
              Status:{' '}
              <span className={data ? 'text-green-400' : 'text-amber-400'}>
                {data ? 'Connected' : 'Loading'}
              </span>
            </p>
            <p className="flex items-center gap-1">
              {wsConnected ? (
                <Wifi className="w-3 h-3 text-green-400" />
              ) : (
                <WifiOff className="w-3 h-3 text-zinc-600" />
              )}
              <span className={wsConnected ? 'text-green-400' : 'text-zinc-600'}>
                {wsConnected ? 'Live' : 'Polling'}
              </span>
            </p>
            <p className="text-zinc-600">{serverKeys.length} server{serverKeys.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-zinc-400 hover:text-zinc-200"
            >
              <Menu className="w-4 h-4" />
            </Button>
            {activeTab === 'serverDetail' ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={navigateBack}
                  className="text-zinc-400 hover:text-zinc-200 px-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-sm font-semibold text-zinc-300">
                  {selectedServer && servers[selectedServer]?.displayName || selectedServer || 'Server Detail'}
                </h2>
              </div>
            ) : (
              <h2 className="text-sm font-semibold text-zinc-300">
                {navItems.find((item) => item.id === activeTab)?.label}
              </h2>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:bg-zinc-900"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="ml-2 hidden sm:inline">Refresh</span>
          </Button>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          <div className="p-6">
            {activeTab === 'overview' && (
              <ErrorBoundary fallbackLabel="Overview failed to render">
                <Overview
                  data={data}
                  loading={loading}
                  error={error}
                  servers={servers}
                  serverKeys={serverKeys}
                  effectiveThresholds={thresholdsApi.effectiveFor}
                  projections={projections}
                  onServerClick={navigateToServerDetail}
                />
              </ErrorBoundary>
            )}
            {activeTab === 'serverDetail' && selectedServer && (
              <ErrorBoundary fallbackLabel="Server detail failed to render">
                <ServerDetailPanel
                  serverKey={selectedServer}
                  serverInfo={servers[selectedServer] || { displayName: selectedServer, user: '', ip: '', port: 22, alias: selectedServer }}
                  serverStatus={data?.[selectedServer] ?? null}
                  onBack={navigateBack}
                />
              </ErrorBoundary>
            )}
            {activeTab === 'alerts' && <ErrorBoundary fallbackLabel="Alerts panel failed"><AlertsPanel alertsApi={alertsApi} thresholdsApi={thresholdsApi} servers={servers} onOpenScript={openScript} /></ErrorBoundary>}
            {activeTab === 'prevention' && <ErrorBoundary fallbackLabel="Prevention panel failed"><PreventionPanel servers={servers} onOpenScript={openScript} /></ErrorBoundary>}
            {activeTab === 'services' && <ErrorBoundary fallbackLabel="Services panel failed"><ServicesPanel servers={servers} serverKeys={serverKeys} /></ErrorBoundary>}
            {activeTab === 'docker' && <ErrorBoundary fallbackLabel="Docker panel failed"><DockerPanel servers={servers} serverKeys={serverKeys} /></ErrorBoundary>}
            {activeTab === 'postgres' && <ErrorBoundary fallbackLabel="PostgreSQL panel failed"><PostgresPanel servers={servers} serverKeys={serverKeys} /></ErrorBoundary>}
            {activeTab === 'scripts' && <ErrorBoundary fallbackLabel="Scripts panel failed"><ScriptsPanel servers={servers} serverKeys={serverKeys} initialTarget={scriptTarget} onTargetConsumed={() => setScriptTarget(null)} /></ErrorBoundary>}
            {activeTab === 'crontab' && <ErrorBoundary fallbackLabel="Crontab panel failed"><CrontabPanel servers={servers} serverKeys={serverKeys} /></ErrorBoundary>}
            {activeTab === 'logs' && <ErrorBoundary fallbackLabel="Log viewer failed"><LogViewer servers={servers} serverKeys={serverKeys} /></ErrorBoundary>}
            {activeTab === 'servers' && <ErrorBoundary fallbackLabel="Servers panel failed"><ServersPanel servers={servers} serverKeys={serverKeys} refetchServers={refetchServers} /></ErrorBoundary>}
          </div>
        </div>
      </main>
      <Toaster theme="dark" position="top-right" richColors />
    </div>
  )
}

export default App
