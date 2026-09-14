# Desktop 0.1.27: painted workspace, companion and Chrome

The workspace has a bundled pastel landscape painting in peach, cream, sand and blue, with neutral cream surfaces and charcoal text. Purple and green interface accents and painting colors were removed at the owner’s request. New profiles default to the painted appearance; existing Focus/Scenic selections remain saved. The editor and diff view use a matching readable light palette, and the native terminal retains its established contrast.

Nalu keeps her original charcoal face and model. The proposed blue eyes were removed at the owner's request before the final build.

The ball stays visible when she is resting. Idle walks can go fully beyond the screen edge and return before she lies down. The ball continues to roll beyond the viewport, where Nalu can approach from its far side and nudge it back in. Find Nalu brings both back immediately. Pausing, conversation and reduced motion interrupt wandering. Play uses mouth/paw contact, velocity, gravity, floor bounce and friction. Digging alternates forward paw placement and backward ground scrapes; each scrape emits dirt from the paw contact point. Find Nalu, available in Settings and the tray, centers her on the display nearest the pointer and opens the thought cloud. Pressing Nalu opens her conversation; the close button dismisses it.

The cloud fits its header, scroll area and composer inside the drawn boundary. Chat falls back to conversation when the mode classifier emits an invalid response; network errors and Stop remain errors/cancellations. Live tasks combines local workspace activity with active account tasks from the existing shared task feed. The feed polls every four seconds while open and twelve seconds while closed. It requests the API's maximum 500 recent tasks, so an older active task outside that server response cannot be shown. Account changes clear the previous account's feed. No shared API or CLI contract changed.

PC mode now controls the installed Google Chrome through a private DevTools pipe and shows a live mini preview. Clicking the preview maps the displayed image into Chrome's CSS viewport, including letterboxing. Observed selectors must identify a unique visible, enabled, uncovered click target. Fill replaces text in the selected field with trusted Chrome input. Scroll, named keys, page inspection, screenshot history, approval and Stop remain available. Stop invalidates pending browser input before dispatch; already dispatched input cannot be undone.

Chrome uses a persistent profile under Nalu's application data. It does not open or copy the owner's normal Chrome profiles; sign in in the Nalu Chrome window when needed. Native Mac screen control remains subject to existing Accessibility and Screen Recording permissions. This release has not established Codex feature parity or equal AI speed. Current direct Chrome control targets one tab; unrelated tabs and cross-origin frames are not exposed as separate agent targets. Other desktop platforms retain the prior Electron browser tools and have not received runtime acceptance for the Chrome preview.

The Chrome 136+ profile requirement is documented by [Chrome](https://developer.chrome.com/blog/remote-debugging-port); trusted input and screencast behavior use the official [Input](https://chromedevtools.github.io/devtools-protocol/tot/Input/) and [Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/) protocols.

## Verification

- 125 desktop unit checks passed, including routing fallback, cancellation and ball/digging motion.
- Actual installed Chrome 152 passed isolated-profile navigation, unique/disabled/covered target checks, Unicode and empty-field replacement, Enter submission, trusted events, live frames, window resize, viewport-coordinate clicks, scrolling, cancellation, isolated DOM inspection and reopening after close.
- Fixture timing: launch plus navigation 7,926 ms; Unicode fill 480 ms; click 34 ms. These are individual local control measurements, not AI response benchmarks.
- The actual companion renderer passed physical treat catch/eat, circle then lie down, ball contacts, dirt emission, cloud boundary containment, chat with the workspace closed, local/account task status, malformed classifier fallback, Find Nalu, Stop and Hide.
- Actual renderer acceptance also shrank the viewport so the ball was outside it, observed the whole wolf exit to fetch it, and verified both returned. Pure motion checks cover both edges and narrow/wide displays.
- Painted workspace, Settings and chat views were rendered and inspected at 1360×900, 1100×760 and 900×600; switching appearance persists and leaves drafts intact.
- Cross-repository consistency passed with all three checkouts present. Production backend and CLI were not changed by this update.

The signed universal package, byte verification, packaged runtime results and local installation receipt belong in `review-build/release-0.1.27/`. Source, signed artifacts, installed runtime and public release each require their own evidence. Apple notarization remains pending the configured notarytool credential profile; the public download has not yet been replaced by this version.

Desktop 0.1.28 retains these companion and Chrome behaviors, fixes narrow sidebar spacing, and adds the signed automatic updater. The completed release directory is `review-build/release-0.1.28-complete/`; see `docs/DESKTOP_UPDATES.md` for release and updater verification.
