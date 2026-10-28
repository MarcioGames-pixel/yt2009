# Local media storage

Place operator-owned MP4 or WebM files in this directory. The server exposes them at `/local-media/<filename>` and supports normal HTTP range requests through Express `sendFile`, allowing the existing HTML5 player to seek when the browser and media format support it.

Use a simple filename such as `demo.mp4` and set that catalog record's `playback_url` to `/local-media/demo.mp4`. Only MP4 and WebM files with safe filenames are served. Do not add copyrighted videos unless you have the rights to host them.
