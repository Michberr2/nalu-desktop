# Desktop experience, 0.1.25

The workspace now starts with three task paths: build an idea, work on existing code, and handle everyday work. Auto interprets the task using the existing Nalu reasoning API, selects an appropriate tool mode, and asks for clarification when needed. Manual Chat, Agent, PC, Edit and Terminal remain available. Tool approvals, Stop, edit previews and separate drafts are preserved.

A pastel painting with neutral cream panels is the default for new profiles. Focus and Scenic remain available in Settings, and existing appearance choices are preserved. A single header provides Workspace, Chats, project selection, command search, Activity, Team and account access. Files, Search and Changes use labeled navigation. Editor, terminal and assistant adapt to narrower windows; Chats stays mounted so switching views preserves its draft. Assistant replies and chats render structured text and copyable code.

## Desktop Nalu

The companion uses the original wolf geometry and colors from `train/client/src/components/NaluChase.tsx`, including its mouth contour. Her resting animation walks two circles, lowers the torso and folds the legs into a simple lying position. Her original face and silhouette are preserved. Working switches between the blue ball and digging. Treats follow a projectile path and are caught at the rendered mouth before being eaten.

Click Nalu to open a white comic thought bubble. Its header, scrolling message area, composer and footer fit within the actual cloud outline. It displays current workspace task/status updates, approval requests and the latest result. These are activity reports from the workspace, not an independently running background task or a private model reasoning transcript.

Typing or pressing the microphone starts a companion conversation. Microphone access is requested only on that button; recording stops after one minute or a second press. Stop, closing the bubble and account changes cancel pending voice activity. Tasks requiring local tools are prepared in Auto in the workspace and require Send before execution. Conversational replies can be spoken; voice can be muted.

Closing the workspace hides its existing window and leaves the companion and current work alive. Nalu can reopen it. Quit exits the whole app. Settings and the menu bar support hiding Nalu, resting and optional launch at login; the menu also selects a display. The companion has a separate sandboxed preload without filesystem or shell access. Transparent space passes mouse events through to the desktop.

## Verification scope

`npm run test:ide` passes 120 tests. `node scripts/check-nalu-sync.mjs` checks all three sibling repositories, including unchanged published CLI 1.11.4. No shared API contract or mobile implementation was changed for this desktop presentation work.

`NALU_DESIGN_TEST=1 NALU_COMPANION_TEST=1 node tests/mode-controls.mjs <packaged executable>` checks the actual app with deterministic AI replies, real local files, approved shell execution and local browser actions. It covers Auto routing and failure/Stop behavior, the five manual modes, responsive navigation, retained drafts, dialogs, shared chat-save requests, companion activity, treats, resting and workspace close/reopen. The companion check tests the content rectangles against the SVG cloud fill to catch the reported overflow.

`tests/signed-app-startup.mjs` checks the distribution executable in an isolated profile, including editor/PTY/CLI startup and forced-exit recovery. Package and signature verification scripts bind runtime evidence to the built bytes.

AI fixtures do not establish live model quality. Physical microphone recording, production speech delivery and Windows/Linux runtime behavior need separate verification. Developer ID signing is distinct from notarization; this local review build is not a notarized public release. The redesign has not been evaluated in a comparative usability study against Codex.
