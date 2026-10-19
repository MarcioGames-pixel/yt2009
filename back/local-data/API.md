# Self-hosted local API

This API is optional and keeps the legacy HTML/CSS and modules in place. It provides a self-hosted catalog and lightweight community data. To stop legacy search from contacting YouTube/Innertube or the Data API, set `local_api_only` to `true` in `back/config.json`. In that mode the Home, Videos, Channels, Search, local video watch pages, and local channel pages use the local catalog. Keep it `false` to preserve the original upstream search behavior when local results are absent.

## Catalog

- `GET /local-api/v1/status`
- `GET /local-api/v1/videos?q=term&limit=20&offset=0`
- `GET /local-api/v1/videos/:id`
- `GET /local-media/:filename` — serves operator-provided MP4/WebM files from `back/local-data/media/`
- `GET /local-api/v1/channels?q=term`
- `GET /local-api/v1/channels/:id`
- `GET /local-api/v1/channels/:id/videos`
- `POST /local-api/v1/channels` — same `local_api_key` requirement as video writes
- `POST /local-api/v1/videos` — disabled until `local_api_key` is configured in the server config with at least 24 characters. Send the key in `x-local-api-key`.

Catalog video records accept `id`, `title`, `description`, `author`, `channel_id`, `thumbnail`, `playback_url`, `duration`, `published_at`, and `tags`. Channel records accept `id`, `name`, `description`, `avatar`, `banner`, and `subscribers`. Use `playback_url: "/local-media/demo.mp4"` after placing an operator-owned file at `back/local-data/media/demo.mp4`, or provide another reachable HTTP(S) media URL. Local media files are served directly by this instance; no official YouTube API is involved in their playback.

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

Community data is stored in `back/local-data/community.json`. Do not expose the instance publicly without adding operational protections such as HTTPS, rate limits, backups, and moderation. The legacy watch template now loads a small community panel for local comments, ratings, favorites, playlists, and subscriptions. Local catalog video and channel IDs are rendered by dedicated handlers; IDs not present in the local catalog fall through to the original modules. Existing account pages are not converted into a verified registration/login system.
