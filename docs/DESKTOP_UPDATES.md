# Desktop release and automatic updates

Desktop 0.1.28 adds the signed macOS automatic updater. The app checks the stable GitHub release 20 seconds after launch and every 30 minutes. It downloads the complete update and waits for native Squirrel signature validation before showing an installation countdown. Downgrades and prereleases are disabled. The release feed has no percentage-based rollout limit.

A restart waits for local tasks and approvals, companion conversations/recording, terminal sessions, unsaved edits, drafts and workspace recovery writes. Both renderers report activity. After one minute without interaction, an eligible update has a 15-second countdown. Further interaction cancels the countdown. The recovery journal is flushed and activity checked again before quitting. A downloaded update also installs on an ordinary app quit. Remote account tasks continue on the server; they do not require this computer to stay open.

Builds before 0.1.28 only check for a release and show a download banner. They cannot be remotely converted into silent installers: users must install one new version. Offline users receive the release when they reconnect and launch Nalu. A source push alone does not update installed apps or publish installers.

The browser download page uses `https://github.com/Michberr2/nalu-desktop/releases/latest/download/Nalu-mac.dmg`. Publishing a complete latest release updates that link. Include all of these assets in the same release:

- `Nalu-mac.dmg`, the existing browser download filename.
- `Nalu-<version>-mac-universal.zip` and its blockmap.
- `latest-mac.yml`, containing the ZIP's exact SHA-512 and size.

Build with DMG and ZIP targets together. A directory-only electron-builder build omits `Contents/Resources/app-update.yml`; it must not be installed as an updater-enabled release. `scripts/verify-review-package.mjs` now checks that configuration as well as built bytes.

Release sequence:

1. Build and sign the universal app with the complete DMG and ZIP targets. Test the packaged runtime and `tests/desktop-updater.integration.mjs` in isolated profiles. Install and verify locally first.
2. Submit to Apple using a saved notarization profile or App Store Connect API key. Staple and verify the accepted ticket. Recreate DMG/ZIP from the stapled app and regenerate their metadata; checksums change when tickets are stapled.
3. Verify the final assets with `node scripts/verify-release-assets.mjs <release-directory> --public`. Stage only reviewed, authorized source changes; tag the actual release source, never a stale commit.
4. Upload the complete asset set to a draft GitHub release. Publish it as latest only after every artifact has uploaded successfully. The download-page macOS requirement changes to 13+ with this release.
5. Verify both public download domains, the final redirect, GitHub's asset hashes, the latest-mac feed and a real installed client's check. Record local and public verification separately.

Apple accepted the 0.1.28 credential verification submission on September 13, 2026. Each subsequent release still needs its own accepted submission and ticket verification. Never publish the full review-build directory: test screenshots and local diagnostics can contain private desktop content.

Desktop 0.1.29 sends session instructions through the shared API's `systemPrompt` field, explicitly requests the routing decision in the classifier input, and falls back to conversation if that optional decision is malformed. Routing does not grant tool approval. Routing disables research for that one request; the task itself uses the user's saved model settings. Account checks distinguish an unavailable service from an expired session and preserve cached accounts during transient failures. This does not restore a database that is refusing connections because of its provider quota.
