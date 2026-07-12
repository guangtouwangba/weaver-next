---
name: weaver-image-edit
description: Turn a user-provided annotation screenshot (arrows, 批注 notes marking an image) into a revised AI image and place the revision BESIDE the original on the Weaver canvas without moving, hiding, or overwriting the original. Use when the user supplies a marked-up screenshot and asks to apply the changes.
---

# Weaver Image Edit

Apply the edits marked in a user-provided screenshot and place the revised image next to the original.

## Preconditions

Native Weaver widget open. Requires a host image model (Codex, or a configured image API). The user provides the screenshot(s); do not auto-capture or scan the whole canvas to infer intent.

## Workflow

1. Read the user-provided screenshot(s). Treat each as the authoritative brief for one output image unless told otherwise; process multiple screenshots independently.
2. Extract edit requirements from the visible 批注 text/arrows/notes. Ignore editor chrome (toolbars, selection outlines, handles, cursors).
3. Choose the source image: use the clean underlying image content in the screenshot; if too cropped/low-res, ask the user for a cleaner export.
4. Build the generation prompt: apply the annotations as edit instructions; preserve the original subject, composition, aspect ratio, and style unless an annotation says otherwise; remove ALL annotation artifacts (red arrows, labels, selection outlines, handles); output only the revised clean image.
5. Generate; resolve the exact bytes for THIS request; base64-encode.
6. `weaver_ingest_image` → `assetId`.
7. Place via ChangeSet: `add-node` image in a clear area BESIDE the original node. Never replace/move/hide the original.
8. Confirm the new node id and pending-review state.

## Notes
- One screenshot → one revised image, unless the user groups them.
- Never overwrite an existing asset; ingestion is content-addressed.
