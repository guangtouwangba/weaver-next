---
name: weaver-create-artifact
description: Create a scene-defined Weaver artifact such as an article, flashcards, quiz, learning plan, decision memo, chronology, project plan, or SOP from selected semantic nodes and resolved scene context.
---

# Create Weaver Artifact

1. Read the active project manifest and confirm the requested artifact type is listed by the pinned scene pack.
2. Read current canvas selection and call `weaver_resolve_context`.
3. Generate a structured artifact without changing graph content.
4. Publish through `weaver_publish_artifact` with source node ids and project revision.
5. Return the artifact id and preview/export information.

Do not silently convert an unsupported artifact type. Offer one of the scene's declared alternatives.
