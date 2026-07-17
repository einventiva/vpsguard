const { test, describe } = require('node:test');
const assert = require('node:assert');
const { deriveUserCandidates, cleanPgError } = require('../services/pg');

describe('deriveUserCandidates', () => {
  test('replica containers yield the app name', () => {
    assert.ok(deriveUserCandidates('pg-replica-shopdb').includes('shopdb'));
    assert.ok(deriveUserCandidates('pg-replica-crm').includes('crm'));
    assert.ok(deriveUserCandidates('pg-replica-ticketing').includes('ticketing'));
  });

  test('includes common _admin/_user suffix variants', () => {
    const candidates = deriveUserCandidates('pg-replica-shopdb');
    assert.ok(candidates.includes('shopdb_admin'));
    assert.ok(candidates.includes('shopdb_user'));
  });

  test('primary naming convention yields the app name', () => {
    assert.ok(deriveUserCandidates('shopdb-postgres').includes('shopdb'));
    assert.ok(deriveUserCandidates('crm-postgres').includes('crm'));
    assert.ok(deriveUserCandidates('llmproxy-db').includes('llmproxy'));
  });

  test('swarm task names are stripped of their suffix', () => {
    const candidates = deriveUserCandidates('shopdb-infra_postgres.1.pm5i97c94lwftsqkhs2magug7');
    assert.ok(candidates.includes('shopdb'));
    assert.ok(candidates.every(c => !c.includes('.')));
  });

  test('all candidates are shell-safe', () => {
    for (const name of ['pg-replica-a', 'weird$name;rm -rf', 'a.1.xyz']) {
      for (const c of deriveUserCandidates(name)) {
        assert.match(c, /^[a-zA-Z0-9_-]+$/);
      }
    }
  });

  test('no empty or identity candidates', () => {
    const candidates = deriveUserCandidates('postgres-164-dev');
    assert.ok(!candidates.includes(''));
    assert.ok(!candidates.includes('postgres-164-dev'));
  });
});

describe('cleanPgError', () => {
  test('extracts the psql error line from a full SSH failure', () => {
    const raw = 'Command failed: ssh -o ControlMaster=auto -o ControlPath=/tmp/dshmux/x server_alias "echo U0VMRUNU...base64... | base64 -d | docker exec -i pg-replica-shopdb psql -U postgres -d postgres -t -A"\npsql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL: role "postgres" does not exist';
    const clean = cleanPgError(raw);
    assert.ok(clean.startsWith('psql: error:'));
    assert.ok(clean.includes('role "postgres" does not exist'));
    assert.ok(!clean.includes('base64'));
  });

  test('falls back to a generic message on unrecognized errors', () => {
    assert.strictEqual(cleanPgError('Command failed: something opaque'), 'Failed to query PostgreSQL');
    assert.strictEqual(cleanPgError(''), 'Failed to query PostgreSQL');
    assert.strictEqual(cleanPgError(undefined), 'Failed to query PostgreSQL');
  });
});
