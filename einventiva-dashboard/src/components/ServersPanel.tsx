import { useState } from 'react'
import type { ServerInfo } from '@/types'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SetupWizardPanel } from '@/components/SetupWizardPanel'
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  X,
  Save,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Loader,
  Wifi,
  Wand2,
} from 'lucide-react'

interface ServersPanelProps {
  servers: Record<string, ServerInfo>
  serverKeys: string[]
  refetchServers: () => Promise<void>
}

interface ServerFormData {
  key: string
  displayName: string
  alias: string
  ip: string
  port: number
  user: string
}

const emptyForm: ServerFormData = {
  key: '',
  displayName: '',
  alias: '',
  ip: '',
  port: 22,
  user: '',
}

export function ServersPanel({
  servers,
  serverKeys,
  refetchServers,
}: ServersPanelProps) {
  const [editing, setEditing] = useState<ServerFormData | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ key: string; success: boolean; message: string } | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const handleNew = () => {
    setEditing({ ...emptyForm })
    setIsNew(true)
    setError(null)
  }

  const handleEdit = (key: string) => {
    const svr = servers[key]
    setEditing({
      key,
      displayName: svr.displayName,
      alias: svr.alias,
      ip: svr.ip,
      port: svr.port,
      user: svr.user,
    })
    setIsNew(false)
    setError(null)
  }

  const handleDelete = async (key: string) => {
    try {
      setError(null)
      await api.deleteServer(key)
      await refetchServers()
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete server')
    }
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      if (isNew) {
        await api.createServer({
          key: editing.key,
          displayName: editing.displayName,
          alias: editing.alias,
          ip: editing.ip,
          port: editing.port,
          user: editing.user,
        })
      } else {
        await api.updateServer(editing.key, {
          displayName: editing.displayName,
          alias: editing.alias,
          ip: editing.ip,
          port: editing.port,
          user: editing.user,
        })
      }
      await refetchServers()
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server')
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (key: string) => {
    setTesting(key)
    setTestResult(null)
    try {
      const result = await api.testServerConnection(key)
      setTestResult({
        key,
        success: result.success,
        message: result.success ? 'Connection successful' : (result.error || 'Connection failed'),
      })
    } catch (err) {
      setTestResult({
        key,
        success: false,
        message: err instanceof Error ? err.message : 'Connection test failed',
      })
    } finally {
      setTesting(null)
    }
  }

  // Wizard view
  if (wizardOpen) {
    return (
      <SetupWizardPanel
        onClose={() => setWizardOpen(false)}
        onComplete={() => { setWizardOpen(false); refetchServers() }}
      />
    )
  }

  // Editor view
  if (editing) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(null)}
            className="text-zinc-400 hover:text-zinc-200"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <h3 className="text-sm font-semibold text-zinc-300">
            {isNew ? 'New Server' : 'Edit Server'}
          </h3>
        </div>

        <Card className="border-zinc-700 bg-zinc-900/50 p-6 space-y-4">
          <div>
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
              Key
            </label>
            <input
              type="text"
              value={editing.key}
              onChange={(e) => setEditing({ ...editing, key: e.target.value })}
              placeholder="e.g. prod, staging, web1..."
              disabled={!isNew}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50 disabled:cursor-not-allowed font-mono"
            />
            {isNew && (
              <p className="text-xs text-zinc-500 mt-1">Unique identifier. Cannot be changed after creation.</p>
            )}
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={editing.displayName}
              onChange={(e) => setEditing({ ...editing, displayName: e.target.value })}
              placeholder="Production Server..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
              SSH Alias
            </label>
            <input
              type="text"
              value={editing.alias}
              onChange={(e) => setEditing({ ...editing, alias: e.target.value })}
              placeholder="SSH alias from ~/.ssh/config..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                IP Address
              </label>
              <input
                type="text"
                value={editing.ip}
                onChange={(e) => setEditing({ ...editing, ip: e.target.value })}
                placeholder="0.0.0.0"
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                Port
              </label>
              <input
                type="number"
                value={editing.port}
                onChange={(e) => setEditing({ ...editing, port: parseInt(e.target.value) || 22 })}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                User
              </label>
              <input
                type="text"
                value={editing.user}
                onChange={(e) => setEditing({ ...editing, user: e.target.value })}
                placeholder="root"
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving || !editing.key || !editing.displayName || !editing.alias}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {saving ? (
                <Loader className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {isNew ? 'Create Server' : 'Save Changes'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
            {!isNew && (
              <Button
                variant="outline"
                onClick={() => handleDelete(editing.key)}
                className="border-red-800 text-red-400 hover:bg-red-900/30 ml-auto"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
            )}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">
          Managed Servers ({serverKeys.length})
        </h3>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWizardOpen(true)}
            className="border-amber-700 text-amber-400 hover:bg-amber-900/30"
          >
            <Wand2 className="w-4 h-4 mr-1" />
            Setup Wizard
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNew}
            className="border-blue-700 text-blue-400 hover:bg-blue-900/30"
          >
            <Plus className="w-4 h-4 mr-1" />
            New Server
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800 rounded text-red-200 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Server Cards Grid */}
      {serverKeys.length === 0 ? (
        <Card className="border-zinc-700 bg-zinc-900/50 p-6 text-center text-zinc-400">
          No servers configured. Click "New Server" to add one.
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {serverKeys.map((key) => {
            const svr = servers[key]
            return (
              <Card
                key={key}
                className="border-zinc-700 bg-zinc-900/50 p-4 flex flex-col"
              >
                <div className="flex items-start gap-3 mb-3">
                  <Server className="w-5 h-5 text-blue-400 flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-mono text-sm font-semibold text-zinc-50 truncate">
                      {svr.displayName}
                    </h4>
                    <p className="text-xs text-zinc-500 font-mono">{key}</p>
                  </div>
                </div>

                <div className="text-xs text-zinc-400 space-y-1 mb-3 flex-1">
                  <p>
                    <span className="text-zinc-500">SSH:</span>{' '}
                    <span className="font-mono">{svr.alias}</span>
                  </p>
                  {svr.ip && (
                    <p>
                      <span className="text-zinc-500">IP:</span>{' '}
                      <span className="font-mono">{svr.ip}:{svr.port}</span>
                    </p>
                  )}
                  {svr.user && (
                    <p>
                      <span className="text-zinc-500">User:</span>{' '}
                      <span className="font-mono">{svr.user}</span>
                    </p>
                  )}
                </div>

                {/* Test result */}
                {testResult && testResult.key === key && (
                  <div className={`flex items-center gap-2 text-xs mb-3 p-2 rounded ${
                    testResult.success
                      ? 'bg-green-900/20 text-green-300'
                      : 'bg-red-900/20 text-red-300'
                  }`}>
                    {testResult.success ? (
                      <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    )}
                    <span className="truncate">{testResult.message}</span>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                    onClick={() => handleTest(key)}
                    disabled={testing === key}
                  >
                    {testing === key ? (
                      <Loader className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Wifi className="w-3 h-3 mr-1" />
                    )}
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-zinc-500 hover:text-zinc-300"
                    onClick={() => handleEdit(key)}
                  >
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-zinc-500 hover:text-red-400"
                    onClick={() => handleDelete(key)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
