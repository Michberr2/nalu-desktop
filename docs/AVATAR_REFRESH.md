# Avatar refresh, 0.1.32

The original particle wolf artwork from Nalu-Interactive-Avatar.html now anchors Home, Chats, Workspace, AutoPilot, Team and Settings. The default appearance uses paper, charcoal and gold; Focus, Pastel and Scenic remain selectable. Chat drafts, open files, terminals, task approvals and saved settings keep their existing behavior when changing views.

The desktop companion is a compact head in a transparent 164-pixel window. It floats within the chosen display work area, stops on hover, can be dragged, and expands for chat, live tasks and voice. The menu retains Find, Hide, resting and display selection. Demo motion controls are absent from Home and feature headers. Desktop and mobile icons use the same original PNG.

The canonical renderer and artwork live in train/shared/nalu-avatar. Run train/scripts/sync-nalu-avatar.mjs after renderer changes, and scripts/build-avatar-icons.py when repackaging icons. No shared API or CLI changes are part of this refresh.

The signed-in websites use the same design, with the interactive avatar in chat. Public full-body Nalu and the friends playground remain intact. UI fixtures do not establish live model, calling or microphone quality.

Release checks cover exact packaged bytes, avatar views, real editor/terminal/browser interactions, panel resizing, companion lifecycle, account outage handling, startup recovery and signed automatic installation. Developer ID signing, Apple notarization, local installation and public publication are tracked separately in review-build/release-0.1.32.
