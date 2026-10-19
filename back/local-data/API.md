# Self-hosted local API

This API is optional and keeps the legacy HTML/CSS and modules in place. It provides a self-hosted catalog and lightweight community data. To stop legacy search from contacting YouTube/Innertube or the Data API, set `local_api_only` to `true` in `back/config.json`. In that mode the Home, Videos, Channels, Search, local video watch pages, local channel pages, and embed pages use the local catalog. Unknown watch/channel/embed IDs return local 404 responses instead of falling through to legacy upstream handlers. Keep it `false` to preserve the original upstream search behavior when local results are absent.

## Community accounts

- Open `/local-account` to register or sign in.
- `POST /local-api/v1/accounts/register` with JSON `{ "username": "retro_user", "email": "retro@example.com", "password": "at-least-8-characters", "display_name": "Retro User" }`.
- `POST /local-api/v1/accounts/login` with JSON `{ "username": "retro_user", "password": "at-least-8-characters" }`; username or email can be used.
- Usernames are normalized to lowercase and limited to 3–24 letters, digits, and underscores. Passwords must be 8–256 characters.
- Email addresses and usernames are unique. Passwords are stored as salted scrypt hashes, never as plaintext. Successful registration/login sets the existing HttpOnly `yt2009_local_session` cookie, so comments, ratings, favorites, playlists, subscriptions, and QuickList use that account identity.\n- `GET /local-api/v1/accounts/me` returns the signed-in profile; `PATCH /local-api/v1/accounts/me` updates `display_name`, `bio` (up to 500 characters), and `avatar_url` (HTTPS or a same-origin path). `POST /local-api/v1/accounts/logout` clears the cookie. `GET /local-api/v1/profiles/:username` returns a public profile JSON document and public playlists. `GET /u/:username` renders a simple public profile page in the retro style.
- Older guest profiles remain guest profiles; they are not automatically linked to a new account. Guest data is not merged into an account.

Important remaining limitation: email is collected and checked for uniqueness, but email delivery and verification are NOT implemented yet. The `email_verified` field is informational only and registration does not prove mailbox ownership. Password recovery, rate limiting, and a dedicated HTML public-profile page are also not implemented. Do not expose this instance publicly until email verification, abuse controls, account recovery, and deployment security are added. These accounts are local to this server, not official YouTube/Google accounts. Use HTTPS beyond a trusted local network, keep `back/local-data/community.json` private, and back up that file securely.

## Catalog

- `GET /local-api/v1/status`
- `GET /local-api/v1/videos?q=term&limit=20&offset=0`
- `GET /local-api/v1/videos/:id`
- `GET /local-media/:filename` — serves operator-provided MP4/WebM files from `back/local-data/media/`
- `GET /local-api/v1/channels?q=term`
- `GET /local-api/v1/channels/:id`
- `GET /local-api/v1/channels/:id/videos`
- `POST /local-api/v1/channels` — create/update a channel; protected by `local_api_key`
- `DELETE /local-api/v1/channels/:id` — protected; returns `409 channel_has_videos` if videos still reference the channel
- `POST /local-api/v1/videos` — create/update a video; protected by `local_api_key`
- `DELETE /local-api/v1/videos/:id` — protected; removes the catalog record but intentionally leaves media files untouched
- `POST /local-api/v1/media/:filename` — upload raw MP4/WebM bytes; protected by `local_api_key`, and bounded by the existing `file_limit` in MB
- `GET /local-api/v1/status` — health/status endpoint

Write endpoints return `503 catalog_write_not_configured` until `local_api_key` is configured in the server's local `back/config.json` with at least 24 characters. Send it in `x-local-api-key`. Do not put this secret in browser JavaScript, commit it, or expose write credentials to untrusted users.

Catalog video records accept `id`, `title`, `description`, `author`, `channel_id`, `thumbnail`, `playback_url`, `duration`, `published_at`, and `tags`. Channel records accept `id`, `name`, `description`, `avatar`, `banner`, and `subscribers`. Use `playback_url: "/local-media/demo.mp4"` after placing an operator-owned file at `back/local-data/media/demo.mp4`, or provide another reachable HTTP(S) media URL. Local media files are served directly by this instance; no official YouTube API is involved in their playback.

Example media upload (run on a trusted machine; replace the path and secret):

```sh
curl -i -X POST http://localhost:8080/local-api/v1/media/demo.mp4 \
  -H 'x-local-api-key: REPLACE_WITH_YOUR_LOCAL_SECRET' \
  -H 'Content-Type: video/mp4' \
  --data-binary @demo.mp4
```

The endpoint buffers the request body in memory up to the configured request limit, so use a sensible `file_limit` and avoid large uploads. Upload only media you own or have permission to host.

## Anonymous local profile and community

Create or retrieve an anonymous local profile (cookie-based):

```sh
curl -i -X POST http://localhost:8080/local-api/v1/session \
  -H 'Content-Type: application/json' \
  -d '{"display_name":"Guest"}'
```

Keep the returned cookie for subsequent requests. This is not a verified account/login system. The profile is local to this server installation.

- `GET /local-api/v1/session`
- `POST /local-api/v1/session/logout`
- `GET /local-api/v1/videos/:id/comments`
- `POST /local-api/v1/videos/:id/comments` with JSON `{"text":"Comment"}`
- `GET /local-api/v1/videos/:id/ratings`
- `PUT /local-api/v1/videos/:id/ratings` with JSON `{"rating":1}`, `{"rating":-1}`, or `{"rating":0}` to clear the rating
- `GET /local-api/v1/playlists`
- `POST /local-api/v1/playlists` with JSON `{"name":"Favorites mix"}`
- `POST /local-api/v1/playlists/:id/videos` with JSON `{"video_id":"VIDEO_ID"}`
- `DELETE /local-api/v1/playlists/:id/videos/:video_id`
- `DELETE /local-api/v1/playlists/:id`
- `GET|POST /local-api/v1/favorites` (POST JSON `{"video_id":"VIDEO_ID"}`)
- `GET|POST /local-api/v1/quicklist` (POST JSON `{"video_id":"VIDEO_ID"}`)
- `DELETE /local-api/v1/quicklist/:item`
- `DELETE /local-api/v1/favorites/:item`
- `GET|POST /local-api/v1/subscriptions` (POST JSON `{"channel_id":"CHANNEL_ID"}`)
- `DELETE /local-api/v1/subscriptions/:item`

Community data is stored in `back/local-data/community.json`. Do not expose the instance publicly without adding operational protections such as HTTPS, rate limits, backups, and moderation. The legacy watch template now loads a small community panel for local comments, ratings, favorites, playlists, and subscriptions. The community list panel supports both extensionless routes and legacy static names such as `favorites.htm`, `playlists.htm`, `quicklist.htm`, and `subscriptions.htm`. Local catalog video and channel IDs are rendered by dedicated handlers; IDs not present in the local catalog fall through to the original modules. Existing account pages are not converted into a verified registration/login system.
