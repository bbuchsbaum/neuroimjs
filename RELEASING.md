# Releasing neuroimjs

neuroimjs is published to npm only by the `Release` workflow
(`.github/workflows/release.yml`), using npm Trusted Publishing (OIDC). No npm
token exists in the repository or on a maintainer machine, and every version
carries a signed SLSA provenance attestation linking it to the tag and workflow
run that built it.

Publishing a GitHub release is the **only** publish trigger. Do not run
`npm publish` locally.

## Release flow

1. **Bump the version in a pull request.** On a branch, set the version and
   date the changelog:

   ```bash
   npm version 0.6.0 --no-git-tag-version   # updates package.json and package-lock.json
   ```

   Move the **Unreleased** entries in `CHANGELOG.md` under `## 0.6.0 - YYYY-MM-DD`.
   Open the PR and merge it once the `Quality` workflow is green.

2. **Tag and publish a GitHub release from the merged commit.**

   ```bash
   git switch main && git pull
   gh release create v0.6.0 --target main --title v0.6.0 --notes-file <notes>
   ```

   The tag must be `v` followed by the exact `package.json` version. Versions
   with a prerelease suffix (`0.6.0-rc.1`) are published under the `next`
   dist-tag, and their GitHub release must be marked as a pre-release
   (`--prerelease`); a stable version must not be. The workflow fails if the
   two disagree.

   A stable version must be newer than the current `latest` on npm. The
   workflow refuses to move `latest` backwards, so a backport to an older
   line (say 0.5.1 after 0.6.0) cannot go through it; see
   [Backports](#backports).

3. **The workflow does the rest:**

   | Job | What it does |
   |-----|--------------|
   | Build and gate | Checks out the release commit, fails unless tag = `v` + `package.json` version, the pre-release flag matches the version, and a stable version is newer than `latest`; then `npm ci`, `npm run verify:release`, packs the tarball and stores it as the `npm-tarball` artifact. |
   | Publish to npm | Runs in the `npm` environment; installs a pinned npm 11 and runs `npm publish <tarball> --provenance --access public` with an OIDC token (`id-token: write`). |
   | Verify published package | Downloads `neuroimjs@<version>` from the registry and requires it to be byte-identical to the CI tarball (`dist.integrity`), with the same files, modes and per-file SHA-256, and an SLSA provenance attestation whose subject digest, repository and workflow path match (`scripts/verify-published.mjs`). |

   The release gate runs once, as an explicit step. `prepublishOnly` would run
   it a second time, so pack and publish use `--ignore-scripts`; the tarball
   that passed the gate is the one published. All actions are pinned to full
   commit SHAs; update them deliberately.

4. **Confirm** the package page shows the provenance badge:
   <https://www.npmjs.com/package/neuroimjs?activeTab=versions>.

## One-time setup

### npmjs.com (package owner)

1. Sign in to npmjs.com as an owner of `neuroimjs`, open the package, then
   **Settings → Trusted Publisher → GitHub Actions**, and enter:

   | Field | Value |
   |-------|-------|
   | Organization or user | `bbuchsbaum` |
   | Repository | `neuroimjs` |
   | Workflow filename | `release.yml` (file name only, not the path) |
   | Environment name | `npm` |

   Under the allowed actions, enable **`npm publish`**. Trusted publisher
   configurations created after 3 September 2026 allow only `npm stage publish`
   unless direct publishing is selected, and this workflow publishes directly.
   The dist-tag permission is not needed: the dist-tag is set by the publish
   itself.

2. After the first release publishes successfully through the workflow, go to
   **Settings → Publishing access**, select **Require two-factor
   authentication and disallow tokens**, and revoke any remaining npm access
   tokens under your account's **Access Tokens** page. Trusted publishing is
   unaffected by that setting.

### GitHub (repository admin)

- The `npm` environment is created automatically the first time the publish
  job runs. To restrict it in advance, create it under **Settings →
  Environments → New environment** named `npm`, and under **Deployment branches
  and tags** allow only tags matching `v*`. Adding yourself as a required
  reviewer makes every publish wait for a manual approval.
- No secrets are needed. Do not add an `NPM_TOKEN`.

Requirements that are already met and must stay that way: the repository is
public (npm does not generate provenance for private repositories),
`package.json` `repository.url` is `https://github.com/bbuchsbaum/neuroimjs.git`
(it must match the publishing repository), the job runs on a GitHub-hosted
runner, and the workflow installs npm 11 (trusted publishing needs npm ≥ 11.5.1
and Node ≥ 22.14.0).

## Dry run

**Actions → Release → Run workflow**, with `ref` set to a branch (for example
`main`) or a tag. The manual run performs the same build, version check,
release gate and pack, then runs `npm publish --dry-run`; it never publishes
and never requests an OIDC token. Download the `npm-tarball` artifact from the
run to inspect exactly what would be published.

From the command line:

```bash
gh workflow run release.yml -f ref=main
```

Locally, the equivalent is `npm run verify:release && npm pack --dry-run --ignore-scripts`.

## Verifying a published version

`scripts/verify-published.mjs` compares the registry tarball with one packed
from source and checks for a provenance attestation:

```bash
git switch --detach v0.6.0
npm ci && npm run build && npm run build:vite
node scripts/verify-published.mjs 0.6.0 --require-provenance
```

Options (see `--help`): `--local-tarball <file>` compares against an existing
tarball and then also requires byte-identical `dist.integrity`; `--pack-dir
<dir>` packs another checkout (use it to check tags that predate the script);
`--published-tarball <file>` compares two local files without contacting the
registry; `--expected-repo` and `--expected-workflow` change what the
provenance must name; `--retries`/`--retry-delay` retry registry lookups.
Exit status 0 means all checks passed, 1 a check failed, 2 an error.

The provenance check reads the SLSA statement inside the attestation; it does
not verify the Sigstore signature. For that, install the package in a project
and run `npm audit signatures`.

Releases up to and including 0.5.0 were published by hand and have no
provenance attestation.

## When something fails

**The gate or version check fails** (nothing was published). Fix the problem
in a pull request (a wrong pre-release checkbox needs no code change).
Delete the release and the tag (`gh release delete v0.6.0
--cleanup-tag`), then create the release again from the fixed commit. If the
fix changes nothing but the workflow environment (for example a flaky
network step), re-run the failed jobs from the Actions page instead.

**The publish job fails** (nothing was published). An `E404`/`ENEEDAUTH`/
`E403` from `npm publish` almost always means the Trusted Publisher entry does
not match: check the owner, repository, workflow file name, environment name
and that `npm publish` is an allowed action. Correct it on npmjs.com, then use
**Re-run failed jobs** on the same workflow run; it reuses the gated tarball.
Before re-running, confirm with `npm view neuroimjs@0.6.0 version` that the
version really is absent; npm can time out after accepting a publish.

**The version is published but verification fails.** npm versions are
immutable, so the same version cannot be published again.

- If the log shows the download or attestation lookup timing out, the
  registry was slow to propagate: re-run the verify job.
- If files differ or provenance is missing, investigate with
  `node scripts/verify-published.mjs <version>` locally. If the published
  package is wrong, deprecate it
  (`npm deprecate neuroimjs@0.6.0 "Broken release, use 0.6.1"`), and release a
  patch version through the normal flow. If it went out under the wrong
  dist-tag, move the tag with `npm dist-tag add neuroimjs@<good> latest` (this
  needs a logged-in owner with 2FA). Unpublishing is a last resort; npm allows
  it only within 72 hours and blocks reuse of the version number.

## Backports

The workflow only publishes to `latest` (stable versions newer than the
current `latest`) and `next` (prereleases). To release a fix on an older line,
cut it from a branch, then publish it by hand under its own dist-tag from a
clean checkout of the tag, logged in with 2FA:

```bash
npm ci && npm run verify:release
npm publish --ignore-scripts --access public --tag v0.5-latest
```

This needs an owner logged in with `npm login`; with "Require two-factor
authentication and disallow tokens" set, an interactive publish still works and
prompts for a one-time password (or pass `--otp <code>`). A manual publish has
no provenance attestation.

