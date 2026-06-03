import Database from 'better-sqlite3';

const db = new Database('data/alai.db');

function cols(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function addCol(table, name, type) {
  if (!cols(table).includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    return name;
  }
  return null;
}

const added = [];

for (const [name, type] of [
  ['hypothesis_id', "TEXT DEFAULT ''"],
  ['concept_a', "TEXT DEFAULT ''"],
  ['concept_b', "TEXT DEFAULT ''"],
  ['reason', "TEXT DEFAULT ''"]
]) {
  const x = addCol('hypothesis_validation_log', name, type);
  if (x) added.push(x);
}

console.log(JSON.stringify({
  fixed_table: 'hypothesis_validation_log',
  added_columns: added,
  schema: db.prepare(`PRAGMA table_info(hypothesis_validation_log)`).all()
}, null, 2));

db.close();
