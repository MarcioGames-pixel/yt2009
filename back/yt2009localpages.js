/*
 * Local catalog page handlers.
 * These handlers only claim requests for IDs present in the self-hosted catalog;
 * every other request falls through to the original yt2009 route unchanged.
 */
const fs = require("fs");
const path = require("path");
const local = require("./yt2009localapi");
const utils = require("./yt2009utils");
const watchTemplate = fs.readFileSync(path.join(__dirname, "../watch.html"), "utf8");

function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function mediaUrl(value) {
    if (typeof value !== "string") return "";
    const url = value.trim();
    if (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)) return url;
    return "";
}
function replaceAll(html, token, value) {
    return html.split(token).join(value);
}
function watchHtml(video) {
    const channel = video.channel_id ? local.getChannel(video.channel_id) : null;
    const channelName = channel ? channel.name : video.author;
    const channelUrl = channel ? channel.url : (video.channel_id ? "/channel/" + encodeURIComponent(video.channel_id) : "#");
    const thumbnail = mediaUrl(video.thumbnail) || "/assets/site-assets/default.png";
    const playback = mediaUrl(video.playback_url);
    const description = esc(video.description).replace(/\n/g, "<br>");
    const tags = video.tags.map(tag => '<a class="hLink" href="/results?search_query=' + encodeURIComponent(tag) + '">' + esc(tag) + '</a>').join(" ");
    const source = playback
        ? '<source src="' + esc(playback) + '" type="' + (/\.webm(?:$|\?)/i.test(playback) ? "video/webm" : "video/mp4") + '">'
        : "";
    let html = watchTemplate;
    const replacements = {
        "video_title": esc(video.title),
        "channel_url": esc(channelUrl),
        "channel_icon": esc(channel ? (mediaUrl(channel.avatar) || thumbnail) : thumbnail),
        "channel_name": esc(channelName),
        "upload_date": esc(video.published_at || ""),
        "video_short_description": description,
        "video_full_description": description,
        "video_tags_html": tags,
        "video_url": esc("/watch?v=" + video.id),
        "video_embed_link": esc('<iframe src="/embed/' + video.id + '"></iframe>'),
        "mp4_files": source,
        "video_view_count": "0",
        "yt2009_comment_count": "0",
        "yt2009_ratings_count": "0",
        "video_id": esc(video.id)
    };
    Object.keys(replacements).forEach(key => { html = replaceAll(html, key, replacements[key]); });
    if (!playback) {
        html = replaceAll(html, '<div id="watch-player-div" class="flash-player">', '<div id="watch-player-div" class="flash-player"><div style="padding:18px;background:#111;color:#fff;font:13px Arial">This local catalog entry has no playback URL configured yet.</div>');
    }
    html = replaceAll(html, '<!--yt2009_notice-->', '<div style="margin:8px 0;padding:6px;border:1px solid #d7d7a0;background:#ffffe0;font:12px Arial">Self-hosted video catalog · Local community features are available below.</div>');
    return html;
}
function channelHtml(channel, videos) {
    const avatar = mediaUrl(channel.avatar);
    const banner = mediaUrl(channel.banner);
    const videoCards = videos.map(video => {
        const thumb = mediaUrl(video.thumbnail) || "/assets/site-assets/default.png";
        return '<div style="width:180px;margin:8px;display:inline-block;vertical-align:top;font:12px Arial;color:#333">' +
            '<a href="/watch?v=' + encodeURIComponent(video.id) + '" style="color:#03c;text-decoration:none">' +
            '<img src="' + esc(thumb) + '" alt="" style="width:180px;height:101px;object-fit:cover;border:1px solid #aaa">' +
            '<div style="font-weight:bold;margin-top:4px">' + esc(video.title) + '</div></a>' +
            '<div>' + esc(video.duration ? Math.floor(video.duration / 60) + ":" + String(video.duration % 60).padStart(2, "0") : "") + '</div></div>';
    }).join("");
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>YouTube - ' + esc(channel.name) + '</title><link rel="stylesheet" href="/www-core-feather.css">' +
        '<style>body{font:12px Arial,sans-serif;color:#333;background:#fff;margin:0}a{color:#03c}#masthead{padding:12px 20px;border-bottom:1px solid #ccc;background:#f4f4f4}#masthead a{font-size:18px;font-weight:bold;text-decoration:none}#local-channel{max-width:1000px;margin:18px auto;padding:0 12px}.banner{height:120px;background:#ddd center/cover no-repeat}.info{padding:12px;background:#eee;min-height:70px}.info img{width:64px;height:64px;object-fit:cover;float:left;margin-right:12px}.clear{clear:both}</style></head><body>' +
        '<div id="masthead"><a href="/">YouTube</a> &nbsp; <a href="/videos">Videos</a> &nbsp; <a href="/channels">Channels</a>' +
        '<form action="/results" method="get" style="float:right"><input name="search_query" maxlength="128"><button>Search</button></form></div>' +
        '<main id="local-channel">' + (banner ? '<div class="banner" style="background-image:url(&quot;' + esc(banner) + '&quot;)"></div>' : '') +
        '<section class="info">' + (avatar ? '<img src="' + esc(avatar) + '" alt="">' : '') +
        '<h1 style="margin:0 0 6px;font-size:20px">' + esc(channel.name) + '</h1><div>' + Number(channel.subscribers || 0).toLocaleString() + ' subscribers</div>' +
        '<div>' + esc(channel.description) + '</div><div class="clear"></div></section>' +
        '<h2 style="font-size:16px;border-bottom:1px solid #ccc;padding-bottom:6px">Videos</h2>' +
        (videoCards || '<p>This channel has no videos in the local catalog yet.</p>') + '<div class="clear"></div></main></body></html>';
}
module.exports = {
    set: function(app) {
        app.get("/watch", function(req, res, next) {
            if (!utils.isAuthorized(req) || !req.query.v) return next();
            try {
                const video = local.getVideo(String(req.query.v));
                if (!video) return next();
                res.type("html").send(watchHtml(video));
            } catch (error) {
                console.error("[local-pages] watch render failed:", error.message);
                next();
            }
        });
        app.get("/channel/:id", function(req, res, next) {
            if (!utils.isAuthorized(req)) return next();
            try {
                const channel = local.getChannel(String(req.params.id));
                if (!channel) return next();
                const data = local.getChannelVideos(channel.id, 100, 0);
                res.type("html").send(channelHtml(channel, data.videos));
            } catch (error) {
                console.error("[local-pages] channel render failed:", error.message);
                next();
            }
        });
    }
};
