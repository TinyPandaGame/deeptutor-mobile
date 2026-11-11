# Native preview migration

The native client was introduced in **0.2.0-preview.1**. **0.3.0-preview.1** added signed GitHub OTA infrastructure. **0.3.0-preview.2** adds chat model selection, account-private API-key configuration and administrator model settings. Service selection, anonymous/account modes, origin restrictions, cancellation, and service/account persistence remain authoritative.

## Architecture decisions

| Capability | Existing approach and alternatives | Decision and maintenance cost |
| --- | --- | --- |
| Feature navigation | Embedded upstream pages carried login cookies; rewriting every workflow from scratch duplicates the native implementation reference | Adapt the native screens and API adapters; remove credential bootstrap and upstream-page navigation. Keep unsupported workflows explicitly documented. |
| PDF | Existing WebView cannot provide an isolated local PDF reader consistently; another PDF dependency adds native binaries | Adapt the small local Expo module using Android PdfRenderer / iOS PDFKit. Maintain both platform implementations. |
| Receiving shares | No public implementation; Expo sharing also offers receiving but changes the existing inbox policy | Adopt the local inbox module with limits and explicit service/account confirmation. Disable expo-sharing receiving to avoid duplicate handlers. |
| Exports | No system share UI | Supplement with SDK-matched expo-sharing for outgoing local files only. Cache is scoped to the active client and removed at a boundary change. |
| Media | Text and images cannot play audio/video | Add SDK-matched expo-audio / expo-video and expo-asset. Download from the selected service into private temporary files before native rendering; no credential-bearing media URLs. |
| Math and diagrams | Plain React Native text loses math/layout; a handwritten parser would omit semantics | Reuse the existing WebView as a network-disabled inline canvas, add KaTeX, Mermaid and Chart.js with licenses. Larger bundle and dependency audit surface are accepted for this preview. Generated renderers come from locked npm packages, not a CDN. |
| Keyboard | Existing basic avoidance is insufficient for long editors | Adopt the reference's react-native-keyboard-controller. It adds native code and requires a new build. |
| Workspace | Previously no workspace selection | Extend the existing session manager; scope includes service, account and workspace, and switches retire old requests and temporary files. |
| Updates | The release checker only linked to downloads; EAS adds hosted infrastructure, while a custom remote server adds deployment maintenance | Use SDK-matched expo-updates with GitHub Release assets and a local protocol adapter. Maintain both native adapters, an external signing key and runtime-specific acceptance. Existing installs need a new native base. |

The optional `server/mobile_models` extension adds account-private API-key models for the pinned DeepTutor version. No deployment credentials, private signing key or application data are included. New native modules are covered by the repository Apache-2.0 license; third-party renderer licenses remain separate.

## Preview boundaries

This is not desktop feature parity. See [the route and settings audit](feature-coverage.md) for the current gaps, including external partner channels/groups, some writing reviews, manual mastery-map editing, knowledge sync sources, skills/MCP/tool management and parts of model settings. Chat model selection and API-key management now have native interfaces; ordinary-user BYOK requires the optional server extension. EPUB uses extracted text/images. Calendar reminder fields are not device notifications. Existing public binaries and OTA manifests retain their own release versions; the 0.4.0 source update does not publish a new installer or OTA manifest. Feature availability depends on the selected server's configured models and services.

The source API target is DeepTutor 1.7.2; 1.7.1 remains covered by the scoped compatibility tests. See `upstream-1.7.2.md`. Tests of another installation do not establish this repository's runtime readiness. Current validation is recorded separately in `validation.md`.

## Migrated application workflows

| Area | Native preview scope |
| --- | --- |
| Conversation | Persona/capability parameters, attachments, interactive question cards, continue/stop/resume, history and mistake drafts |
| Reading | Library/collections, import/status/retry, PDF or extracted units, media, position, annotations/bookmarks, source-bound questions, export |
| Knowledge | Provider selection, upload/folders, preview/export, indexing state, question context |
| Books | Outline and content types, generation controls, pages/blocks, question cards, editing/reordering, bookmarks, export |
| Mastery | Goals, planning dialogue, learning/review modes, map/progress, question feedback and sessions |
| Notes | Notebooks/records, edits, move/copy, questions and Markdown export |
| Writing | Documents, structured blocks/tables/media, AI suggestions, conflict errors, Word import/export |
| Partners | Creation/preferences, enable/disable, sessions/history and access errors |
| Memory | Layers, editing, consolidation/review/deduplication, jobs, stop/undo |
| Calendar | Month/events/categories, recurrence, timezone, reminder fields and ICS export |
| Workspaces | Current scope, registrations, creation/editing and archive controls |
| Capture/inbox | Native photo/document selection, mistake review, local incoming files and explicit upload confirmation |

These are implementation scopes, not a statement that every server operation or long-running task has passed this release's runtime acceptance. The public fixture exercises representative contracts, not a complete replacement server.
