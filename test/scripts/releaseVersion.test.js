const { releaseVersion } = require('../../scripts/release-version.js');

const input = { baseline: '2.1.5', tags: [], releases: [], marker: '<!-- release-run:123 -->' };
test('manual release increments the highest stable tag or package version numerically', () => {
  expect(releaseVersion(input)).toEqual({ version: '2.1.6', tag: 'v2.1.6', create: true });
  expect(releaseVersion({ ...input, tags: ['v2.1.9', '2.1.10', 'v3.0.0-beta'] }).tag).toBe('v2.1.11');
});
test('explicit versions must be valid and newer than existing versions', () => {
  expect(releaseVersion({ ...input, requested: '2.2.0' }).tag).toBe('v2.2.0');
  for (const requested of ['2.1.5', 'v2.0.0', '2.2.0-rc', '2.01.6', 'x\ntag=bad']) {
    expect(() => releaseVersion({ ...input, requested })).toThrow();
  }
});
test('rerunning a workflow reuses its release instead of publishing another version', () => {
  expect(releaseVersion({ ...input, tags: ['v2.1.6'], releases: [{ tag_name: 'v2.1.6', body: input.marker }] })).toEqual({ version: '2.1.6', tag: 'v2.1.6', create: false });
});
test('published-release trigger keeps the exact tag spelling and does not create a release', () => {
  expect(releaseVersion({ ...input, publishedTag: '2.1.6' })).toEqual({ version: '2.1.6', tag: '2.1.6', create: false });
  expect(() => releaseVersion({ ...input, publishedTag: 'v2.1.6-beta' })).toThrow();
});
