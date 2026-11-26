import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const directory = new URL('./migrations/', import.meta.url);
const migrations = readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map((name, index) => {
  if (!name.startsWith(String(index + 1).padStart(3, '0') + '_')) throw Error('Invalid migration sequence: ' + name);
  const sql = readFileSync(new URL(name, directory), 'utf8');
  return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
});

export function migrate(db) {
  // Serialize startup across connections, including adoption of legacy databases.
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)');
    const applied = db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version').all();
    for (const [index, row] of applied.entries()) {
      const file = migrations[index];
      if (row.version !== index + 1 || file?.name !== row.name || file.checksum !== row.checksum)
        throw Error('Database migration history differs from this release at version ' + row.version);
    }
    const insert = db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?, ?)');
    for (const [index, file] of migrations.entries()) {
      if (index < applied.length) continue;
      db.exec(file.sql);
      if (db.prepare('PRAGMA foreign_key_check').get()) throw Error('Foreign key violation in ' + file.name);
      insert.run(index + 1, file.name, file.checksum, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
