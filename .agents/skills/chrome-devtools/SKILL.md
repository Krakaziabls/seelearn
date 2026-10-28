---
name: chrome-devtools
description: Uses Chrome DevTools via MCP for efficient debugging, troubleshooting and browser automation. Use when debugging web pages, automating browser interactions, analyzing performance, or inspecting network requests. This skill does not apply to `--slim` mode (MCP configuration).
---

## Core Concepts

**Browser lifecycle**: Browser starts automatically on first tool call using a persistent Chrome profile. Configure via CLI args in the MCP server configuration: `npx chrome-devtools-mcp@latest --help`.
Addional tooling can be enabled by providing the following flags:

- For extension tooling, use the `--categoryExtensions` flag.
- For memory tooling, use the `--memoryDebugging` flag.

**Page targeting**: Page-scoped tools require a `pageId` parameter to target a specific page. Use `list_pages` to see available pages and their IDs (e.g. `pageId: 1`), or use the ID returned when creating a page with `new_page`.
Note: For `evaluate_script`, `pageId` is required when targeting pages. However, when `--categoryExtensions` is enabled, `pageId` is optional so you can pass `serviceWorkerId` instead to evaluate inside an extension background service worker.
**Element interaction**: Use `take_snapshot` to get page structure with element `uid`s. Each element has a unique `uid` for interaction. If an element isn't found, take a fresh snapshot - the element may have been removed or the page changed.

## Workflow Patterns

### Before interacting with a page

1. Navigate: `navigate_page` or `new_page`
2. Wait: `wait_for` to ensure content is loaded if you know what you look for.
3. Snapshot: `take_snapshot` with `pageId` to understand page structure
4. Interact: Use element `uid`s from snapshot for `click`, `fill`, etc., passing the corresponding `pageId`.

### Efficient data retrieval

- Use `filePath` parameter for large outputs (screenshots, snapshots, traces)
- Use pagination (`pageIdx`, `pageSize`) and filtering (`types`) to minimize data
- Set `includeSnapshot: false` on input actions unless you need updated page state

### Tool selection

- **Automation/interaction**: `take_snapshot` (text-based, faster, better for automation)
- **Visual inspection**: `take_screenshot` (when user needs to see visual state)
- **CSS & Styling inspection**: Use `get_css_styles` to inspect matched rules, cascade, and CSS variables. Treat the output as authoritative and complete.
- **Additional details**: Use `evaluate_script` for runtime DOM/JS data not available via `get_css_styles` or `take_snapshot`.

### Parallel execution

You can send multiple tool calls in parallel, but maintain correct order: navigate → wait → snapshot → interact.

### Testing an extension or UI

1. **Navigate**: Open the target page or local test harness.
2. **Snapshot**: `take_snapshot` to verify DOM structure, element roles, and IDs.
3. **Inspect Styling**: `get_css_styles` to verify button sizes, colors, margins, overflow properties.
4. **Visual Verification**: `take_screenshot` to confirm the rendered layout.
5. **Interactive Verification**: `click`, `press_key` to test UI interactions (flipping cards, submitting forms, opening modals).

## Troubleshooting

If `chrome-devtools-mcp` is insufficient, guide users to use Chrome DevTools UI:
- https://developer.chrome.com/docs/devtools
- https://developer.chrome.com/docs/devtools/ai-assistance
