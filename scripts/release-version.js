const fs = require('fs');
const { execFileSync } = require('child_process');

const parse = (value) => {
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(value || '');
  return match ? match[1] : null;
};
const compare = (a, b) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
};

function releaseVersion({ publishedTag, requested, baseline, tags, releases, marker }) {
  if (publishedTag) {
    const version = parse(publishedTag);
    if (!version) throw new Error('Release tag must be vX.Y.Z or X.Y.Z');
    return { version, tag: publishedTag, create: false };
  }
  const previous = releases.find((release) => (release.body || '').includes(marker));
  if (previous) return { version: parse(previous.tag_name), tag: previous.tag_name, create: false };
  const latest = [baseline, ...tags.map(parse).filter(Boolean)].sort(compare).pop();
  const parts = latest.split('.').map(Number);
  parts[2] += 1;
  const version = requested ? parse(requested) : parts.join('.');
  if (!version || compare(version, latest) <= 0) throw new Error(`Version must be X.Y.Z and newer than ${latest}`);
  return { version, tag: `v${version}`, create: true };
}

if (require.main === module) {
  const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' }).trim();
  const marker = `<!-- release-run:${process.env.GITHUB_RUN_ID} -->`;
  const publishedTag = process.env.RELEASE_TAG;
  const releases = publishedTag ? [] : JSON.parse(run('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/releases`, '--paginate', '--slurp'])).flat();
  const result = releaseVersion({
    publishedTag, requested: process.env.REQUESTED_VERSION,
    baseline: require('../package.json').version,
    tags: run('git', ['tag', '--list']).split('\n'), releases, marker,
  });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${result.version}\ntag=${result.tag}\ncreate=${result.create}\n`);
  fs.writeFileSync('release-notes.md', `${marker}\n`);
  console.log(`${result.tag}${result.create ? ' (new release)' : ' (existing release)'}`);
}

module.exports = { releaseVersion };
