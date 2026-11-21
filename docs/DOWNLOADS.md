# TEDFLIX 1.52.5 — Downloads offline

## Architecture

The feature uses the same source-resolution pipeline as playback. The WebView never tries to scrape or reconstruct a stream URL.

1. The movie/episode/series info screen calls `AndroidPlayer.downloadContent` or `AndroidPlayer.enqueueDownloadQueue`.
2. Android opens `PlayerActivity` with `EXTRA_DOWNLOAD_ONLY`.
3. Para as cinco fontes de conteúdo, `PlayerActivity` consulta exclusivamente o Content Server v2 em `/api/play/:api/:sourceId`, enviando `type`, `season` e `episode` quando necessário. TEDTOP continua como integração independente e só é usado para itens da categoria `destaque`.
4. The resolved final URL, media type and the request headers actually selected by the playback pipeline are passed to `TedflixDownloadService`.
5. The service creates a persistent `DownloadRequest` and adds it to Media3 `DownloadManager`.
6. `DefaultDownloadIndex` persists the queue/state; `SimpleCache` with `NoOpCacheEvictor` stores downloaded media.
7. The request's application data contains the metadata and its own `downloadHeaders`. A per-request `DownloaderFactory` creates an OkHttp-backed downloader with those headers. This avoids header collisions when several episodes from the same CDN are downloading concurrently.
8. Offline playback opens the same cached media through a cache-only `CacheDataSource`. It does not fall back to the network.

## Media types

- HLS/M3U8: Media3 HLS downloader. `streamKeys` is empty, so all available tracks are downloaded.
- DASH/MPD: Media3 DASH downloader. `streamKeys` is empty, so all available tracks are downloaded.
- MP4/progressive: Media3 progressive downloader.

The app's native player source selection was also corrected to create a `DashMediaSource` for DASH instead of routing every non-MP4 stream through HLS.

## User features

- Download icon on movie and series information pages.
- Download icon on each episode row and on the episode information page.
- Download-all-series queue (all seasons/episodes exposed by the selected source).
- Persistent pending episode queue; if Android kills the app during queue resolution, the queue is resumed when TEDFLIX is opened again.
- Meus downloads page in Settings.
- Live progress, state, downloaded bytes and estimated content size.
- Pause/resume one item; pause/resume all.
- Retry failed items.
- Delete a download and release its cached data.
- Play completed items offline.
- Foreground progress notification, completion notification and failure notification.
- Runtime notification permission request on Android 13+ when the user starts a download.

## Storage and compatibility

Downloads are stored in the app-private directory `filesDir/tedflix_download_cache`. They are not exported as loose MP4 files and do not require broad storage permission. The TEDFLIX player reads the cache directly.

Live HLS/DASH streams are not treated as downloadable VOD. DRM-protected media requires a licensed offline DRM flow and is not bypassed by this implementation. All-stream HLS/DASH requests can use more storage than selecting a single quality/audio track.

## Verification status

Automated checks completed in this workspace:
- JavaScript syntax check: all 32 active JS files pass `node --check`.
- Local ES module imports: no missing relative modules.
- Android manifest: parses as valid XML.
- Content Server v2 flow test: search, catalogs, categories, details, season/episode mapping and playback route pass with mocked HTTP responses.

Not verified here:
- Full Gradle/Android compilation and APK packaging. This workspace has no Android SDK, Gradle installation or Gradle wrapper.
- Device playback/download tests against each live source provider and CDN.
- Airplane-mode playback, process-death recovery, notification permission behavior and Android 13–15 foreground-service behavior on physical devices.

A real Android build and device test is required before calling the APK production-validated. No build success is claimed in this document.
