'use strict';

var API = 'api.php';

// --- Sanitized markdown rendering ---
// All markdown content is sanitized through DOMPurify before DOM insertion.
// Plain text (names, status values) always uses textContent.
// The only innerHTML usage is for:
//   1. DOMPurify.sanitize(marked.parse(...)) — safe sanitized HTML
//   2. Static form markup with no user data

function renderMarkdown(mdText) {
    return DOMPurify.sanitize(marked.parse(mdText));
}

// --- API Client ---

async function api(action, params, method, body) {
    params = params || {};
    method = method || 'GET';
    body = body || null;

    var url = new URL(API, window.location.href);
    url.searchParams.set('action', action);
    for (var k in params) {
        if (params.hasOwnProperty(k)) {
            url.searchParams.set(k, params[k]);
        }
    }

    var opts = { method: method, headers: {} };
    if (body !== null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }

    var res = await fetch(url, opts);
    var data = await res.json();

    if (!res.ok) {
        throw new Error(data.error || 'Unbekannter Fehler');
    }
    return data;
}

// --- Router ---

function getRoute() {
    var hash = window.location.hash.slice(1) || 'home';
    if (hash === 'home') return { view: 'home' };
    var match = hash.match(/^list\/(.+)$/);
    if (match) return { view: 'list', id: match[1] };
    return { view: 'home' };
}

function navigate(hash) {
    window.location.hash = hash;
}

// --- Helpers ---

function formatDate(date) {
    var day = String(date.getDate()).padStart(2, '0');
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var hours = String(date.getHours()).padStart(2, '0');
    var minutes = String(date.getMinutes()).padStart(2, '0');
    return day + '.' + month + '. ' + hours + ':' + minutes;
}

// --- App Init ---

var $app = document.getElementById('app');

async function render() {
    var route = getRoute();
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

// --- Home View ---

async function renderHomeView() {
    var lists = await api('lists');

    $app.innerHTML = '';

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    var newBtn = document.createElement('button');
    newBtn.className = 'btn btn-primary';
    newBtn.textContent = '+ Neue Liste';
    newBtn.addEventListener('click', showNewListForm);
    toolbar.appendChild(newBtn);
    $app.appendChild(toolbar);

    // Form container
    var formContainer = document.createElement('div');
    formContainer.id = 'new-list-form';
    $app.appendChild(formContainer);

    if (lists.length === 0) {
        var p = document.createElement('p');
        p.textContent = 'Noch keine Listen vorhanden.';
        $app.appendChild(p);
    } else {
        var ul = document.createElement('ul');
        ul.className = 'list-overview';
        for (var i = 0; i < lists.length; i++) {
            var list = lists[i];
            var li = document.createElement('li');

            var a = document.createElement('a');
            a.href = '#list/' + list.id;
            a.textContent = list.name;
            li.appendChild(a);

            var span = document.createElement('span');

            var meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = list.rowCount + ' Geräte · ' + list.columnCount + ' Aufgaben';
            span.appendChild(meta);

            var delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger';
            delBtn.style.cssText = 'margin-left:0.5rem;padding:0.2rem 0.5rem;font-size:0.8rem';
            delBtn.textContent = '\u00d7';
            delBtn.addEventListener('click', (function(id, name) {
                return function(e) {
                    e.preventDefault();
                    deleteList(id, name);
                };
            })(list.id, list.name));
            span.appendChild(delBtn);

            li.appendChild(span);
            ul.appendChild(li);
        }
        $app.appendChild(ul);
    }
}

function showNewListForm() {
    var container = document.getElementById('new-list-form');
    if (container.children.length > 0) {
        container.innerHTML = '';
        return;
    }

    var form = document.createElement('form');
    form.addEventListener('submit', createList);

    // Static form markup — no user data, safe to use innerHTML
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

    var submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = 'Erstellen';
    form.appendChild(submitBtn);

    var cancelBtn = document.createElement('button');
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
    var name = document.getElementById('list-name').value.trim();
    var description = document.getElementById('list-desc').value;
    var rowsText = document.getElementById('list-rows').value;
    var rows = rowsText.split('\n').map(function(r) { return r.trim(); }).filter(function(r) { return r !== ''; });

    if (!name || rows.length === 0) return;

    try {
        var list = await api('lists', {}, 'POST', { name: name, description: description, rows: rows });
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

// --- List View ---

var currentList = null;

async function renderListView(id) {
    var list = await api('list', { id: id });
    currentList = list;

    $app.innerHTML = '';

    // Header
    var header = document.createElement('div');
    header.className = 'list-header';

    var titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.alignItems = 'center';
    titleRow.style.gap = '0.5rem';

    var h2 = document.createElement('h2');
    h2.textContent = list.name;
    titleRow.appendChild(h2);

    var editListBtn = document.createElement('button');
    editListBtn.className = 'btn';
    editListBtn.style.fontSize = '0.8rem';
    editListBtn.textContent = 'Bearbeiten';
    editListBtn.addEventListener('click', editList);
    titleRow.appendChild(editListBtn);

    var delListBtn = document.createElement('button');
    delListBtn.className = 'btn btn-danger';
    delListBtn.style.fontSize = '0.8rem';
    delListBtn.textContent = 'Liste löschen';
    delListBtn.addEventListener('click', function() { deleteList(list.id, list.name); });
    titleRow.appendChild(delListBtn);

    header.appendChild(titleRow);

    if (list.description) {
        var descDiv = document.createElement('div');
        descDiv.className = 'list-description';
        // Markdown rendered through DOMPurify — safe sanitized HTML
        descDiv.innerHTML = renderMarkdown(list.description);
        header.appendChild(descDiv);
    }

    $app.appendChild(header);

    // Toolbar
    var toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    var addRowBtn = document.createElement('button');
    addRowBtn.className = 'btn';
    addRowBtn.textContent = '+ Gerät';
    addRowBtn.addEventListener('click', addRow);
    toolbar.appendChild(addRowBtn);

    var addColBtn = document.createElement('button');
    addColBtn.className = 'btn';
    addColBtn.textContent = '+ Aufgabe';
    addColBtn.addEventListener('click', addColumn);
    toolbar.appendChild(addColBtn);

    $app.appendChild(toolbar);

    // Table
    $app.appendChild(buildTable(list));
}

function buildTable(list) {
    var rows = list.rows;
    var columns = list.columns;
    var statusMap = list.status || {};

    var table = document.createElement('table');
    table.className = 'matrix-table';
    table.setAttribute('role', 'grid');

    // Header
    var thead = document.createElement('thead');
    var headerRow = document.createElement('tr');

    var thNum = document.createElement('th');
    thNum.className = 'row-number';
    thNum.setAttribute('scope', 'col');
    thNum.textContent = '#';
    headerRow.appendChild(thNum);

    var thDevice = document.createElement('th');
    thDevice.setAttribute('scope', 'col');
    thDevice.textContent = 'Gerät';
    headerRow.appendChild(thDevice);

    for (var ci = 0; ci < columns.length; ci++) {
        var col = columns[ci];
        var th = document.createElement('th');
        th.setAttribute('scope', 'col');
        th.className = 'task-header';
        th.title = 'Klicken für Beschreibung';
        th.addEventListener('click', (function(colId) {
            return function() { showTaskDescription(colId); };
        })(col.id));

        var colNameSpan = document.createElement('span');
        colNameSpan.textContent = col.name;
        th.appendChild(colNameSpan);

        var delColBtn = document.createElement('button');
        delColBtn.className = 'btn btn-danger';
        delColBtn.style.cssText = 'margin-left:0.3rem;padding:0 0.3rem;font-size:0.6rem;line-height:1;vertical-align:middle;';
        delColBtn.textContent = '\u00d7';
        delColBtn.title = 'Aufgabe entfernen';
        delColBtn.addEventListener('click', (function(cId, cName) {
            return function(e) { e.stopPropagation(); deleteColumn(cId, cName); };
        })(col.id, col.name));
        th.appendChild(delColBtn);

        headerRow.appendChild(th);
    }

    var thZuletzt = document.createElement('th');
    thZuletzt.setAttribute('scope', 'col');
    thZuletzt.className = 'col-zuletzt';
    thZuletzt.textContent = 'Zuletzt';
    headerRow.appendChild(thZuletzt);

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    var tbody = document.createElement('tbody');

    for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        var tr = document.createElement('tr');

        var tdNum = document.createElement('td');
        tdNum.className = 'row-number';
        tdNum.textContent = String(ri + 1);
        tr.appendChild(tdNum);

        var thRow = document.createElement('th');
        thRow.setAttribute('scope', 'row');

        var rowNameSpan = document.createElement('span');
        rowNameSpan.textContent = row.name;
        thRow.appendChild(rowNameSpan);

        var delRowBtn = document.createElement('button');
        delRowBtn.className = 'btn btn-danger';
        delRowBtn.style.cssText = 'margin-left:0.5rem;padding:0 0.3rem;font-size:0.7rem;line-height:1;';
        delRowBtn.textContent = '\u00d7';
        delRowBtn.title = 'Gerät entfernen';
        delRowBtn.addEventListener('click', (function(rId, rName) {
            return function(e) { e.stopPropagation(); deleteRow(rId, rName); };
        })(row.id, row.name));
        thRow.appendChild(delRowBtn);

        tr.appendChild(thRow);

        var latestDate = null;

        for (var cj = 0; cj < columns.length; cj++) {
            var col2 = columns[cj];
            var key = row.id + ':' + col2.id;
            var entry = statusMap[key];
            var value = entry ? entry.value : 'offen';
            var cssClass = 'status-' + value.replace(' ', '-').toLowerCase();

            var td = document.createElement('td');
            var btn = document.createElement('button');
            btn.className = 'status-cell ' + cssClass;
            btn.setAttribute('role', 'gridcell');
            btn.setAttribute('aria-label', col2.name + ' auf ' + row.name + ': ' + value);
            btn.textContent = value;
            btn.addEventListener('click', (function(rId, cId) {
                return function() { cycleStatus(rId, cId); };
            })(row.id, col2.id));
            td.appendChild(btn);
            tr.appendChild(td);

            if (entry && entry.updated_at) {
                var d = new Date(entry.updated_at);
                if (!latestDate || d > latestDate) {
                    latestDate = d;
                }
            }
        }

        var tdZuletzt = document.createElement('td');
        tdZuletzt.className = 'col-zuletzt';
        tdZuletzt.textContent = latestDate ? formatDate(latestDate) : '\u2014';
        tr.appendChild(tdZuletzt);

        tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    return table;
}

// --- Status Cycling ---

var STATUS_CYCLE = ['offen', 'in Arbeit', 'erledigt'];

async function cycleStatus(rowId, colId) {
    if (!currentList) return;

    var key = rowId + ':' + colId;
    var statusMap = currentList.status || {};
    var current = statusMap[key] ? statusMap[key].value : 'offen';
    var currentIndex = STATUS_CYCLE.indexOf(current);
    var next = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];

    try {
        var updated = await api('status', {
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

// --- Add Row / Column (inline inputs) ---

function addRow() {
    if (document.getElementById('inline-add-row')) return;
    var table = document.querySelector('.matrix-table tbody');
    if (!table) return;
    var tr = document.createElement('tr');
    tr.id = 'inline-add-row';
    var colSpan = (currentList.columns.length || 0) + 3;
    var td = document.createElement('td');
    td.colSpan = colSpan;
    td.style.textAlign = 'left';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Name des Geräts';
    input.style.cssText = 'padding:0.3rem;border:1px solid #ccc;border-radius:3px;font:inherit;width:200px;';

    var okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary';
    okBtn.style.cssText = 'margin-left:0.5rem;padding:0.2rem 0.6rem;font-size:0.85rem;';
    okBtn.textContent = 'Hinzufügen';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.style.cssText = 'margin-left:0.3rem;padding:0.2rem 0.6rem;font-size:0.85rem;';
    cancelBtn.textContent = 'Abbrechen';

    async function submit() {
        var name = input.value.trim();
        if (!name) return;
        try {
            var updated = await api('row', { list: currentList.id }, 'POST', { name: name });
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
    var toolbar = document.querySelector('.toolbar');
    var div = document.createElement('div');
    div.id = 'inline-add-col';
    div.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.5rem;';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Name der Aufgabe';
    input.style.cssText = 'padding:0.3rem;border:1px solid #ccc;border-radius:3px;font:inherit;width:200px;';

    var okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary';
    okBtn.style.cssText = 'padding:0.2rem 0.6rem;font-size:0.85rem;';
    okBtn.textContent = 'Hinzufügen';

    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.style.cssText = 'padding:0.2rem 0.6rem;font-size:0.85rem;';
    cancelBtn.textContent = 'Abbrechen';

    async function submit() {
        var name = input.value.trim();
        if (!name) return;
        try {
            var updated = await api('column', { list: currentList.id }, 'POST', {
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

// --- Delete Row / Column ---

async function deleteRow(rowId, name) {
    if (!confirm('Gerät "' + name + '" wirklich entfernen?')) return;
    try {
        var updated = await api('row', { list: currentList.id, row: rowId }, 'DELETE');
        currentList = updated;
        await renderListView(currentList.id);
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

async function deleteColumn(colId, name) {
    if (!confirm('Aufgabe "' + name + '" wirklich entfernen?')) return;
    try {
        var updated = await api('column', { list: currentList.id, col: colId }, 'DELETE');
        currentList = updated;
        await renderListView(currentList.id);
    } catch (err) {
        alert('Fehler: ' + err.message);
    }
}

// --- Task Description Modal ---

function showTaskDescription(colId) {
    if (!currentList) return;

    var col = currentList.columns.find(function(c) { return c.id === colId; });
    if (!col) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', col.name);

    var h3 = document.createElement('h3');
    h3.textContent = col.name;
    modal.appendChild(h3);

    var descDiv = document.createElement('div');
    if (col.description) {
        // Markdown rendered through DOMPurify — safe sanitized HTML
        descDiv.innerHTML = renderMarkdown(col.description);
    } else {
        var em = document.createElement('em');
        em.textContent = 'Keine Beschreibung vorhanden.';
        descDiv.appendChild(em);
    }
    modal.appendChild(descDiv);

    modal.appendChild(document.createElement('hr'));

    var formGroup = document.createElement('div');
    formGroup.className = 'form-group';

    var label = document.createElement('label');
    label.setAttribute('for', 'col-desc-edit');
    label.textContent = 'Beschreibung bearbeiten (Markdown)';
    formGroup.appendChild(label);

    var textarea = document.createElement('textarea');
    textarea.id = 'col-desc-edit';
    textarea.rows = 6;
    textarea.value = col.description || '';
    formGroup.appendChild(textarea);

    modal.appendChild(formGroup);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Speichern';
    saveBtn.addEventListener('click', function() { saveTaskDescription(colId); });
    modal.appendChild(saveBtn);

    var closeBtn = document.createElement('button');
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
    var textarea = document.getElementById('col-desc-edit');
    var description = textarea.value;

    try {
        var updated = await api('column', {
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

// --- Edit List ---

function editList() {
    if (!currentList) return;

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Liste bearbeiten');

    var h3 = document.createElement('h3');
    h3.textContent = 'Liste bearbeiten';
    modal.appendChild(h3);

    var nameGroup = document.createElement('div');
    nameGroup.className = 'form-group';
    var nameLabel = document.createElement('label');
    nameLabel.setAttribute('for', 'edit-list-name');
    nameLabel.textContent = 'Name';
    nameGroup.appendChild(nameLabel);
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'edit-list-name';
    nameInput.value = currentList.name;
    nameGroup.appendChild(nameInput);
    modal.appendChild(nameGroup);

    var descGroup = document.createElement('div');
    descGroup.className = 'form-group';
    var descLabel = document.createElement('label');
    descLabel.setAttribute('for', 'edit-list-desc');
    descLabel.textContent = 'Beschreibung (Markdown)';
    descGroup.appendChild(descLabel);
    var descTextarea = document.createElement('textarea');
    descTextarea.id = 'edit-list-desc';
    descTextarea.rows = 6;
    descTextarea.value = currentList.description || '';
    descGroup.appendChild(descTextarea);
    modal.appendChild(descGroup);

    var saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = 'Speichern';
    saveBtn.addEventListener('click', async function() {
        var name = nameInput.value.trim();
        if (!name) { alert('Name darf nicht leer sein'); return; }
        try {
            var updated = await api('list', { id: currentList.id }, 'PUT', {
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

    var closeBtn = document.createElement('button');
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
