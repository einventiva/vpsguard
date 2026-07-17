const { test, describe } = require('node:test');
const assert = require('node:assert');
const { parseCertbotOutput } = require('../services/sslCheck');

// Fixed "now": 2026-07-16T12:00:00Z
const NOW = Date.parse('2026-07-16T12:00:00Z');

const CERTBOT_OUTPUT = `
Saving debug log to /var/log/letsencrypt/letsencrypt.log

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
Found the following certs:
  Certificate Name: example.com
    Serial Number: 4a5b
    Domains: example.com www.example.com
    Expiry Date: 2026-09-10 12:00:00+00:00 (VALID: 56 days)
  Certificate Name: api.example.com
    Domains: api.example.com
    Expiry Date: 2026-07-20 08:30:00+00:00 (VALID: 3 days)
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
`;

describe('parseCertbotOutput', () => {
  test('parses names and computes days left', () => {
    const certs = parseCertbotOutput(CERTBOT_OUTPUT, NOW);
    assert.strictEqual(certs.length, 2);

    const main = certs.find(c => c.name === 'example.com');
    assert.strictEqual(main.daysLeft, 56);

    const api = certs.find(c => c.name === 'api.example.com');
    assert.strictEqual(api.daysLeft, 3);
  });

  test('grep-filtered output (only Name/Expiry lines) parses the same', () => {
    const filtered = CERTBOT_OUTPUT.split('\n')
      .filter(l => l.includes('Certificate Name:') || l.includes('Expiry Date:'))
      .join('\n');
    assert.strictEqual(parseCertbotOutput(filtered, NOW).length, 2);
  });

  test('expired cert yields negative days', () => {
    const raw = 'Certificate Name: old.example.com\nExpiry Date: 2026-07-10 00:00:00+00:00 (INVALID: EXPIRED)';
    const certs = parseCertbotOutput(raw, NOW);
    assert.strictEqual(certs.length, 1);
    assert.ok(certs[0].daysLeft < 0);
  });

  test('empty or garbage output yields no certs', () => {
    assert.deepStrictEqual(parseCertbotOutput('', NOW), []);
    assert.deepStrictEqual(parseCertbotOutput('sudo: a password is required', NOW), []);
    assert.deepStrictEqual(parseCertbotOutput('No certificates found.', NOW), []);
  });

  test('name without expiry is skipped', () => {
    const raw = 'Certificate Name: broken.example.com\nSome other line';
    assert.deepStrictEqual(parseCertbotOutput(raw, NOW), []);
  });
});
