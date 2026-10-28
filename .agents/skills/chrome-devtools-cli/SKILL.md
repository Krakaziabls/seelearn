---
name: chrome-devtools-cli
description: Use this skill to write shell scripts or run shell commands to automate tasks in the browser or otherwise use Chrome DevTools via CLI.
---

The `chrome-devtools-mcp` CLI (`chrome-devtools`) lets you interact with the browser from your terminal.

## Setup

Binary is installed globally and accessible via `chrome-devtools` or `/Users/andreyshelyagin/.bun/bin/chrome-devtools`.

## AI Workflow

1. **Execute**: Run tools directly. If you don't know the target page's ID, run `chrome-devtools list_pages` to find it.
2. **Inspect**: Use `chrome-devtools take_snapshot <pageId>` to get an element `<uid>`.
3. **Act**: Use `chrome-devtools click <pageId> <uid>`, `chrome-devtools fill <pageId> <uid> <value>`, etc.
4. **Screenshot**: `chrome-devtools take_screenshot <pageId> --filePath <path>`.

## Common Commands

```bash
# Navigation
chrome-devtools list_pages
chrome-devtools navigate_page 1 "http://localhost:3000"
chrome-devtools new_page "http://localhost:3000"

# Inspection
chrome-devtools take_snapshot 1
chrome-devtools take_screenshot 1 --filePath "screenshot.png"
chrome-devtools get_css_styles 1 "<uid>"
chrome-devtools list_console_messages 1

# Interaction
chrome-devtools click 1 "<uid>"
chrome-devtools fill 1 "<uid>" "value"
chrome-devtools press_key 1 "Space"
chrome-devtools evaluate_script "() => document.title" --pageId 1
```
