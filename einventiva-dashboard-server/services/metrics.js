const { log } = require('./logger');

const METRICS_COMMAND = 'top -bn1 | head -5; echo "---SEPARATOR---"; free -m; echo "---SEPARATOR---"; df -h /; echo "---SEPARATOR---"; uptime; echo "---SEPARATOR---"; docker ps --format \'{{json .}}\'; echo "---SEPARATOR---"; ps aux --sort=-%cpu | head -16; echo "---SEPARATOR---"; docker stats --no-stream --format \'{{json .}}\' 2>/dev/null; echo "---SEPARATOR---"; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 0';

function parseCpuPercent(cpuData) {
  if (!cpuData || !cpuData.raw) return 0;
  try {
    const idleMatch = cpuData.raw.match(/([\d.]+)\s*id/);
    if (idleMatch) {
      return 100 - parseFloat(idleMatch[1]);
    }
  } catch (e) { /* ignore */ }
  return 0;
}

function parseSystemMetrics(output) {
  const sections = output.split('---SEPARATOR---');
  if (sections.length < 5) {
    throw new Error('Invalid metrics output format');
  }

  const metrics = {};

  // CPU
  try {
    const topLines = sections[0].trim().split('\n');
    metrics.cpu = { raw: topLines.join(' ') };
  } catch (e) {
    metrics.cpu = { error: 'Failed to parse CPU info' };
  }

  // RAM
  try {
    const ramLines = sections[1].trim().split('\n');
    const memLine = ramLines.find(line => line.startsWith('Mem:'));
    if (memLine) {
      const parts = memLine.split(/\s+/);
      metrics.memory = {
        total: parseInt(parts[1]),
        used: parseInt(parts[2]),
        free: parseInt(parts[3]),
        unit: 'MB'
      };
    }
  } catch (e) {
    metrics.memory = { error: 'Failed to parse memory info' };
  }

  // Disk
  try {
    const diskLines = sections[2].trim().split('\n');
    const diskLine = diskLines[1];
    if (diskLine) {
      const parts = diskLine.split(/\s+/);
      metrics.disk = {
        filesystem: parts[0],
        size: parts[1],
        used: parts[2],
        available: parts[3],
        percentUsed: parts[4]
      };
    }
  } catch (e) {
    metrics.disk = { error: 'Failed to parse disk info' };
  }

  // Uptime
  try {
    metrics.uptime = { raw: sections[3].trim() };
  } catch (e) {
    metrics.uptime = { error: 'Failed to parse uptime' };
  }

  // Docker
  try {
    const dockerLines = sections[4].trim().split('\n').filter(line => line.trim());
    metrics.docker = [];
    for (const line of dockerLines) {
      if (line.trim()) {
        try {
          metrics.docker.push(JSON.parse(line));
        } catch (parseError) {
          log(`Skipping malformed docker JSON`, { line: line.substring(0, 100) });
        }
      }
    }
  } catch (e) {
    metrics.docker = { error: 'Failed to parse docker info' };
  }

  // Top processes (section 5)
  try {
    if (sections[5]) {
      const psLines = sections[5].trim().split('\n');
      metrics.topProcesses = [];
      for (let i = 1; i < psLines.length; i++) {
        const line = psLines[i].trim();
        if (!line) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          metrics.topProcesses.push({
            user: parts[0],
            pid: parts[1],
            cpu: parseFloat(parts[2]) || 0,
            mem: parseFloat(parts[3]) || 0,
            command: parts.slice(10).join(' '),
          });
        }
      }
    }
  } catch (e) {
    metrics.topProcesses = [];
  }

  // Docker stats (section 6)
  try {
    if (sections[6]) {
      const statsLines = sections[6].trim().split('\n').filter(l => l.trim());
      metrics.dockerStats = [];
      for (const line of statsLines) {
        try {
          metrics.dockerStats.push(JSON.parse(line));
        } catch (e) { /* skip */ }
      }
    }
  } catch (e) {
    metrics.dockerStats = [];
  }

  // CPU core count (section 7)
  try {
    if (sections[7]) {
      metrics.cpuCores = parseInt(sections[7].trim()) || 0;
    }
  } catch (e) {
    metrics.cpuCores = 0;
  }

  return metrics;
}

function parseDockerPsOutput(output) {
  const containers = [];
  const lines = output.trim().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      containers.push(JSON.parse(line));
    } catch (e) {
      log(`Docker line not JSON`, { line: line.substring(0, 100) });
    }
  }
  return containers;
}

function parseLogs(output) {
  return output.trim().split('\n').slice(-100);
}

module.exports = {
  METRICS_COMMAND,
  parseCpuPercent,
  parseSystemMetrics,
  parseDockerPsOutput,
  parseLogs,
};
