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

// --- Handlers ---

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
