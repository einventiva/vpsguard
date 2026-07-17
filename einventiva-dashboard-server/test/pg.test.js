const { test, describe } = require('node:test');
const assert = require('node:assert');
const { deriveUserCandidates, cleanPgError } = require('../services/pg');

describe('deriveUserCandidates', () => {
  test('replica containers yield the app name', () => {
    assert.ok(deriveUserCandidates('pg-replica-hashtask').includes('hashtask'));
    assert.ok(deriveUserCandidates('pg-replica-saas').includes('saas'));
    assert.ok(deriveUserCandidates('pg-replica-einventickets').includes('einventickets'));
  });

  test('includes common _admin/_user suffix variants', () => {
    const candidates = deriveUserCandidates('pg-replica-hashtask');
    assert.ok(candidates.includes('hashtask_admin'));
    assert.ok(candidates.includes('hashtask_user'));
  });

  test('primary naming convention yields the app name', () => {
    assert.ok(deriveUserCandidates('hashtask-postgres').includes('hashtask'));
    assert.ok(deriveUserCandidates('saas-postgres').includes('saas'));
    assert.ok(deriveUserCandidates('litellm-db').includes('litellm'));
  });

  test('swarm task names are stripped of their suffix', () => {
    const candidates = deriveUserCandidates('hashtask-infra_postgres.1.pm5i97c94lwftsqkhs2magug7');
    assert.ok(candidates.includes('hashtask'));
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
    const raw = 'Command failed: ssh -o ControlMaster=auto -o ControlPath=/tmp/dshmux/x dashboard_infra "echo U0VMRUNU...base64... | base64 -d | docker exec -i pg-replica-hashtask psql -U postgres -d postgres -t -A"\npsql: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: FATAL: role "postgres" does not exist';
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
