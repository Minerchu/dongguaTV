'use strict';

const fs = require('fs');
const path = require('path');

function stamp(date) {
    const value = date instanceof Date ? date : new Date();
    const pad = number => String(number).padStart(2, '0');
    return value.getFullYear()
        + pad(value.getMonth() + 1)
        + pad(value.getDate())
        + '-'
        + pad(value.getHours())
        + pad(value.getMinutes())
        + pad(value.getSeconds());
}

function backupName(date) {
    const suffix = (Math.random().toString(36) + '0000').slice(2, 6);
    return 'db-' + stamp(date) + '-' + suffix + '.json';
}

function listBackups(backupDir) {
    try {
        return fs.readdirSync(backupDir)
            .filter(name => /^db-[0-9]{8}-[0-9]{6}-[a-z0-9]{4}\.json$/i.test(name))
            .map(name => {
                const full = path.join(backupDir, name);
                const stat = fs.statSync(full);
                return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
            })
            .sort((left, right) => right.name.localeCompare(left.name));
    } catch (error) {
        return [];
    }
}

function pruneBackups(backupDir, keep) {
    const limit = Math.max(1, Number(keep) || 7);
    const files = listBackups(backupDir);
    for (const file of files.slice(limit)) {
        try { fs.rmSync(path.join(backupDir, file.name), { force: true }); } catch (error) { }
    }
}

function createBackup(dataFile, backupDir, options) {
    const opts = options || {};
    if (!fs.existsSync(dataFile)) return null;
    fs.mkdirSync(backupDir, { recursive: true });
    const name = backupName(opts.now);
    const target = path.join(backupDir, name);
    fs.copyFileSync(dataFile, target);
    pruneBackups(backupDir, opts.keep || 7);
    return { name, size: fs.statSync(target).size, createdAt: new Date().toISOString() };
}

function backupPath(backupDir, name) {
    const safe = String(name || '');
    if (!/^db-[0-9]{8}-[0-9]{6}-[a-z0-9]{4}\.json$/i.test(safe)) throw new Error('备份文件名不正确');
    return path.join(backupDir, safe);
}

function readBackup(backupDir, name) {
    return fs.readFileSync(backupPath(backupDir, name), 'utf-8');
}

module.exports = { createBackup, listBackups, pruneBackups, backupPath, readBackup };
