# Liste — Design Spec

A web-based checklist tool for tracking recurring tasks across multiple devices.

## Problem

Teams managing multiple devices (servers, desktops, etc.) need to perform the same set of tasks on each device. Tracking what's done where gets lost quickly. Liste provides a simple matrix view: devices × tasks, with status tracking.

## Architecture

Single-page vanilla HTML app with a PHP JSON API and file-based storage.

```
Browser (index.html + app.js + style.css)
    ↕  JSON via fetch()
PHP Backend (api.php)
    ↕  read/write
File Storage (data/{list-id}.json)
```

### File Structure

```
liste/
├── index.html       — single page UI
├── app.js           — all client logic
├── style.css        — accessible, simple styles
├── api.php          — JSON API entry point
└── data/            — one .json file per list
```

No build step. No framework. Requires PHP 8.0+. No external dependencies except marked.js (~8KB, CDN) for markdown rendering and DOMPurify (~7KB, CDN) for HTML sanitization of rendered markdown. API expects JSON request bodies (`Content-Type: application/json`). The `data/` directory is created by `api.php` on first write if it doesn't exist.

## Data Model

One JSON file per list in `data/`:

```json
{
  "id": "a1b2c3",
  "name": "Server Setup",
  "description": "## Neue Server\nAlle Schritte für die Inbetriebnahme.",
  "rows": [
    { "id": "r1", "name": "srv-web01" },
    { "id": "r2", "name": "srv-db01" },
    { "id": "r3", "name": "srv-mail01" }
  ],
  "columns": [
    { "id": "c1", "name": "Format Disk", "description": "Partition und Formatierung..." },
    { "id": "c2", "name": "Update OS", "description": "" },
    { "id": "c3", "name": "Set Time", "description": "" }
  ],
  "status": {
    "r1:c1": { "value": "erledigt", "updated_at": "2026-03-23T14:30:00Z" },
    "r1:c2": { "value": "erledigt", "updated_at": "2026-03-23T14:15:00Z" },
    "r2:c1": { "value": "in Arbeit", "updated_at": null }
  },
  "created_at": "2026-03-23T10:00:00Z"
}
```

- **Rows** = devices (entered at list creation, one per line)
- **Columns** = tasks (added dynamically as work progresses)
- **Status map** keyed by `"rowId:colId"` — only non-default entries stored (missing = `"offen"`)
- `updated_at` is set automatically only when status changes to `"erledigt"` (reset to `null` on other transitions). The "Zuletzt" column computes the most recent `updated_at` across all columns for that row. Note: cycling away from "erledigt" loses that timestamp — this is intentional (simple v1 behavior).
- Both the list and each column (task) have a markdown `description` field. The list description explains the project/context; the column description explains the specific task to perform (per original requirement in `idee.md`).
- **IDs** are generated via `bin2hex(random_bytes(4))` (8-char hex strings)
- **Column order** is significant (array index). Columns appear in the order they were added. No reordering in v1.
- **Deleting a row or column** also removes all associated entries from the `status` map.

### Status Values

| Value | Meaning | Color |
|-------|---------|-------|
| `offen` | Not started (default) | Grey |
| `in Arbeit` | In progress | Yellow |
| `erledigt` | Done | Green |

## API

Single `api.php` entry point. Routing via query parameters.

### Endpoints

| Method | Path | Action |
|--------|------|--------|
| GET | `?action=lists` | List all lists (id + name only) |
| POST | `?action=lists` | Create new list (name, description, initial rows) |
| GET | `?action=list&id=X` | Get full list with all data |
| PUT | `?action=list&id=X` | Update list name/description |
| DELETE | `?action=list&id=X` | Delete a list |
| POST | `?action=row&list=X` | Add a row (device) |
| PUT | `?action=row&list=X&row=Y` | Update row name |
| DELETE | `?action=row&list=X&row=Y` | Delete a row |
| POST | `?action=column&list=X` | Add a column (task) |
| PUT | `?action=column&list=X&col=Y` | Update column name/description |
| DELETE | `?action=column&list=X&col=Y` | Remove a column |
| PUT | `?action=status&list=X&row=Y&col=Z` | Set status (auto-sets timestamp) |

All responses are JSON. Mutating endpoints (POST/PUT/DELETE) return the updated object on success.

Error codes: 400 (invalid input / empty name), 404 (list/row/column not found), 500 (file I/O failure). Errors return `{"error": "message"}`.

Query params instead of pretty URLs — keeps it to one file, no `.htaccess` needed. Easy to add a router when migrating to Laravel.

### File Locking

Use `flock()` on the JSON file for the entire read-modify-write cycle (not just the write) to prevent concurrent corruption.

## UI

### Views

Two views, hash-routed (no page reloads):

1. **Home** (`index.html` / `index.html#home`)
   - Lists all existing lists as a simple list
   - Each entry shows: name, row count, column count
   - "Neue Liste" button → form with: name, description (markdown textarea), rows (one per line textarea)

2. **List view** (`index.html#list/{id}`)
   - Header: list name + rendered markdown description
   - Matrix table: rows = devices, columns = tasks
   - First column: auto-incrementing counter (#)
   - Second column: device name
   - Task columns: status badges (clickable)
   - Last column: "Zuletzt" — last time any task was completed for that device (auto-populated)
   - Buttons: "+ Gerät" (add row), "+ Aufgabe" (add column)

### Interaction

- **Click a status cell** → cycles: offen → in Arbeit → erledigt → offen (sends PUT to API)
- **Click a task column header** → shows/edits task description (markdown)
- **"Zuletzt" column** → auto-displays most recent `erledigt` timestamp for that row
- **"+ Gerät"** → inline input to add a new device row
- **"+ Aufgabe"** → inline input to add a new task column

### Accessibility

- Semantic HTML: `<table>`, `<th scope>`, `<button>`, `<form>`
- Keyboard navigation: Tab through cells, Enter/Space to cycle status
- ARIA labels on status cells (e.g., `aria-label="Format Disk auf srv-web01: offen"`)
- Client-side rendering: `index.html` is a static shell, JS fetches data from the API and renders the table. Status cycling works without page reloads.
- German UI throughout

## Future Considerations (Not In Scope)

- **Authentication**: structure allows adding auth later (middleware in Laravel)
- **Laravel migration**: PHP backend maps naturally to Laravel controllers + Eloquent
- **Database**: JSON structure maps to relational schema (lists, rows, columns, status tables)
- **Multi-user**: `updated_at` can be extended with `updated_by` when auth exists
