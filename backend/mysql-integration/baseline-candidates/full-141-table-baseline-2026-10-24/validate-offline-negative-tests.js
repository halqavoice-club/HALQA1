'use strict';

const assert = require('assert');
const { REQUIRED_CHECKS, extractCreateTables, validateChecks } = require('./validate-offline');

let passed = 0;
function test(name, fn) { fn(); passed++; process.stdout.write(`PASS ${name}\n`); }
function fails(name, fn, pattern) { test(name, () => assert.throws(fn, pattern)); }

test('simple quoted CREATE TABLE', () => assert.deepStrictEqual(extractCreateTables('CREATE TABLE `a` (`id` INT);').map((x) => x.name), ['a']));
test('conditional quoted CREATE TABLE', () => assert.strictEqual(extractCreateTables('CREATE TABLE IF NOT EXISTS `a` (`id` INT);')[0].conditional, true));
test('conditional unquoted CREATE TABLE', () => assert.deepStrictEqual(extractCreateTables('CREATE TABLE IF NOT EXISTS a (id INT);').map((x) => x.name), ['a']));
test('multiline declaration', () => assert.deepStrictEqual(extractCreateTables('CREATE\n TABLE\n IF NOT EXISTS\n `s`.`a`\n(id INT);').map((x) => [x.schema, x.name]), [['s', 'a']]));
test('commented-out CREATE TABLE', () => assert.strictEqual(extractCreateTables('-- CREATE TABLE `bad` (`id` INT);\n/* CREATE TABLE bad2 (id INT); */').length, 0));
test('CREATE TABLE inside strings', () => assert.strictEqual(extractCreateTables("SELECT 'CREATE TABLE bad (id INT)';").length, 0));
fails('duplicate table definition', () => extractCreateTables('CREATE TABLE a (id INT); CREATE TABLE `a` (id INT);'), /duplicate/);
fails('malformed identifier', () => extractCreateTables('CREATE TABLE bad-name (id INT);'), /unrecognized/);
fails('unsupported conditional syntax', () => extractCreateTables('CREATE TABLE IF EXISTS a (id INT);'), /unrecognized/);
fails('unrecognized schema-changing statement', () => extractCreateTables('CREATE VIEW v AS SELECT 1;', { rejectOtherSchemaStatements: true }), /unrecognized schema-changing/);

function validChecks() { return REQUIRED_CHECKS.map((x) => ({ table: x.table, name: x.name, expression: x.expression })); }
function expectCheckFailure(name, mutate) { test(name, () => { const checks = validChecks(); mutate(checks); assert.ok(validateChecks(checks).length > 0); }); }
expectCheckFailure('correct count wrong constraint name', (c) => { c[0].name = 'wrong_name'; });
expectCheckFailure('correct name wrong table', (c) => { c[0].table = 'other'; });
expectCheckFailure('correct name wrong column', (c) => { c[0].expression = '`diamonds`>=0'; });
expectCheckFailure('positive versus nonnegative', (c) => { c[0].expression = '`coins`>0'; });
expectCheckFailure('removed wallet transaction type', (c) => { c[5].expression = c[5].expression.replace(",'DISPUTED'", ''); });
expectCheckFailure('added unauthorized membership role', (c) => { c[4].expression = c[4].expression.replace(')', ",'SUPER_ADMIN')"); });
expectCheckFailure('missing constraint', (c) => { c.pop(); });
expectCheckFailure('duplicate constraint', (c) => { c.push({ ...c[0] }); });
expectCheckFailure('tautology replacement', (c) => { c[0].expression = '1=1'; });

process.stdout.write(`PASS ${passed}/19 hostile offline tests\n`);
