const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyLibrary } = require('../src/store');
const { manifestFor } = require('../src/manifest');

test('manifest version changes when shelves change so Stremio refreshes without reinstall', () => {
    const library = emptyLibrary();
    const first = manifestFor(library).version;
    library.lists.push({ id: 'l1', name: 'Comfort', filmIds: [], order: 0 });
    const second = manifestFor(library).version;
    assert.notEqual(first, second);
    assert.match(second, /^0\.2\.\d+$/);
});
