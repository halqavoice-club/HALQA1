'use strict';

// Unit B-6 deterministic, offline-only validator. It reads local text files and
// never imports Prisma, opens a socket, spawns a process, or executes SQL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const BACKEND = path.resolve(DIR, '../../..');
const SCHEMA = path.join(BACKEND, 'prisma/schema.prisma');
const MIGRATIONS = path.join(BACKEND, 'prisma/migrations');
const BASELINE = path.join(DIR, 'mysql-8.4-full-baseline-candidate.sql');
const CHECKS = path.join(DIR, 'custom-sql-supplement.sql');
const FULLTEXT = path.join(DIR, 'historical-fulltext-index-supplement.sql');

function read(file) { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); }
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function artifactSetHash(files) {
  const hash = crypto.createHash('sha256');
  for (const name of files) { hash.update(Buffer.from(name + '\n')); hash.update(fs.readFileSync(path.join(DIR, name))); hash.update(Buffer.from('\n')); }
  return hash.digest('hex').toUpperCase();
}
function lineAt(text, offset) { return text.slice(0, offset).split(/\r?\n/).length; }
function splitList(value) {
  const out = []; let current = ''; let depth = 0; let quote = null;
  for (const ch of value) {
    if (quote) { current += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
function balancedArg(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  let depth = 0; let quote = null; const at = start + marker.length;
  for (let i = at; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === quote && text[i - 1] !== '\\') quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') { if (depth === 0) return text.slice(at, i); depth--; }
  }
  throw new Error(`unclosed ${marker}`);
}
function blockMatches(text, keyword) {
  const out = []; const re = new RegExp(`\\b${keyword}\\s+(\\w+)\\s*\\{`, 'g'); let m;
  while ((m = re.exec(text))) {
    let depth = 1; let i = re.lastIndex;
    for (; i < text.length && depth; i++) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; }
    if (depth) throw new Error(`unclosed ${keyword} ${m[1]}`);
    out.push({ name: m[1], body: text.slice(re.lastIndex, i - 1), line: lineAt(text, m.index) });
    re.lastIndex = i;
  }
  return out;
}

function parseSchema(text) {
  const enumMap = new Map(blockMatches(text, 'enum').map((e) => [e.name,
    e.body.split(/\r?\n/).map((x) => x.replace(/\/\/.*$/, '').trim()).filter((x) => /^\w+$/.test(x))]));
  const scalar = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes']);
  const models = new Map();
  for (const model of blockMatches(text, 'model')) {
    const table = (model.body.match(/@@map\("([^"]+)"\)/) || [])[1] || model.name;
    const fields = new Map(); const relations = []; const modelLines = model.body.split(/\r?\n/);
    for (let n = 0; n < modelLines.length; n++) {
      const clean = modelLines[n].replace(/\/\/.*$/, '').trim();
      const fm = clean.match(/^(\w+)\s+([\w]+)(\?|\[\])?\s*(.*)$/);
      if (!fm || clean.startsWith('@@')) continue;
      const [, prismaName, baseType, modifier = '', attrs] = fm;
      const relationArg = balancedArg(attrs, '@relation(');
      if (relationArg) {
        const fieldsArg = (relationArg.match(/fields:\s*\[([^\]]+)\]/) || [])[1];
        const refsArg = (relationArg.match(/references:\s*\[([^\]]+)\]/) || [])[1];
        if (fieldsArg && refsArg) relations.push({
          model: baseType, fields: splitList(fieldsArg), references: splitList(refsArg),
          onDelete: (relationArg.match(/onDelete:\s*(\w+)/) || [])[1] || null,
          onUpdate: (relationArg.match(/onUpdate:\s*(\w+)/) || [])[1] || 'Cascade',
          line: model.line + n + 1,
        });
      }
      if (!scalar.has(baseType) && !enumMap.has(baseType)) continue;
      const column = (attrs.match(/@map\("([^"]+)"\)/) || [])[1] || prismaName;
      const db = (attrs.match(/@db\.([A-Za-z]+(?:\([^)]*\))?)/) || [])[1] || null;
      fields.set(prismaName, { prismaName, column, baseType, enumValues: enumMap.get(baseType) || null,
        nullable: modifier === '?', db, id: /(?:^|\s)@id(?:\s|$)/.test(attrs),
        unique: /(?:^|\s)@unique(?:\s|$)/.test(attrs), default: balancedArg(attrs, '@default('),
        updatedAt: /(?:^|\s)@updatedAt(?:\s|$)/.test(attrs), line: model.line + n + 1 });
    }
    const indexes = [];
    for (let n = 0; n < modelLines.length; n++) {
      const clean = modelLines[n].replace(/\/\/.*$/, '').trim();
      const im = clean.match(/^@@(id|unique|index)\(\[([^\]]+)\](.*)\)$/);
      if (!im) continue;
      const options = im[3];
      indexes.push({ kind: im[1], fields: splitList(im[2]).map((x) => x.replace(/\(.*/, '').trim()),
        name: (options.match(/map:\s*"([^"]+)"/) || [])[1] || null, line: model.line + n + 1 });
    }
    models.set(model.name, { prismaName: model.name, table, fields, relations, indexes, line: model.line });
  }
  return { models, enumMap };
}

function parseSql(text) {
  const tables = new Map(); const tableRe = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\) DEFAULT CHARACTER SET ([^\s]+) COLLATE ([^;]+);/g; let m;
  while ((m = tableRe.exec(text))) {
    const table = { name: m[1], columns: new Map(), indexes: [], primary: null, charset: m[3], collation: m[4], line: lineAt(text, m.index) };
    for (const raw of m[2].split(/\r?\n/)) {
      const line = raw.trim().replace(/,$/, ''); if (!line) continue;
      const cm = line.match(/^`([^`]+)`\s+(.+?)\s+(NULL|NOT NULL)(.*)$/);
      if (cm) {
        const tail = cm[4]; table.columns.set(cm[1], { name: cm[1], type: cm[2], nullable: cm[3] === 'NULL',
          default: (tail.match(/\sDEFAULT\s+(.+?)(?:\s+AUTO_INCREMENT)?$/) || [])[1] || null,
          autoIncrement: /\bAUTO_INCREMENT\b/.test(tail), line: table.line + m[2].slice(0, m[2].indexOf(raw)).split(/\r?\n/).length }); continue;
      }
      const pm = line.match(/^PRIMARY KEY \(([^)]+)\)$/); if (pm) { table.primary = quotedCols(pm[1]); continue; }
      const im = line.match(/^(UNIQUE )?INDEX `([^`]+)`\((.+)\)$/);
      if (im) table.indexes.push({ unique: Boolean(im[1]), name: im[2], columns: quotedCols(im[3]), line: table.line + m[2].slice(0, m[2].indexOf(raw)).split(/\r?\n/).length });
    }
    if (tables.has(table.name)) throw new Error(`duplicate table ${table.name}`); tables.set(table.name, table);
  }
  const fks = []; const fkRe = /ALTER TABLE `([^`]+)` ADD CONSTRAINT `([^`]+)` FOREIGN KEY \(([^)]+)\) REFERENCES `([^`]+)`\(([^)]+)\) ON DELETE (CASCADE|RESTRICT|SET NULL|NO ACTION) ON UPDATE (CASCADE|RESTRICT|SET NULL|NO ACTION);/g;
  while ((m = fkRe.exec(text))) fks.push({ sourceTable: m[1], name: m[2], sourceColumns: quotedCols(m[3]), targetTable: m[4], targetColumns: quotedCols(m[5]), onDelete: m[6], onUpdate: m[7], line: lineAt(text, m.index) });
  return { tables, fks };
}
function quotedCols(value) { return [...value.matchAll(/`([^`]+)`/g)].map((m) => m[1]); }
function sqlType(field) {
  if (field.db) return field.db.replace(/^VarChar/i, 'VARCHAR').replace(/^Decimal/i, 'DECIMAL').replace(/^LongText/i, 'LONGTEXT').replace(/^Text/i, 'TEXT').replace(/^Date$/i, 'DATE').replace(/,\s*/g, ',');
  if (field.enumValues) return `ENUM(${field.enumValues.map((v) => `'${v}'`).join(',')})`;
  return ({ String: 'VARCHAR(191)', Int: 'INTEGER', BigInt: 'BIGINT', Float: 'DOUBLE', Decimal: 'DECIMAL(65,30)', Boolean: 'BOOLEAN', DateTime: 'DATETIME(3)', Json: 'JSON', Bytes: 'LONGBLOB' })[field.baseType];
}
function sqlDefault(field) {
  const value = field.default; if (value == null || /^(uuid|cuid|autoincrement)\(/.test(value)) return null;
  if (value === 'now()') return 'CURRENT_TIMESTAMP(3)';
  if (/^dbgenerated\(/.test(value)) return value.replace(/^dbgenerated\("|"\)$/g, '');
  if (/^"[\s\S]*"$/.test(value)) return `'${value.slice(1, -1).replace(/'/g, "''")}'`;
  if (field.enumValues) return `'${value}'`;
  return value;
}
function action(value) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase(); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function validateParity(schema, sql) {
  const errors = []; const tables = []; const modelByTable = new Map([...schema.models.values()].map((m) => [m.table, m]));
  for (const model of schema.models.values()) {
    const actual = sql.tables.get(model.table); const row = { table: model.table, prismaModel: model.prismaName, prismaLine: model.line, candidateLine: actual?.line || null, columns: [], indexes: [], foreignKeys: [] };
    if (!actual) { errors.push(`missing table ${model.table}`); tables.push(row); continue; }
    for (const field of model.fields.values()) {
      const col = actual.columns.get(field.column); const expected = { type: sqlType(field), nullable: field.nullable, default: sqlDefault(field), autoIncrement: field.default === 'autoincrement()' };
      const actualValue = col && { type: col.type.replace(/,\s*/g, ','), nullable: col.nullable, default: col.default, autoIncrement: col.autoIncrement };
      const status = col && same(expected, actualValue) ? 'PASS' : 'FAIL';
      row.columns.push({ prismaField: field.prismaName, column: field.column, prismaLine: field.line, candidateLine: col?.line || null, expected, actual: actualValue || null, status });
      if (status === 'FAIL') errors.push(`${model.table}.${field.column} column mismatch`);
    }
    for (const extra of actual.columns.keys()) if (![...model.fields.values()].some((f) => f.column === extra)) errors.push(`extra column ${model.table}.${extra}`);
    const fieldPk = [...model.fields.values()].filter((f) => f.id).map((f) => f.column);
    const modelPk = model.indexes.find((i) => i.kind === 'id'); const expectedPk = modelPk ? modelPk.fields.map((f) => model.fields.get(f).column) : fieldPk;
    row.primaryKey = { expected: expectedPk, actual: actual.primary, status: same(expectedPk, actual.primary) ? 'PASS' : 'FAIL' };
    if (row.primaryKey.status === 'FAIL') errors.push(`${model.table} primary key mismatch`);
    const expectedIndexes = [];
    for (const f of model.fields.values()) if (f.unique) expectedIndexes.push({ unique: true, name: `${model.table}_${f.column}_key`, columns: [f.column] });
    for (const idx of model.indexes.filter((i) => i.kind !== 'id')) {
      const cols = idx.fields.map((f) => model.fields.get(f).column); const suffix = idx.kind === 'unique' ? 'key' : 'idx';
      expectedIndexes.push({ unique: idx.kind === 'unique', name: idx.name || `${model.table}_${cols.join('_')}_${suffix}`, columns: cols });
    }
    for (const expected of expectedIndexes) {
      const found = actual.indexes.find((i) => i.name === expected.name); const status = found && found.unique === expected.unique && same(found.columns, expected.columns) ? 'PASS' : 'FAIL';
      row.indexes.push({ ...expected, candidateLine: found?.line || null, actual: found ? { unique: found.unique, columns: found.columns } : null, status });
      if (status === 'FAIL') errors.push(`${model.table}.${expected.name} index mismatch`);
    }
    for (const found of actual.indexes) if (!expectedIndexes.some((i) => i.name === found.name)) errors.push(`extra index ${model.table}.${found.name}`);
    tables.push(row);
  }
  for (const extra of sql.tables.keys()) if (!modelByTable.has(extra)) errors.push(`extra table ${extra}`);

  const fkNames = new Set();
  for (const fk of sql.fks) {
    const sourceModel = modelByTable.get(fk.sourceTable); const targetModel = modelByTable.get(fk.targetTable); let matched = null;
    if (sourceModel && targetModel) matched = sourceModel.relations.find((r) => r.model === targetModel.prismaName &&
      same(r.fields.map((f) => sourceModel.fields.get(f)?.column), fk.sourceColumns) &&
      same(r.references.map((f) => targetModel.fields.get(f)?.column), fk.targetColumns));
    const sourceTypes = sourceModel ? fk.sourceColumns.map((c) => sql.tables.get(fk.sourceTable).columns.get(c)?.type) : [];
    const targetTypes = targetModel ? fk.targetColumns.map((c) => sql.tables.get(fk.targetTable).columns.get(c)?.type) : [];
    const referencedKey = targetModel && (same(sql.tables.get(fk.targetTable).primary, fk.targetColumns) || sql.tables.get(fk.targetTable).indexes.some((i) => i.unique && same(i.columns, fk.targetColumns)));
    const expectedDelete = matched ? (matched.onDelete ? action(matched.onDelete) : (matched.fields.some((f) => sourceModel.fields.get(f)?.nullable) ? 'SET NULL' : 'RESTRICT')) : null;
    const status = Boolean(matched && same(sourceTypes, targetTypes) && referencedKey && expectedDelete === fk.onDelete && action(matched.onUpdate) === fk.onUpdate && !fkNames.has(fk.name)) ? 'PASS' : 'FAIL';
    fkNames.add(fk.name);
    const record = { ...fk, prismaLine: matched?.line || null, sourceTypes, targetTypes, referencedKey: Boolean(referencedKey), sourceNullable: fk.sourceColumns.map((c) => sql.tables.get(fk.sourceTable).columns.get(c).nullable), expectedOnDelete: expectedDelete, expectedOnUpdate: matched ? action(matched.onUpdate) : null, status };
    const row = tables.find((t) => t.table === fk.sourceTable); if (row) row.foreignKeys.push(record);
    if (status === 'FAIL') errors.push(`foreign key mismatch ${fk.name}`);
  }
  const expectedRelationCount = [...schema.models.values()].reduce((n, m) => n + m.relations.length, 0);
  if (expectedRelationCount !== sql.fks.length) errors.push(`relation/FK count mismatch ${expectedRelationCount}/${sql.fks.length}`);
  return { errors, tables, summary: { prismaModels: schema.models.size, candidateTables: sql.tables.size, columns: tables.reduce((n, t) => n + t.columns.length, 0), primaryKeys: tables.filter((t) => t.primaryKey?.status === 'PASS').length, indexes: tables.reduce((n, t) => n + t.indexes.length, 0), foreignKeys: sql.fks.length, expectedRelations: expectedRelationCount } };
}

function parseCustomObjects(checkText, fulltextText) {
  const checks = [...checkText.matchAll(/ALTER TABLE `([^`]+)`[\s\S]*?(?:ADD CONSTRAINT `([^`]+)`\s+CHECK\s*\(([\s\S]*?)\))(?:,|;)/g)].map((m) => ({ table: m[1], name: m[2], expression: m[3].replace(/\s+/g, ' ').trim(), line: lineAt(checkText, m.index) }));
  // The first ALTER contains four constraints; collect the remaining ADD clauses too.
  for (const m of checkText.matchAll(/ADD CONSTRAINT `([^`]+)`\s+CHECK\s*\(([^;]*?)\)(?:,|;)/g)) {
    if (!checks.some((c) => c.name === m[1])) {
      const before = checkText.slice(0, m.index); const table = [...before.matchAll(/ALTER TABLE `([^`]+)`/g)].pop()[1];
      checks.push({ table, name: m[1], expression: m[2].replace(/\s+/g, ' ').trim(), line: lineAt(checkText, m.index) });
    }
  }
  const fulltext = [...fulltextText.matchAll(/ALTER TABLE `([^`]+)`\s+ADD FULLTEXT INDEX `([^`]+)` \(([^)]+)\);/g)].map((m) => ({ table: m[1], name: m[2], columns: quotedCols(m[3]), line: lineAt(fulltextText, m.index) }));
  return { checks, fulltext };
}

function sqlStatements(text) {
  const statements = []; let clean = ''; let state = 'normal'; let line = 1; let startLine = null;
  function append(ch) { clean += ch; if (startLine === null && !/\s/.test(ch)) startLine = line; }
  function finish() { if (clean.trim()) statements.push({ text: clean.trim(), line: startLine || line }); clean = ''; startLine = null; }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '\n') line++;
    if (state === 'line-comment') { if (ch === '\n') { state = 'normal'; append('\n'); } else append(' '); continue; }
    if (state === 'block-comment') { if (ch === '*' && next === '/') { append('  '); i++; state = 'normal'; } else append(ch === '\n' ? '\n' : ' '); continue; }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (ch === '\\' && next !== undefined) { append('  '); i++; continue; }
      if (ch === quote && next === quote) { append('  '); i++; continue; }
      if (ch === quote) { append(ch); state = 'normal'; } else append(ch === '\n' ? '\n' : ' ');
      continue;
    }
    if (state === 'backtick') {
      append(ch);
      if (ch === '`' && next === '`') { append(next); i++; continue; }
      if (ch === '`') state = 'normal';
      continue;
    }
    if (ch === '-' && next === '-' && (i + 2 >= text.length || /\s/.test(text[i + 2]))) { append('  '); i++; state = 'line-comment'; continue; }
    if (ch === '#') { append(' '); state = 'line-comment'; continue; }
    if (ch === '/' && next === '*') { append('  '); i++; state = 'block-comment'; continue; }
    if (ch === "'") { append(ch); state = 'single'; continue; }
    if (ch === '"') { append(ch); state = 'double'; continue; }
    if (ch === '`') { append(ch); state = 'backtick'; continue; }
    if (ch === ';') { finish(); continue; }
    append(ch);
  }
  if (state !== 'normal' && state !== 'line-comment') throw new Error(`unterminated SQL ${state}`);
  finish(); return statements;
}

function parseIdentifier(token) {
  if (/^`(?:``|[^`])+`$/.test(token)) return { name: token.slice(1, -1).replace(/``/g, '`'), quoted: true };
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(token)) return { name: token, quoted: false };
  throw new Error(`malformed SQL identifier: ${token}`);
}

function extractCreateTables(text, { rejectOtherSchemaStatements = false } = {}) {
  const creates = []; const id = '(?:`(?:``|[^`])+`|[A-Za-z_][A-Za-z0-9_$]*)';
  const createRe = new RegExp(`^CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?(${id})(?:\\s*\\.\\s*(${id}))?\\s*\\(`, 'i');
  for (const statement of sqlStatements(text)) {
    const hasCreateTable = /\bCREATE\s+TABLE\b/i.test(statement.text);
    const match = statement.text.match(createRe);
    if (hasCreateTable && !match) throw new Error(`unrecognized CREATE TABLE at line ${statement.line}`);
    if (match) {
      const schema = match[3] ? parseIdentifier(match[2]).name : null;
      const table = parseIdentifier(match[3] || match[2]);
      creates.push({ name: table.name, schema, quoted: table.quoted, conditional: Boolean(match[1]), line: statement.line, exactDefinition: match[0].replace(/\s+/g, ' ').trim() });
    } else if (rejectOtherSchemaStatements && /^(?:CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i.test(statement.text)) {
      throw new Error(`unrecognized schema-changing statement at line ${statement.line}`);
    }
  }
  const duplicates = creates.filter((x, i) => creates.findIndex((y) => `${y.schema || ''}.${y.name}` === `${x.schema || ''}.${x.name}`) !== i);
  if (duplicates.length) throw new Error(`duplicate CREATE TABLE: ${duplicates[0].name}`);
  return creates;
}

const REQUIRED_CHECKS = Object.freeze([
  { table: 'wallets', name: 'chk_wallet_coins_positive', expression: '`coins`>=0', columns: ['coins'] },
  { table: 'wallets', name: 'chk_wallet_diamonds_positive', expression: '`diamonds`>=0', columns: ['diamonds'] },
  { table: 'wallets', name: 'chk_wallet_total_spent', expression: '`totalSpent`>=0', columns: ['totalSpent'] },
  { table: 'wallets', name: 'chk_wallet_total_earned', expression: '`totalEarned`>=0', columns: ['totalEarned'] },
  { table: 'school_memberships', name: 'chk_membership_role', expression: "`role`IN('SCHOOL_ADMIN','TEACHER','STUDENT','GUARDIAN','REPRESENTATIVE')", columns: ['role'] },
  { table: 'wallet_transactions', name: 'chk_wallet_tx_type', expression: "`type`IN('STRIPE_PURCHASE','GIFT_SEND','GIFT_RECEIVE','TIP_SEND','TIP_RECEIVE','SUBSCRIPTION','SUBSCRIPTION_RECEIVE','ADMIN_GRANT','REFUND','PAYOUT','PAYOUT_REVERSAL','DISPUTED')", columns: ['type'] },
]);
function normalizeCheckExpression(expression) { return expression.replace(/\s+/g, ''); }
function validateChecks(checks) {
  const errors = []; const seen = new Set();
  for (const check of checks) {
    if (seen.has(check.name)) errors.push(`duplicate CHECK ${check.name}`); seen.add(check.name);
    const expected = REQUIRED_CHECKS.find((x) => x.name === check.name);
    if (!expected) { errors.push(`unexpected CHECK ${check.name}`); continue; }
    if (check.table !== expected.table) errors.push(`CHECK table mismatch ${check.name}`);
    if (normalizeCheckExpression(check.expression) !== expected.expression) errors.push(`CHECK expression mismatch ${check.name}`);
    const actualColumns = [...check.expression.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (!same([...new Set(actualColumns)], expected.columns)) errors.push(`CHECK column mismatch ${check.name}`);
  }
  for (const expected of REQUIRED_CHECKS) if (!checks.some((x) => x.name === expected.name)) errors.push(`missing CHECK ${expected.name}`);
  if (checks.length !== REQUIRED_CHECKS.length) errors.push(`CHECK count ${checks.length}`);
  return errors;
}

function scanMigrations(baseSql, supplements) {
  const files = fs.readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => path.join(MIGRATIONS, d.name, 'migration.sql')).filter(fs.existsSync).sort();
  const entries = []; const patterns = [
    ['check', /ADD CONSTRAINT `([^`]+)`\s+CHECK\s*\(([^;]+?)\)(?=,|;)/gis],
    ['fulltext-index', /ALTER TABLE `([^`]+)`\s+ADD FULLTEXT INDEX `([^`]+)` \(([^)]+)\)/gis],
    ['drop-table', /DROP TABLE(?: IF EXISTS)? `([^`]+)`/gi],
    ['create-index', /CREATE\s+(UNIQUE\s+)?INDEX(?: IF NOT EXISTS)? `([^`]+)`\s+ON `([^`]+)`\s*\(([^;]+)\)/gi],
    ['drop-index', /DROP INDEX `([^`]+)`/gi], ['add-foreign-key', /ADD CONSTRAINT `([^`]+)` FOREIGN KEY/gi],
    ['drop-foreign-key', /DROP FOREIGN KEY `([^`]+)`/gi], ['add-column', /ADD COLUMN `([^`]+)`/gi],
    ['drop-column', /DROP COLUMN `([^`]+)`/gi], ['modify-column', /MODIFY(?: COLUMN)? `([^`]+)`/gi],
    ['rename-table', /RENAME TABLE `([^`]+)` TO `([^`]+)`/gi], ['data-transformation', /(?:^|;)\s*(UPDATE|INSERT INTO|DELETE FROM)\s+/gim],
    ['dynamic-sql', /\b(?:PREPARE|EXECUTE|DEALLOCATE PREPARE|SET @)\b/gi], ['charset-collation', /\b(?:CHARACTER SET|COLLATE)\b/gi],
  ];
  for (const file of files) {
    const text = read(file); const rel = path.relative(BACKEND, file).replace(/\\/g, '/');
    for (const created of extractCreateTables(text)) entries.push({ objectId: `${path.basename(path.dirname(file))}:${created.line}:create-table:${created.name}`, objectType: 'create-table', sourceMigration: rel, sourceLine: created.line, targetTable: created.name, objectName: created.name, exactDefinition: created.exactDefinition, conditional: created.conditional, quoted: created.quoted, schema: created.schema, laterChanges: [], currentIntendedStatus: baseSql.includes('CREATE TABLE `' + created.name + '`') ? 'represented-current' : 'historical-review-required', presenceInBaseSql: baseSql.includes('CREATE TABLE `' + created.name + '`'), presenceInSupplements: false, verificationMethod: 'comment/string-aware SQL statement tokenizer plus exhaustive final parity', unresolvedAssumptions: [] });
    for (const [type, re] of patterns) { re.lastIndex = 0; let m; while ((m = re.exec(text))) {
      const definition = m[0].replace(/\s+/g, ' ').trim();
      const name = type === 'fulltext-index' ? m[2] : type === 'create-index' ? m[2] : (m[1] || null);
      const presentInBase = name ? baseSql.includes('`' + name + '`') : false;
      const presentInSupplement = name ? supplements.includes('`' + name + '`') : false;
      const structural = ['create-table','create-index','add-foreign-key','add-column','modify-column','charset-collation'].includes(type);
      const status = presentInBase || presentInSupplement ? 'represented-current'
        : type.startsWith('drop-') || type === 'rename-table' ? 'historical-removal'
        : type === 'data-transformation' ? 'historical-data-only-empty-baseline'
        : type === 'dynamic-sql' ? 'reconciled-by-exhaustive-final-parity'
        : structural ? 'reconciled-by-exhaustive-final-parity' : 'reviewed-no-separate-final-object';
      entries.push({ objectId: `${path.basename(path.dirname(file))}:${lineAt(text, m.index)}:${type}:${name || entries.length}`, objectType: type, sourceMigration: rel, sourceLine: lineAt(text, m.index), targetTable: type === 'fulltext-index' ? m[1] : (type === 'create-index' ? m[3] : null), objectName: name, exactDefinition: definition, laterChanges: [], currentIntendedStatus: status, presenceInBaseSql: presentInBase, presenceInSupplements: presentInSupplement, verificationMethod: structural || type === 'dynamic-sql' ? 'exhaustive final Prisma-to-candidate parity ledger' : 'historical statement classification', unresolvedAssumptions: type === 'data-transformation' ? ['not replayed because a from-empty baseline contains no pre-existing rows'] : type === 'dynamic-sql' ? ['branching migration mechanics are superseded by verified final structure'] : [] });
    }}
  }
  const creates = entries.filter((e) => e.objectType === 'create-table');
  return { summary: { totalMigrations: files.length, totalLifecycleEntries: entries.length, byType: Object.fromEntries([...new Set(entries.map((e) => e.objectType))].sort().map((t) => [t, entries.filter((e) => e.objectType === t).length])), createTables: { executableStatements: creates.length, uniquePhysicalTables: new Set(creates.map((e) => e.objectName)).size, migrationsContainingCreateTable: new Set(creates.map((e) => e.sourceMigration)).size, plainQuoted: creates.filter((e) => !e.conditional && e.quoted).length, conditionalQuoted: creates.filter((e) => e.conditional && e.quoted).length, plainUnquoted: creates.filter((e) => !e.conditional && !e.quoted).length, conditionalUnquoted: creates.filter((e) => e.conditional && !e.quoted).length, duplicateCreates: creates.length - new Set(creates.map((e) => e.objectName)).size } }, entries };
}

function main() {
  const schemaText = read(SCHEMA), baselineText = read(BASELINE), checkText = read(CHECKS), fulltextText = read(FULLTEXT);
  const schema = parseSchema(schemaText), sql = parseSql(baselineText), parity = validateParity(schema, sql), custom = parseCustomObjects(checkText, fulltextText);
  const errors = [...parity.errors];
  const requiredFt = new Map([['posts_ft_body',['posts','body']],['users_ft_name',['users','firstName','lastName']],['communities_ft_name_desc',['communities','name','description']],['voice_rooms_ft_title_topic',['voice_rooms','title','topic','description']],['hashtags_ft_name',['hashtags','name']]]);
  for (const [name, spec] of requiredFt) { const found = custom.fulltext.find((x) => x.name === name); if (!found || found.table !== spec[0] || !same(found.columns, spec.slice(1))) errors.push(`FULLTEXT mismatch ${name}`); }
  if (custom.fulltext.length !== 5) errors.push(`FULLTEXT count ${custom.fulltext.length}`);
  errors.push(...validateChecks(custom.checks));
  const migrations = scanMigrations(baselineText, checkText + '\n' + fulltextText);
  if (migrations.summary.totalMigrations !== 103) errors.push(`migration count ${migrations.summary.totalMigrations}`);
  const expectedCreateSummary = { executableStatements: 141, uniquePhysicalTables: 141, migrationsContainingCreateTable: 36, plainQuoted: 94, conditionalQuoted: 46, plainUnquoted: 0, conditionalUnquoted: 1, duplicateCreates: 0 };
  if (!same(migrations.summary.createTables, expectedCreateSummary)) errors.push(`CREATE TABLE classification mismatch: ${JSON.stringify(migrations.summary.createTables)}`);
  const historicalTables = migrations.entries.filter((e) => e.objectType === 'create-table').map((e) => e.objectName).sort();
  const candidateTables = [...sql.tables.keys()].sort();
  if (!same(historicalTables, candidateTables)) errors.push('historical CREATE TABLE set does not match final candidate table inventory');
  const output = { formatVersion: 1, generatedBy: 'validate-offline.js', status: errors.length ? 'FAIL' : 'PASS', errors, summary: { ...parity.summary, checks: custom.checks.length, fulltextIndexes: custom.fulltext.length, migrations: migrations.summary.totalMigrations }, sourceHashes: { schemaPrisma: sha(SCHEMA), baselineSql: sha(BASELINE), checkSupplement: sha(CHECKS), fulltextSupplement: sha(FULLTEXT) }, tables: parity.tables, customObjects: custom };
  if (process.argv.includes('--write')) {
    fs.writeFileSync(path.join(DIR, 'parity-object-ledger.json'), JSON.stringify(output, null, 2) + '\n');
    fs.writeFileSync(path.join(DIR, 'migration-object-ledger.json'), JSON.stringify(migrations, null, 2) + '\n');
  }
  const manifest = JSON.parse(read(path.join(DIR, 'full-schema-manifest.json')));
  const bindings = [
    ['candidateSQL', 'mysql-8.4-full-baseline-candidate.sql'], ['checkSupplement', 'custom-sql-supplement.sql'],
    ['historicalIndexSupplement', 'historical-fulltext-index-supplement.sql'], ['customObjectInventory', 'custom-sql-objects.json'],
    ['migrationObjectLedger', 'migration-object-ledger.json'], ['parityObjectLedger', 'parity-object-ledger.json'], ['offlineValidator', 'validate-offline.js'],
    ['offlineNegativeTests', 'validate-offline-negative-tests.js'],
  ];
  for (const [key, name] of bindings) if (manifest.metadata[key]?.sha256 !== sha(path.join(DIR, name))) errors.push(`manifest hash mismatch ${name}`);
  if (manifest.metadata.sourceSchema?.sha256 !== sha(SCHEMA)) errors.push('manifest schema hash mismatch');
  if (manifest.metadata.artifactSet.sha256 !== artifactSetHash(manifest.metadata.artifactSet.canonicalFiles)) errors.push('artifact-set hash mismatch');
  if (!same(manifest.metadata.approvedExecutionOrder, ['mysql-8.4-full-baseline-candidate.sql','historical-fulltext-index-supplement.sql','custom-sql-supplement.sql'])) errors.push('execution order mismatch');
  output.status = errors.length ? 'FAIL' : 'PASS'; output.errors = errors;
  process.stdout.write(JSON.stringify({ status: output.status, errors, summary: output.summary, sourceHashes: output.sourceHashes }, null, 2) + '\n');
  process.exitCode = errors.length ? 1 : 0;
}

if (require.main === module) main();
module.exports = { REQUIRED_CHECKS, extractCreateTables, normalizeCheckExpression, parseCustomObjects, sqlStatements, validateChecks };
