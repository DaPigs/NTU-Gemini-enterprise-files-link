'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextDecoder } = require('node:util');

const HEADER = '# VibeBridge Delta v2\n';
const STATE = '.vibebridge-state';
const PATCH_LIMIT = 7_000_000;
const FILE_LIMIT = 16 * 1024 * 1024;
const SHA = /^[0-9a-f]{64}$/;
const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function requireThat(condition, message) {
    if (!condition) throw new Error(message);
}

function jsonFile(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function info(file) {
    return fs.lstatSync(file, { throwIfNoEntry: false });
}

function safePath(root, relative) {
    requireThat(typeof relative === 'string' && relative.length <= 240, 'Invalid project path.');
    const parts = relative.split('/');
    for (const part of parts) {
        requireThat(part && !/[<>:"\\|?*\x00-\x1f]|[. ]$/.test(part) &&
            !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part) &&
            !/^(?:\.git|\.agents|\.codex|\.aws|\.vibebridge-.*|repo-context\.txt|apply-changes(?:\..+)?\.ps1)$/i.test(part),
        'Invalid or protected project path: ' + relative);
    }
    let current = root;
    for (const part of parts) {
        current = path.join(current, part);
        const stat = info(current);
        if (!stat) continue;
        requireThat(!stat.isSymbolicLink() &&
            fs.realpathSync.native(current).toLowerCase() === current.toLowerCase(),
        'Asset aliases, links and junctions are unsupported: ' + relative);
    }
    return current;
}

function stateDirectory(root) {
    const state = path.join(root, STATE);
    if (!info(state)) fs.mkdirSync(state);
    const stat = info(state);
    requireThat(stat?.isDirectory() && !stat.isSymbolicLink() &&
        fs.realpathSync.native(state).toLowerCase() === state.toLowerCase(),
    'Invalid bridge state directory.');
    return state;
}

function writeAtomic(file, contents) {
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    try {
        fs.writeFileSync(temp, contents, { flag: 'wx' });
        fs.renameSync(temp, file);
    } finally {
        fs.rmSync(temp, { force: true });
    }
}

function readFile(file, limit = FILE_LIMIT) {
    const stat = info(file);
    requireThat(stat?.isFile() && !stat.isSymbolicLink(), 'Expected an ordinary file: ' + file);
    requireThat(stat.size <= limit, 'File exceeds bridge size limit: ' + file);
    const bytes = fs.readFileSync(file);
    requireThat(bytes.length <= limit, 'File exceeds bridge size limit: ' + file);
    return bytes;
}

function textView(bytes) {
    try {
        const decoded = decoder.decode(bytes);
        const bom = decoded.startsWith('\uFEFF');
        const content = bom ? decoded.slice(1) : decoded;
        const text = content.replace(/\r\n/g, '\n');
        const eol = text.includes('\r') || (content.includes('\r\n') && /(^|[^\r])\n/.test(content))
            ? 'mixed' : content.includes('\r\n') ? 'crlf' : 'lf';
        return { text, bom, eol };
    } catch {
        return null;
    }
}

function bytesFromText(text, { bom, eol }) {
    return Buffer.from((bom ? '\uFEFF' : '') + (eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text), 'utf8');
}

function metadata(project, file) {
    const current = jsonFile(file);
    requireThat(current.format === 'vibebridge-snapshot-v2' && current.project === project && ID.test(current.snapshotId),
        'The local snapshot is invalid. Refresh the watcher.');
    return current;
}

function publishSnapshot(root, packedPath, destination) {
    const state = stateDirectory(root);
    requireThat(!info(path.join(state, 'pending')), 'An interrupted patch needs recovery before refreshing the snapshot.');
    const packed = jsonFile(packedPath);
    requireThat(packed.files && typeof packed.files === 'object' && !Array.isArray(packed.files), 'Repomix did not return a file map.');
    const files = Object.create(null);
    for (const [name, text] of Object.entries(packed.files)) {
        requireThat(typeof text === 'string', 'Repomix returned an unexpected file entry.');
        files[name] = { text };
        try {
            const bytes = readFile(safePath(root, name));
            const view = textView(bytes);
            const packedText = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
            // Repomix can strip final newlines. Restore only those line breaks from approved files.
            if (view && view.eol !== 'mixed' &&
                (view.text === packedText || view.text.replace(/\n+$/, '') === packedText)) {
                files[name] = { ...view, sha256: digest(bytes) };
            }
        } catch {
            // A file can disappear, be filtered, or change during packing. Its packed view stays read-only.
        }
    }
    const snapshot = {
        format: 'vibebridge-snapshot-v2',
        project: path.basename(root),
        snapshotId: crypto.randomUUID(),
        directoryStructure: packed.directoryStructure,
        files
    };
    const base = {
        format: snapshot.format,
        project: snapshot.project,
        snapshotId: snapshot.snapshotId,
        files: Object.fromEntries(Object.entries(files).filter(([, entry]) => entry.sha256)
            .map(([name, entry]) => [name, entry.sha256]))
    };
    writeAtomic(destination, JSON.stringify(snapshot, null, 2) + '\n');
    writeAtomic(path.join(state, 'snapshot.json'), JSON.stringify(base));
    console.log('[SNAPSHOT] ' + snapshot.snapshotId);
}

function payload(bytes) {
    requireThat(bytes.every((byte) => byte < 128), 'Patch envelope must be ASCII.');
    const text = bytes.toString('ascii').replace(/\r\n/g, '\n');
    requireThat(text.startsWith(HEADER), 'Rejected executable or unsupported upload. Expected VibeBridge Delta v2 data.');
    return JSON.parse(text.slice(HEADER.length));
}

function encodedBytes(operation) {
    const value = operation.base64;
    requireThat(typeof value === 'string', 'Full file operations require Base64 bytes.');
    const bytes = Buffer.from(value, 'base64');
    requireThat(bytes.toString('base64') === value, 'Invalid or noncanonical Base64.');
    return bytes;
}

function applyEdits(bytes, edits) {
    const view = textView(bytes);
    requireThat(view && view.eol !== 'mixed', 'Text edits require UTF-8 and consistent line endings.');
    requireThat(Array.isArray(edits) && edits.length > 0, 'An edit operation requires at least one hunk.');
    const spans = edits.map(({ before, after }) => {
        const insertsIntoEmptyFile = view.text.length === 0 && edits.length === 1 && before === '';
        requireThat(typeof before === 'string' && (before.length > 0 || insertsIntoEmptyFile) &&
            typeof after === 'string' && before !== after && !before.includes('\r') && !after.includes('\r'),
        'Hunks require distinct before/after strings using LF.');
        const start = view.text.indexOf(before);
        requireThat(start !== -1 && (insertsIntoEmptyFile || view.text.indexOf(before, start + 1) === -1),
            'The before text must match exactly once in the original file.');
        return { start, end: start + before.length, after };
    }).sort((a, b) => a.start - b.start);
    let cursor = 0;
    let output = '';
    for (const span of spans) {
        requireThat(span.start >= cursor, 'Text hunks overlap.');
        output += view.text.slice(cursor, span.start) + span.after;
        cursor = span.end;
    }
    return bytesFromText(output + view.text.slice(cursor), view);
}

function prepare(root, patch, snapshot) {
    const paths = new Set();
    let transactionBytes = 0;
    requireThat(Array.isArray(patch.operations) && patch.operations.length > 0 && patch.operations.length <= 200,
        'Expected 1 to 200 operations.');
    return patch.operations.map((operation) => {
        const { op, path: relative, baseSha256, sha256 } = operation;
        const file = safePath(root, relative);
        const key = relative.toLowerCase();
        requireThat(![...paths].some((prior) => prior === key || prior.startsWith(key + '/') || key.startsWith(prior + '/')),
            'Duplicate or overlapping project path: ' + relative);
        paths.add(key);

        const before = op === 'create' ? null : readFile(file);
        if (op === 'create') {
            requireThat(!info(file), 'Create would overwrite an existing path: ' + relative);
        } else {
            requireThat(SHA.test(baseSha256) && digest(before) === baseSha256, 'Base SHA-256 mismatch: ' + relative);
        }

        let after;
        if (op === 'edit') {
            requireThat(snapshot.files[relative] === baseSha256, 'Text edit is not based on this snapshot: ' + relative);
            after = applyEdits(before, operation.edits);
        } else if (op === 'create' || op === 'replace') {
            // Existing snapshot text must use hunks. Full replacements are for binaries or
            // text whose exact bytes could not be reconstructed from the packed view.
            const view = before && textView(before);
            requireThat(op === 'create' || !snapshot.files[relative] || view?.eol === 'mixed',
                'Use text edits for existing snapshot text: ' + relative);
            after = encodedBytes(operation);
        } else if (op === 'delete') {
            requireThat(operation.confirmDelete === true, 'Deletion requires explicit authorization: ' + relative);
            after = null;
        } else {
            throw new Error('Unsupported patch operation: ' + op);
        }
        if (after !== null) {
            requireThat(after.length <= FILE_LIMIT && SHA.test(sha256) && digest(after) === sha256,
                'Output SHA-256 or size mismatch: ' + relative);
        }
        transactionBytes += (before?.length ?? 0) + (after?.length ?? 0);
        requireThat(transactionBytes <= 64 * 1024 * 1024, 'Patch transaction exceeds 64 MiB. Split the change.');
        return { relative, file, before, after };
    });
}

function checkBase(root, entry) {
    safePath(root, entry.relative);
    const { file, before } = entry;
    if (before === null) {
        requireThat(!info(file), 'File appeared before commit: ' + entry.relative);
    } else {
        requireThat(readFile(file).equals(before), 'File changed before commit: ' + entry.relative);
    }
}

function commit(root, state, receipt, patch, packageHash, entries) {
    const pending = path.join(state, 'pending');
    fs.mkdirSync(pending);
    const applied = [];
    const newDirectories = [];
    let preserve = false;
    try {
        fs.writeFileSync(path.join(state, 'used-' + patch.snapshotId), patch.patchId, { flag: 'wx' });
        entries.forEach(({ before, after }, index) => {
            if (before !== null) fs.writeFileSync(path.join(pending, index + '.before'), before);
            if (after !== null) fs.writeFileSync(path.join(pending, index + '.after'), after);
        });
        fs.writeFileSync(path.join(pending, 'recovery.json'), JSON.stringify({
            patchId: patch.patchId, packageHash, files: entries.map(({ relative, before }) => ({
                path: relative, existed: before !== null
            }))
        }, null, 2));
        entries.forEach((entry) => checkBase(root, entry));
        for (const [index, entry] of entries.entries()) {
            checkBase(root, entry);
            const { file, before, after } = entry;
            if (after === null) {
                fs.unlinkSync(file);
            } else {
                const parents = [];
                for (let parent = path.dirname(file); !info(parent); parent = path.dirname(parent)) parents.push(parent);
                for (const parent of parents.reverse()) {
                    fs.mkdirSync(parent);
                    newDirectories.push(parent);
                }
                const staged = path.join(pending, index + '.after');
                if (before === null) {
                    fs.copyFileSync(staged, file, fs.constants.COPYFILE_EXCL);
                } else {
                    fs.renameSync(staged, file);
                }
            }
            applied.push(entry);
        }
        fs.writeFileSync(receipt, JSON.stringify({
            patchId: patch.patchId, snapshotId: patch.snapshotId, packageHash,
            appliedAt: new Date().toISOString()
        }), { flag: 'wx' });
    } catch (error) {
        try {
            for (const { file, relative, before, after } of applied.reverse()) {
                safePath(root, relative);
                requireThat(after === null ? !info(file) : readFile(file).equals(after),
                    'File changed after commit: ' + relative);
                if (before === null) fs.unlinkSync(file);
                else writeAtomic(file, before);
            }
            for (const directory of newDirectories.reverse()) fs.rmdirSync(directory);
        } catch (rollbackError) {
            preserve = true;
            throw new Error(error.message + '; rollback needs attention: ' + rollbackError.message +
                '. Backups: ' + pending);
        }
        throw error;
    } finally {
        if (!preserve) fs.rmSync(pending, { recursive: true, force: true });
    }
}

function applyPatch(root, source) {
    const state = stateDirectory(root);
    requireThat(!info(path.join(state, 'pending')), 'An interrupted patch needs recovery before another upload can apply.');
    const bytes = readFile(source, PATCH_LIMIT);
    const patch = payload(bytes);
    requireThat(patch.version === 2 && typeof patch.patchId === 'string' && ID.test(patch.patchId),
        'Invalid patch version or patch ID.');
    requireThat(patch.project === path.basename(root), 'Patch targets a different project.');
    const receipt = path.join(state, 'applied-' + patch.patchId + '.json');
    requireThat(!info(receipt), 'Patch ID already applied: ' + patch.patchId);
    const snapshot = metadata(patch.project, path.join(state, 'snapshot.json'));
    requireThat(typeof patch.snapshotId === 'string' && ID.test(patch.snapshotId), 'Invalid patch snapshot ID.');
    requireThat(patch.snapshotId === snapshot.snapshotId, 'Stale snapshot. Received ' + patch.snapshotId +
        ', watcher expects ' + snapshot.snapshotId + '. Download the current repo-context.txt and regenerate the patch.');
    requireThat(!info(path.join(state, 'used-' + patch.snapshotId)), 'This snapshot already had an apply attempt. Refresh the watcher.');
    const entries = prepare(root, patch, snapshot);
    const packageHash = digest(bytes);
    console.log('[PATCH] ' + patch.patchId + ' SHA-256 ' + packageHash);
    commit(root, state, receipt, patch, packageHash, entries);
    console.log('[APPLIED] ' + patch.patchId + ' (' + entries.length + ' files)');
}

function makeSample(root, template, destination) {
    const snapshot = metadata(path.basename(root), path.join(stateDirectory(root), 'snapshot.json'));
    const patch = payload(readFile(template, PATCH_LIMIT));
    requireThat(patch.version === 2 && patch.operations.every(({ op }) => op === 'create'), 'Invalid offline sample template.');
    Object.assign(patch, { project: snapshot.project, snapshotId: snapshot.snapshotId, patchId: crypto.randomUUID() });
    prepare(root, patch, snapshot);
    fs.writeFileSync(destination, HEADER + JSON.stringify(patch) + '\n', { flag: 'wx' });
}

try {
    const [command, project, ...args] = process.argv.slice(2);
    const root = fs.realpathSync.native(project);
    requireThat(fs.statSync(root).isDirectory(), 'Project must be a directory.');
    if (command === 'snapshot' && args.length === 2) publishSnapshot(root, ...args);
    else if (command === 'apply' && args.length === 1) applyPatch(root, ...args);
    else if (command === 'sample' && args.length === 2) makeSample(root, ...args);
    else throw new Error('Usage: bridge-delta.cjs <snapshot|apply|sample> <project> <input> [output]');
} catch (error) {
    console.error('[BRIDGE] ' + error.message);
    process.exitCode = 1;
}

