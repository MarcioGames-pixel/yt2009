"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function harness(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt2009-community-"));
    const back = path.join(root, "back");
    fs.mkdirSync(back, { recursive: true });
    fs.copyFileSync(path.join(__dirname, "..", "back", "yt2009communityapi.js"), path.join(back, "yt2009communityapi.js"));
    const routes = new Map();
    const app = {};
    for (const method of ["get", "post", "put", "delete"]) {
        app[method] = (route, handler) => routes.set(method.toUpperCase() + " " + route, handler);
    }
    require(path.join(back, "yt2009communityapi.js")).set(app);
    t.after(() => {
        for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key];
        fs.rmSync(root, { recursive: true, force: true });
    });
    function call(method, route, options = {}) {
        const handler = routes.get(method.toUpperCase() + " " + route);
        assert.equal(typeof handler, "function", "route registered: " + method + " " + route);
        const result = { statusCode: 200, headers: {}, body: undefined };
        const req = {
            params: options.params || {},
            query: options.query || {},
            body: options.body,
            headers: options.headers || {},
            secure: false,
            get(name) { return this.headers[name.toLowerCase()] || this.headers[name] || ""; }
        };
        const res = {
            headersSent: false,
            status(code) { result.statusCode = code; return this; },
            json(value) { result.body = value; return this; },
            send(value) { result.body = value; return this; },
            sendStatus(code) { result.statusCode = code; return this; },
            setHeader(name, value) { result.headers[name] = value; return this; }
        };
        handler(req, res);
        return result;
    }
    return { call };
}
function json(value) { return Buffer.from(JSON.stringify(value)); }
function cookie(response) {
    const value = response.headers["Set-Cookie"];
    assert.ok(value, "session response should set a cookie");
    return value.split(";")[0];
}

test("community session, comments, ratings, playlists and private list ownership", t => {
    const { call } = harness(t);
    assert.equal(call("POST", "/local-api/v1/videos/:id/comments", {
        params: { id: "demo" }, body: json({ text: "no session" })
    }).statusCode, 401);

    const firstSession = call("POST", "/local-api/v1/session", { body: json({ display_name: "Tester" }) });
    assert.equal(firstSession.statusCode, 200);
    assert.equal(firstSession.body.user.display_name, "Tester");
    const firstCookie = cookie(firstSession);
    const first = { cookie: firstCookie };

    const sessionInfo = call("GET", "/local-api/v1/session", { headers: first });
    assert.equal(sessionInfo.body.authenticated, true);
    assert.equal(sessionInfo.body.user.display_name, "Tester");

    const posted = call("POST", "/local-api/v1/videos/:id/comments", {
        params: { id: "demo" }, headers: first, body: json({ text: "A local comment" })
    });
    assert.equal(posted.statusCode, 201);
    assert.equal(posted.body.comment.text, "A local comment");
    assert.equal(call("GET", "/local-api/v1/videos/:id/comments", {
        params: { id: "demo" }
    }).body.total, 1);

    assert.equal(call("PUT", "/local-api/v1/videos/:id/ratings", {
        params: { id: "demo" }, headers: first, body: json({ rating: 1 })
    }).body.likes, 1);
    assert.equal(call("PUT", "/local-api/v1/videos/:id/ratings", {
        params: { id: "demo" }, headers: first, body: json({ rating: 5 })
    }).statusCode, 400);

    const created = call("POST", "/local-api/v1/playlists", {
        headers: first, body: json({ name: "My playlist" })
    });
    assert.equal(created.statusCode, 201);
    const playlistId = created.body.playlist.id;
    assert.equal(call("POST", "/local-api/v1/playlists/:id/videos", {
        params: { id: playlistId }, headers: first, body: json({ video_id: "demo" })
    }).body.playlist.video_ids[0], "demo");

    const secondSession = call("POST", "/local-api/v1/session", { body: json({ display_name: "Other" }) });
    const second = { cookie: cookie(secondSession) };
    assert.equal(call("DELETE", "/local-api/v1/playlists/:id", {
        params: { id: playlistId }, headers: second
    }).statusCode, 404);
    assert.equal(call("GET", "/local-api/v1/playlists", { headers: second }).body.playlists.length, 0);

    assert.deepEqual(call("POST", "/local-api/v1/favorites", {
        headers: first, body: json({ video_id: "demo" })
    }).body.items, ["demo"]);
    assert.deepEqual(call("POST", "/local-api/v1/subscriptions", {
        headers: first, body: json({ channel_id: "channel_1" })
    }).body.items, ["channel_1"]);
    assert.deepEqual(call("POST", "/local-api/v1/quicklist", {
        headers: first, body: json({ video_id: "demo" })
    }).body.items, ["demo"]);

    assert.equal(call("POST", "/local-api/v1/session/logout", { headers: first }).statusCode, 200);
    assert.match(call("POST", "/local-api/v1/session/logout", { headers: first }).headers["Set-Cookie"], /Max-Age=0/);
});
