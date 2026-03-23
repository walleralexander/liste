# Liste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based checklist tool that tracks recurring tasks across multiple devices using a tasks × devices matrix.

**Architecture:** Single-page vanilla HTML/JS frontend talks to a PHP JSON API (`api.php`). Data is stored as one JSON file per list in a `data/` directory. No framework, no build step.

**Tech Stack:** PHP 8.0+, vanilla HTML/CSS/JS, marked.js (CDN) for markdown, DOMPurify (CDN) for HTML sanitization

**Spec:** `docs/superpowers/specs/2026-03-23-liste-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `api.php` | JSON API — routing, validation, file I/O with flock, all CRUD operations |
| `index.html` | Static shell — loads CSS, JS, marked.js CDN, DOMPurify CDN, contains no app logic |
| `app.js` | All client logic — routing, API calls, DOM rendering, interaction handlers |
| `style.css` | Accessible styles — table, status badges, forms, layout |
| `data/*.json` | One JSON file per list (created at runtime, not committed) |

**XSS Prevention:** All user-generated content rendered as HTML (markdown descriptions) MUST be sanitized through DOMPurify before insertion into the DOM. Plain text content (names, status values) MUST use `textContent` or equivalent safe DOM methods instead of innerHTML. This applies throughout all tasks.

---

## Task 1: PHP API — List CRUD

**Files:**
- Create: `api.php`

This task builds the core API file with routing, helpers, and list-level operations (create, read, update, delete, list all).

- [ ] **Step 1: Create api.php with routing skeleton and helpers**

```php
<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

define('DATA_DIR', __DIR__ . '/data');

if (!is_dir(DATA_DIR)) {
    mkdir(DATA_DIR, 0755, true);
}

function generateId(): string {
    return bin2hex(random_bytes(4));
}

function jsonResponse(mixed $data, int $code = 200): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function errorResponse(string $message, int $code): never {
    jsonResponse(['error' => $message], $code);
}

function getInput(): array {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function loadList(string $id): array {
    $path = DATA_DIR . '/' . $id . '.json';
    if (!file_exists($path)) {
        errorResponse('Liste nicht gefunden', 404);
    }
    $fp = fopen($path, 'r');
    flock($fp, LOCK_SH);
    $data = json_decode(stream_get_contents($fp), true);
    flock($fp, LOCK_UN);
    fclose($fp);
    return $data;
}

function saveList(array $list): void {
    $path = DATA_DIR . '/' . $list['id'] . '.json';
    $fp = fopen($path, 'c');
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    fwrite($fp, json_encode($list, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

function unlockAndError(mixed $fp, string $message, int $code): never {
    flock($fp, LOCK_UN);
    fclose($fp);
    errorResponse($message, $code);
}

function loadAndLockList(string $id): array {
    $path = DATA_DIR . '/' . $id . '.json';
    if (!file_exists($path)) {
        errorResponse('Liste nicht gefunden', 404);
    }
    $fp = fopen($path, 'r+');
    flock($fp, LOCK_EX);
    $data = json_decode(stream_get_contents($fp), true);
    $data['_fp'] = $fp;
    return $data;
}

function saveAndUnlock(array &$list): void {
    $fp = $list['_fp'];
    unset($list['_fp']);
    $path = DATA_DIR . '/' . $list['id'] . '.json';
    $content = json_encode($list, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, $content);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

// --- Routing ---
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

switch ($action) {
    case 'lists':
        handleLists($method);
        break;
    case 'list':
        handleList($method);
        break;
    case 'row':
        handleRow($method);
        break;
    case 'column':
        handleColumn($method);
        break;
    case 'status':
        handleStatus($method);
        break;
    default:
        errorResponse('Unbekannte Aktion', 400);
}
```

- [ ] **Step 2: Implement handleLists (GET all, POST create)**

Add after the routing switch:

```php
function handleLists(string $method): void {
    if ($method === 'GET') {
        $lists = [];
        foreach (glob(DATA_DIR . '/*.json') as $file) {
            $data = json_decode(file_get_contents($file), true);
            $lists[] = [
                'id' => $data['id'],
                'name' => $data['name'],
                'rowCount' => count($data['rows']),
                'columnCount' => count($data['columns']),
            ];
        }
        jsonResponse($lists);
    }

    if ($method === 'POST') {
        $input = getInput();
        $name = trim($input['name'] ?? '');
        if ($name === '') {
            errorResponse('Name darf nicht leer sein', 400);
        }
        $description = $input['description'] ?? '';
        $rowNames = $input['rows'] ?? [];

        $rows = [];
        foreach ($rowNames as $rowName) {
            $rowName = trim($rowName);
            if ($rowName !== '') {
                $rows[] = ['id' => generateId(), 'name' => $rowName];
            }
        }

        $list = [
            'id' => generateId(),
            'name' => $name,
            'description' => $description,
            'rows' => $rows,
            'columns' => [],
            'status' => (object)[],
            'created_at' => gmdate('Y-m-d\TH:i:s\Z'),
        ];

        saveList($list);
        jsonResponse($list, 201);
    }

    errorResponse('Methode nicht erlaubt', 400);
}
```

- [ ] **Step 3: Implement handleList (GET one, PUT update, DELETE)**

```php
function handleList(string $method): void {
    $id = $_GET['id'] ?? '';
    if ($id === '') {
        errorResponse('Listen-ID fehlt', 400);
    }

    if ($method === 'GET') {
        jsonResponse(loadList($id));
    }

    if ($method === 'PUT') {
        $list = loadAndLockList($id);
        $input = getInput();
        if (isset($input['name'])) {
            $name = trim($input['name']);
            if ($name === '') {
                unlockAndError($list['_fp'], 'Name darf nicht leer sein', 400);
            }
            $list['name'] = $name;
        }
        if (isset($input['description'])) {
            $list['description'] = $input['description'];
        }
        saveAndUnlock($list);
        jsonResponse($list);
    }

    if ($method === 'DELETE') {
        $path = DATA_DIR . '/' . $id . '.json';
        if (!file_exists($path)) {
            errorResponse('Liste nicht gefunden', 404);
        }
        unlink($path);
        jsonResponse(['success' => true]);
    }

    errorResponse('Methode nicht erlaubt', 400);
}
```

- [ ] **Step 4: Test list CRUD manually with curl**

```bash
php -S localhost:8080 &

# Create a list
curl -s -X POST 'http://localhost:8080/api.php?action=lists' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Server Setup","description":"Test","rows":["srv-web01","srv-db01"]}'

# List all
curl -s 'http://localhost:8080/api.php?action=lists'

# Get one (use id from create response)
curl -s 'http://localhost:8080/api.php?action=list&id=REPLACE_ID'

# Update
curl -s -X PUT 'http://localhost:8080/api.php?action=list&id=REPLACE_ID' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Server Setup v2"}'

# Delete
curl -s -X DELETE 'http://localhost:8080/api.php?action=list&id=REPLACE_ID'
```

Expected: each returns JSON with correct data. After delete, GET returns 404.

- [ ] **Step 5: Commit**

```bash
git add api.php
git commit -m "feat: add PHP API with list CRUD operations"
```

---

## Task 2: PHP API — Row, Column, and Status Operations

**Files:**
- Modify: `api.php`

- [ ] **Step 1: Implement handleRow (POST add, PUT update, DELETE)**

```php
function handleRow(string $method): void {
    $listId = $_GET['list'] ?? '';
    if ($listId === '') {
        errorResponse('Listen-ID fehlt', 400);
    }

    if ($method === 'POST') {
        $input = getInput();
        $name = trim($input['name'] ?? '');
        if ($name === '') {
            errorResponse('Name darf nicht leer sein', 400);
        }
        $list = loadAndLockList($listId);
        $row = ['id' => generateId(), 'name' => $name];
        $list['rows'][] = $row;
        saveAndUnlock($list);
        jsonResponse($list, 201);
    }

    $rowId = $_GET['row'] ?? '';
    if ($rowId === '') {
        errorResponse('Zeilen-ID fehlt', 400);
    }

    if ($method === 'PUT') {
        $input = getInput();
        $name = trim($input['name'] ?? '');
        if ($name === '') {
            errorResponse('Name darf nicht leer sein', 400);
        }
        $list = loadAndLockList($listId);
        $found = false;
        foreach ($list['rows'] as &$row) {
            if ($row['id'] === $rowId) {
                $row['name'] = $name;
                $found = true;
                break;
            }
        }
        unset($row);
        if (!$found) {
            unlockAndError($list['_fp'], 'Zeile nicht gefunden', 404);
        }
        saveAndUnlock($list);
        jsonResponse($list);
    }

    if ($method === 'DELETE') {
        $list = loadAndLockList($listId);
        $found = false;
        $list['rows'] = array_values(array_filter($list['rows'], function ($row) use ($rowId, &$found) {
            if ($row['id'] === $rowId) {
                $found = true;
                return false;
            }
            return true;
        }));
        if (!$found) {
            unlockAndError($list['_fp'], 'Zeile nicht gefunden', 404);
        }
        // Cascade: remove status entries for this row
        $status = (array)$list['status'];
        foreach (array_keys($status) as $key) {
            if (str_starts_with($key, $rowId . ':')) {
                unset($status[$key]);
            }
        }
        $list['status'] = empty($status) ? (object)[] : $status;
        saveAndUnlock($list);
        jsonResponse($list);
    }

    errorResponse('Methode nicht erlaubt', 400);
}
```

- [ ] **Step 2: Implement handleColumn (POST add, PUT update, DELETE)**

```php
function handleColumn(string $method): void {
    $listId = $_GET['list'] ?? '';
    if ($listId === '') {
        errorResponse('Listen-ID fehlt', 400);
    }

    if ($method === 'POST') {
        $input = getInput();
        $name = trim($input['name'] ?? '');
        if ($name === '') {
            errorResponse('Name darf nicht leer sein', 400);
        }
        $list = loadAndLockList($listId);
        $col = [
            'id' => generateId(),
            'name' => $name,
            'description' => $input['description'] ?? '',
        ];
        $list['columns'][] = $col;
        saveAndUnlock($list);
        jsonResponse($list, 201);
    }

    $colId = $_GET['col'] ?? '';
    if ($colId === '') {
        errorResponse('Spalten-ID fehlt', 400);
    }

    if ($method === 'PUT') {
        $input = getInput();
        $list = loadAndLockList($listId);
        $found = false;
        foreach ($list['columns'] as &$col) {
            if ($col['id'] === $colId) {
                if (isset($input['name'])) {
                    $name = trim($input['name']);
                    if ($name === '') {
                        unlockAndError($list['_fp'], 'Name darf nicht leer sein', 400);
                    }
                    $col['name'] = $name;
                }
                if (isset($input['description'])) {
                    $col['description'] = $input['description'];
                }
                $found = true;
                break;
            }
        }
        unset($col);
        if (!$found) {
            unlockAndError($list['_fp'], 'Spalte nicht gefunden', 404);
        }
        saveAndUnlock($list);
        jsonResponse($list);
    }

    if ($method === 'DELETE') {
        $list = loadAndLockList($listId);
        $found = false;
        $list['columns'] = array_values(array_filter($list['columns'], function ($col) use ($colId, &$found) {
            if ($col['id'] === $colId) {
                $found = true;
                return false;
            }
            return true;
        }));
        if (!$found) {
            unlockAndError($list['_fp'], 'Spalte nicht gefunden', 404);
        }
        // Cascade: remove status entries for this column
        $status = (array)$list['status'];
        foreach (array_keys($status) as $key) {
            if (str_ends_with($key, ':' . $colId)) {
                unset($status[$key]);
            }
        }
        $list['status'] = empty($status) ? (object)[] : $status;
        saveAndUnlock($list);
        jsonResponse($list);
    }

    errorResponse('Methode nicht erlaubt', 400);
}
```

- [ ] **Step 3: Implement handleStatus (PUT set status)**

```php
function handleStatus(string $method): void {
    if ($method !== 'PUT') {
        errorResponse('Methode nicht erlaubt', 400);
    }

    $listId = $_GET['list'] ?? '';
    $rowId = $_GET['row'] ?? '';
    $colId = $_GET['col'] ?? '';

    if ($listId === '' || $rowId === '' || $colId === '') {
        errorResponse('Listen-ID, Zeilen-ID und Spalten-ID erforderlich', 400);
    }

    $input = getInput();
    $value = $input['value'] ?? '';
    $allowed = ['offen', 'in Arbeit', 'erledigt'];
    if (!in_array($value, $allowed, true)) {
        errorResponse('Ungültiger Status. Erlaubt: ' . implode(', ', $allowed), 400);
    }

    $list = loadAndLockList($listId);

    // Verify row exists
    $rowFound = false;
    foreach ($list['rows'] as $row) {
        if ($row['id'] === $rowId) { $rowFound = true; break; }
    }
    if (!$rowFound) {
        unlockAndError($list['_fp'], 'Zeile nicht gefunden', 404);
    }

    // Verify column exists
    $colFound = false;
    foreach ($list['columns'] as $col) {
        if ($col['id'] === $colId) { $colFound = true; break; }
    }
    if (!$colFound) {
        unlockAndError($list['_fp'], 'Spalte nicht gefunden', 404);
    }

    $key = $rowId . ':' . $colId;
    $status = (array)$list['status'];

    if ($value === 'offen') {
        unset($status[$key]);
    } else {
        $updatedAt = ($value === 'erledigt') ? gmdate('Y-m-d\TH:i:s\Z') : null;
        $status[$key] = ['value' => $value, 'updated_at' => $updatedAt];
    }

    $list['status'] = empty($status) ? (object)[] : $status;
    saveAndUnlock($list);
    jsonResponse($list);
}
```

- [ ] **Step 4: Test row, column, status operations with curl**

```bash
# Create list first
RESPONSE=$(curl -s -X POST 'http://localhost:8080/api.php?action=lists' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","rows":["srv-web01"]}')
LIST_ID=$(echo $RESPONSE | php -r 'echo json_decode(file_get_contents("php://stdin"))->id;')

# Add column (task)
curl -s -X POST "http://localhost:8080/api.php?action=column&list=$LIST_ID" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Format Disk","description":"Partition erstellen"}'

# Add row (device)
curl -s -X POST "http://localhost:8080/api.php?action=row&list=$LIST_ID" \
  -H 'Content-Type: application/json' \
  -d '{"name":"srv-db01"}'

# Get list to find IDs
curl -s "http://localhost:8080/api.php?action=list&id=$LIST_ID"

# Set status (use actual row/col IDs from response)
curl -s -X PUT "http://localhost:8080/api.php?action=status&list=$LIST_ID&row=ROW_ID&col=COL_ID" \
  -H 'Content-Type: application/json' \
  -d '{"value":"erledigt"}'
```

Expected: status entry has `updated_at` timestamp. Setting to "offen" removes the entry.

- [ ] **Step 5: Commit**

```bash
git add api.php
git commit -m "feat: add row, column, and status CRUD to API"
```

---

## Task 3: HTML Shell and CSS

**Files:**
- Create: `index.html`
- Create: `style.css`

- [ ] **Step 1: Create index.html — static shell**

```html
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Liste</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <header>
        <h1><a href="#home">Liste</a></h1>
    </header>
    <main id="app">
        <p>Laden...</p>
    </main>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/dompurify/dist/purify.min.js"></script>
    <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create style.css — accessible base styles**

```css
*, *::before, *::after {
    box-sizing: border-box;
}

body {
    font-family: system-ui, -apple-system, sans-serif;
    line-height: 1.5;
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
    color: #1a1a1a;
    background: #fafafa;
}

header h1 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
}

header h1 a {
    color: inherit;
    text-decoration: none;
}

/* --- Home view --- */
.list-overview {
    list-style: none;
    padding: 0;
}

.list-overview li {
    padding: 0.75rem 1rem;
    border: 1px solid #ddd;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.list-overview li a {
    color: inherit;
    text-decoration: none;
    font-weight: 600;
}

.list-overview li a:hover {
    text-decoration: underline;
}

.list-overview .meta {
    color: #666;
    font-size: 0.875rem;
}

/* --- List view --- */
.list-header {
    margin-bottom: 1rem;
}

.list-header h2 {
    margin: 0 0 0.5rem;
}

.list-description {
    color: #444;
    margin-bottom: 1rem;
    padding: 0.5rem;
    background: #f0f0f0;
    border-radius: 4px;
}

/* --- Table --- */
.matrix-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: auto;
}

.matrix-table th,
.matrix-table td {
    border: 1px solid #ddd;
    padding: 0.5rem 0.75rem;
    text-align: center;
    vertical-align: middle;
}

.matrix-table th {
    background: #f5f5f5;
    font-weight: 600;
    font-size: 0.875rem;
}

.matrix-table th[scope="row"] {
    text-align: left;
    font-weight: 600;
}

.matrix-table .row-number {
    color: #999;
    width: 2.5rem;
}

.matrix-table .col-zuletzt {
    color: #999;
    font-size: 0.8rem;
    min-width: 6rem;
}

/* --- Status badges --- */
.status-cell {
    cursor: pointer;
    user-select: none;
    border-radius: 3px;
    padding: 0.25rem 0.5rem;
    font-size: 0.8rem;
    display: inline-block;
    min-width: 5rem;
    border: none;
    font-family: inherit;
}

.status-cell:hover {
    opacity: 0.8;
}

.status-cell:focus {
    outline: 2px solid #4a90d9;
    outline-offset: 2px;
}

.status-offen {
    background: #e8e8e8;
    color: #666;
}

.status-in-arbeit {
    background: #fff3cd;
    color: #856404;
}

.status-erledigt {
    background: #d4edda;
    color: #155724;
}

/* --- Task column header --- */
th.task-header {
    cursor: pointer;
}

th.task-header:hover {
    background: #eaeaea;
}

/* --- Forms --- */
.form-group {
    margin-bottom: 1rem;
}

.form-group label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
}

.form-group input,
.form-group textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    font: inherit;
}

.form-group textarea {
    min-height: 4rem;
    resize: vertical;
}

/* --- Buttons --- */
.btn {
    display: inline-block;
    padding: 0.4rem 1rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    background: #fff;
    font: inherit;
    cursor: pointer;
}

.btn:hover {
    background: #f0f0f0;
}

.btn:focus {
    outline: 2px solid #4a90d9;
    outline-offset: 2px;
}

.btn-primary {
    background: #4a90d9;
    color: #fff;
    border-color: #4a90d9;
}

.btn-primary:hover {
    background: #357abd;
}

.btn-danger {
    color: #dc3545;
    border-color: #dc3545;
}

.btn-danger:hover {
    background: #dc3545;
    color: #fff;
}

.toolbar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
}

/* --- Task description modal --- */
.modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
}

.modal {
    background: #fff;
    border-radius: 8px;
    padding: 1.5rem;
    max-width: 600px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
}

.modal h3 {
    margin: 0 0 1rem;
}

/* --- Responsive --- */
@media (max-width: 768px) {
    .matrix-table {
        font-size: 0.8rem;
    }
    .matrix-table th,
    .matrix-table td {
        padding: 0.3rem 0.4rem;
    }
}
```

- [ ] **Step 3: Verify HTML loads in browser**

```bash
# PHP dev server should still be running from Task 1
# Open http://localhost:8080/index.html in browser
# Expected: see "Liste" header and "Laden..." text
```

- [ ] **Step 4: Commit**

```bash
git add index.html style.css
git commit -m "feat: add HTML shell and CSS styles"
```

---

## Task 4: JavaScript — API Client and Router

**Files:**
- Create: `app.js`

- [ ] **Step 1: Create app.js with API client and hash router**

All DOM rendering in this and subsequent tasks MUST follow these rules:
- Use `textContent` for plain text (names, status values, error messages)
- Use `DOMPurify.sanitize(marked.parse(...))` for markdown content before setting innerHTML
- Build DOM elements programmatically with `document.createElement()` where practical

```javascript
'use strict';

const API = 'api.php';

// --- Sanitized markdown rendering ---

function renderMarkdown(mdText) {
    return DOMPurify.sanitize(marked.parse(mdText));
}

// --- API Client ---

async function api(action, params = {}, method = 'GET', body = null) {
    const url = new URL(API, window.location.href);
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }

    const opts = { method, headers: {} };
    if (body !== null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }

    const res = await fetch(url, opts);
    const data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || 'Unbekannter Fehler');
    }
    return data;
}

// --- Router ---

function getRoute() {
    const hash = window.location.hash.slice(1) || 'home';
    if (hash === 'home') return { view: 'home' };
    const match = hash.match(/^list\/(.+)$/);
    if (match) return { view: 'list', id: match[1] };
    return { view: 'home' };
}

function navigate(hash) {
    window.location.hash = hash;
}

// --- Helpers ---

function formatDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return day + '.' + month + '. ' + hours + ':' + minutes;
}

// --- App Init ---

const $app = document.getElementById('app');

async function render() {
    const route = getRoute();
    try {
        if (route.view === 'list') {
            await renderListView(route.id);
        } else {
            await renderHomeView();
        }
    } catch (err) {
        $app.textContent = 'Fehler: ' + err.message;
    }
}

window.addEventListener('hashchange', render);
render();
```

- [ ] **Step 2: Verify router works**

Open `http://localhost:8080/index.html` — should show error text because `renderHomeView` is not defined yet. Check browser console for the error (confirms JS is loading and router is running).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add JS API client and hash router"
```

---

## Task 5: JavaScript — Home View

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Implement renderHomeView**

Append to `app.js`. Uses DOM methods for text content, only uses innerHTML for structural markup that contains no user data:

```javascript
// --- Home View ---

async function renderHomeView() {
    const lists = await api('lists');

    $app.innerHTML = '';

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const newBtn = document.createElement('button');
    newBtn.className = 'btn btn-primary';
    newBtn.textContent = '+ Neue Liste';
    newBtn.addEventListener('click', showNewListForm);
    toolbar.appendChild(newBtn);
    $app.appendChild(toolbar);

    // Form container
    const formContainer = document.createElement('div');
    formContainer.id = 'new-list-form';
    $app.appendChild(formContainer);

    if (lists.length === 0) {
        const p = document.createElement('p');
        p.textContent = 'Noch keine Listen vorhanden.';
        $app.appendChild(p);
    } else {
        const ul = document.createElement('ul');
        ul.className = 'list-overview';
        for (const list of lists) {
            const li = document.createElement('li');

            const a = document.createElement('a');
            a.href = '#list/' + list.id;
            a.textContent = list.name;
            li.appendChild(a);

            const span = document.createElement('span');

            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = list.rowCount + ' Geräte · ' + list.columnCount + ' Aufgaben';
            span.appendChild(meta);

            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.style.cssText = 'margin-left:0.5rem;padding:0.2rem 0.5rem;font-size:0.8rem';
            delBtn.textContent = '×';
            delBtn.addEventListener('click', function(e) {
                e.preventDefault();
                deleteList(list.id, list.name);
            });
            span.appendChild(delBtn);

            li.appendChild(span);
            ul.appendChild(li);
        }
        $app.appendChild(ul);
    }
}

function showNewListForm() {
    const container = document.getElementById('new-list-form');
    if (container.children.length > 0) {
        container.innerHTML = '';
        return;
    }

    const form = document.createElement('form');
    form.addEventListener('submit', createList);

    form.innerHTML = '<div class="form-group">'
        + '<label for="list-name">Name</label>'
        + '<input type="text" id="list-name" required>'
        + '</div>'
        + '<div class="form-group">'
        + '<label for="list-desc">Beschreibung (Markdown)</label>'
        + '<textarea id="list-desc"></textarea>'
        + '</div>'
        + '<div class="form-group">'
        + '<label for="list-rows">Geräte (eins pro Zeile)</label>'
        + '<textarea id="list-rows" required placeholder="srv-web01&#10;srv-db01&#10;srv-mail01"></textarea>'
        + '</div>';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = 'Erstellen';
    form.appendChild(submitBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn';
    cancelBtn.textContent = 'Abbrechen';
    cancelBtn.style.marginLeft = '0.5rem';
    cancelBtn.addEventListener('click', function() { container.innerHTML = ''; });
    form.appendChild(cancelBtn);

    container.appendChild(form);
    document.getElementById('list-name').focus();
}

async function createList(event) {
    event.preventDefault();
    const name = document.getElementById('list-name').value.trim();
    const description = document.getElementById('list-desc').value;
    const rowsText = document.getElementById('list-rows').value;
    const rows = rowsText.split('\n').map(function(r) { return r.trim(); }).filter(function(r) { return r !== ''; });

    if (!name || rows.length === 0) return;

    try {
        const list = await api('lists', {}, 'POST', { name: name, description: description, rows: rows });
        navigate('list/' + list.id);
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

async function deleteList(id, name) {
    if (!confirm('Liste "' + name + '" wirklich löschen?')) return;
    try {
        await api('list', { id: id }, 'DELETE');
        navigate('home');
        await render();
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}
```

- [ ] **Step 2: Test home view in browser**

Open `http://localhost:8080/index.html` — should show "Noch keine Listen vorhanden." and the "+ Neue Liste" button. Click it, fill in the form, submit. Should navigate to list view (will show error since list view isn't implemented yet).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add home view with list creation form"
```

---

## Task 6: JavaScript — List View (Table Rendering)

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Implement renderListView**

Append to `app.js`. The table is built using innerHTML for structural elements, but all user-provided text (names, status values) is set via textContent after insertion. Markdown descriptions are sanitized through DOMPurify.

```javascript
// --- List View ---

let currentList = null;

async function renderListView(id) {
    const list = await api('list', { id: id });
    currentList = list;

    $app.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'list-header';

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.gap = '0.5rem';

    const h2 = document.createElement('h2');
    h2.textContent = list.name;
    titleRow.appendChild(h2);

    const delListBtn = document.createElement('button');
    delListBtn.className = 'btn btn-danger';
    delListBtn.style.fontSize = '0.8rem';
    delListBtn.textContent = 'Liste löschen';
    delListBtn.addEventListener('click', function() { deleteList(list.id, list.name); });
    titleRow.appendChild(delListBtn);

    header.appendChild(titleRow);

    if (list.description) {
        const descDiv = document.createElement('div');
        descDiv.className = 'list-description';
        descDiv.innerHTML = renderMarkdown(list.description);
        header.appendChild(descDiv);
    }

    $app.appendChild(header);

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const addRowBtn = document.createElement('button');
    addRowBtn.className = 'btn';
    addRowBtn.textContent = '+ Gerät';
    addRowBtn.addEventListener('click', addRow);
    toolbar.appendChild(addRowBtn);

    const addColBtn = document.createElement('button');
    addColBtn.className = 'btn';
    addColBtn.textContent = '+ Aufgabe';
    addColBtn.addEventListener('click', addColumn);
    toolbar.appendChild(addColBtn);

    $app.appendChild(toolbar);

    // Table
    $app.appendChild(buildTable(list));
}

function buildTable(list) {
    const rows = list.rows;
    const columns = list.columns;
    const statusMap = list.status || {};

    const table = document.createElement('table');
    table.className = 'matrix-table';
    table.setAttribute('role', 'grid');

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const thNum = document.createElement('th');
    thNum.className = 'row-number';
    thNum.setAttribute('scope', 'col');
    thNum.textContent = '#';
    headerRow.appendChild(thNum);

    const thDevice = document.createElement('th');
    thDevice.setAttribute('scope', 'col');
    thDevice.textContent = 'Gerät';
    headerRow.appendChild(thDevice);

    for (const col of columns) {
        const th = document.createElement('th');
        th.setAttribute('scope', 'col');
        th.className = 'task-header';
        th.textContent = col.name;
        th.title = 'Klicken für Beschreibung';
        th.addEventListener('click', (function(colId) {
            return function() { showTaskDescription(colId); };
        })(col.id));
        headerRow.appendChild(th);
    }

    const thZuletzt = document.createElement('th');
    thZuletzt.setAttribute('scope', 'col');
    thZuletzt.className = 'col-zuletzt';
    thZuletzt.textContent = 'Zuletzt';
    headerRow.appendChild(thZuletzt);

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const tr = document.createElement('tr');

        const tdNum = document.createElement('td');
        tdNum.className = 'row-number';
        tdNum.textContent = String(i + 1);
        tr.appendChild(tdNum);

        const thRow = document.createElement('th');
        thRow.setAttribute('scope', 'row');
        thRow.textContent = row.name;
        tr.appendChild(thRow);

        let latestDate = null;

        for (const col of columns) {
            const key = row.id + ':' + col.id;
            const entry = statusMap[key];
            const value = entry ? entry.value : 'offen';
            const cssClass = 'status-' + value.replace(' ', '-').toLowerCase();

            const td = document.createElement('td');
            const btn = document.createElement('button');
            btn.className = 'status-cell ' + cssClass;
            btn.setAttribute('role', 'gridcell');
            btn.setAttribute('aria-label', col.name + ' auf ' + row.name + ': ' + value);
            btn.textContent = value;
            btn.addEventListener('click', (function(rId, cId) {
                return function() { cycleStatus(rId, cId); };
            })(row.id, col.id));
            td.appendChild(btn);
            tr.appendChild(td);

            if (entry && entry.updated_at) {
                const d = new Date(entry.updated_at);
                if (!latestDate || d > latestDate) {
                    latestDate = d;
                }
            }
        }

        const tdZuletzt = document.createElement('td');
        tdZuletzt.className = 'col-zuletzt';
        tdZuletzt.textContent = latestDate ? formatDate(latestDate) : '—';
        tr.appendChild(tdZuletzt);

        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    return table;
}
```

- [ ] **Step 2: Test table rendering**

Open `http://localhost:8080/index.html` — go to home, create a list with some devices, add a column via curl:

```bash
curl -s -X POST "http://localhost:8080/api.php?action=column&list=LIST_ID" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Format Disk"}'
```

Refresh the list view. Should see the matrix table with devices as rows, task as column header, all cells showing "offen".

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add list view with matrix table rendering"
```

---

## Task 7: JavaScript — Status Cycling, Add Row/Column, Task Description

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Implement cycleStatus**

Append to `app.js`:

```javascript
// --- Status Cycling ---

const STATUS_CYCLE = ['offen', 'in Arbeit', 'erledigt'];

async function cycleStatus(rowId, colId) {
    if (!currentList) return;

    const key = rowId + ':' + colId;
    const statusMap = currentList.status || {};
    const current = statusMap[key] ? statusMap[key].value : 'offen';
    const currentIndex = STATUS_CYCLE.indexOf(current);
    const next = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];

    try {
        const updated = await api('status', {
            list: currentList.id,
            row: rowId,
            col: colId
        }, 'PUT', { value: next });
        currentList = updated;
        await renderListView(currentList.id);
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}
```

- [ ] **Step 2: Implement inline addRow and addColumn**

Uses inline input fields instead of `prompt()` dialogs, per spec requirement:

```javascript
// --- Add Row / Column (inline inputs) ---

function addRow() {
    if (document.getElementById('inline-add-row')) return;
    const table = document.querySelector('.matrix-table tbody');
    const tr = document.createElement('tr');
    tr.id = 'inline-add-row';
    const colSpan = (currentList.columns.length || 0) + 3; // #, name, cols, zuletzt
    const td = document.createElement('td');
    td.colSpan = colSpan;
    td.style.textAlign = 'left';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Name des Geräts';
    input.style.cssText = 'padding:0.3rem;border:1px solid #ccc;border-radius:3px;font:inherit;width:200px;';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary';
    okBtn.style.cssText = 'margin-left:0.5rem;padding:0.2rem 0.6rem;font-size:0.85rem;';
    okBtn.textContent = 'Hinzufügen';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.style.cssText = 'margin-left:0.3rem;padding:0.2rem 0.6rem;font-size:0.85rem;';
    cancelBtn.textContent = 'Abbrechen';

    async function submit() {
        const name = input.value.trim();
        if (!name) return;
        try {
            const updated = await api('row', { list: currentList.id }, 'POST', { name: name });
            currentList = updated;
            await renderListView(currentList.id);
        } catch (err) {
            alert('Fehler: ' + err.message);
        }
    }

    okBtn.addEventListener('click', submit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') tr.remove();
    });
    cancelBtn.addEventListener('click', function() { tr.remove(); });

    td.appendChild(input);
    td.appendChild(okBtn);
    td.appendChild(cancelBtn);
    tr.appendChild(td);
    table.appendChild(tr);
    input.focus();
}

function addColumn() {
    if (document.getElementById('inline-add-col')) return;
    const toolbar = document.querySelector('.toolbar');
    const div = document.createElement('div');
    div.id = 'inline-add-col';
    div.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Name der Aufgabe';
    input.style.cssText = 'padding:0.3rem;border:1px solid #ccc;border-radius:3px;font:inherit;width:200px;';

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary';
    okBtn.style.cssText = 'padding:0.2rem 0.6rem;font-size:0.85rem;';
    okBtn.textContent = 'Hinzufügen';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.style.cssText = 'padding:0.2rem 0.6rem;font-size:0.85rem;';
    cancelBtn.textContent = 'Abbrechen';

    async function submit() {
        const name = input.value.trim();
        if (!name) return;
        try {
            const updated = await api('column', { list: currentList.id }, 'POST', {
                name: name,
                description: ''
            });
            currentList = updated;
            await renderListView(currentList.id);
        } catch (err) {
            alert('Fehler: ' + err.message);
        }
    }

    okBtn.addEventListener('click', submit);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') div.remove();
    });
    cancelBtn.addEventListener('click', function() { div.remove(); });

    div.appendChild(input);
    div.appendChild(okBtn);
    div.appendChild(cancelBtn);
    toolbar.after(div);
    input.focus();
}
```

- [ ] **Step 3: Implement showTaskDescription modal**

```javascript
// --- Task Description Modal ---

function showTaskDescription(colId) {
    if (!currentList) return;

    const col = currentList.columns.find(function(c) { return c.id === colId; });
    if (!col) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', col.name);

    const h3 = document.createElement('h3');
    h3.textContent = col.name;
    modal.appendChild(h3);

    const descDiv = document.createElement('div');
    if (col.description) {
        descDiv.innerHTML = renderMarkdown(col.description);
    } else {
        const em = document.createElement('em');
        em.textContent = 'Keine Beschreibung vorhanden.';
        descDiv.appendChild(em);
    }
    modal.appendChild(descDiv);

    modal.appendChild(document.createElement('hr'));

    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';

    const label = document.createElement('label');
    label.setAttribute('for', 'col-desc-edit');
    label.textContent = 'Beschreibung bearbeiten (Markdown)';
    formGroup.appendChild(label);

    const textarea = document.createElement('textarea');
    textarea.id = 'col-desc-edit';
    textarea.rows = 6;
    textarea.value = col.description || '';
    formGroup.appendChild(textarea);

    modal.appendChild(formGroup);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Speichern';
    saveBtn.addEventListener('click', function() { saveTaskDescription(colId); });
    modal.appendChild(saveBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Schließen';
    closeBtn.style.marginLeft = '0.5rem';
    closeBtn.addEventListener('click', function() { overlay.remove(); });
    modal.appendChild(closeBtn);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    textarea.focus();

    overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') overlay.remove();
    });
}

async function saveTaskDescription(colId) {
    const textarea = document.getElementById('col-desc-edit');
    const description = textarea.value;

    try {
        const updated = await api('column', {
            list: currentList.id,
            col: colId
        }, 'PUT', { description: description });
        currentList = updated;
        document.querySelector('.modal-overlay').remove();
        await renderListView(currentList.id);
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}
```

- [ ] **Step 4: Full integration test in browser**

1. Open `http://localhost:8080/index.html`
2. Create a new list "Server Setup" with devices: srv-web01, srv-db01
3. Navigate to the list
4. Click "+ Aufgabe" → add "Format Disk"
5. Click "+ Aufgabe" → add "Update OS"
6. Click a status cell → should cycle offen → in Arbeit → erledigt → offen
7. Verify "Zuletzt" column shows timestamp after marking "erledigt"
8. Click "Format Disk" column header → should show description modal
9. Type some markdown, save, click header again → should render sanitized markdown
10. Click "+ Gerät" → add "srv-mail01"
11. Navigate back to home → should show list with correct counts

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: add status cycling, row/column add, and task description modal"
```

---

## Task 8: Delete Row/Column UI, Edit List, and Polish

**Files:**
- Modify: `app.js`
- Create: `.gitignore`

- [ ] **Step 1: Add delete buttons for rows and columns**

Append to `app.js`:

```javascript
// --- Delete Row / Column ---

async function deleteRow(rowId, name) {
    if (!confirm('Gerät "' + name + '" wirklich entfernen?')) return;
    try {
        const updated = await api('row', { list: currentList.id, row: rowId }, 'DELETE');
        currentList = updated;
        await renderListView(currentList.id);
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

async function deleteColumn(colId, name) {
    if (!confirm('Aufgabe "' + name + '" wirklich entfernen?')) return;
    try {
        const updated = await api('column', { list: currentList.id, col: colId }, 'DELETE');
        currentList = updated;
        await renderListView(currentList.id);
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}
```

- [ ] **Step 2: Update buildTable to include delete buttons**

In `buildTable`, add a small "×" delete button next to each device name in the row header, and a delete button in each column header:

For row headers — modify the `thRow` creation in `buildTable`:

```javascript
        // Replace the simple thRow.textContent line with:
        const rowNameSpan = document.createElement('span');
        rowNameSpan.textContent = row.name;
        thRow.appendChild(rowNameSpan);

        const delRowBtn = document.createElement('button');
        delRowBtn.className = 'btn btn-danger';
        delRowBtn.style.cssText = 'margin-left:0.5rem;padding:0 0.3rem;font-size:0.7rem;line-height:1;';
        delRowBtn.textContent = '×';
        delRowBtn.title = 'Gerät entfernen';
        delRowBtn.addEventListener('click', (function(rId, rName) {
            return function(e) { e.stopPropagation(); deleteRow(rId, rName); };
        })(row.id, row.name));
        thRow.appendChild(delRowBtn);
```

For column headers — modify the `th` creation in the header loop:

```javascript
        // After th.textContent = col.name; replace with:
        const colNameSpan = document.createElement('span');
        colNameSpan.textContent = col.name;
        th.appendChild(colNameSpan);

        const delColBtn = document.createElement('button');
        delColBtn.className = 'btn btn-danger';
        delColBtn.style.cssText = 'margin-left:0.3rem;padding:0 0.3rem;font-size:0.6rem;line-height:1;vertical-align:middle;';
        delColBtn.textContent = '×';
        delColBtn.title = 'Aufgabe entfernen';
        delColBtn.addEventListener('click', (function(cId, cName) {
            return function(e) { e.stopPropagation(); deleteColumn(cId, cName); };
        })(col.id, col.name));
        th.appendChild(delColBtn);
```

- [ ] **Step 3: Add list name/description edit UI**

Append to `app.js`. Clicking the list name in the header opens an edit form:

```javascript
// --- Edit List ---

function editList() {
    if (!currentList) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Liste bearbeiten');

    const h3 = document.createElement('h3');
    h3.textContent = 'Liste bearbeiten';
    modal.appendChild(h3);

    const nameGroup = document.createElement('div');
    nameGroup.className = 'form-group';
    const nameLabel = document.createElement('label');
    nameLabel.setAttribute('for', 'edit-list-name');
    nameLabel.textContent = 'Name';
    nameGroup.appendChild(nameLabel);
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'edit-list-name';
    nameInput.value = currentList.name;
    nameGroup.appendChild(nameInput);
    modal.appendChild(nameGroup);

    const descGroup = document.createElement('div');
    descGroup.className = 'form-group';
    const descLabel = document.createElement('label');
    descLabel.setAttribute('for', 'edit-list-desc');
    descLabel.textContent = 'Beschreibung (Markdown)';
    descGroup.appendChild(descLabel);
    const descTextarea = document.createElement('textarea');
    descTextarea.id = 'edit-list-desc';
    descTextarea.rows = 6;
    descTextarea.value = currentList.description || '';
    descGroup.appendChild(descTextarea);
    modal.appendChild(descGroup);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Speichern';
    saveBtn.addEventListener('click', async function() {
        const name = nameInput.value.trim();
        if (!name) { alert('Name darf nicht leer sein'); return; }
        try {
            const updated = await api('list', { id: currentList.id }, 'PUT', {
                name: name,
                description: descTextarea.value
            });
            currentList = updated;
            overlay.remove();
            await renderListView(currentList.id);
        } catch (err) {
            alert('Fehler: ' + err.message);
        }
    });
    modal.appendChild(saveBtn);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = 'Abbrechen';
    closeBtn.style.marginLeft = '0.5rem';
    closeBtn.addEventListener('click', function() { overlay.remove(); });
    modal.appendChild(closeBtn);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    nameInput.focus();

    overlay.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') overlay.remove();
    });
}
```

- [ ] **Step 4: Wire edit button into renderListView**

In `renderListView`, add an edit button next to the list title. After the `h2` element:

```javascript
    const editListBtn = document.createElement('button');
    editListBtn.className = 'btn';
    editListBtn.style.fontSize = '0.8rem';
    editListBtn.textContent = 'Bearbeiten';
    editListBtn.addEventListener('click', editList);
    titleRow.appendChild(editListBtn);
```

- [ ] **Step 5: Create .gitignore**

```
data/
.superpowers/
```

- [ ] **Step 6: Full end-to-end test**

1. Create a list, add devices and tasks
2. Click status cells — cycle through all three states
3. Verify "Zuletzt" timestamps appear/disappear correctly
4. Add rows and columns via inline inputs
5. Delete rows and columns via × buttons in table headers
6. Edit list name/description via "Bearbeiten" button
7. Edit task descriptions with markdown
8. Delete a list from home view
9. Test keyboard navigation (Tab + Enter/Space on status cells)
10. Check that DOMPurify is sanitizing markdown output (try entering `<script>alert(1)</script>` in a description — should be stripped)

- [ ] **Step 7: Commit**

```bash
git add app.js .gitignore
git commit -m "feat: add delete UI for rows/columns, list edit, and gitignore"
```

---

## Summary

| Task | What it builds | Files |
|------|---------------|-------|
| 1 | API skeleton + list CRUD | `api.php` |
| 2 | Row, column, status CRUD | `api.php` |
| 3 | HTML shell + CSS | `index.html`, `style.css` |
| 4 | JS API client + router | `app.js` |
| 5 | Home view (list overview + create + delete) | `app.js` |
| 6 | List view (matrix table) | `app.js` |
| 7 | Status cycling + inline add row/column + descriptions | `app.js` |
| 8 | Delete row/column UI, list edit, gitignore | `app.js`, `.gitignore` |
