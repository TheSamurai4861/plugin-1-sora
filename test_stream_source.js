const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = __dirname;
const scriptPath = path.join(projectRoot, 'stream-source.js');
const manifestPath = path.join(projectRoot, 'venom-stream.json');
const scriptCode = fs.readFileSync(scriptPath, 'utf8');

function makeSandbox() {
    const requests = [];
    const sandbox = {
        console,
        assert,
        Buffer,
        process,
        URLSearchParams,
        fetchv2: async (url, headers, method, body) => {
            requests.push({ url, headers, method, body });

            if (url.startsWith('https://api.themoviedb.org/3/movie/597')) {
                return {
                    json: async () => ({
                        id: 597,
                        title: 'Titanic',
                        original_title: 'Titanic',
                        release_date: '1997-12-19',
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/search')) {
                return {
                    json: async () => ({
                        results: [{ id: 132531, title: 'Titanic' }],
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/films/download/132531')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                type: 'hls',
                                m3u8: '',
                                quality: '1080p',
                                language: 'MULTI',
                            },
                            {
                                type: 'hls',
                                m3u8: 'https://example.com/titanic-720p.m3u8',
                                quality: '720p',
                                language: 'VF',
                            },
                        ],
                    }),
                };
            }

            throw new Error(`Unexpected fetchv2 request: ${url}`);
        },
    };

    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox, { filename: scriptPath });
    return { sandbox, requests };
}

function testManifest() {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.asyncJS, true, 'asyncJS should be true');
    assert.strictEqual(manifest.streamAsyncJS, false, 'streamAsyncJS should be false');
    assert.ok(typeof manifest.searchBaseUrl === 'string', 'searchBaseUrl must be a string');
    assert.ok(manifest.searchBaseUrl.includes('%s'), 'searchBaseUrl must include %s');
    assert.ok(typeof manifest.scriptUrl === 'string' && manifest.scriptUrl.length > 0, 'scriptUrl must be defined');
}

async function testSearchSourceMovie() {
    const { sandbox, requests } = makeSandbox();
    const result = await sandbox.searchSourceMovie('Titanic');

    assert.ok(result, 'searchSourceMovie must return a result object');
    assert.ok(Array.isArray(result.results), 'searchSourceMovie results should be an array');
    assert.strictEqual(result.results[0].id, 132531);
    assert.strictEqual(requests.length, 1, 'One fetchv2 request should be made');
    assert.strictEqual(requests[0].method, undefined, 'fetchv2 GET should not pass a method string');
    assert.strictEqual(requests[0].body, undefined, 'fetchv2 GET should not pass a body');
    assert.ok(requests[0].url.includes('https://api.movix.blog/api/search?title='), 'search URL must use query string');
}

function testExtractHlsSources() {
    const { sandbox } = makeSandbox();
    const sources = sandbox.extractHlsSources({
        sources: [
            { type: 'hls', m3u8: 'https://a', quality: '720p', language: 'VF' },
            { type: 'hls', m3u8: '', quality: '1080p', language: 'MULTI' },
        ],
    });
    assert.strictEqual(sources.length, 1, 'extractHlsSources should return only sources with a URL');
    assert.strictEqual(sources[0].url, 'https://a');
}

async function testExtractStreamUrl() {
    const { sandbox } = makeSandbox();
    const streamUrl = await sandbox.extractStreamUrl('media://stream/597');
    assert.strictEqual(streamUrl, 'https://example.com/titanic-720p.m3u8');
}

async function testExtractStreamUrlFromHtml() {
    const { sandbox } = makeSandbox();
    const htmlInput = '<html><body><a href="media://stream/597">Play</a></body></html>';
    const streamUrl = await sandbox.extractStreamUrl(htmlInput);
    assert.strictEqual(streamUrl, 'https://example.com/titanic-720p.m3u8');
}

async function testSearchSourceMovieFallback() {
    const { sandbox, requests } = makeSandbox();
    const details = { title: 'Titanic', original_title: 'Titanic' };
    const result = await sandbox.searchSourceMovieFallback(details);

    assert.ok(result, 'searchSourceMovieFallback must return a result object');
    assert.ok(Array.isArray(result.results), 'searchSourceMovieFallback results should be an array');
    assert.strictEqual(result.results[0].id, 132531);
    assert.strictEqual(requests.length, 1, 'One fetchv2 request should be made for fallback');
}

async function run() {
    const { sandbox } = makeSandbox();
    const htmlInput = '<html><body><a href="media://stream/597">Play</a></body></html>';
    const streamUrl = await sandbox.extractStreamUrl(htmlInput);
    assert.strictEqual(streamUrl, 'https://example.com/titanic-720p.m3u8');
}

async function run() {
    console.log('Running venom-stream tests...');
    testManifest();
    await testSearchSourceMovie();
    testExtractHlsSources();
    await testExtractStreamUrl();
    await testExtractStreamUrlFromHtml();
    await testSearchSourceMovieFallback();
    console.log('All venom-stream tests passed.');
}

run().catch(error => {
    console.error('Test failure:', error);
    process.exit(1);
});
