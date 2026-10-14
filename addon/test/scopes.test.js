const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanScope, scopeParams, isPooled, movieOnly } = require('../src/scopes');
const { cleanFilters } = require('../src/library');

test('cleanScope accepts JSON, shorthand and objects', () => {
    assert.deepEqual(cleanScope('{"kind":"person","id":"525","role":"crew","name":"Christopher Nolan"}'), {
        kind: 'person', id: '525', name: 'Christopher Nolan', role: 'crew',
    });
    assert.deepEqual(cleanScope('person:6384'), { kind: 'person', id: '6384', name: '', role: 'cast' });
    assert.deepEqual(cleanScope({ kind: 'list', id: 'criterion' }), { kind: 'list', id: 'criterion', name: 'The Criterion Collection' });
    assert.equal(cleanScope({ kind: 'list', id: 'nope' }), null);
    assert.equal(cleanScope({ kind: 'company', id: '1;drop' }), null);
    assert.equal(cleanScope({ kind: 'wat', id: '1' }), null);
    assert.equal(cleanScope(''), null);
});

test('scopes map to discover params or local pools', () => {
    assert.deepEqual(scopeParams({ kind: 'company', id: '41077' }), { with_companies: '41077' });
    assert.deepEqual(scopeParams({ kind: 'keyword', id: '4379' }), { with_keywords: '4379' });
    assert.equal(isPooled({ kind: 'person', id: '1' }), true);
    assert.equal(isPooled({ kind: 'company', id: '1' }), false);
    assert.equal(movieOnly({ kind: 'list', id: 'criterion' }), true);
    assert.equal(movieOnly({ kind: 'person', id: '1' }), false);
});

test('saved filters keep a cleaned scope', () => {
    const filters = cleanFilters({ scope: '{"kind":"list","id":"criterion","movieOnly":true}', sort: 'list' });
    assert.deepEqual(filters.scope, { kind: 'list', id: 'criterion', name: 'The Criterion Collection' });
    assert.equal(filters.sort, 'list');
});
