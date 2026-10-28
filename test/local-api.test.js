"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function harness(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt2009-local-api-"));
    const back = path.join(root, "back");
    fs.mkdirSync(back, { recursive: true });
    fs.copyFileSync(path.join(__dirname, "..", "back", "yt2009localapi.js"), path.join(back, "yt2009localapi.js"));
    fs.mkdirSync(path.join(back, "local-data", "media"), { recursive: true });
    const routes = new Map();
    const app = {
        get: (route, handler) => routes.set("GET " + route, handler),
        post: (route, handler) => routes.set("POST " + route, handler),
        delete: (route, handler) => routes.set("DELETE " + route, handler)
    };
    require(path.join(back, "yt2009localapi.js")).set(app, { local_api_key: "test-key-that-is-at-least-24-chars" });
    t.after(() => {
        for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key];
        fs.rmSync(root, { recursive: true, force: true });
    });
    function call(method, route, options = {}) {
        const handler = routes.get(method + " " + route);
        assert.equal(typeof handler, "function", "route registered: " + method + " " + route);
        const result = { statusCode: 200, headers: {}, body: undefined, contentType: "" };
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
            type(value) { result.contentType = value; return this; },
            setHeader(name, value) { result.headers[name] = value; return this; },
            sendFile(file, callback) { result.body = fs.readFileSync(file); if (callback) callback(); return this; }
        };
        handler(req, res);
        return result;
    }
    return { root, call };
}

test("protected catalog CRUD and media upload work without external APIs", t => {
    const { call, root } = harness(t);
    assert.deepEqual(call("GET", "/local-api/v1/status").body, {
        ok: true, service: "yt2009-local-api", version: 1, provider: "local"
    });

    const denied = call("POST", "/local-api/v1/videos", {
        body: Buffer.from(JSON.stringify({ id: "demo", title: "Demo" }))
    });
    assert.equal(denied.statusCode, 401);

    const key = { "x-local-api-key": "test-key-that-is-at-least-24-chars" };
    const channel = call("POST", "/local-api/v1/channels", {
        headers: key, body: Buffer.from(JSON.stringify({ id: "chan1", name: "Local Channel" }))
    });
    assert.equal(channel.statusCode, 201);
    const video = call("POST", "/local-api/v1/videos", {
        headers: key,
        body: Buffer.from(JSON.stringify({ id: "demo", title: "Demo Video", author: "Local Channel", channel_id: "chan1" }))
    });
    assert.equal(video.statusCode, 201);
    assert.equal(call("GET", "/local-api/v1/videos", { query: { q: "demo" } }).body.total, 1);

    const blockedChannelDelete = call("DELETE", "/local-api/v1/channels/:id", {
        headers: key, params: { id: "chan1" }
    });
    assert.equal(blockedChannelDelete.statusCode, 409);

    const uploaded = call("POST", "/local-api/v1/media/:filename", {
        headers: key, params: { filename: "demo.mp4" }, body: Buffer.from("fake-media")
    });
    assert.equal(uploaded.statusCode, 201);
    assert.equal(uploaded.body.playback_url, "/local-media/demo.mp4");
    assert.equal(fs.readFileSync(path.join(root, "back", "local-data", "media", "demo.mp4"), "utf8"), "fake-media");

    const invalidUpload = call("POST", "/local-api/v1/media/:filename", {
        headers: key, params: { filename: "../bad.mp4" }, body: Buffer.from("x")
    });
    assert.equal(invalidUpload.statusCode, 400);

    assert.equal(call("DELETE", "/local-api/v1/videos/:id", {
        headers: key, params: { id: "demo" }
    }).statusCode, 200);
    assert.equal(call("DELETE", "/local-api/v1/channels/:id", {
        headers: key, params: { id: "chan1" }
    }).statusCode, 200);
    assert.equal(call("GET", "/local-api/v1/videos", {}).body.total, 0);
});
