import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// 1. Read manifest.json
const manifestPath = path.resolve('manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
const tag = version;

console.log(`\n🚀 Releasing SeeLearn v${version} locally (100% Free, No GitHub Actions)...\n`);

// 2. Validate versions match
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
if (pkg.version !== version) {
  console.error(`❌ Version mismatch: manifest.json has ${version}, but package.json has ${pkg.version}`);
  process.exit(1);
}

const versions = JSON.parse(fs.readFileSync(path.resolve('versions.json'), 'utf8'));
if (!versions[version]) {
  console.error(`❌ versions.json does not contain mapping for ${version}`);
  process.exit(1);
}

// 3. Build & test
console.log('📦 Running build and test verification...');
execSync('npm run verify', { stdio: 'inherit' });

// 4. Extract release notes from CHANGELOG.md
let notes = `Release ${version}`;
try {
  const changelog = fs.readFileSync(path.resolve('CHANGELOG.md'), 'utf8');
  const escapedVersion = version.replace(/\./g, '\\.');
  const sectionRegex = new RegExp(`## \\[[vV]?${escapedVersion}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = changelog.match(sectionRegex);
  if (match && match[1].trim()) {
    notes = match[1].trim();
  }
} catch (e) {
  console.warn('⚠️ Could not extract changelog section, using default notes.');
}

// 5. Get GitHub token from env or macOS osxkeychain
let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  try {
    const creds = execSync('printf "protocol=https\\nhost=github.com\\n" | git credential fill 2>/dev/null', {
      encoding: 'utf8',
    });
    const match = creds.match(/^password=(.+)$/m);
    if (match) {
      token = match[1].trim();
    }
  } catch (e) {
    // ignore
  }
}

if (!token) {
  console.error('❌ No GitHub token found. Please set GITHUB_TOKEN or authenticate git with github.com.');
  process.exit(1);
}

// 6. Get repo owner & name from git remote
const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
const repoMatch = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
if (!repoMatch) {
  console.error(`❌ Could not parse owner/repo from remote URL: ${remoteUrl}`);
  process.exit(1);
}
const [, owner, repo] = repoMatch;

// 7. Call GitHub API to create or get release
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'seelearn-local-releaser',
};

async function run() {
  console.log(`🌐 Connecting to GitHub API for ${owner}/${repo}...`);

  // Check if release already exists
  let release = null;
  const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
    headers,
  });
  if (getRes.status === 200) {
    release = await getRes.json();
    console.log(`ℹ️ Existing release found for tag ${tag} (id: ${release.id}). Updating assets...`);
  } else {
    // Create new release
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: version,
        body: notes,
        draft: false,
        prerelease: false,
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`❌ Failed to create release: HTTP ${createRes.status}\n${errText}`);
      process.exit(1);
    }
    release = await createRes.json();
    console.log(`✅ Created GitHub release for ${tag} (id: ${release.id})`);
  }

  // 8. Upload assets
  const filesToUpload = [
    { name: 'main.js', contentType: 'application/javascript' },
    { name: 'manifest.json', contentType: 'application/json' },
    { name: 'styles.css', contentType: 'text/css' },
  ];

  for (const file of filesToUpload) {
    const filePath = path.resolve(file.name);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File ${file.name} not found!`);
      process.exit(1);
    }
    const fileData = fs.readFileSync(filePath);

    // Delete existing asset if it exists
    const existingAsset = release.assets?.find((a) => a.name === file.name);
    if (existingAsset) {
      console.log(`🔄 Deleting existing asset ${file.name}...`);
      await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existingAsset.id}`, {
        method: 'DELETE',
        headers,
      });
    }

    console.log(`⬆️ Uploading ${file.name} (${fileData.length} bytes)...`);
    const uploadRes = await fetch(
      `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(
        file.name
      )}`,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': file.contentType,
          'Content-Length': String(fileData.length),
        },
        body: fileData,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error(`❌ Failed to upload ${file.name}: HTTP ${uploadRes.status}\n${errText}`);
      process.exit(1);
    }
    console.log(`   Uploaded ${file.name} successfully.`);
  }

  console.log(`\n🎉 Success! Release v${version} published at:`);
  console.log(`   ${release.html_url}\n`);
}

run().catch((err) => {
  console.error('❌ Release failed:', err);
  process.exit(1);
});
