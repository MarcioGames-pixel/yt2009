# Self-hosted local API

This API is optional and does not replace the legacy HTML/CSS. It lets a self-hosted instance keep its own catalog and lightweight community data without calling the official YouTube API for these records.

## Catalog

- `GET /local-api/v1/status`
- `GET /local-api/v1/videos?q=term&limit=20&offset=0`
- `GET /local-api/v1/videos/:id`
- `POST /local-api/v1/videos` — disabled until `local_api_key` is configured in the server config with at least 24 characters. Send the key in `x-local-api-key`.

Catalog video records accept `id`, `title`, `description`, `author`, `thumbnail`, `playback_url`, `duration`, `published_at`, and `tags`. Use a real reachable `playback_url` for playable media; this catalog does not download or host video files automatically.

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
- `GET|POST /local-api/v1/favorites` (POST JSON `{"video_id":"VIDEO_ID"}`)
- `DELETE /local-api/v1/favorites/:item`
- `GET|POST /local-api/v1/subscriptions` (POST JSON `{"channel_id":"CHANNEL_ID"}`)
- `DELETE /local-api/v1/subscriptions/:item`

Community data is stored in `back/local-data/community.json`. Do not expose the instance publicly without adding operational protections such as HTTPS, rate limits, backups, and moderation. The legacy pages are not yet wired to these new endpoints; this is a backend foundation for that next integration step.
