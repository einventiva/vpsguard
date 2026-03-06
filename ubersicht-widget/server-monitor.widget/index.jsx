import { css } from "uebersicht";

const API_BASE = "http://localhost:3847/api";
const API_TOKEN = "YOUR_API_TOKEN_HERE";

export const refreshFrequency = 15000;

export const command = `
  STATUS=$(curl -sf -H "Authorization: Bearer ${API_TOKEN}" "${API_BASE}/status" 2>/dev/null) || STATUS='{}'
  SERVERS=$(curl -sf -H "Authorization: Bearer ${API_TOKEN}" "${API_BASE}/servers" 2>/dev/null) || SERVERS='{}'
  echo "{\\"status\\":$STATUS,\\"servers\\":$SERVERS}"
`;

// ─── Styles ──────────────────────────────────────────────────────────

const container = css`
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 300px;
  font-family: "SF Mono", "Menlo", "Monaco", monospace;
  font-size: 11px;
  color: #e4e4e7;
  background: rgba(9, 9, 11, 0.9);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(63, 63, 70, 0.5);
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  user-select: none;
`;

const headerStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.4);
`;

const titleStyle = css`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #71717a;
`;

const countBadge = css`
  font-size: 9px;
  color: #52525b;
`;

const serverBlockStyle = css`
  margin-bottom: 10px;
  &:last-child {
    margin-bottom: 0;
  }
`;

const serverHeaderStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
`;

const serverNameStyle = css`
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const serverMeta = css`
  font-size: 9px;
  color: #52525b;
  display: flex;
  gap: 8px;
`;

const dot = (color) => css`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${color};
  display: inline-block;
  flex-shrink: 0;
`;

const metricRowStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 3px;
`;

const metricLabelStyle = css`
  color: #52525b;
  width: 30px;
  font-size: 9px;
`;

const barContainerStyle = css`
  flex: 1;
  height: 3px;
  background: rgba(63, 63, 70, 0.4);
  border-radius: 2px;
  margin: 0 8px;
  overflow: hidden;
`;

const barFill = (pct, color) => css`
  height: 100%;
  width: ${Math.min(pct, 100)}%;
  background: ${color};
  border-radius: 2px;
  transition: width 0.5s ease;
`;

const metricValueStyle = css`
  width: 32px;
  text-align: right;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
`;

// ─── Helpers ─────────────────────────────────────────────────────────

function getColor(pct) {
  if (pct > 85) return "#ef4444";
  if (pct > 70) return "#f59e0b";
  return "#22c55e";
}

function getStatusColor(data) {
  if (!data || data.status === "error") return "#ef4444";
  const cpu = parseCpu(data.metrics?.cpu);
  const mem = parseMem(data.metrics?.memory);
  if (cpu > 80 || mem > 85) return "#ef4444";
  if (cpu > 60 || mem > 70) return "#f59e0b";
  return "#22c55e";
}

function parseCpu(cpuData) {
  if (!cpuData?.raw) return 0;
  const match = cpuData.raw.match(/([\d.]+)\s*id/);
  return match ? Math.round((100 - parseFloat(match[1])) * 10) / 10 : 0;
}

function parseMem(memData) {
  if (!memData?.total) return 0;
  return Math.round((memData.used / memData.total) * 1000) / 10;
}

function parseDisk(diskData) {
  return parseInt((diskData?.percentUsed || "0").replace("%", "")) || 0;
}

function parseUptime(uptimeData) {
  if (!uptimeData?.raw) return "";
  const raw = uptimeData.raw;
  const daysMatch = raw.match(/up\s+(\d+)\s+days?/);
  const hoursMatch = raw.match(/up\s+(?:\d+\s+days?,\s*)?(\d+):(\d+)/);
  const minMatch = raw.match(/up\s+(\d+)\s+min/);
  if (daysMatch) return `${daysMatch[1]}d`;
  if (hoursMatch) return `${hoursMatch[1]}h${hoursMatch[2]}m`;
  if (minMatch) return `${minMatch[1]}m`;
  return "";
}

function containerCount(metrics) {
  const docker = metrics?.docker;
  return Array.isArray(docker) ? docker.length : 0;
}

// ─── Components ──────────────────────────────────────────────────────

function ServerMetrics({ name, data }) {
  if (!data || data.status === "error") {
    return (
      <div className={serverBlockStyle}>
        <div className={serverHeaderStyle}>
          <div className={serverNameStyle}>
            <span className={dot("#ef4444")} />
            <span style={{ color: "#a1a1aa" }}>{name}</span>
          </div>
          <span style={{ color: "#ef4444", fontSize: 9 }}>OFFLINE</span>
        </div>
      </div>
    );
  }

  const metrics = data.metrics || {};
  const cpu = parseCpu(metrics.cpu);
  const mem = parseMem(metrics.memory);
  const disk = parseDisk(metrics.disk);
  const uptime = parseUptime(metrics.uptime);
  const containers = containerCount(metrics);

  const rows = [
    { label: "CPU", value: cpu },
    { label: "MEM", value: mem },
    { label: "DSK", value: disk },
  ];

  return (
    <div className={serverBlockStyle}>
      <div className={serverHeaderStyle}>
        <div className={serverNameStyle}>
          <span className={dot(getStatusColor(data))} />
          <span>{name}</span>
        </div>
        <div className={serverMeta}>
          {uptime && <span>{uptime}</span>}
          {containers > 0 && <span>{containers}c</span>}
        </div>
      </div>
      {rows.map((r) => (
        <div key={r.label} className={metricRowStyle}>
          <span className={metricLabelStyle}>{r.label}</span>
          <div className={barContainerStyle}>
            <div className={barFill(r.value, getColor(r.value))} />
          </div>
          <span className={metricValueStyle} style={{ color: getColor(r.value) }}>
            {r.value}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Render ─────────────────────────────────────────────────────

export const render = ({ output, error }) => {
  if (error) {
    return (
      <div className={container}>
        <div className={headerStyle}>
          <span className={titleStyle}>VPSGUARD</span>
          <span className={dot("#ef4444")} />
        </div>
        <div style={{ color: "#ef4444", fontSize: 10 }}>Error: {String(error)}</div>
      </div>
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    return (
      <div className={container}>
        <div className={headerStyle}>
          <span className={titleStyle}>VPSGUARD</span>
        </div>
        <div style={{ color: "#52525b" }}>Loading...</div>
      </div>
    );
  }

  if (parsed.error) {
    return (
      <div className={container}>
        <div className={headerStyle}>
          <span className={titleStyle}>VPSGUARD</span>
          <span className={dot("#ef4444")} />
        </div>
        <div style={{ color: "#ef4444", fontSize: 10 }}>{parsed.error}</div>
      </div>
    );
  }

  const { status, servers } = parsed;
  const keys = Object.keys(status);
  const anyOffline = keys.some((k) => status[k]?.status === "error");
  const onlineCount = keys.filter((k) => status[k]?.status !== "error").length;

  return (
    <div className={container}>
      <div className={headerStyle}>
        <span className={titleStyle}>VPSGUARD</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className={countBadge}>
            {onlineCount}/{keys.length}
          </span>
          <span className={dot(anyOffline ? "#ef4444" : "#22c55e")} />
        </div>
      </div>
      {keys.map((key) => (
        <ServerMetrics
          key={key}
          name={servers[key]?.displayName || key}
          data={status[key]}
        />
      ))}
    </div>
  );
};
