const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectRoot = __dirname;
const scriptPath = path.join(projectRoot, 'stream-source.js');
const manifestPath = path.join(projectRoot, 'venom-stream.json');
const scriptCode = fs.readFileSync(scriptPath, 'utf8');

function createNumberedEpisodes(start, count, prefix) {
    return Array.from({ length: count }, (_, index) => ({
        episode_number: start + index,
        name: `${prefix} ${start + index}`,
        air_date: '2000-01-01',
    }));
}

function makeSandbox(options = {}) {
    const requests = [];
    const logs = [];
    const sandboxConsole = {
        log: (...args) => logs.push({ level: 'log', args }),
        error: (...args) => logs.push({ level: 'error', args }),
        warn: (...args) => logs.push({ level: 'warn', args }),
    };

    const sandbox = {
        console: sandboxConsole,
        assert,
        Buffer,
        process,
        URLSearchParams,
        fetchv2: async (url, headers, method, body) => {
            requests.push({ url, headers, method, body });

            if (url === 'https://example.com/titanic-720p.m3u8') {
                return {
                    text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000\nvideo.m3u8',
                };
            }

            if (url === 'https://example.com/movie-bad-1080p.m3u8') {
                return {
                    text: async () => 'Access denied',
                };
            }

            if (url === 'https://example.com/boys-s1e1.m3u8') {
                return {
                    text: async () => '#EXTM3U\n#EXTINF:10,\nsegment.ts',
                };
            }

            if (url === 'https://example.com/stranger-things-s1e1.m3u8') {
                return {
                    text: async () => '#EXTM3U\n#EXTINF:10,\nsegment.ts',
                };
            }

            if (url === 'https://example.com/fallback-show-s1e1.m3u8') {
                return {
                    text: async () => '#EXTM3U\n#EXTINF:10,\nsegment.ts',
                };
            }

            if (url === 'https://example.com/one-piece-s20e1-local.m3u8') {
                return {
                    text: async () => '#EXTM3U\n#EXTINF:10,\nsegment.ts',
                };
            }

            if (url === 'https://example.com/flatten-show-s1e3.m3u8') {
                return {
                    text: async () => '#EXTM3U\n#EXTINF:10,\nsegment.ts',
                };
            }

            if (url === 'https://example.com/ambiguous-show-s2e1.m3u8') {
                return {
                    text: async () => '#EXTM3U\n#EXTINF:10,\nsegment.ts',
                };
            }

            if (url === 'https://example.com/ambiguous-show-s1e5.m3u8') {
                return {
                    text: async () => '#EXTM3U\n#EXTINF:10,\nsegment.ts',
                };
            }

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

            if (url.startsWith('https://api.themoviedb.org/3/movie/')) {
                return {
                    json: async () => null,
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

            if (url.startsWith('https://api.themoviedb.org/3/tv/66732/season/1')) {
                return {
                    json: async () => ({
                        season_number: 1,
                        episodes: [
                            { episode_number: 1, name: 'Chapter One' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/66732')) {
                return {
                    json: async () => ({
                        id: 66732,
                        name: 'Stranger Things',
                        original_name: 'Stranger Things',
                        first_air_date: '2016-07-15',
                        seasons: [{ season_number: 1 }],
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/99999') && !url.includes('/season/')) {
                return {
                    json: async () => ({
                        id: 99999,
                        name: 'Fallback Show',
                        original_name: 'Fallback Show',
                        first_air_date: '2024-01-01',
                        seasons: [{ season_number: 1 }],
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/99999/season/1')) {
                return {
                    json: async () => ({
                        season_number: 1,
                        episodes: [
                            { episode_number: 1, name: 'Fallback Episode', air_date: '2024-01-01' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/37854/season/1')) {
                return {
                    json: async () => ({
                        season_number: 1,
                        episodes: createNumberedEpisodes(1, 877, 'East Blue')
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/37854/season/20')) {
                return {
                    json: async () => ({
                        season_number: 20,
                        episodes: [
                            { episode_number: 878, name: 'Le monde entier abasourdi', air_date: '2019-03-31' },
                            { episode_number: 879, name: 'Cap sur Reverie', air_date: '2019-04-07' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/37854')) {
                return {
                    json: async () => ({
                        id: 37854,
                        name: 'One Piece',
                        original_name: 'One Piece',
                        first_air_date: '1999-10-20',
                        seasons: [{ season_number: 1 }, { season_number: 20 }],
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/55555/season/1')) {
                return {
                    json: async () => ({
                        season_number: 1,
                        episodes: [
                            { episode_number: 1, name: 'Pilot', air_date: '2020-01-01' },
                            { episode_number: 2, name: 'Second', air_date: '2020-01-08' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/55555/season/2')) {
                return {
                    json: async () => ({
                        season_number: 2,
                        episodes: [
                            { episode_number: 50, name: 'Season Two Premiere', air_date: '2021-01-01' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/55555')) {
                return {
                    json: async () => ({
                        id: 55555,
                        name: 'Flatten Show',
                        original_name: 'Flatten Show',
                        first_air_date: '2020-01-01',
                        seasons: [{ season_number: 1 }, { season_number: 2 }],
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/66666/season/1')) {
                return {
                    json: async () => ({
                        season_number: 1,
                        episodes: [
                            { episode_number: 1, name: 'Start', air_date: '2022-01-01' },
                            { episode_number: 2, name: 'Middle', air_date: '2022-01-08' },
                            { episode_number: 3, name: 'More', air_date: '2022-01-15' },
                            { episode_number: 4, name: 'End', air_date: '2022-01-22' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/66666/season/2')) {
                return {
                    json: async () => ({
                        season_number: 2,
                        episodes: [
                            { episode_number: 100, name: 'Renumbered Premiere', air_date: '2023-01-01' }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.themoviedb.org/3/tv/66666')) {
                return {
                    json: async () => ({
                        id: 66666,
                        name: 'Ambiguous Show',
                        original_name: 'Ambiguous Show',
                        first_air_date: '2022-01-01',
                        seasons: [{ season_number: 1 }, { season_number: 2 }],
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/search')) {
                if (options.omitSeriesSearch && url.includes('Fallback%20Show')) {
                    return {
                        json: async () => ({
                            results: [],
                        }),
                    };
                }

                return {
                    json: async () => ({
                        results: [
                            { id: 132531, title: 'Titanic', tmdb_id: 597, type: 'movie' },
                            { id: 51764, name: 'The Boys', tmdb_id: 76479, type: 'series' },
                            { id: 124008, name: 'Stranger Things', tmdb_id: 66732, type: 'series' },
                            { id: 88888, name: 'One Piece', tmdb_id: 37854, type: 'series' },
                            { id: 22222, name: 'Flatten Show', tmdb_id: 55555, type: 'series' },
                            { id: 33333, name: 'Ambiguous Show', tmdb_id: 66666, type: 'series' }
                        ],
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/films/download/132531')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                type: 'hls',
                                m3u8: 'https://example.com/movie-bad-1080p.m3u8',
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

            if (url.startsWith('https://api.movix.blog/api/series/download/124008/season/1/episode/1')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/88888/season/20/episode/878')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/88888/season/20/episode/1')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                quality: '1080p',
                                language: 'VOSTFR',
                                m3u8: 'https://example.com/one-piece-s20e1-local.m3u8',
                                type: 'hls',
                            }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/88888/season/1/episode/878')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/22222/season/2/episode/50')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/22222/season/2/episode/1')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/22222/season/1/episode/3')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                quality: '720p',
                                language: 'VF',
                                m3u8: 'https://example.com/flatten-show-s1e3.m3u8',
                                type: 'hls',
                            }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/33333/season/2/episode/100')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/33333/season/2/episode/1')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                quality: '720p',
                                language: 'VF',
                                m3u8: 'https://example.com/ambiguous-show-s2e1.m3u8',
                                type: 'hls',
                            }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/series/download/33333/season/1/episode/5')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                quality: '720p',
                                language: 'VF',
                                m3u8: 'https://example.com/ambiguous-show-s1e5.m3u8',
                                type: 'hls',
                            }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/purstream/tv/66732/stream?season=1&episode=1')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                url: 'https://example.com/stranger-things-s1e1.m3u8',
                                name: 'pulse | 720p | VF',
                                format: 'm3u8',
                            }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/purstream/tv/99999/stream?season=1&episode=1')) {
                return {
                    json: async () => ({
                        sources: [
                            {
                                url: 'https://example.com/fallback-show-s1e1.m3u8',
                                name: 'pulse | 720p | VF',
                                format: 'm3u8',
                            }
                        ]
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/purstream/tv/37854/stream?season=')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/purstream/tv/55555/stream?season=')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            if (url.startsWith('https://api.movix.blog/api/purstream/tv/66666/stream?season=')) {
                return {
                    json: async () => ({
                        sources: []
                    }),
                };
            }

            throw new Error(`Unexpected fetchv2 request: ${url}`);
        },
    };

    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(scriptCode, sandbox, { filename: scriptPath });
    return { sandbox, requests, logs };
}

function testManifest() {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.asyncJS, true, 'asyncJS should be true');
    assert.strictEqual(manifest.streamAsyncJS, false, 'streamAsyncJS should be false');
    assert.ok(typeof manifest.searchBaseUrl === 'string', 'searchBaseUrl must be a string');
    assert.ok(manifest.searchBaseUrl.includes('%s'), 'searchBaseUrl must include %s');
    assert.ok(typeof manifest.scriptUrl === 'string' && manifest.scriptUrl.length > 0, 'scriptUrl must be defined');
}

function findRequestIndex(requests, fragment) {
    return requests.findIndex(request => request.url.includes(fragment));
}

function countRequests(requests, fragment) {
    return requests.filter(request => request.url.includes(fragment)).length;
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
    const streamUrl = await sandbox.extractStreamUrl('movie/597');
    assert.strictEqual(streamUrl, 'https://example.com/titanic-720p.m3u8');
}

async function testPlayableSourceValidation() {
    const { sandbox } = makeSandbox();
    const goodSource = await sandbox.isPlayableHlsUrl('https://example.com/titanic-720p.m3u8');
    const badSource = await sandbox.isPlayableHlsUrl('https://example.com/movie-bad-1080p.m3u8');

    assert.strictEqual(goodSource, true);
    assert.strictEqual(badSource, false);
}

async function testExtractStreamUrlFromHtml() {
    const { sandbox } = makeSandbox();
    const htmlInput = '<html><body><a href="movie/597">Play</a></body></html>';
    const streamUrl = await sandbox.extractStreamUrl(htmlInput);
    assert.strictEqual(streamUrl, 'https://example.com/titanic-720p.m3u8');
}

async function testExtractStreamUrlTv() {
    const { sandbox } = makeSandbox();
    const streamUrl = await sandbox.extractStreamUrl('tv/76479/1/1');
    assert.strictEqual(streamUrl, 'https://example.com/boys-s1e1.m3u8');
}

async function testExtractStreamUrlTvPurstreamFallbackWithoutSearchMatch() {
    const { sandbox } = makeSandbox({ omitSeriesSearch: true });
    const streamUrl = await sandbox.extractStreamUrl('tv/99999/1/1');
    assert.strictEqual(streamUrl, 'https://example.com/fallback-show-s1e1.m3u8');
}

async function testExtractEpisodesTv() {
    const { sandbox } = makeSandbox();
    const episodes = JSON.parse(await sandbox.extractEpisodes('tv/76479/1/1'));
    assert.ok(Array.isArray(episodes), 'extractEpisodes should return an array');
    assert.strictEqual(episodes[0].href, 'tv/76479/1/1');
    assert.strictEqual(episodes[0].number, 1);
    assert.strictEqual(episodes[2].number, 1);
}

async function testExtractEpisodesTvWithoutTypeHint() {
    const { sandbox } = makeSandbox();
    const episodes = JSON.parse(await sandbox.extractEpisodes('media://stream/76479'));
    assert.ok(Array.isArray(episodes), 'extractEpisodes should return an array without explicit type hint');
    assert.strictEqual(episodes[0].href, 'tv/76479/1/1');
}

async function testExtractEpisodesOnePieceUsesCanonicalTmdbNumbers() {
    const { sandbox } = makeSandbox();
    const episodes = JSON.parse(await sandbox.extractEpisodes('tv/37854/20/878'));
    const targetEpisode = episodes.find(episode => episode.href === 'tv/37854/20/878');

    assert.ok(targetEpisode, 'One Piece canonical episode should be listed with TMDB numbering');
    assert.strictEqual(targetEpisode.number, 878);
    assert.strictEqual(targetEpisode.title, 'Le monde entier abasourdi');
}

async function testExtractEpisodesMovieStillReturnsSingleEntry() {
    const { sandbox } = makeSandbox();
    const episodes = JSON.parse(await sandbox.extractEpisodes('movie/597'));
    assert.ok(Array.isArray(episodes), 'movie extractEpisodes should return an array');
    assert.strictEqual(episodes.length, 1);
    assert.strictEqual(episodes[0].href, 'movie/597');
    assert.strictEqual(episodes[0].number, 1);
}

async function testExtractStreamUrlTvPurstreamFallbackWhenSeriesDownloadIsEmpty() {
    const { sandbox } = makeSandbox();
    const streamUrl = await sandbox.extractStreamUrl('tv/66732/1/1');
    assert.strictEqual(streamUrl, 'https://example.com/stranger-things-s1e1.m3u8');
}

async function testExtractStreamUrlOnePieceUsesSeasonLocalFallback() {
    const { sandbox, requests } = makeSandbox();
    const streamUrl = await sandbox.extractStreamUrl('tv/37854/20/878');

    assert.strictEqual(streamUrl, 'https://example.com/one-piece-s20e1-local.m3u8');
    assert.ok(findRequestIndex(requests, '/api/series/download/88888/season/20/episode/878') !== -1, 'exact TMDB candidate should be tested');
    assert.ok(findRequestIndex(requests, '/api/series/download/88888/season/20/episode/1') !== -1, 'season-local fallback should be tested');
    assert.ok(findRequestIndex(requests, '/api/series/download/88888/season/20/episode/878') < findRequestIndex(requests, '/api/series/download/88888/season/20/episode/1'), 'exact TMDB candidate should be tried before season-local fallback');
}

async function testExtractStreamUrlUsesFlattenFallback() {
    const { sandbox, requests } = makeSandbox();
    const streamUrl = await sandbox.extractStreamUrl('tv/55555/2/50');

    assert.strictEqual(streamUrl, 'https://example.com/flatten-show-s1e3.m3u8');
    assert.ok(findRequestIndex(requests, '/api/series/download/22222/season/2/episode/50') !== -1, 'exact TMDB candidate should be tested');
    assert.ok(findRequestIndex(requests, '/api/series/download/22222/season/2/episode/1') !== -1, 'season-local fallback should be tested');
    assert.ok(findRequestIndex(requests, '/api/series/download/22222/season/1/episode/3') !== -1, 'flatten fallback should be tested');
    assert.ok(findRequestIndex(requests, '/api/series/download/22222/season/2/episode/1') < findRequestIndex(requests, '/api/series/download/22222/season/1/episode/3'), 'flatten fallback should run after season-local fallback');
}

async function testExtractStreamUrlReturnsNullWhenFallbacksAreAmbiguous() {
    const { sandbox, requests, logs } = makeSandbox();
    const streamUrl = await sandbox.extractStreamUrl('tv/66666/2/100');

    assert.strictEqual(streamUrl, null);
    assert.ok(findRequestIndex(requests, '/api/series/download/33333/season/2/episode/1') !== -1, 'first fallback should be tested');
    assert.ok(findRequestIndex(requests, '/api/series/download/33333/season/1/episode/5') !== -1, 'second fallback should be tested');
    assert.ok(logs.some(entry => entry.args.some(value => String(value).includes('resolution_ambiguous'))), 'ambiguity should be logged');
}

async function testSeriesResolutionCachesEpisodeIndexAndSourceResult() {
    const { sandbox, requests } = makeSandbox();

    await sandbox.extractStreamUrl('tv/55555/2/50');
    await sandbox.extractStreamUrl('tv/55555/2/50');

    assert.strictEqual(countRequests(requests, 'https://api.movix.blog/api/search?title=Flatten%20Show'), 1, 'source search should be cached');
    assert.strictEqual(countRequests(requests, 'https://api.themoviedb.org/3/tv/55555/season/1'), 1, 'season 1 index should be cached');
    assert.strictEqual(countRequests(requests, 'https://api.themoviedb.org/3/tv/55555/season/2'), 1, 'season 2 index should be cached');
}

async function testSearchResults() {
    const { sandbox } = makeSandbox();
    const results = JSON.parse(await sandbox.searchResults('Titanic'));
    assert.ok(Array.isArray(results), 'searchResults should return an array');
    assert.ok(results.some(item => item.href === 'https://movix.rodeo/player/movie/597'), 'search results should include movie href');
    assert.ok(results.some(item => item.href === 'https://movix.rodeo/player/tv/76479/1/1'), 'search results should include tv href');
}

async function run() {
    console.log('Running venom-stream tests...');
    testManifest();
    await testSearchSourceMovie();
    testExtractHlsSources();
    await testPlayableSourceValidation();
    await testExtractStreamUrlMovie();
    await testExtractStreamUrlFromHtml();
    await testExtractStreamUrlTv();
    await testExtractStreamUrlTvPurstreamFallbackWithoutSearchMatch();
    await testExtractStreamUrlTvPurstreamFallbackWhenSeriesDownloadIsEmpty();
    await testExtractEpisodesTv();
    await testExtractEpisodesTvWithoutTypeHint();
    await testExtractEpisodesOnePieceUsesCanonicalTmdbNumbers();
    await testExtractEpisodesMovieStillReturnsSingleEntry();
    await testExtractStreamUrlOnePieceUsesSeasonLocalFallback();
    await testExtractStreamUrlUsesFlattenFallback();
    await testExtractStreamUrlReturnsNullWhenFallbacksAreAmbiguous();
    await testSeriesResolutionCachesEpisodeIndexAndSourceResult();
    await testSearchResults();
    console.log('All venom-stream tests passed.');
}

run().catch(error => {
    console.error('Test failure:', error);
    process.exit(1);
});
