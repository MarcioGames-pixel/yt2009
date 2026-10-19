"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function harness(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "yt2009-accounts-"));
    const back = path.join(root, "back");
    fs.mkdirSync(path.join(back, "local-data"), { recursive: true });
    fs.copyFileSync(path.join(__dirname, "..", "back", "yt2009accounts.js"), path.join(back, "yt2009accounts.js"));
    const routes = new Map();
    const app = {};
    for (const method of ["get", "post"]) app[method] = (route, handler) => routes.set(method.toUpperCase() + " " + route, handler);
    require(path.join(back, "yt2009accounts.js")).set(app);
    t.after(() => {
        for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key];
        fs.rmSync(root, { recursive: true, force: true });
    });
    function call(method, route, options = {}) {
        const handler = routes.get(method.toUpperCase() + " " + route);
        assert.equal(typeof handler, "function", "registered route " + method + " " + route);
        const result = { statusCode: 200, headers: {}, body: undefined, type: "" };
        const req = { body: options.body || {}, headers: options.headers || {}, secure: false };
        const res = {
            status(code) { result.statusCode = code; return this; },
            json(value) { result.body = value; return this; },
            type(value) { result.type = value; return this; },
            send(value) { result.body = value; return this; },
            setHeader(name, value) { result.headers[name] = value; return this; }
        };
        handler(req, res);
        return result;
    }
    return { root, call };
}

test("registration creates a persistent account without storing the plaintext password", t => {
    const { root, call } = harness(t);
    const registered = call("POST", "/local-api/v1/accounts/register", {
        body: { username: "Retro_User", password: "test-password-123", display_name: "Retro User" }
    });
    assert.equal(registered.statusCode, 201);
    assert.equal(registered.body.user.username, "retro_user");
    assert.equal(registered.body.user.account, true);
    assert.match(registered.headers["Set-Cookie"], /^yt2009_local_session=[a-f0-9]{48};/);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "back", "local-data", "community.json"), "utf8"));
    const user = saved.users[registered.body.user.id];
    assert.ok(user.password_salt);
    assert.ok(user.password_hash);
    assert.equal(JSON.stringify(user).includes("test-password-123"), false);
    assert.equal(call("POST", "/local-api/v1/accounts/register", {
        body: { username: "retro_user", password: "another-password-123" }
    }).statusCode, 409);
});

test("login verifies the password and sets the existing community session cookie", t => {
    const { call } = harness(t);
    call("POST", "/local-api/v1/accounts/register", {
        body: { username: "member1", password: "a-secure-test-password" }
    });
    const bad = call("POST", "/local-api/v1/accounts/login", {
        body: { username: "member1", password: "wrong-password" }
    });
    assert.equal(bad.statusCode, 401);
    const good = call("POST", "/local-api/v1/accounts/login", {
        body: { username: "MEMBER1", password: "a-secure-test-password" }
    });
    assert.equal(good.statusCode, 200);
    assert.equal(good.body.user.username, "member1");
    assert.match(good.headers["Set-Cookie"], /HttpOnly; SameSite=Lax/);
});

test("registration validates usernames and password length", t => {
    const { call } = harness(t);
    assert.equal(call("POST", "/local-api/v1/accounts/register", {
        body: { username: "x!", password: "12345678" }
    }).statusCode, 400);
    assert.equal(call("POST", "/local-api/v1/accounts/register", {
        body: { username: "validname", password: "short" }
    }).statusCode, 400);
});
