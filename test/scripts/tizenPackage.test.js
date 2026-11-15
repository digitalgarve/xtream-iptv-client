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
  writeFileSync(join(root, 'tizen-studio/tools/ide/bin/tizen'), '#!/bin/bash\nprintf "%s\\n" "$2" >> "$GITHUB_WORKSPACE/commands"\nprintf "%s\\n" "$@" > "$GITHUB_WORKSPACE/args"\nif [ "$2" = "remove" ]; then exit 0; fi\nexit 42\n', { mode: 0o700 });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(root, 'key.pem'), '-out', join(root, 'cert.pem'), '-subj', '/CN=Signing test', '-days', '1'], { stdio: 'ignore' });
  execFileSync('openssl', ['pkcs12', '-export', '-inkey', join(root, 'key.pem'), '-in', join(root, 'cert.pem'), '-out', join(root, 'test.p12'), '-passout', 'pass:test-password'], { stdio: 'ignore' });
  const cert = readFileSync(join(root, 'test.p12')).toString('base64');
  env = { ...process.env, GITHUB_WORKSPACE: root, RUNNER_TEMP: root, CERT_PASSWORD: 'test-password', CERT_AUTHOR_BASE64: cert, CERT_DISTRIBUTOR_BASE64: cert };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test.each([false, true])('registers supplied certificates even with a cached profile: %s', (cached) => {
  if (cached) {
    mkdirSync(join(root, 'tizen-studio-data/profile'), { recursive: true });
    writeFileSync(join(root, 'tizen-studio-data/.profile-xtream-added'), '');
    writeFileSync(join(root, 'tizen-studio-data/profile/profiles.xml'), '<profiles><profile name="xtream"><profileitem distributor="0" key="author" value="/old/tizencert.p12"/></profile></profiles>');
  }
  const result = spawnSync('bash', [script, '0.1.0'], { env, encoding: 'utf8' });
  expect(result.status).toBe(42);
  expect(readFileSync(join(root, 'commands'), 'utf8')).toBe('remove\nadd\n');
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


test.each([false, true])('legacy-encrypted certificates require the correct password (wrong: %s)', (wrong) => {
  execFileSync('openssl', ['pkcs12', '-export', '-legacy', '-inkey', join(root, 'key.pem'), '-in', join(root, 'cert.pem'), '-out', join(root, 'legacy.p12'), '-passout', 'pass:test-password'], { stdio: 'ignore' });
  const cert = readFileSync(join(root, 'legacy.p12')).toString('base64');
  env.CERT_AUTHOR_BASE64 = cert;
  env.CERT_DISTRIBUTOR_BASE64 = cert;
  if (wrong) env.CERT_PASSWORD = 'wrong-password';
  const result = spawnSync('bash', [script, '0.1.0'], { env, encoding: 'utf8' });
  expect(result.status).toBe(wrong ? 1 : 42);
  expect(existsSync(join(root, 'args'))).toBe(!wrong);
  expect(result.stdout + result.stderr).not.toContain(env.CERT_PASSWORD);
});
