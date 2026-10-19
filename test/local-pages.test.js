"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

function loadPageHandlers() {
    const target = path.join(__dirname, "..", "back", "yt2009localpages.js");
    const originalLoad = Module._load;
    const videos = [{
        id: "demo_1", title: "A <local> video", description: "Line one\nLine two",
        author: "Local creator", thumbnail: "/local-media/thumb.jpg", channel_id: "chan_1",
        playback_url: "/local-media/demo.mp4", duration: 61, published_at: "2009-11-17", tags: ["retro"]
    }];
    const channels = [{ id: "chan_1", name: "Local channel", description: "A channel", avatar: "", banner: "", subscribers: 2, url: "/channel/chan_1" }];
    const local = {
        getVideos: () => ({ videos }),
        searchChannels: () => channels,
        getVideo: id => videos.find(v => v.id === id) || null,
        getChannel: id => channels.find(c => c.id === id) || null,
        getChannelVideos: () => ({ videos }),
        searchVideos: q => ({ videos: videos.filter(v => v.title.toLowerCase().includes(q.toLowerCase())) })
    };
    Module._load = function(request, parent, isMain) {
        if (parent && parent.filename === target && request === "./yt2009localapi") return local;
        if (parent && parent.filename === target && request === "./yt2009utils") return { isAuthorized: () => true };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[target];
        const pages = require(target);
        return { pages, videos, channels };
    } finally {
        Module._load = originalLoad;
    }
}
function harness(t, config = { local_api_only: true }) {
    const { pages, videos, channels } = loadPageHandlers();
    const routes = new Map();
    const app = { get(route, handler) { routes.set(route, handler); } };
    pages.set(app, config);
    function call(route, options = {}) {
        const handler = routes.get(route);
        assert.equal(typeof handler, "function", "route registered: " + route);
        const result = { statusCode: 200, type: "", body: "", redirect: "" };
        const req = { query: options.query || {}, params: options.params || {} };
        const res = {
            status(code) { result.statusCode = code; return this; },
            type(value) { result.type = value; return this; },
            send(value) { result.body = value; return this; },
            redirect(value) { result.redirect = value; return this; }
        };
        let nextCalled = false;
        handler(req, res, () => { nextCalled = true; });
        result.nextCalled = nextCalled;
        return result;
    }
    t.after(() => {
        delete require.cache[path.join(__dirname, "..", "back", "yt2009localpages.js")];
    });
    return { call, videos, channels };
}

test("local catalog pages render escaped titles, HTML5 playback, channels and embed", t => {
    const { call } = harness(t);
    const home = call("/");
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /Local channel/);
    assert.match(home.body, /A &lt;local&gt; video/);

    const watch = call("/watch", { query: { v: "demo_1" } });
    assert.equal(watch.type, "html");
    assert.match(watch.body, /A &lt;local&gt; video/);
    assert.match(watch.body, /\/local-media\/demo\.mp4/);
    assert.doesNotMatch(watch.body, /<title>A <local> video<\/title>/);

    const channel = call("/channel/:id", { params: { id: "chan_1" } });
    assert.match(channel.body, /Local channel/);
    assert.match(channel.body, /A &lt;local&gt; video/);

    const embed = call("/embed/:id", { params: { id: "demo_1" } });
    assert.match(embed.body, /<video controls autoplay playsinline/);
    assert.match(embed.body, /type="video\/mp4"/);
});

test("local-only pages return local 404s for unknown IDs and respect disabled mode", t => {
    const local = harness(t);
    const missing = local.call("/watch", { query: { v: "missing" } });
    assert.equal(missing.statusCode, 404);
    assert.match(missing.body, /not found in the local catalog/i);
    assert.equal(local.call("/channel/:id", { params: { id: "missing" } }).statusCode, 404);

    const passthrough = harness(t, { local_api_only: false });
    assert.equal(passthrough.call("/").nextCalled, true);
    assert.equal(passthrough.call("/watch", { query: { v: "missing" } }).nextCalled, true);
});
