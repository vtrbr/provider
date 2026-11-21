package com.tedflix.app.downloads

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.exoplayer.offline.DefaultDownloadIndex
import androidx.media3.exoplayer.offline.DefaultDownloaderFactory
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadCursor
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.Downloader
import androidx.media3.exoplayer.offline.DownloaderFactory
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@UnstableApi
object DownloadRepository {
    private const val TAG = "TedflixDownloadRepo"
    private const val QUEUE_PREFS = "tedflix_pending_download_queue"
    private const val QUEUE_KEY = "items"

    @Volatile private var database: StandaloneDatabaseProvider? = null
    @Volatile private var downloadCache: SimpleCache? = null
    @Volatile private var downloadManager: DownloadManager? = null
    // Dois downloads simultâneos: dois workers evitam criar threads ociosas
    // e reduzem disputa de CPU/RAM em aparelhos modestos.
    private val segmentExecutor = java.util.concurrent.Executors.newFixedThreadPool(2)
    private val downloadHttpClient: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()
    }

    @Synchronized
    private fun database(context: Context): StandaloneDatabaseProvider {
        return database ?: StandaloneDatabaseProvider(context.applicationContext).also { database = it }
    }

    @Synchronized
    fun cache(context: Context): SimpleCache {
        val app = context.applicationContext
        return downloadCache ?: SimpleCache(
            File(app.filesDir, "tedflix_download_cache"),
            NoOpCacheEvictor(),
            database(app),
        ).also { downloadCache = it }
    }

    /**
     * Each DownloadRequest carries its own exact playback headers in request.data.
     * This prevents concurrent episode downloads from overwriting Referer/Auth headers
     * belonging to another episode on the same CDN host.
     */
    private fun upstreamFactory(context: Context, request: DownloadRequest): OkHttpDataSource.Factory {
        val metadata = try { JSONObject(String(request.data, Charsets.UTF_8)) } catch (_: Throwable) { JSONObject() }
        val headerJson = metadata.optJSONObject("downloadHeaders") ?: JSONObject()
        val headers = buildMap {
            val keys = headerJson.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                put(key, headerJson.optString(key))
            }
        }
        val userAgent = headers.entries.firstOrNull { it.key.equals("User-Agent", true) }?.value
            ?.takeIf { it.isNotBlank() } ?: "TEDFLIX Android"
        val requestHeaders = headers.filterKeys { !it.equals("User-Agent", true) }
        return OkHttpDataSource.Factory(downloadHttpClient)
            .setUserAgent(userAgent)
            .setDefaultRequestProperties(requestHeaders)
    }

    fun getDownloadManager(context: Context): DownloadManager = onMain {
        synchronized(this) {
            downloadManager?.let { return@synchronized it }
            val app = context.applicationContext
            val index = DefaultDownloadIndex(database(app))
            val factory = object : DownloaderFactory {
                override fun createDownloader(request: DownloadRequest): Downloader {
                    val upstream = upstreamFactory(app, request)
                    val cacheFactory = CacheDataSource.Factory()
                        .setCache(cache(app))
                        .setUpstreamDataSourceFactory(upstream)
                    return DefaultDownloaderFactory(cacheFactory, segmentExecutor).createDownloader(request)
                }
            }
            val manager = DownloadManager(app, index, factory)
            manager.maxParallelDownloads = 2
            downloadManager = manager
            manager
        }
    }

    fun enqueue(
        context: Context,
        id: String,
        url: String,
        mimeType: String,
        metadataJson: String,
        headersJson: String,
    ) {
        val parsedUrl = android.net.Uri.parse(url.trim())
        val scheme = parsedUrl.scheme?.lowercase().orEmpty()
        require(id.isNotBlank() && (scheme == "http" || scheme == "https") && !parsedUrl.host.isNullOrBlank()) {
            "A API não retornou uma URL válida para download."
        }
        val intent = android.content.Intent(context, TedflixDownloadService::class.java).apply {
            action = TedflixDownloadService.ACTION_ADD
            putExtra(TedflixDownloadService.EXTRA_ID, id)
            putExtra(TedflixDownloadService.EXTRA_URI, url)
            putExtra(TedflixDownloadService.EXTRA_MIME, mimeType)
            putExtra(TedflixDownloadService.EXTRA_METADATA, metadataJson)
            putExtra(TedflixDownloadService.EXTRA_HEADERS, headersJson)
        }
        startDownloadServiceSafely(context, intent, requireForeground = true)
    }

    fun command(context: Context, action: String, id: String? = null) {
        val intent = android.content.Intent(context, TedflixDownloadService::class.java).apply {
            this.action = action
            if (!id.isNullOrBlank()) putExtra(TedflixDownloadService.EXTRA_ID, id)
        }
        val requiresForeground = action == TedflixDownloadService.ACTION_RESUME ||
            action == TedflixDownloadService.ACTION_RESUME_ALL ||
            action == TedflixDownloadService.ACTION_RETRY
        startDownloadServiceSafely(context, intent, requireForeground = requiresForeground)
    }

    /**
     * Evita crash por ForegroundServiceStartNotAllowedException / time budget:
     * quando o processo está em foreground, usa startService (sem obrigação de FG imediata).
     * Caso contrário tenta startForegroundService e deixa o Service tratar a negação.
     */
    private fun startDownloadServiceSafely(context: Context, intent: android.content.Intent, requireForeground: Boolean) {
        val appCtx = context.applicationContext
        if (android.os.Build.VERSION.SDK_INT < 26 || !requireForeground) {
            try {
                appCtx.startService(intent)
            } catch (error: Throwable) {
                Log.e(TAG, "Falha ao iniciar serviço de download", error)
            }
            return
        }
        val inForeground = try {
            val am = appCtx.getSystemService(Context.ACTIVITY_SERVICE) as? android.app.ActivityManager
            val importance = am?.runningAppProcesses
                ?.firstOrNull { it.pid == android.os.Process.myPid() }
                ?.importance
            importance != null && importance <= android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        } catch (_: Throwable) {
            false
        }
        try {
            if (inForeground) {
                // Processo visível: startService evita a obrigação rígida de startForeground
                // em cenários de orçamento dataSync já esgotado.
                appCtx.startService(intent)
            } else {
                appCtx.startForegroundService(intent)
            }
        } catch (error: Throwable) {
            Log.w(TAG, "startForegroundService bloqueado; tentando startService", error)
            try {
                appCtx.startService(intent)
            } catch (error2: Throwable) {
                Log.e(TAG, "Não foi possível iniciar o serviço de download", error2)
            }
        }
    }

    fun notifyResolutionFailure(context: Context, title: String, reason: String) {
        val intent = android.content.Intent(context, TedflixDownloadService::class.java).apply {
            action = TedflixDownloadService.ACTION_FAILURE
            putExtra(TedflixDownloadService.EXTRA_MESSAGE, "$title · $reason")
        }
        context.startService(intent)
    }

    fun metadata(download: Download): JSONObject = metadata(download.request)

    fun metadata(request: DownloadRequest): JSONObject {
        return try { JSONObject(String(request.data, Charsets.UTF_8)) }
        catch (_: Throwable) { JSONObject() }
    }

    fun listDownloads(context: Context): JSONArray {
        val result = JSONArray()
        var cursor: DownloadCursor? = null
        try {
            val index = onMain { getDownloadManager(context).downloadIndex }
            val downloadCursor = index.getDownloads(
                Download.STATE_QUEUED,
                Download.STATE_STOPPED,
                Download.STATE_DOWNLOADING,
                Download.STATE_COMPLETED,
                Download.STATE_FAILED,
                Download.STATE_REMOVING,
                Download.STATE_RESTARTING,
            )
            cursor = downloadCursor
            while (downloadCursor.moveToNext()) {
                val download = downloadCursor.download
                val metadata = metadata(download)
                result.put(JSONObject().apply {
                    put("id", download.request.id)
                    put("title", metadata.optString("title", "Conteúdo"))
                    put("poster", metadata.optString("poster", ""))
                    put("mediaType", metadata.optString("mediaType", ""))
                    put("sourceCategory", metadata.optString("sourceCategory", ""))
                    put("sourceSlug", metadata.optString("sourceSlug", ""))
                    put("season", metadata.optInt("season", 0))
                    put("episode", metadata.optInt("episode", 0))
                    put("seriesTitle", metadata.optString("seriesTitle", ""))
                    put("seriesKey", metadata.optString("seriesKey", ""))
                    put("episodeTitle", metadata.optString("episodeTitle", ""))
                    put("seriesTotalEpisodes", metadata.optInt("seriesTotalEpisodes", 0))
                    put("state", download.state)
                    put("percent", download.percentDownloaded.coerceAtLeast(0f).toInt())
                    put("bytesDownloaded", download.bytesDownloaded)
                    put("contentLength", download.contentLength)
                    put("failureReason", download.failureReason)
                    put("mimeType", download.request.mimeType.orEmpty())
                })
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Erro ao listar downloads", error)
        } finally {
            try { cursor?.close() } catch (_: Throwable) {}
        }
        return result
    }

    fun getDownload(context: Context, id: String): Download? {
        return try {
            val index = onMain { getDownloadManager(context).downloadIndex }
            index.getDownload(id)
        } catch (error: Throwable) {
            Log.e(TAG, "Download não encontrado: $id", error)
            null
        }
    }

    fun offlineMediaSourceFactory(context: Context): DefaultMediaSourceFactory {
        val cacheFactory = CacheDataSource.Factory()
            .setCache(cache(context))
            .setUpstreamDataSourceFactory(null)
            .setCacheWriteDataSinkFactory(null)
        return DefaultMediaSourceFactory(context).setDataSourceFactory(cacheFactory)
    }

    fun buildResolverIntent(context: Context, item: JSONObject, queue: JSONArray? = null): android.content.Intent {
        val metadata = JSONObject(item.optString("metadata", "{}").let {
            if (it.startsWith("{")) it else "{}"
        })
        metadata.put("id", item.optString("id").ifBlank {
            "${item.optString("categoria")}_${item.optString("slug")}".replace(Regex("[^A-Za-z0-9_-]"), "_")
        })
        metadata.put("title", item.optString("titulo"))
        metadata.put("poster", item.optString("thumb"))
        metadata.put("mediaType", item.optString("tipo"))
        val intent = android.content.Intent(context, com.tedflix.app.DownloadResolverActivity::class.java).apply {
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_CATEGORIA, item.optString("categoria"))
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_SLUG, item.optString("slug"))
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_TITULO, item.optString("titulo"))
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_FILME_ID, item.optString("filmeId").ifBlank { item.optString("slug") })
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_THUMB, item.optString("thumb"))
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_TIPO, item.optString("tipo"))
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_SERIE_CATEGORIA, item.optString("serieCategoria"))
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_SERIE_SLUG, item.optString("serieSlug"))
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_DOWNLOAD_ONLY, true)
            putExtra(com.tedflix.app.PlayerActivity.EXTRA_DOWNLOAD_METADATA, metadata.toString())
            if (queue != null) putExtra(com.tedflix.app.PlayerActivity.EXTRA_DOWNLOAD_QUEUE, queue.toString())
        }
        return intent
    }

    fun startDownloadQueue(context: Context, itemsJson: String): Boolean = onMain {
        val items = try { JSONArray(itemsJson) } catch (_: Throwable) { JSONArray() }
        if (items.length() == 0) return@onMain false
        val first = items.optJSONObject(0) ?: return@onMain false
        val queue = JSONArray()
        for (i in 0 until items.length()) queue.put(items.optJSONObject(i) ?: JSONObject())
        context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
            .edit().putString(QUEUE_KEY, queue.toString()).apply()
        context.startActivity(buildResolverIntent(context, first, queue))
        true
    }

    fun startNextFromQueue(activity: android.app.Activity, rawQueue: String?): Boolean {
        if (rawQueue.isNullOrBlank()) return false
        val prefs = activity.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE)
        val persistedQueue = prefs.getString(QUEUE_KEY, null) ?: return false
        val queue = try { JSONArray(persistedQueue) } catch (_: Throwable) {
            prefs.edit().remove(QUEUE_KEY).apply()
            return false
        }
        if (queue.length() <= 1) {
            prefs.edit().remove(QUEUE_KEY).apply()
            return false
        }
        val nextQueue = JSONArray()
        for (i in 1 until queue.length()) nextQueue.put(queue.optJSONObject(i) ?: JSONObject())
        prefs.edit().putString(QUEUE_KEY, nextQueue.toString()).apply()
        val next = nextQueue.optJSONObject(0) ?: return false
        activity.startActivity(buildResolverIntent(activity, next, nextQueue))
        return true
    }

    fun pendingQueueCount(context: Context): Int {
        return try {
            JSONArray(context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE).getString(QUEUE_KEY, "[]"))
                .length()
        } catch (_: Throwable) { 0 }
    }

    fun cancelPendingQueue(context: Context) {
        context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE).edit().remove(QUEUE_KEY).apply()
    }

    fun resumePendingQueue(context: Context): Boolean = onMain {
        val raw = context.getSharedPreferences(QUEUE_PREFS, Context.MODE_PRIVATE).getString(QUEUE_KEY, null)
            ?: return@onMain false
        val queue = try { JSONArray(raw) } catch (_: Throwable) {
            cancelPendingQueue(context)
            return@onMain false
        }
        if (queue.length() == 0) {
            cancelPendingQueue(context)
            return@onMain false
        }
        val first = queue.optJSONObject(0) ?: return@onMain false
        context.startActivity(buildResolverIntent(context, first, queue))
        true
    }

    fun stateLabel(state: Int): String = when (state) {
        Download.STATE_QUEUED -> "Na fila"
        Download.STATE_STOPPED -> "Pausado"
        Download.STATE_DOWNLOADING -> "Baixando"
        Download.STATE_COMPLETED -> "Concluído"
        Download.STATE_FAILED -> "Falhou"
        Download.STATE_REMOVING -> "Removendo"
        Download.STATE_RESTARTING -> "Retomando"
        else -> "Preparando"
    }

    private fun <T> onMain(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val result = AtomicReference<T>()
        val failure = AtomicReference<Throwable>()
        val latch = CountDownLatch(1)
        Handler(Looper.getMainLooper()).post {
            try { result.set(block()) } catch (error: Throwable) { failure.set(error) }
            finally { latch.countDown() }
        }
        if (!latch.await(15, TimeUnit.SECONDS)) throw IllegalStateException("Tempo limite ao acessar o gerenciador de downloads.")
        failure.get()?.let { throw it }
        return result.get()
    }
}
