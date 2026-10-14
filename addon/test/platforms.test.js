const assert = require('assert');
const test = require('node:test');
const { brandName, collapseProviders, expandPlatformIds, brandNamesForIds } = require('../src/platforms');

test('Amazon ad and channel variants collapse to Prime Video', () => {
    assert.equal(brandName('Amazon Prime Video'), 'Prime Video');
    assert.equal(brandName('Amazon Prime Video with Ads'), 'Prime Video');
    assert.equal(brandName('Amazon Prime Video Free with Ads'), 'Prime Video');
    assert.equal(brandName('Amazon Video'), 'Prime Video');
    assert.equal(brandName('Amazon MX Player'), 'Prime Video');
});

test('collapseProviders keeps one chip and all ids for a brand', () => {
    const collapsed = collapseProviders([
        { id: 9, name: 'Amazon Prime Video', priority: 1 },
        { id: 119, name: 'Amazon Prime Video with Ads', priority: 4 },
        { id: 2100, name: 'Amazon Prime Video Free with Ads', priority: 8 },
        { id: 8, name: 'Netflix', priority: 0 },
        { id: 1796, name: 'Netflix basic with Ads', priority: 5 },
    ]);
    assert.deepEqual(collapsed.map((item) => item.name), ['Netflix', 'Prime Video']);
    assert.equal(collapsed[0].id, 8);
    assert.deepEqual(collapsed[0].ids.map(String).sort(), ['1796', '8']);
    assert.equal(collapsed[1].id, 9);
    assert.deepEqual(collapsed[1].ids.map(String).sort(), ['119', '2100', '9']);
});

test('expandPlatformIds turns a brand id into every sibling provider', () => {
    const providers = collapseProviders([
        { id: 9, name: 'Amazon Prime Video', priority: 1 },
        { id: 119, name: 'Amazon Prime Video with Ads', priority: 4 },
        { id: 8, name: 'Netflix', priority: 0 },
    ]);
    assert.deepEqual(expandPlatformIds(['9'], providers).map(String).sort(), ['119', '9']);
    assert.deepEqual(brandNamesForIds(['9', '119', '8'], providers).sort(), ['Netflix', 'Prime Video']);
});
