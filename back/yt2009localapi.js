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
    }
};
