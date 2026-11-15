/** @jest-environment node */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { execFileSync, spawnSync } from 'child_process';

const script = resolve('platforms/tizen/package.sh');
let root;
let env;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tizen-sign-test-'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist/config.xml'), '<widget/>');
  mkdirSync(join(root, 'tizen-studio/tools/ide/bin'), { recursive: true });
  // Stop at the real CLI boundary, after certificate decoding and password validation.
  writeFileSync(join(root, 'tizen-studio/tools/ide/bin/tizen'), '#!/bin/bash\nprintf "%s\\n" "$@" > "$GITHUB_WORKSPACE/args"\nexit 42\n', { mode: 0o700 });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem'), '-subj', '/CN=Signing test', '-days', '1'], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', join(root, 'key.pem'), '-in', join(root, 'cert.pem'), '-out', join(root, 'test.p12'), '-passout', 'pass:test-password'], { stdio: 'ignore' });
  const cert = readFileSync(join(root, 'test.p12')).toString('base64');
  env = { ...process.env, GITHUB_WORKSPACE: root, RUNNER_TEMP: root, CERT_PASSWORD: 'test-password', CERT_AUTHOR_BASE64: cert, CERT_DISTRIBUTOR_BASE64: cert };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('registers both supplied certificates with their shared password', () => {
  const result = spawnSync('bash', [script, '0.1.0'], { env, encoding: 'utf8' });
  expect(result.status).toBe(42);
  expect(readFileSync(join(root, 'args'), 'utf8').trim().split('\n')).toEqual([
    'security-profiles', 'add', '-n', 'xtream', '-a', join(root, 'tizen-sign/author.p12'), '-p', 'test-password',
    '-d', join(root, 'tizen-sign/distributor.p12'), '-dp', 'test-password',
  ]);
});

test.each(['password', 'missing distributor', 'invalid distributor'])('rejects %s before invoking the Tizen SDK', (mode) => {
  if (mode === 'password') env.CERT_PASSWORD = 'wrong-password';
  if (mode === 'missing distributor') env.CERT_DISTRIBUTOR_BASE64 = '';
  if (mode === 'invalid distributor') env.CERT_DISTRIBUTOR_BASE64 = Buffer.from('invalid certificate').toString('base64');
  const result = spawnSync('bash', [script, '0.1.0'], { env, encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(existsSync(join(root, 'args'))).toBe(false);
  expect(result.stdout + result.stderr).not.toContain(env.CERT_PASSWORD);
});
