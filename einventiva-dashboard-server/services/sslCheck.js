const { executeSSHCommand, filterWarnings } = require('./ssh');

// certbot certificates output (the only lines we keep):
//   Certificate Name: example.com
//     Expiry Date: 2026-09-10 12:00:00+00:00 (VALID: 55 days)
const NAME_RE = /Certificate Name:\s*(.+)/;
const EXPIRY_RE = /Expiry Date:\s*([0-9-]+\s[0-9:]+(?:[+-][0-9:]+)?)/;

function parseCertbotOutput(raw, now = Date.now()) {
  const certs = [];
  let currentName = null;

  for (const line of filterWarnings(raw).split('\n')) {
    const nameMatch = line.match(NAME_RE);
    if (nameMatch) {
      currentName = nameMatch[1].trim();
      continue;
    }
    const expiryMatch = line.match(EXPIRY_RE);
    if (expiryMatch && currentName) {
      const expiry = new Date(expiryMatch[1].replace(' ', 'T')).getTime();
      if (!isNaN(expiry)) {
        certs.push({
          name: currentName,
          expiry: new Date(expiry).toISOString(),
          daysLeft: Math.floor((expiry - now) / 86400e3),
        });
      }
      currentName = null;
    }
  }

  return certs;
}

// Requires passwordless sudo (certbot config is root-only). Without it
// the command yields nothing and we report unknown — no false alarms,
// same pattern as cron watch.
async function fetchCertificates(alias) {
  const script = "sudo -n certbot certificates 2>/dev/null | grep -E 'Certificate Name:|Expiry Date:'";
  const b64 = Buffer.from(script).toString('base64');
  const raw = await executeSSHCommand(alias, `echo ${b64} | base64 -d | bash`, 20000).catch(() => '');
  return parseCertbotOutput(raw);
}

module.exports = { parseCertbotOutput, fetchCertificates };
