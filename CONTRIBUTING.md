# Contribution Guideline

## Finding Issues to Work on

If you are interested in contributing to ObserveRTC 
and are looking for issues to work on, take a look at the issues  
tagged with [help wanted](https://github.com/ObserveRTC/client-monitor-js/labels/help%20wanted).

## Running Tests

To run the tests use `yarn test`.

## Building Documentation

The documentation sources are located at `docs/`.

## Working on the code base

The source is written in typescript. 

## Releasing

Publishing is handled by `.github/workflows/publish.yaml` on push:

| Branch    | Version                | dist-tags moved                          |
| --------- | ---------------------- | ---------------------------------------- |
| `master`  | `package.json` as-is   | `latest`                                 |
| `develop` | `X.Y.Z-rc.<run_number>`| `next`, plus the per-line `develop-XYZ-rc`|

`package.json` is only bumped in the workflow (never committed back), so the RC patch is derived from the last released version: a base of `4.7.0` publishes `4.7.1-rc.<N>`.

Two constraints on the RC identifier, both load-bearing — please do not "simplify" them away:

1. **It must increase monotonically.** Semver compares prerelease identifiers as ASCII strings, so an identifier with no chronological order (this used to be the git short SHA) makes the highest RC random, and consumers on a caret range silently stick to an arbitrary older build. `github.run_number` is strictly increasing, and semver compares all-numeric identifiers numerically, so `rc.9 < rc.10` as intended.
2. **`rc` specifically.** The first publish of any new scheme has to sort *above* the highest already-published RC (`4.7.1-ee698a7.0`) or consumers with existing ranges never see it. `'r' > 'e'`, so `rc` works; `dev`, `alpha` and `beta` would all sort below it and be invisible. Verify any change with node-semver rather than by eye.

Do not put the SHA in semver build metadata (`4.7.1-rc.5+28d5bf5`): semver treats versions differing only in build metadata as equal and npm rejects the second publish as a duplicate. The commit is already recorded in the published `gitHead` field.

Note that `npm` performs its OIDC token exchange only inside `npm publish` and keeps the minted token in memory, so any additional registry write in the job (moving the per-line tag) mints its own token via `.github/scripts/npm-oidc-token.mjs`. That step is best-effort: if it fails, the published version and `next` are still correct and only the legacy per-line tag lags.

## Creating a pull request

Once you are ready with your changes:

- Commit your changes in your local branch
- Push your changes to your remote branch on GitHub
- Send us a [pull request](https://help.github.com/articles/creating-a-pull-request)


