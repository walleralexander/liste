# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"Liste" is a web-based checklist tool for tracking recurring tasks across multiple devices. It presents a matrix view: rows = devices, columns = tasks, cells = status. The original concept is in `idee.md` (German).

## Development

```bash
# Start dev server
php -S localhost:8080

# Open in browser
# http://localhost:8080/index.html
```

Requires PHP 8.0+. No build step, no package manager, no framework.

## Architecture

Single-page app with a PHP JSON API and file-based storage.

```
Browser (index.html + app.js + style.css)
    ↕  JSON via fetch()
PHP Backend (api.php)
    ↕  read/write with flock()
File Storage (data/{list-id}.json)
```

- `api.php` — Single entry point for all API routes. Uses query params (`?action=...`) for routing, `flock()` for concurrency, `saveAndUnlock()` takes array by reference to avoid resource leaks.
- `app.js` — All client logic: hash router, API client, DOM rendering. Uses `textContent` for user data, `DOMPurify.sanitize(marked.parse(...))` for markdown. No innerHTML with unsanitized content.
- `index.html` — Static shell, loads marked.js and DOMPurify from CDN.
- `style.css` — Accessible styles, responsive table, status badges.
- `data/*.json` — One file per list, not committed (in `.gitignore`).

## Key Conventions

- **German UI** — all labels, messages, and error strings are in German
- **Status values**: `offen`, `in Arbeit`, `erledigt` — hardcoded in both PHP and JS
- **IDs**: `bin2hex(random_bytes(4))` — 8-char hex strings
- **Status map key format**: `"rowId:colId"` — missing entries default to `offen`
- **`updated_at`**: only set when status changes to `erledigt`, reset to `null` otherwise
- **Lock discipline**: validate input before acquiring lock; use `unlockAndError()` for errors after lock

## Spec & Plan

- Design spec: `docs/superpowers/specs/2026-03-23-liste-design.md`
- Implementation plan: `docs/superpowers/plans/2026-03-23-liste-implementation.md`
