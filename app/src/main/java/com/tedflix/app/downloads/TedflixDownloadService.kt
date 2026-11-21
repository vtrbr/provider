package com.tedflix.app.downloads

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.app.PendingIntent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import androidx.core.app.NotificationCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager

@UnstableApi
class TedflixDownloadService : Service() {
    companion object {
        const val ACTION_ADD = "com.tedflix.app.downloads.ADD"
        const val ACTION_PAUSE_ALL = "com.tedflix.app.downloads.PAUSE_ALL"
        const val ACTION_RESUME_ALL = "com.tedflix.app.downloads.RESUME_ALL"
        const val ACTION_PAUSE = "com.tedflix.app.downloads.PAUSE"
        const val ACTION_RESUME = "com.tedflix.app.downloads.RESUME"
        const val ACTION_REMOVE = "com.tedflix.app.downloads.REMOVE"
        const val ACTION_RETRY = "com.tedflix.app.downloads.RETRY"
        const val ACTION_FAILURE = "com.tedflix.app.downloads.FAILURE"
        const val EXTRA_MESSAGE = "download_message"
        const val EXTRA_ID = "download_id"
        const val EXTRA_URI = "download_uri"
        const val EXTRA_MIME = "download_mime"
        const val EXTRA_METADATA = "download_metadata"
        const val EXTRA_HEADERS = "download_headers"
        const val CHANNEL_ID = "tedflix_downloads"
        private const val EVENT_CHANNEL_ID = "tedflix_download_events"
        private const val NOTIFICATION_ID = 7310
        private const val TAG = "TedflixDownloads"
    }

    private lateinit var manager: DownloadManager
    private val handler = Handler(Looper.getMainLooper())
    private var updateTask: Runnable? = null
    private var listenerRegistered = false
    @Volatile private var pendingAddCount = 0
    @Volatile private var foregroundStarted = false

    private val downloadListener = object : DownloadManager.Listener {
        override fun onDownloadChanged(downloadManager: DownloadManager, download: Download, finalException: Exception?) {
            updateNotification()
            if (download.state == Download.STATE_COMPLETED) postCompletionNotification(download)
            else if (download.state == Download.STATE_FAILED) postFailureNotification(download, finalException)
        }
        override fun onDownloadRemoved(downloadManager: DownloadManager, download: Download) {
            updateNotification()
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        manager = DownloadRepository.getDownloadManager(this)
        manager.addListener(downloadListener)
        listenerRegistered = true
        // Downloads are resumed only after foreground promotion succeeds.
        scheduleNotificationUpdates()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Sempre tente promover a foreground o mais cedo possível quando o serviço
        // foi iniciado via startForegroundService. Se o sistema bloquear (Android 14/15
        // restrições ou orçamento dataSync esgotado), capturamos e encerramos sem crash.
        val action = intent?.action
        val needsForeground = action == ACTION_ADD || action == ACTION_RETRY ||
            action == ACTION_RESUME || action == ACTION_RESUME_ALL || intent == null
        // intent == null: sistema reiniciou o serviço; ainda precisamos de notificação FG
        // se o tipo exigir, para não estourar RemoteServiceException.
        if (needsForeground) {
            if (!ensureForeground(startId)) {
                // Não foi possível promover: fila pausada e serviço encerrado sem crash.
                return START_NOT_STICKY
            }
        }
        try {
            if (needsForeground && action != null) manager.resumeDownloads()
            when (action) {
                ACTION_ADD -> {
                    val id = intent.getStringExtra(EXTRA_ID).orEmpty()
                    val uri = intent.getStringExtra(EXTRA_URI).orEmpty()
                    val mime = intent.getStringExtra(EXTRA_MIME).orEmpty()
                    val metadata = intent.getStringExtra(EXTRA_METADATA).orEmpty()
                    val headers = intent.getStringExtra(EXTRA_HEADERS).orEmpty()
                    require(id.isNotBlank() && uri.isNotBlank()) { "Download inválido." }
                    val requestMetadata = JSONObject(metadata).put(
                        "downloadHeaders",
                        try { JSONObject(headers) } catch (_: Throwable) { JSONObject() },
                    )
                    val request = androidx.media3.exoplayer.offline.DownloadRequest.Builder(
                        id, android.net.Uri.parse(uri)
                    ).setMimeType(mime.ifBlank { null })
                        .setData(requestMetadata.toString().toByteArray(Charsets.UTF_8))
                        .build()
                    val index = manager.downloadIndex
                    pendingAddCount += 1
                    Thread {
                        val existing = try { index.getDownload(id) } catch (_: Throwable) { null }
                        handler.post {
                            try {
                                if (existing != null &&
                                    existing.state != Download.STATE_FAILED &&
                                    existing.state != Download.STATE_REMOVING &&
                                    existing.state != Download.STATE_RESTARTING
                                ) {
                                    postInfoText("Este conteúdo já está baixado ou na fila.")
                                } else {
                                    manager.addDownload(request)
                                }
                            } catch (error: Throwable) {
                                Log.e(TAG, "Falha ao enfileirar download", error)
                                postFailureText(error.message ?: "Não foi possível iniciar o download.")
                            } finally {
                                handler.postDelayed({
                                    pendingAddCount = (pendingAddCount - 1).coerceAtLeast(0)
                                    updateNotification()
                                }, 900L)
                            }
                        }
                    }.apply { name = "TedflixDownloadIndexLookup"; start() }
                }
                ACTION_PAUSE_ALL -> manager.setStopReason(null, 1)
                ACTION_RESUME_ALL -> {
                    holdForegroundBriefly()
                    manager.setStopReason(null, Download.STOP_REASON_NONE)
                }
                ACTION_PAUSE -> intent.getStringExtra(EXTRA_ID)?.let { manager.setStopReason(it, 1) }
                ACTION_RESUME -> intent.getStringExtra(EXTRA_ID)?.let {
                    holdForegroundBriefly()
                    manager.setStopReason(it, Download.STOP_REASON_NONE)
                }
                ACTION_REMOVE -> intent.getStringExtra(EXTRA_ID)?.let {
                    manager.removeDownload(it)
                }
                ACTION_RETRY -> {
                    val id = intent.getStringExtra(EXTRA_ID).orEmpty()
                    require(id.isNotBlank()) { "Download inválido." }
                    val index = manager.downloadIndex
                    pendingAddCount += 1
                    Thread {
                        val existing = try { index.getDownload(id) } catch (_: Throwable) { null }
                        handler.post {
                            try {
                                if (existing != null && existing.state == Download.STATE_FAILED) {
                                    manager.addDownload(existing.request)
                                } else {
                                    postInfoText("Este download não está em estado de falha.")
                                }
                            } catch (error: Throwable) {
                                Log.e(TAG, "Falha ao tentar novamente", error)
                                postFailureText(error.message ?: "Não foi possível tentar novamente.")
                            } finally {
                                handler.postDelayed({
                                    pendingAddCount = (pendingAddCount - 1).coerceAtLeast(0)
                                    updateNotification()
                                }, 900L)
                            }
                        }
                    }.apply { name = "TedflixRetryLookup"; start() }
                }
                ACTION_FAILURE -> postFailureText(intent.getStringExtra(EXTRA_MESSAGE).orEmpty().ifBlank { "Um episódio não pôde ser preparado." })
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Falha ao processar comando de download", error)
            postFailureText(error.message ?: "Não foi possível processar o download.")
        }
        updateNotification()
        return START_NOT_STICKY
    }

    /**
     * Android 14/15+ can reject a dataSync foreground service (background start
     * restriction or daily time budget exhausted). Treat that as a recoverable
     * scheduling condition — never let the exception escape and crash the process.
     * When startForegroundService was used, we still MUST call startForeground
     * or the system kills the app; if promotion is denied we stop cleanly.
     */
    private fun ensureForeground(startId: Int): Boolean {
        val notification = buildNotification("Preparando downloads", 0, true)
        return try {
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            foregroundStarted = true
            true
        } catch (error: Throwable) {
            val type = error.javaClass.simpleName
            val blocked = type.contains("ForegroundServiceStartNotAllowed") ||
                type.contains("ForegroundServiceDidNotStartInTime") ||
                error is SecurityException ||
                error is IllegalStateException
            if (blocked) {
                Log.w(TAG, "Android bloqueou o foreground dataSync; downloads preservados para retomada ($type)", error)
                // Tenta pelo menos publicar uma notificação normal (não FG) para o usuário.
                try {
                    getSystemService(NotificationManager::class.java)
                        .notify(NOTIFICATION_ID, buildNotification("Downloads pausados", 0, false, "Limite do sistema atingido. Abra o app para retomar."))
                } catch (_: Throwable) {}
                pauseActiveDownloadsAndStop(startId)
                false
            } else {
                Log.e(TAG, "Falha inesperada ao promover foreground", error)
                try { stopSelf(startId) } catch (_: Throwable) {}
                false
            }
        }
    }

    private fun pauseActiveDownloadsAndStop(startId: Int) {
        try { if (::manager.isInitialized) manager.setStopReason(null, 1) } catch (error: Throwable) {
            Log.e(TAG, "Não foi possível pausar a fila após bloqueio do serviço", error)
        }
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (_: Throwable) {}
        foregroundStarted = false
        stopSelf(startId)
    }

    /** Called by Android 15+ when the dataSync foreground-service budget expires. */
    override fun onTimeout(startId: Int, fgsType: Int) {
        Log.w(TAG, "Tempo limite do serviço dataSync atingido; pausando downloads sem apagar a fila")
        pauseActiveDownloadsAndStop(startId)
    }

    private fun holdForegroundBriefly(delayMs: Long = 1200L) {
        pendingAddCount += 1
        handler.postDelayed({
            pendingAddCount = (pendingAddCount - 1).coerceAtLeast(0)
            updateNotification()
        }, delayMs)
    }

    private fun scheduleNotificationUpdates() {
        if (updateTask != null) return
        val task = object : Runnable {
            override fun run() {
                updateTask = null
                if (!::manager.isInitialized) return
                // updateNotification agenda o próximo ciclo apenas se ainda houver
                // trabalho ativo; quando a fila fica ociosa, o polling termina.
                updateNotification()
            }
        }
        updateTask = task
        handler.postDelayed(task, 4000L)
    }

    private fun cancelNotificationUpdates() {
        updateTask?.let(handler::removeCallbacks)
        updateTask = null
    }

    private fun updateNotification() {
        if (!::manager.isInitialized) return
        val downloads = try { manager.currentDownloads } catch (_: Throwable) { emptyList() }
        val shouldKeepForeground = !manager.isInitialized || pendingAddCount > 0 || downloads.any {
            it.state == Download.STATE_DOWNLOADING ||
                (it.state == Download.STATE_QUEUED && it.stopReason == Download.STOP_REASON_NONE)
        }
        if (!shouldKeepForeground) {
            cancelNotificationUpdates()
            if (foregroundStarted) stopForeground(STOP_FOREGROUND_REMOVE)
            foregroundStarted = false
            stopSelf()
            return
        }
        if (foregroundStarted && updateTask == null) scheduleNotificationUpdates()
        val percent = if (downloads.isEmpty()) 0 else downloads
            .filter { it.state == Download.STATE_DOWNLOADING || it.state == Download.STATE_QUEUED }
            .map { it.percentDownloaded.coerceAtLeast(0f) }
            .takeIf { it.isNotEmpty() }
            ?.average()?.toInt() ?: 0
        val active = downloads.firstOrNull { it.state == Download.STATE_DOWNLOADING }
            ?: downloads.firstOrNull()
        val activeMetadata = active?.let { DownloadRepository.metadata(it) } ?: JSONObject()
        val series = activeMetadata.optString("seriesTitle").trim()
        val episode = activeMetadata.optInt("episode", 0)
        val season = activeMetadata.optInt("season", 0)
        val contentLabel = if (series.isNotBlank()) {
            if (season > 0 && episode > 0) "$series · T${season}:E${episode}" else series
        } else activeMetadata.optString("title").ifBlank { "Conteúdo" }
        val title = if (downloads.any { it.state == Download.STATE_DOWNLOADING }) "Baixando $contentLabel" else "Downloads TEDFLIX"
        val message = if (downloads.isEmpty()) "Adicionando à fila" else "$percent% · ${downloads.size} item(ns) na fila"
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(title, percent, downloads.isNotEmpty(), message))
    }

    private fun buildNotification(title: String, progress: Int, ongoing: Boolean, message: String = "Gerenciando downloads"): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(message)
            .setOnlyAlertOnce(true)
            .setOngoing(ongoing)
            .setProgress(100, progress.coerceIn(0, 100), progress <= 0)
            .setContentIntent(openAppPendingIntent(NOTIFICATION_ID))
            .setAutoCancel(false)
            .build()

    private fun openAppPendingIntent(requestCode: Int): PendingIntent {
        val intent = Intent(this, com.tedflix.app.MainActivity::class.java).apply {
            putExtra(com.tedflix.app.MainActivity.EXTRA_OPEN_DOWNLOADS, true)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        return PendingIntent.getActivity(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun postCompletionNotification(download: Download) {
        val metadata = DownloadRepository.metadata(download)
        val seriesTitle = metadata.optString("seriesTitle").trim()
        val seriesKey = metadata.optString("seriesKey").trim()
        val expectedEpisodes = metadata.optInt("seriesTotalEpisodes", 0)
        val notificationTitle: String
        val notificationText: String
        val notificationId: Int

        if (seriesTitle.isNotBlank() && expectedEpisodes > 0) {
            val downloads = DownloadRepository.listDownloads(this)
            val sameSeries = (0 until downloads.length()).mapNotNull { index ->
                downloads.optJSONObject(index)?.takeIf {
                    if (seriesKey.isNotBlank()) it.optString("seriesKey") == seriesKey
                    else it.optString("seriesTitle").equals(seriesTitle, ignoreCase = true)
                }
            }
            val queueStillPreparing = DownloadRepository.pendingQueueCount(this) > 0
            val allEpisodesPresent = sameSeries.size >= expectedEpisodes
            val completedEpisodes = sameSeries.count {
                it.optInt("state", -1) == Download.STATE_COMPLETED
            }
            val allEpisodesCompleted = allEpisodesPresent && completedEpisodes >= expectedEpisodes
            if (queueStillPreparing || !allEpisodesCompleted) return
            notificationTitle = "Série disponível offline"
            notificationText = "$seriesTitle está disponível offline. Todos os episódios selecionados foram baixados."
            notificationId = NOTIFICATION_ID + 900 + (seriesTitle.hashCode().toLong() and 0x3FFL).toInt()
        } else {
            val title = metadata.optString("episodeTitle").ifBlank {
                metadata.optString("title").ifBlank { "Seu conteúdo" }
            }
            notificationTitle = if (seriesTitle.isNotBlank()) "Episódio baixado" else "Download concluído"
            notificationText = "$title está disponível offline."
            notificationId = NOTIFICATION_ID + 100 + (download.request.id.hashCode().toLong() and 0x3FFL).toInt()
        }

        getSystemService(NotificationManager::class.java).notify(
            notificationId,
            NotificationCompat.Builder(this, EVENT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(notificationTitle)
                .setContentText(notificationText)
                .setContentIntent(openAppPendingIntent(download.request.id.hashCode()))
                .setAutoCancel(true).build()
        )
    }

    private fun postFailureNotification(download: Download, error: Exception?) {
        val title = DownloadRepository.metadata(download).optString("title").ifBlank { "Seu conteúdo" }
        getSystemService(NotificationManager::class.java).notify(
            NOTIFICATION_ID + 1200 + (download.request.id.hashCode().toLong() and 0x3FFL).toInt(),
            NotificationCompat.Builder(this, EVENT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Falha no download")
                .setContentText("$title · ${error?.message ?: "Tente novamente."}")
                .setContentIntent(openAppPendingIntent(download.request.id.hashCode()))
                .setAutoCancel(true).build()
        )
    }

    private fun postInfoText(message: String) {
        getSystemService(NotificationManager::class.java).notify(
            NOTIFICATION_ID + 3,
            NotificationCompat.Builder(this, EVENT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("TEDFLIX")
                .setContentText(message)
                .setContentIntent(openAppPendingIntent(NOTIFICATION_ID + 3))
                .setAutoCancel(true).build()
        )
    }

    private fun postFailureText(message: String) {
        getSystemService(NotificationManager::class.java).notify(
            NOTIFICATION_ID + 2,
            NotificationCompat.Builder(this, EVENT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_error)
                .setContentTitle("Falha no download")
                .setContentText(message)
                .setContentIntent(openAppPendingIntent(NOTIFICATION_ID + 2))
                .setAutoCancel(true).build()
        )
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Downloads TEDFLIX", NotificationManager.IMPORTANCE_LOW)
            )
            manager.createNotificationChannel(
                NotificationChannel(EVENT_CHANNEL_ID, "Avisos de downloads", NotificationManager.IMPORTANCE_DEFAULT)
            )
        }
    }

    override fun onDestroy() {
        updateTask?.let(handler::removeCallbacks)
        if (listenerRegistered && ::manager.isInitialized) manager.removeListener(downloadListener)
        super.onDestroy()
    }
}
