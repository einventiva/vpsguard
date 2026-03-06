import { useState, useEffect, useRef } from 'react'
import { Socket } from 'socket.io-client'
import { createDedicatedSocket } from '@/lib/socket'
import { useAutoScroll } from '@/hooks/useAutoScroll'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Wand2,
  Eye,
  EyeOff,
  Loader,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  RotateCcw,
  Server,
} from 'lucide-react'

interface SetupWizardPanelProps {
  onClose: () => void
  onComplete: () => void
}

interface StepState {
  status: 'pending' | 'running' | 'done' | 'error'
  message: string
}

const STEP_LABELS: Record<string, string> = {
  validate: 'Validate inputs',
  preflight: 'Check sshpass',
  'root-ssh': 'Test root SSH',
  'create-user': 'Create user & sudo',
  keygen: 'Generate SSH keypair',
  'copy-key': 'Copy public key',
  'copy-key-manual': 'Copy key (fallback)',
  'ssh-config': 'Configure SSH config',
  'test-alias': 'Test SSH via alias',
  register: 'Register in dashboard',
}

const STEP_ORDER = [
  'validate', 'preflight', 'root-ssh', 'create-user',
  'keygen', 'copy-key', 'ssh-config', 'test-alias', 'register',
]

export function SetupWizardPanel({ onClose, onComplete }: SetupWizardPanelProps) {
  const [phase, setPhase] = useState<'form' | 'running' | 'done' | 'error'>('form')
  const [serverKey, setServerKey] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [ip, setIp] = useState('')
  const [port, setPort] = useState(22)
  const [rootPassword, setRootPassword] = useState('')
  const [newUser, setNewUser] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [showRootPass, setShowRootPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)

  const [steps, setSteps] = useState<Record<string, StepState>>({})
  const [output, setOutput] = useState<string[]>([])
  const [result, setResult] = useState<{ serverKey: string; displayName: string; alias: string; ip: string; port: number; user: string } | null>(null)
  const [errorInfo, setErrorInfo] = useState<{ step: string; error: string } | null>(null)

  const scrollRef = useAutoScroll<HTMLPreElement>([output])
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect()
    }
  }, [])

  const handleStart = () => {
    setPhase('running')
    setSteps({})
    setOutput([])
    setResult(null)
    setErrorInfo(null)

    const socket = createDedicatedSocket()
    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('wizard:setup', {
        ip,
        port,
        rootPassword,
        newUser,
        newPassword,
        serverKey,
        displayName,
      })
    })

    socket.on('wizard:step', ({ step, status, message }) => {
      setSteps((prev) => ({ ...prev, [step]: { status, message } }))
    })

    socket.on('wizard:output', ({ data }) => {
      setOutput((prev) => [...prev, data])
    })

    socket.on('wizard:done', (data) => {
      setResult(data)
      setPhase('done')
      socket.disconnect()
    })

    socket.on('wizard:error', ({ step, error }) => {
      setErrorInfo({ step, error })
      setPhase('error')
      socket.disconnect()
    })
  }

  const handleRetry = () => {
    setPhase('form')
    setSteps({})
    setOutput([])
    setErrorInfo(null)
  }

  const canSubmit = serverKey && displayName && ip && rootPassword && newUser && newPassword

  // Form phase
  if (phase === 'form') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200"
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <h3 className="text-sm font-semibold text-zinc-300">
            <Wand2 className="w-4 h-4 inline mr-2" />
            Setup Wizard — Provision New Server
          </h3>
        </div>

        <Card className="border-zinc-700 bg-zinc-900/50 p-6 space-y-4">
          <p className="text-xs text-zinc-400">
            This wizard will configure a virgin server: create a user, set up SSH keys, and register it in the dashboard.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                Server Key
              </label>
              <input
                type="text"
                value={serverKey}
                onChange={(e) => setServerKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                placeholder="e.g. prod, web1..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono"
              />
              <p className="text-xs text-zinc-500 mt-1">Alphanumeric, unique identifier</p>
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Production Server..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                IP Address
              </label>
              <input
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.1.100"
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 22)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
              Root Password
            </label>
            <div className="relative">
              <input
                type={showRootPass ? 'text' : 'password'}
                value={rootPassword}
                onChange={(e) => setRootPassword(e.target.value)}
                placeholder="Current root password..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowRootPass(!showRootPass)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showRootPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                New User
              </label>
              <input
                type="text"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                placeholder="deploy, admin..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-semibold uppercase tracking-wider block mb-1">
                New User Password
              </label>
              <div className="relative">
                <input
                  type={showNewPass ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Password for new user..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-50 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPass(!showNewPass)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <Button
              onClick={handleStart}
              disabled={!canSubmit}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Wand2 className="w-4 h-4 mr-2" />
              Start Setup
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  // Running / Done / Error phases
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-200"
          disabled={phase === 'running'}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <h3 className="text-sm font-semibold text-zinc-300">
          <Wand2 className="w-4 h-4 inline mr-2" />
          {phase === 'running' ? 'Provisioning...' : phase === 'done' ? 'Setup Complete' : 'Setup Failed'}
        </h3>
      </div>

      {/* Steps progress */}
      <Card className="border-zinc-700 bg-zinc-900/50 p-4">
        <div className="space-y-2">
          {STEP_ORDER.map((step) => {
            const s = steps[step]
            if (!s) return (
              <div key={step} className="flex items-center gap-3 text-xs text-zinc-600">
                <div className="w-4 h-4 rounded-full border border-zinc-700" />
                <span>{STEP_LABELS[step] || step}</span>
              </div>
            )
            return (
              <div key={step} className={`flex items-center gap-3 text-xs ${
                s.status === 'done' ? 'text-green-400' :
                s.status === 'error' ? 'text-red-400' :
                'text-blue-400'
              }`}>
                {s.status === 'running' ? (
                  <Loader className="w-4 h-4 animate-spin" />
                ) : s.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                <span>{STEP_LABELS[step] || step}</span>
                <span className="text-zinc-500 ml-auto">{s.message}</span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Terminal output */}
      <Card className="border-zinc-700 bg-zinc-900/50 overflow-hidden">
        <div className="px-3 py-2 border-b border-zinc-700 text-xs text-zinc-400 font-mono">
          Output
        </div>
        <pre
          ref={scrollRef}
          className="h-64 overflow-auto bg-black p-3 font-mono text-xs whitespace-pre-wrap break-words"
        >
          {output.map((chunk, i) => {
            if (chunk.startsWith('══') || chunk.startsWith('  Setup Wizard') || chunk.startsWith('  Target:') || chunk.startsWith('  New user:') || chunk.startsWith('  SSH alias:') || chunk.startsWith('  Keypair:')) {
              return <span key={i} className="text-cyan-400 font-bold">{chunk}</span>
            }
            if (chunk.startsWith('\n── ') || chunk.startsWith('── ')) {
              return <span key={i} className="text-yellow-400">{chunk}</span>
            }
            if (chunk.startsWith('\n$ ') || chunk.startsWith('$ ')) {
              return <span key={i} className="text-zinc-500">{chunk}</span>
            }
            if (chunk.startsWith('  Will') || chunk.startsWith('  Using') || chunk.startsWith('  Path:') || chunk.startsWith('    ')) {
              return <span key={i} className="text-zinc-400">{chunk}</span>
            }
            return <span key={i} className="text-green-400">{chunk}</span>
          })}
          {phase === 'running' && (
            <span className="text-zinc-500 animate-pulse">_</span>
          )}
        </pre>
      </Card>

      {/* Result / Error */}
      {phase === 'done' && result && (
        <Card className="border-green-800 bg-green-900/20 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-green-300">Server provisioned successfully!</p>
              <div className="text-xs text-zinc-300 space-y-1 font-mono">
                <p><span className="text-zinc-500">Key:</span> {result.serverKey}</p>
                <p><span className="text-zinc-500">Name:</span> {result.displayName}</p>
                <p><span className="text-zinc-500">SSH Alias:</span> {result.alias}</p>
                <p><span className="text-zinc-500">User:</span> {result.user}@{result.ip}:{result.port}</p>
              </div>
              <Button
                onClick={() => { onComplete(); onClose() }}
                className="bg-green-700 hover:bg-green-800 text-white mt-2"
                size="sm"
              >
                <Server className="w-4 h-4 mr-2" />
                Go to Servers
              </Button>
            </div>
          </div>
        </Card>
      )}

      {phase === 'error' && errorInfo && (
        <Card className="border-red-800 bg-red-900/20 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="space-y-2">
              <p className="text-sm font-semibold text-red-300">Setup failed at: {STEP_LABELS[errorInfo.step] || errorInfo.step}</p>
              <p className="text-xs text-red-200">{errorInfo.error}</p>
              <Button
                onClick={handleRetry}
                variant="outline"
                size="sm"
                className="border-red-700 text-red-300 hover:bg-red-900/30 mt-2"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
