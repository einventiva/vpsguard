const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseCpuPercent, parseSystemMetrics, parseDockerPsOutput, parseLogs } = require('../services/metrics');

describe('parseCpuPercent', () => {
  it('parses idle percent from top output', () => {
    const result = parseCpuPercent({ raw: '%Cpu(s):  5.3 us,  2.1 sy,  0.0 ni, 92.0 id,  0.6 wa' });
    assert.equal(result, 8);  // 100 - 92
  });

  it('returns 0 for null input', () => {
    assert.equal(parseCpuPercent(null), 0);
  });

  it('returns 0 for missing raw', () => {
    assert.equal(parseCpuPercent({}), 0);
  });

  it('returns 0 when no id match', () => {
    assert.equal(parseCpuPercent({ raw: 'no cpu data here' }), 0);
  });
});

describe('parseSystemMetrics', () => {
  const makeSections = (overrides = {}) => {
    const defaults = {
      cpu: '%Cpu(s):  3.0 us,  1.0 sy,  0.0 ni, 95.5 id,  0.5 wa',
      mem: '              total        used        free      shared  buff/cache   available\nMem:           7963        4123        1234         256        2606        3584',
      disk: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   25G   23G  53% /',
      uptime: '10:30:01 up 5 days,  3:42,  2 users,  load average: 0.15, 0.30, 0.45',
      docker: '{"ID":"abc123","Names":"nginx","State":"running"}\n{"ID":"def456","Names":"redis","State":"running"}',
      ps: 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\nroot         1  2.5  0.1  12345  6789 ?        Ss   Jan01   1:23 /sbin/init',
      dockerStats: '{"Name":"nginx","CPUPerc":"1.5%","MemUsage":"50MiB / 512MiB"}',
      cores: '4',
    };
    const s = { ...defaults, ...overrides };
    return [s.cpu, s.mem, s.disk, s.uptime, s.docker, s.ps, s.dockerStats, s.cores].join('---SEPARATOR---');
  };

  it('parses all sections correctly', () => {
    const output = makeSections();
    const m = parseSystemMetrics(output);

    // CPU
    assert.ok(m.cpu.raw.includes('95.5 id'));

    // Memory
    assert.equal(m.memory.total, 7963);
    assert.equal(m.memory.used, 4123);
    assert.equal(m.memory.free, 1234);

    // Disk
    assert.equal(m.disk.size, '50G');
    assert.equal(m.disk.used, '25G');
    assert.equal(m.disk.percentUsed, '53%');

    // Uptime
    assert.ok(m.uptime.raw.includes('up 5 days'));

    // Docker
    assert.equal(m.docker.length, 2);
    assert.equal(m.docker[0].Names, 'nginx');

    // Top processes
    assert.equal(m.topProcesses.length, 1);
    assert.equal(m.topProcesses[0].cpu, 2.5);

    // Docker stats
    assert.equal(m.dockerStats.length, 1);
    assert.equal(m.dockerStats[0].Name, 'nginx');

    // CPU cores
    assert.equal(m.cpuCores, 4);
  });

  it('throws for fewer than 5 sections', () => {
    assert.throws(() => parseSystemMetrics('a---SEPARATOR---b---SEPARATOR---c'), /Invalid metrics output format/);
  });

  it('handles empty docker section', () => {
    const output = makeSections({ docker: '' });
    const m = parseSystemMetrics(output);
    assert.deepEqual(m.docker, []);
  });

  it('skips malformed docker JSON', () => {
    const output = makeSections({ docker: 'not-json\n{"ID":"ok","Names":"valid"}' });
    const m = parseSystemMetrics(output);
    assert.equal(m.docker.length, 1);
    assert.equal(m.docker[0].Names, 'valid');
  });

  it('handles only 5 sections (no ps/dockerStats/cores)', () => {
    const output = [
      '%Cpu(s):  3.0 us,  1.0 sy,  0.0 ni, 95.5 id,  0.5 wa',
      '              total        used        free\nMem:           7963        4123        1234',
      'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   25G   23G  53% /',
      '10:30:01 up 5 days,  3:42,  2 users,  load average: 0.15, 0.30, 0.45',
      '{"ID":"abc","Names":"nginx","State":"running"}',
    ].join('---SEPARATOR---');
    const m = parseSystemMetrics(output);
    assert.ok(m.cpu.raw);
    assert.equal(m.memory.total, 7963);
    assert.equal(m.docker.length, 1);
    // Optional sections should be undefined or empty
    assert.equal(m.topProcesses, undefined);
    assert.equal(m.dockerStats, undefined);
    assert.equal(m.cpuCores, undefined);
  });

  it('handles memory section without Mem: line', () => {
    const output = makeSections({ mem: 'something else\nno mem line here' });
    const m = parseSystemMetrics(output);
    assert.equal(m.memory, undefined);
  });

  it('parses high precision cpu percent', () => {
    const result = parseCpuPercent({ raw: '%Cpu(s): 99.5 us,  0.0 sy,  0.0 ni,  0.5 id' });
    assert.equal(result, 99.5);
  });
});

describe('parseDockerPsOutput', () => {
  it('parses JSON lines', () => {
    const output = '{"ID":"abc","Names":"web"}\n{"ID":"def","Names":"db"}';
    const result = parseDockerPsOutput(output);
    assert.equal(result.length, 2);
    assert.equal(result[0].Names, 'web');
    assert.equal(result[1].Names, 'db');
  });

  it('skips non-JSON lines', () => {
    const output = 'not json\n{"ID":"abc","Names":"web"}';
    const result = parseDockerPsOutput(output);
    assert.equal(result.length, 1);
  });

  it('handles empty output', () => {
    const result = parseDockerPsOutput('');
    assert.deepEqual(result, []);
  });
});

describe('parseLogs', () => {
  it('returns last 100 lines', () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`);
    const result = parseLogs(lines.join('\n'));
    assert.equal(result.length, 100);
    assert.equal(result[0], 'line 50');
    assert.equal(result[99], 'line 149');
  });

  it('returns all lines when fewer than 100', () => {
    const result = parseLogs('a\nb\nc');
    assert.deepEqual(result, ['a', 'b', 'c']);
  });
});
