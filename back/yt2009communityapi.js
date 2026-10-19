/*
 * Independent local community API for yt2009.
 * This adds self-hosted comments, ratings, playlists, favorites and subscriptions.
 * It intentionally does not call the official YouTube API and does not change the
 * legacy HTML/CSS. The session is an anonymous local profile, not an account system.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "local-data");
const FILE = path.join(DATA_DIR, "community.json");
const VIDEO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SESSION_COOKIE = "yt2009_local_session";

function freshData() {
    return { version: 1, users: {}, comments: {}, ratings: {}, playlists: {}, favorites: {}, subscriptions: {}, quicklist: {} };
}
function readData() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(freshData(), null, 2));
    let data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!data || typeof data !== "object") throw new Error("Invalid community data");
    for (const key of ["users", "comments", "ratings", "playlists"]) {
        if (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key])) data[key] = {};
    }
    return data;
}
function writeData(data) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, FILE);
}
function parseBody(body) {
    if (Buffer.isBuffer(body)) {
        try { return JSON.parse(body.toString("utf8")); } catch (_) { return null; }
    }
    if (typeof body === "string") {
        try { return JSON.parse(body); } catch (_) { return null; }
    }
    return body && typeof body === "object" ? body : null;
}
function cookieValue(req, name) {
    const cookie = req.headers && req.headers.cookie || "";
    const part = cookie.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="));
    if (!part) return "";
    try { return decodeURIComponent(part.slice(name.length + 1)); } catch (_) { return ""; }
}
function session(req, data) {
    const id = cookieValue(req, SESSION_COOKIE);
    return id && data.users[id] ? { id, user: data.users[id] } : null;
}
function requireSession(req, res, data) {
    const s = session(req, data);
    if (!s) {
        res.status(401).json({ ok: false, error: "session_required", hint: "POST /local-api/v1/session first" });
        return null;
    }
    return s;
}
function safeText(value, max) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validId(id) { return typeof id === "string" && VIDEO_ID.test(id); }
function setSessionCookie(res, id, req) {
    const secure = req.secure || (req.headers["x-forwarded-proto"] || "").split(",")[0] === "https";
    res.setHeader("Set-Cookie", SESSION_COOKIE + "=" + encodeURIComponent(id) +
        "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000" + (secure ? "; Secure" : ""));
}
function ensureList(map, key) {
    if (!Array.isArray(map[key])) map[key] = [];
    return map[key];
}
function userPayload(s) {
    return { id: s.id, display_name: s.user.display_name, created_at: s.user.created_at };
}

module.exports = {
    set: function(app) {
        app.post("/local-api/v1/session", (req, res) => {
            const body = parseBody(req.body) || {};
            let data;
            try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
            let current = session(req, data);
            if (!current) {
                const id = crypto.randomBytes(24).toString("hex");
                const displayName = safeText(body.display_name, 32) || ("Guest-" + id.slice(0, 6));
                data.users[id] = { display_name: displayName, created_at: new Date().toISOString() };
                current = { id, user: data.users[id] };
                try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
            } else if (typeof body.display_name === "string") {
                current.user.display_name = safeText(body.display_name, 32) || current.user.display_name;
                data.users[current.id] = current.user;
                try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
            }
            setSessionCookie(res, current.id, req);
            res.json({ ok: true, user: userPayload(current), note: "Anonymous local profile; not a verified account." });
        });

        app.get("/local-api/v1/session", (req, res) => {
            try {
                const data = readData(), s = session(req, data);
                res.json({ ok: true, authenticated: !!s, user: s ? userPayload(s) : null });
            } catch (_) { res.status(500).json({ ok: false, error: "community_unavailable" }); }
        });

        app.post("/local-api/v1/session/logout", (req, res) => {
            const secure = req.secure || (req.headers["x-forwarded-proto"] || "").split(",")[0] === "https";
            res.setHeader("Set-Cookie", SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (secure ? "; Secure" : ""));
            res.json({ ok: true });
        });

        app.get("/local-api/v1/videos/:id/comments", (req, res) => {
            if (!validId(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_video_id" });
            try {
                const data = readData(), comments = ensureList(data.comments, req.params.id);
                res.json({ ok: true, total: comments.length, comments: comments.slice(-100).reverse() });
            } catch (_) { res.status(500).json({ ok: false, error: "community_unavailable" }); }
        });

        app.post("/local-api/v1/videos/:id/comments", (req, res) => {
            if (!validId(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_video_id" });
            let data;
            try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
            const s = requireSession(req, res, data); if (!s) return;
            const body = parseBody(req.body) || {}, text = safeText(body.text, 2000);
            if (!text) return res.status(400).json({ ok: false, error: "comment_required" });
            const list = ensureList(data.comments, req.params.id);
            const comment = { id: crypto.randomBytes(12).toString("hex"), author: s.user.display_name, text, created_at: new Date().toISOString() };
            list.push(comment);
            try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
            res.status(201).json({ ok: true, comment });
        });

        app.get("/local-api/v1/videos/:id/ratings", (req, res) => {
            if (!validId(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_video_id" });
            try {
                const data = readData(), map = data.ratings[req.params.id] || {};
                const values = Object.values(map).filter(v => v === 1 || v === -1);
                const mine = session(req, data);
                res.json({ ok: true, likes: values.filter(v => v === 1).length, dislikes: values.filter(v => v === -1).length,
                    rating: mine ? (map[mine.id] || 0) : 0 });
            } catch (_) { res.status(500).json({ ok: false, error: "community_unavailable" }); }
        });

        app.put("/local-api/v1/videos/:id/ratings", (req, res) => {
            if (!validId(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_video_id" });
            let data;
            try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
            const s = requireSession(req, res, data); if (!s) return;
            const body = parseBody(req.body) || {};
            if (![1, -1, 0].includes(body.rating)) return res.status(400).json({ ok: false, error: "rating_must_be_1_minus1_or_0" });
            if (!data.ratings[req.params.id]) data.ratings[req.params.id] = {};
            if (body.rating === 0) delete data.ratings[req.params.id][s.id];
            else data.ratings[req.params.id][s.id] = body.rating;
            try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
            const values = Object.values(data.ratings[req.params.id]);
            res.json({ ok: true, likes: values.filter(v => v === 1).length, dislikes: values.filter(v => v === -1).length, rating: body.rating });
        });

        app.get("/local-api/v1/playlists", (req, res) => {
            try {
                const data = readData(), s = session(req, data);
                res.json({ ok: true, playlists: s ? Object.values(data.playlists).filter(p => p.owner === s.id).map(p => ({ id: p.id, name: p.name, video_ids: p.video_ids, updated_at: p.updated_at })) : [] });
            } catch (_) { res.status(500).json({ ok: false, error: "community_unavailable" }); }
        });

        app.post("/local-api/v1/playlists", (req, res) => {
            let data;
            try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
            const s = requireSession(req, res, data); if (!s) return;
            const body = parseBody(req.body) || {}, name = safeText(body.name, 100);
            if (!name) return res.status(400).json({ ok: false, error: "playlist_name_required" });
            const id = crypto.randomBytes(10).toString("hex");
            const playlist = { id, owner: s.id, name, video_ids: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            data.playlists[id] = playlist;
            try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
            res.status(201).json({ ok: true, playlist: { id, name, video_ids: [], updated_at: playlist.updated_at } });
        });

        app.delete("/local-api/v1/playlists/:id", (req, res) => {
            let data;
            try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
            const s = requireSession(req, res, data); if (!s) return;
            const playlist = data.playlists[req.params.id];
            if (!playlist || playlist.owner !== s.id) return res.status(404).json({ ok: false, error: "playlist_not_found" });
            delete data.playlists[req.params.id];
            try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
            res.json({ ok: true });
        });

        app.post("/local-api/v1/playlists/:id/videos", (req, res) => {
            let data;
            try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
            const s = requireSession(req, res, data); if (!s) return;
            const playlist = data.playlists[req.params.id];
            if (!playlist || playlist.owner !== s.id) return res.status(404).json({ ok: false, error: "playlist_not_found" });
            const body = parseBody(req.body) || {};
            if (!validId(body.video_id)) return res.status(400).json({ ok: false, error: "invalid_video_id" });
            if (!playlist.video_ids.includes(body.video_id)) playlist.video_ids.push(body.video_id);
            playlist.updated_at = new Date().toISOString();
            try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
            res.json({ ok: true, playlist: { id: playlist.id, name: playlist.name, video_ids: playlist.video_ids, updated_at: playlist.updated_at } });
        });

        app.delete("/local-api/v1/playlists/:id/videos/:video_id", (req, res) => {
            let data;
            try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
            const s = requireSession(req, res, data); if (!s) return;
            const playlist = data.playlists[req.params.id];
            if (!playlist || playlist.owner !== s.id) return res.status(404).json({ ok: false, error: "playlist_not_found" });
            playlist.video_ids = playlist.video_ids.filter(id => id !== req.params.video_id);
            playlist.updated_at = new Date().toISOString();
            try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
            res.json({ ok: true, playlist: { id: playlist.id, name: playlist.name, video_ids: playlist.video_ids, updated_at: playlist.updated_at } });
        });

        for (const kind of ["favorites", "subscriptions", "quicklist"]) {
            app.get("/local-api/v1/" + kind, (req, res) => {
                try {
                    const data = readData(), s = session(req, data);
                    const list = s ? ensureList(data[kind] || (data[kind] = {}), s.id) : [];
                    res.json({ ok: true, items: list });
                } catch (_) { res.status(500).json({ ok: false, error: "community_unavailable" }); }
            });
            app.post("/local-api/v1/" + kind, (req, res) => {
                let data;
                try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
                if (!data[kind]) data[kind] = {};
                const s = requireSession(req, res, data); if (!s) return;
                const body = parseBody(req.body) || {};
                const item = kind === "subscriptions" ? body.channel_id : body.video_id;
                if (typeof item !== "string" || !VIDEO_ID.test(item)) return res.status(400).json({ ok: false, error: kind === "subscriptions" ? "invalid_channel_id" : "invalid_video_id" });
                const list = ensureList(data[kind], s.id);
                if (!list.includes(item)) list.push(item);
                try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
                res.json({ ok: true, items: list });
            });
            app.delete("/local-api/v1/" + kind + "/:item", (req, res) => {
                let data;
                try { data = readData(); } catch (_) { return res.status(500).json({ ok: false, error: "community_unavailable" }); }
                const s = requireSession(req, res, data); if (!s) return;
                const map = data[kind] || {};
                map[s.id] = ensureList(map, s.id).filter(item => item !== req.params.item);
                try { writeData(data); } catch (_) { return res.status(500).json({ ok: false, error: "community_write_failed" }); }
                res.json({ ok: true, items: map[s.id] });
            });
        }
    }
};
