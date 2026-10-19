/* yt2009 independent local community UI.
 * Uses the local API only; legacy layout/styles remain in place.
 */
(function () {
    "use strict";
    if (window.__yt2009LocalCommunityLoaded) return;
    window.__yt2009LocalCommunityLoaded = true;

    function videoId() {
        try {
            var url = new URL(window.location.href);
            var id = url.searchParams.get("v");
            if (!id && /\/embed\//.test(url.pathname)) id = url.pathname.split("/embed/")[1].split("/")[0];
            if (!id && /\/watch\//.test(url.pathname)) id = url.pathname.split("/watch/")[1].split("/")[0];
            return /^[A-Za-z0-9_-]{1,80}$/.test(id || "") ? id : "";
        } catch (_) { return ""; }
    }
    function element(tag, text, className) {
        var node = document.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (className) node.className = className;
        return node;
    }
    function request(path, options) {
        options = options || {};
        options.credentials = "same-origin";
        options.headers = Object.assign({ "Content-Type": "application/json" }, options.headers || {});
        return fetch("/local-api/v1" + path, options).then(function (response) {
            return response.text().then(function (raw) {
                var data = {};
                try { data = raw ? JSON.parse(raw) : {}; } catch (_) {}
                if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
                return data;
            });
        });
    }
    function mount() {
        var id = videoId();
        if (!id || !document.body || document.getElementById("yt2009-local-community")) return;
        var anchor = document.getElementById("watch-comment-panel") ||
                     document.getElementById("watch-this-vid-info") ||
                     document.getElementById("baseDiv");
        if (!anchor) return;

        var panel = element("section");
        panel.id = "yt2009-local-community";
        panel.style.cssText = "clear:both;margin:14px 0;padding:10px;border:1px solid #ccc;background:#f7f7f7;color:#333;font:12px Arial,sans-serif;max-width:100%;box-sizing:border-box";
        var heading = element("h2", "Community", "");
        heading.style.cssText = "margin:0 0 8px;font:bold 16px Arial,sans-serif;color:#333";
        panel.appendChild(heading);
        var note = element("div", "Local community for this yt2009 server.", "");
        note.style.cssText = "color:#666;margin-bottom:8px";
        panel.appendChild(note);

        var actions = element("div");
        actions.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px";
        function actionButton(label, handler) {
            var b = element("button", label);
            b.type = "button";
            b.style.cssText = "padding:5px 9px;border:1px solid #aaa;background:linear-gradient(#fff,#e8e8e8);color:#222;cursor:pointer;border-radius:2px";
            b.addEventListener("click", function () {
                b.disabled = true;
                Promise.resolve().then(handler).catch(function (e) { status.textContent = "Could not complete action: " + e.message; })
                    .then(function () { b.disabled = false; });
            });
            actions.appendChild(b);
            return b;
        }
        panel.appendChild(actions);
        var status = element("div", "");
        status.setAttribute("role", "status");
        status.style.cssText = "margin:6px 0;color:#555;min-height:14px";
        panel.appendChild(status);

        var commentsTitle = element("h3", "Comments", "");
        commentsTitle.style.cssText = "font:bold 13px Arial,sans-serif;margin:10px 0 6px;border-bottom:1px solid #ddd;padding-bottom:4px";
        panel.appendChild(commentsTitle);
        var commentForm = element("form");
        var commentInput = element("textarea");
        commentInput.maxLength = 2000;
        commentInput.rows = 3;
        commentInput.placeholder = "Write a comment for this local community…";
        commentInput.style.cssText = "display:block;width:100%;box-sizing:border-box;padding:6px;border:1px solid #aaa;font:12px Arial,sans-serif";
        var commentSubmit = element("button", "Post comment");
        commentSubmit.type = "submit";
        commentSubmit.style.cssText = "margin-top:5px;padding:5px 9px;border:1px solid #aaa;background:#eee;cursor:pointer";
        commentForm.appendChild(commentInput);
        commentForm.appendChild(commentSubmit);
        panel.appendChild(commentForm);
        var commentList = element("div");
        commentList.style.cssText = "margin-top:8px";
        panel.appendChild(commentList);

        if (anchor.id === "watch-comment-panel") anchor.parentNode.insertBefore(panel, anchor);
        else anchor.appendChild(panel);

        var latestRating = { likes: 0, dislikes: 0, rating: 0 };
        var likeButton = actionButton("Like (0)", function () { return rate(1); });
        var dislikeButton = actionButton("Dislike (0)", function () { return rate(-1); });
        actionButton("Add to favorites", function () {
            return ensureSession().then(function () {
                return request("/favorites", { method: "POST", body: JSON.stringify({ video_id: id }) });
            }).then(function () { status.textContent = "Added to this local profile's favorites."; });
        });
        actionButton("Add to QuickList", function () {
            return ensureSession().then(function () {
                return request("/quicklist", { method: "POST", body: JSON.stringify({ video_id: id }) });
            }).then(function () { status.textContent = "Added to the local QuickList."; });
        });
        actionButton("Create playlist", function () {
            var name = window.prompt("Name your local playlist:");
            if (!name || !name.trim()) return;
            return ensureSession().then(function () {
                return request("/playlists", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
            }).then(function (result) {
                return request("/playlists/" + encodeURIComponent(result.playlist.id) + "/videos", {
                    method: "POST", body: JSON.stringify({ video_id: id })
                });
            }).then(function () { status.textContent = "Playlist created and video added."; });
        });

        var channelLink = document.querySelector("#watch-channel-stats a[href*='/channel/'], .yt2009-channel-link[href*='/channel/']");
        if (channelLink) {
            var channelId = channelLink.getAttribute("href").split("/channel/")[1].split(/[/?#]/)[0];
            if (/^[A-Za-z0-9_-]{1,80}$/.test(channelId)) {
                actionButton("Subscribe to channel", function () {
                    return ensureSession().then(function () {
                        return request("/subscriptions", { method: "POST", body: JSON.stringify({ channel_id: channelId }) });
                    }).then(function () { status.textContent = "Subscribed in this local profile."; });
                });
            }
        }

        function ensureSession() {
            return request("/session").then(function (result) {
                if (result.authenticated) return result;
                return request("/session", { method: "POST", body: JSON.stringify({}) });
            });
        }
        function rate(value) {
            return ensureSession().then(function () {
                return request("/videos/" + encodeURIComponent(id) + "/ratings", {
                    method: "PUT", body: JSON.stringify({ rating: latestRating.rating === value ? 0 : value })
                });
            }).then(function () {
                status.textContent = "Your rating was saved locally.";
                return loadRatings();
            });
        }
        function loadRatings() {
            return request("/videos/" + encodeURIComponent(id) + "/ratings").then(function (r) {
                latestRating = r;
                likeButton.textContent = (r.rating === 1 ? "✓ " : "") + "Like (" + r.likes + ")";
                dislikeButton.textContent = (r.rating === -1 ? "✓ " : "") + "Dislike (" + r.dislikes + ")";
            }).catch(function () {});
        }
        function renderComments(comments) {
            while (commentList.firstChild) commentList.removeChild(commentList.firstChild);
            if (!comments.length) {
                commentList.appendChild(element("div", "No local comments yet. Be the first to comment."));
                return;
            }
            comments.forEach(function (comment) {
                var item = element("div");
                item.style.cssText = "padding:7px 0;border-top:1px solid #ddd;overflow-wrap:anywhere";
                var author = element("strong", comment.author || "Guest");
                author.style.cssText = "display:block;margin-bottom:3px";
                var body = element("div", comment.text || "");
                var date = element("small", comment.created_at ? new Date(comment.created_at).toLocaleString() : "");
                date.style.cssText = "display:block;color:#777;margin-top:4px";
                item.appendChild(author); item.appendChild(body); item.appendChild(date);
                commentList.appendChild(item);
            });
        }
        function loadComments() {
            return request("/videos/" + encodeURIComponent(id) + "/comments").then(function (r) {
                renderComments(r.comments || []);
            }).catch(function (e) { status.textContent = "Local comments unavailable: " + e.message; });
        }
        commentForm.addEventListener("submit", function (event) {
            event.preventDefault();
            var text = commentInput.value.trim();
            if (!text) { status.textContent = "Enter a comment first."; return; }
            commentSubmit.disabled = true;
            ensureSession().then(function () {
                return request("/videos/" + encodeURIComponent(id) + "/comments", {
                    method: "POST", body: JSON.stringify({ text: text })
                });
            }).then(function () {
                commentInput.value = "";
                status.textContent = "Comment posted to the local community.";
                return loadComments();
            }).catch(function (e) {
                status.textContent = "Could not post comment: " + e.message;
            }).then(function () { commentSubmit.disabled = false; });
        });

        Promise.all([loadRatings(), loadComments(), request("/session").then(function (r) {
            if (!r.authenticated) status.textContent = "Choose a community action to create a local guest profile.";
            else status.textContent = "Signed in locally as " + r.user.display_name + ".";
        }).catch(function () {})]);
    }

    function mountLists() {
        var path = window.location.pathname;
        var kind = path === "/my_favorites" || path === "/favorites" ? "favorites" :
                   path === "/my_subscriptions" || path === "/subscriptions" ? "subscriptions" :
                   path === "/watch_queue" ? "quicklist" :
                   path === "/playlists" || path === "/my_playlists" ? "playlists" : "";
        if (!kind || document.getElementById("yt2009-local-list-panel")) return;
        var base = document.getElementById("baseDiv") || document.querySelector("main") || document.body;
        var panel = element("section");
        panel.id = "yt2009-local-list-panel";
        panel.style.cssText = "margin:12px 0;padding:10px;border:1px solid #ccc;background:#f7f7f7;color:#333;font:12px Arial,sans-serif";
        var title = kind === "favorites" ? "Local Favorites" : kind === "subscriptions" ? "Local Subscriptions" : kind === "quicklist" ? "Local QuickList" : "Local Playlists";
        var h = element("h2", title);
        h.style.cssText = "font:bold 16px Arial,sans-serif;margin:0 0 8px";
        panel.appendChild(h);
        var status = element("div", "Loading local data…");
        panel.appendChild(status);
        var list = element("div");
        panel.appendChild(list);
        if (base.firstChild) base.insertBefore(panel, base.firstChild); else base.appendChild(panel);

        function removeButton(label, fn) {
            var b = element("button", label);
            b.type = "button";
            b.style.cssText = "margin-left:8px;padding:2px 6px;border:1px solid #aaa;background:#eee;cursor:pointer";
            b.addEventListener("click", function () {
                b.disabled = true;
                Promise.resolve().then(fn).then(load).catch(function (e) {
                    status.textContent = "Could not update list: " + e.message;
                    b.disabled = false;
                });
            });
            return b;
        }
        function row(label, href, removeFn) {
            var item = element("div");
            item.style.cssText = "padding:6px 0;border-top:1px solid #ddd;overflow-wrap:anywhere";
            var a = element("a", label);
            a.href = href;
            a.style.cssText = "color:#03c;text-decoration:none;font-weight:bold";
            item.appendChild(a);
            if (removeFn) item.appendChild(removeButton("Remove", removeFn));
            list.appendChild(item);
        }
        function load() {
            while (list.firstChild) list.removeChild(list.firstChild);
            var endpoint = kind === "playlists" ? "/playlists" : "/" + kind;
            return request(endpoint).then(function (data) {
                var items = kind === "playlists" ? (data.playlists || []) : (data.items || []);
                status.textContent = items.length ? "Stored on this server for the current local profile." : "No local items yet. Open a video and use the local community controls.";
                if (kind === "playlists") {
                    items.forEach(function (playlist) {
                        var wrapper = element("div");
                        wrapper.style.cssText = "padding:8px 0;border-top:1px solid #ddd";
                        var name = element("strong", playlist.name);
                        wrapper.appendChild(name);
                        wrapper.appendChild(removeButton("Delete playlist", function () {
                            return request("/playlists/" + encodeURIComponent(playlist.id), { method: "DELETE" });
                        }));
                        (playlist.video_ids || []).forEach(function (id) {
                            var link = element("div");
                            link.style.cssText = "margin:5px 0 0 12px";
                            var a = element("a", id);
                            a.href = "/watch?v=" + encodeURIComponent(id);
                            a.style.color = "#03c";
                            link.appendChild(a);
                            link.appendChild(removeButton("Remove video", function () {
                                return request("/playlists/" + encodeURIComponent(playlist.id) + "/videos/" + encodeURIComponent(id), { method: "DELETE" });
                            }));
                            wrapper.appendChild(link);
                        });
                        list.appendChild(wrapper);
                    });
                    return;
                }
                items.forEach(function (id) {
                    if (typeof id !== "string") return;
                    if (kind === "subscriptions") {
                        request("/channels/" + encodeURIComponent(id)).then(function (r) {
                            row(r.channel.name, r.channel.url, function () {
                                return request("/subscriptions/" + encodeURIComponent(id), { method: "DELETE" });
                            });
                        }).catch(function () { row(id, "/channel/" + encodeURIComponent(id), function () {
                            return request("/subscriptions/" + encodeURIComponent(id), { method: "DELETE" });
                        }); });
                    } else {
                        request("/videos/" + encodeURIComponent(id)).then(function (r) {
                            row(r.video.title, "/watch?v=" + encodeURIComponent(id), function () {
                                return request("/" + kind + "/" + encodeURIComponent(id), { method: "DELETE" });
                            });
                        }).catch(function () { row(id, "/watch?v=" + encodeURIComponent(id), function () {
                            return request("/" + kind + "/" + encodeURIComponent(id), { method: "DELETE" });
                        }); });
                    }
                });
            }).catch(function (e) {
                status.textContent = "Local list unavailable: " + e.message;
            });
        }
        load();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { mount(); mountLists(); });
    } else { mount(); mountLists(); }
})();
