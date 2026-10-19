/*
 * yt2009 local data API
 *
 * Self-hosted catalog endpoints. This module deliberately does not call YouTube
 * APIs. Existing 2009 pages and modules remain untouched.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "local-data");
const CATALOG_FILE = path.join(DATA_DIR, "videos.json");
const CHANNELS_FILE = path.join(DATA_DIR, "channels.json");
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function ensureCatalog() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CATALOG_FILE)) {
        fs.writeFileSync(CATALOG_FILE, JSON.stringify({ version: 1, videos: [] }, null, 2));
    }
}

function readCatalog() {
    ensureCatalog();
    const data = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    if (!data || !Array.isArray(data.videos)) {
        throw new Error("Invalid local video catalog format");
    }
    return data;
}

function ensureChannels() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(CHANNELS_FILE)) fs.writeFileSync(CHANNELS_FILE, JSON.stringify({ version: 1, channels: [] }, null, 2));
}
function readChannels() {
    ensureChannels();
    const data = JSON.parse(fs.readFileSync(CHANNELS_FILE, "utf8"));
    if (!data || !Array.isArray(data.channels)) throw new Error("Invalid local channel catalog format");
    return data;
}
function validChannel(channel) {
    return channel && typeof channel.id === "string" && ID_RE.test(channel.id)
        && typeof channel.name === "string" && channel.name.trim().length > 0 && channel.name.length <= 200;
}
function publicChannel(channel) {
    return { id: channel.id, name: channel.name, description: typeof channel.description === "string" ? channel.description : "",
        avatar: typeof channel.avatar === "string" ? channel.avatar : "", banner: typeof channel.banner === "string" ? channel.banner : "",
        url: "/channel/" + encodeURIComponent(channel.id), subscribers: Number.isFinite(Number(channel.subscribers)) ? Number(channel.subscribers) : 0 };
}
function parseRequestBody(body) {
    if (Buffer.isBuffer(body)) {
        try { return JSON.parse(body.toString("utf8")); } catch (error) { return null; }
    }
    if (typeof body === "string") {
        try { return JSON.parse(body); } catch (error) { return null; }
    }
    return body && typeof body === "object" ? body : null;
}

function validVideo(video) {
    return video && typeof video.id === "string" && ID_RE.test(video.id)
        && typeof video.title === "string" && video.title.trim().length > 0
        && video.title.length <= 300;
}

function publicVideo(video) {
    return {
        id: video.id,
        title: video.title,
        description: typeof video.description === "string" ? video.description : "",
        author: typeof video.author === "string" ? video.author : "Unknown",
        thumbnail: typeof video.thumbnail === "string" ? video.thumbnail : "",
        channel_id: typeof video.channel_id === "string" && ID_RE.test(video.channel_id) ? video.channel_id : "",
        playback_url: typeof video.playback_url === "string" ? video.playback_url : "",
        duration: Number.isFinite(Number(video.duration)) ? Number(video.duration) : 0,
        published_at: typeof video.published_at === "string" ? video.published_at : "",
        tags: Array.isArray(video.tags) ? video.tags.filter(t => typeof t === "string").slice(0, 30) : []
    };
}

module.exports = {
    set: function(app, config) {
        app.get("/local-api/v1/status", (req, res) => {
            res.json({ ok: true, service: "yt2009-local-api", version: 1, provider: "local" });
        });

        app.get("/local-api/v1/channels", (req, res) => {
            try {
                const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 120) : "";
                const channels = readChannels().channels.filter(validChannel).filter(ch =>
                    !q || [ch.name, ch.description, ...(Array.isArray(ch.tags) ? ch.tags : [])]
                        .some(value => typeof value === "string" && value.toLowerCase().includes(q)));
                res.json({ ok: true, total: channels.length, channels: channels.slice(0, 100).map(publicChannel) });
            } catch (error) {
                console.error("[local-api] channel catalog read failed:", error.message);
                res.status(500).json({ ok: false, error: "channel_catalog_unavailable" });
            }
        });

        app.get("/local-api/v1/channels/:id", (req, res) => {
            if (!ID_RE.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_channel_id" });
            try {
                const channel = readChannels().channels.find(ch => validChannel(ch) && ch.id === req.params.id);
                if (!channel) return res.status(404).json({ ok: false, error: "channel_not_found" });
                res.json({ ok: true, channel: publicChannel(channel) });
            } catch (error) {
                res.status(500).json({ ok: false, error: "channel_catalog_unavailable" });
            }
        });

        app.get("/local-api/v1/channels/:id/videos", (req, res) => {
            if (!ID_RE.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_channel_id" });
            try {
                const catalog = readCatalog();
                const videos = catalog.videos.filter(v => validVideo(v) && v.channel_id === req.params.id);
                res.json({ ok: true, total: videos.length, videos: videos.slice(0, 100).map(publicVideo) });
            } catch (error) {
                res.status(500).json({ ok: false, error: "catalog_unavailable" });
            }
        });

        app.post("/local-api/v1/channels", (req, res) => {
            const expected = config && typeof config.local_api_key === "string" ? config.local_api_key : "";
            const supplied = req.get("x-local-api-key") || "";
            if (!expected || expected.length < 24) return res.status(503).json({ ok: false, error: "catalog_write_not_configured" });
            if (supplied.length !== expected.length || supplied !== expected) return res.status(401).json({ ok: false, error: "unauthorized" });
            const channel = parseRequestBody(req.body);
            if (!validChannel(channel)) return res.status(400).json({ ok: false, error: "invalid_channel" });
            try {
                const data = readChannels(), index = data.channels.findIndex(ch => ch.id === channel.id);
                const safe = publicChannel(channel);
                if (index >= 0) data.channels[index] = safe; else data.channels.push(safe);
                fs.writeFileSync(CHANNELS_FILE + ".tmp", JSON.stringify(data, null, 2));
                fs.renameSync(CHANNELS_FILE + ".tmp", CHANNELS_FILE);
                res.status(index >= 0 ? 200 : 201).json({ ok: true, channel: safe });
            } catch (error) {
                res.status(500).json({ ok: false, error: "channel_catalog_write_failed" });
            }
        });

        app.get("/local-api/v1/videos", (req, res) => {
            try {
                const catalog = readCatalog();
                const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase().slice(0, 120) : "";
                const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
                const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
                let videos = catalog.videos.filter(validVideo);
                if (q) {
                    videos = videos.filter(v => [v.title, v.description, v.author, ...(Array.isArray(v.tags) ? v.tags : [])]
                        .some(value => typeof value === "string" && value.toLowerCase().includes(q)));
                }
                res.json({ ok: true, total: videos.length, offset, limit, videos: videos.slice(offset, offset + limit).map(publicVideo) });
            } catch (error) {
                console.error("[local-api] catalog read failed:", error.message);
                res.status(500).json({ ok: false, error: "catalog_unavailable" });
            }
        });

        app.get("/local-api/v1/videos/:id", (req, res) => {
            if (!ID_RE.test(req.params.id)) return res.status(400).json({ ok: false, error: "invalid_video_id" });
            try {
                const video = readCatalog().videos.find(v => validVideo(v) && v.id === req.params.id);
                if (!video) return res.status(404).json({ ok: false, error: "video_not_found" });
                res.json({ ok: true, video: publicVideo(video) });
            } catch (error) {
                console.error("[local-api] video read failed:", error.message);
                res.status(500).json({ ok: false, error: "catalog_unavailable" });
            }
        });

        // Catalog writes are disabled until the operator explicitly configures
        // local_api_key in back/config.json. Never expose an unprotected write route.
        app.post("/local-api/v1/videos", (req, res) => {
            const expected = config && typeof config.local_api_key === "string" ? config.local_api_key : "";
            const supplied = req.get("x-local-api-key") || "";
            if (!expected || expected.length < 24) {
                return res.status(503).json({ ok: false, error: "catalog_write_not_configured" });
            }
            if (supplied.length !== expected.length || supplied !== expected) {
                return res.status(401).json({ ok: false, error: "unauthorized" });
            }
            const video = parseRequestBody(req.body);
            if (!validVideo(video)) return res.status(400).json({ ok: false, error: "invalid_video" });
            try {
                const catalog = readCatalog();
                const index = catalog.videos.findIndex(v => v.id === video.id);
                const safe = publicVideo(video);
                if (index >= 0) catalog.videos[index] = safe;
                else catalog.videos.push(safe);
                const temporary = CATALOG_FILE + ".tmp";
                fs.writeFileSync(temporary, JSON.stringify(catalog, null, 2));
                fs.renameSync(temporary, CATALOG_FILE);
                res.status(index >= 0 ? 200 : 201).json({ ok: true, video: safe });
            } catch (error) {
                console.error("[local-api] catalog write failed:", error.message);
                res.status(500).json({ ok: false, error: "catalog_write_failed" });
            }
        });

    },
    getVideos: function(limit, offset) {
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
        const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
        const videos = readCatalog().videos.filter(validVideo);
        return { total: videos.length, videos: videos.slice(safeOffset, safeOffset + safeLimit).map(publicVideo) };
    },
    getVideo: function(id) {
        if (!ID_RE.test(id || "")) return null;
        const video = readCatalog().videos.find(v => validVideo(v) && v.id === id);
        return video ? publicVideo(video) : null;
    },
    getChannel: function(id) {
        if (!ID_RE.test(id || "")) return null;
        const channel = readChannels().channels.find(ch => validChannel(ch) && ch.id === id);
        return channel ? publicChannel(channel) : null;
    },
    getChannelVideos: function(id, limit, offset) {
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
        const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
        const videos = readCatalog().videos.filter(v => validVideo(v) && v.channel_id === id);
        return { total: videos.length, videos: videos.slice(safeOffset, safeOffset + safeLimit).map(publicVideo) };
    },
    searchChannels: function(query, limit) {
        const q = typeof query === "string" ? query.trim().toLowerCase().slice(0, 120) : "";
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const channels = readChannels().channels.filter(validChannel).filter(ch =>
            !q || [ch.name, ch.description, ...(Array.isArray(ch.tags) ? ch.tags : [])]
                .some(value => typeof value === "string" && value.toLowerCase().includes(q)));
        return channels.slice(0, safeLimit).map(ch => {
            const p = publicChannel(ch);
            return { type: "channel", name: p.name, avatar: p.avatar, subscribers: p.subscribers + " subscribers", url: p.url, local: true };
        });
    },
    searchVideos: function(query, limit, offset) {
        const q = typeof query === "string" ? query.trim().toLowerCase().slice(0, 120) : "";
        const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
        const videos = readCatalog().videos.filter(validVideo).filter(v => {
            return !q || [v.title, v.description, v.author, ...(Array.isArray(v.tags) ? v.tags : [])]
                .some(value => typeof value === "string" && value.toLowerCase().includes(q));
        });
        return {
            total: videos.length,
            videos: videos.slice(safeOffset, safeOffset + safeLimit).map(v => {
                const p = publicVideo(v);
                return {
                    type: "video",
                    id: p.id,
                    title: p.title,
                    views: "0 views",
                    thumbnail: p.thumbnail || "/assets/site-assets/default.png",
                    description: p.description,
                    time: p.duration ? Math.floor(p.duration / 60) + ":" + String(p.duration % 60).padStart(2, "0") : "",
                    author_name: p.author,
                    author_url: "",
                    author_handle: false,
                    upload: p.published_at,
                    verified: false,
                    artist: false,
                    local: true
                };
            })
        };
    }
};
