"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "assets/site-assets/yt2009-local-community.js"), "utf8");

test("community lists mount on legacy .htm pages and extensionless aliases", () => {
    for (const route of [
        "/favorites.htm", "/my_favorites.htm", "/my_favorites",
        "/subscriptions.htm", "/my_subscriptions.htm", "/my_subscriptions",
        "/quicklist.htm", "/watch_queue.htm", "/watch_queue",
        "/playlists.htm", "/my_playlists.htm", "/my_playlists"
    ]) {
        assert.ok(source.includes('"' + route + '"'), "supports " + route);
    }
});

test("community UI renders user-generated text as text, not injected HTML", () => {
    assert.match(source, /node\.textContent\s*=\s*text/);
    assert.doesNotMatch(source, /\.innerHTML\s*=/);
});
