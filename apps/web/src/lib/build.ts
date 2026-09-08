/**
 * What this build is, and where it came from.
 *
 * Injected by Vite from the root `package.json` so a release cannot ship a
 * stale version number.
 */
export const VERSION: string = __MASAX_VERSION__;
export const REPOSITORY: string = __MASAX_REPOSITORY__;

/** The release notes for exactly this version. */
export const releaseUrl = (version: string = VERSION): string =>
  `${REPOSITORY}/releases/tag/v${version}`;
