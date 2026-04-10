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

            if (url.startsWith('https://api.themoviedb.org/3/search/movie')) {
                return {
                    json: async () => ({
                        results: [{ id: 597, title: 'Titanic', poster_path: '/poster.jpg' }],
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/search/tv')) {
                return {
                    json: async () => ({
                        results: [{ id: 76479, name: 'The Boys', poster_path: '/poster-tv.jpg' }],
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/76479/season/1')) {
                return {
                    json: async () => ({
                        season_number: 1,
                        episodes: [
                            { episode_number: 1, name: 'Episode 1' },
                            { episode_number: 2, name: 'Episode 2' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/76479/season/2')) {
                return {
                    json: async () => ({
                        season_number: 2,
                        episodes: [
                            { episode_number: 1, name: 'Episode 1' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/76479')) {
                return {
                    json: async () => ({
                        id: 76479,
                        name: 'The Boys',
                        original_name: 'The Boys',
                        first_air_date: '2019-07-23',
                        seasons: [{ season_number: 1 }, { season_number: 2 }],
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/search')) {
                return {
                    json: async () => ({
                        results: [{ id: 132531, title: 'Titanic', tmdb_id: 597, type: 'movie' }, { id: 51764, name: 'The Boys', tmdb_id: 76479, type: 'series' }],
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

            if (url.startsWith('https://api.movix.blog/api/series/download/51764/season/1/episode/1')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                src: 'https://darkibox.com/embed-ht6nhalc2zgn.html',
                                language: 'MULTI',
                                quality: '1080p',
                                m3u8: 'https://example.com/boys-s1e1.m3u8',
                            }
                        ]
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
    const result = await sandbox.searchSourceByTitle('Titanic');

    assert.ok(result, 'searchSourceByTitle must return a result object');
    assert.ok(Array.isArray(result.results), 'searchSourceByTitle results should be an array');
    assert.strictEqual(result.results[0].id, 132531);
    assert.strictEqual(requests.length, 1, 'One fetchv2 request should be made');
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

async function testExtractStreamUrlMovie() {
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

async function testExtractStreamUrlTv() {
    const { sandbox } = makeSandbox();
    const streamUrl = await sandbox.extractStreamUrl('media://stream/76479?mediaType=tv&season=1&episode=1');
    assert.strictEqual(streamUrl, 'https://example.com/boys-s1e1.m3u8');
}

async function testExtractEpisodesTv() {
    const { sandbox } = makeSandbox();
    const episodes = JSON.parse(await sandbox.extractEpisodes('media://stream/76479?mediaType=tv'));
    assert.ok(Array.isArray(episodes), 'extractEpisodes should return an array');
    assert.strictEqual(episodes[0].href, 'media://stream/76479?mediaType=tv&season=1&episode=1');
    assert.strictEqual(episodes[0].number, 'S1E1');
    assert.strictEqual(episodes[2].number, 'S2E1');
}

async function testSearchResults() {
    const { sandbox } = makeSandbox();
    const results = JSON.parse(await sandbox.searchResults('Titanic'));
    assert.ok(Array.isArray(results), 'searchResults should return an array');
    assert.ok(results.some(item => item.href.includes('media://stream/597')), 'search results should include movie href');
}

async function run() {
    console.log('Running venom-stream tests...');
    testManifest();
    await testSearchSourceMovie();
    testExtractHlsSources();
    await testExtractStreamUrlMovie();
    await testExtractStreamUrlFromHtml();
    await testExtractStreamUrlTv();
    await testExtractEpisodesTv();
    await testSearchResults();
    console.log('All venom-stream tests passed.');
}

run().catch(error => {
    console.error('Test failure:', error);
    process.exit(1);
});
