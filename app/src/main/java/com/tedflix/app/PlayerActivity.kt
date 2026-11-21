package com.tedflix.app

import android.app.Activity
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.content.Context
import android.app.PictureInPictureParams
import androidx.activity.OnBackPressedCallback
import android.app.PendingIntent
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.core.app.NotificationCompat
import androidx.media3.session.MediaSession
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.media.AudioManager
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import com.tedflix.app.ui.TedflixDialogs
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.dash.DashMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import com.tedflix.app.auth.AuthSession
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

@androidx.media3.common.util.UnstableApi
open class PlayerActivity : Activity() {
    companion object {
        const val EXTRA_CATEGORIA = "categoria"
        const val EXTRA_SLUG = "slug"
        const val EXTRA_TITULO = "titulo"
        const val EXTRA_NEXT_EPISODES = "next_episodes"
        const val EXTRA_FILME_ID = "filme_id"
        const val EXTRA_THUMB = "thumb"
        const val EXTRA_TIPO = "tipo"
        const val EXTRA_SERIE_CATEGORIA = "serie_categoria"
        const val EXTRA_SERIE_SLUG = "serie_slug"
        const val EXTRA_SERIES_EPISODES = "series_episodes"
        const val EXTRA_RECOMMENDATIONS = "recommendations"
        const val EXTRA_DOWNLOAD_ONLY = "download_only"
        const val EXTRA_DOWNLOAD_METADATA = "download_metadata"
        const val EXTRA_DOWNLOAD_QUEUE = "download_queue"
        const val EXTRA_OFFLINE_DOWNLOAD_ID = "offline_download_id"
        const val PREFS = "tedflix_preferences"
        const val BUFFER_KEY = "buffer"
        const val EXTRA_BUFFER = BUFFER_KEY
        private const val STREAM_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36"
        private const val TAG = "TedflixPlayer"
    }

    private lateinit var playerView: PlayerView
    private lateinit var overlay: FrameLayout
    private lateinit var topBar: View
    private lateinit var nextButton: Button
    private lateinit var episodesButton: Button
    private lateinit var pipButton: Button
    private lateinit var progress: SeekBar
    private lateinit var currentTime: TextView
    private lateinit var durationTime: TextView
    private lateinit var playButton: Button
    private lateinit var titleView: TextView
    private lateinit var loading: ProgressBar
    private lateinit var loadingPanel: LinearLayout
    private var player: ExoPlayer? = null
    private var tedtopFallbackTried = false
    private var tedtopRefreshTried = false
    private var currentCategoria = ""
    private var currentSlug = ""
    private var currentTitle = ""
    private var currentFilmeId = ""
    private var currentThumb = ""
    private var currentTipo = ""
    private var currentSerieCategoria = ""
    private var currentSerieSlug = ""
    private val nextEpisodes = mutableListOf<NextEpisode>()
    private var mediaSession: MediaSession? = null
    private var mediaSessionCompat: MediaSessionCompat? = null
    private val notifChannelId = "tedflix_playback"
    private val notifId = 4401
    private var lastNotifUpdateMs = 0L
    private var lastLocalSaveMs = 0L
    private val allSeriesEpisodes = mutableListOf<NextEpisode>()
    private val recommendations = mutableListOf<NextEpisode>()
    private var remoteHistory = emptyList<AuthSession.HistoryItem>()
    private var autoPlayTriggered = false
    private lateinit var nextCountdownPanel: LinearLayout
    private lateinit var nextCountdownTitle: TextView
    private lateinit var nextCountdownSeconds: TextView
    private var lastCountdownSec = -1
    private lateinit var gestureDetector: GestureDetector
    private var gestureStartY = 0f
    private var gestureStartX = 0f
    private var gestureMode = 0 // 0 none, 1 volume, 2 brightness
    private var gestureStartVolume = 0
    private var gestureStartBrightness = -1f
    private lateinit var gestureHint: TextView
    private val hideGestureHintRunnable = Runnable {
        if (::gestureHint.isInitialized) gestureHint.visibility = View.GONE
    }
    private var controlsVisible = false
    private var playerReady = false
    private var closingPlayer = false
    private var downloadOnly = false
    private var downloadMetadata = JSONObject()
    private var downloadResolutionHandled = false
    private var offlinePlayback = false
    private var activityDestroyed = false
    @Volatile private var lastStep = "Activity ainda não inicializada"
    @Volatile private var diagnosticUrl = ""
    private var validationThread: Thread? = null
    private var lastDuration = 0L
    private var positionRestored = false
    private val pendingQualityUrls = mutableListOf<String>()
    private var qualityFallbackTried = false
    private var lastStreamHeaders: Map<String, String> = emptyMap()
    @Volatile private var lastRemoteSaveAt = 0L
    @Volatile private var remotePositionMs: Long? = null
    @Volatile private var remotePositionLoaded = false
    private var remotePositionApplied = false
    private val handler = Handler(Looper.getMainLooper())
    private val hideRunnable = Runnable { setControlsVisible(false) }
    private class WifiErrorIconView(context: android.content.Context) : View(context) {
        private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 3.2f * resources.displayMetrics.density
            strokeCap = Paint.Cap.ROUND
            color = Color.rgb(145, 145, 152)
        }
        private val redStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 3.6f * resources.displayMetrics.density
            strokeCap = Paint.Cap.ROUND
            color = Color.rgb(245, 32, 52)
        }
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val d = resources.displayMetrics.density
            val cx = width * 0.48f
            val cy = height * 0.48f
            canvas.drawArc(RectF(cx - 32 * d, cy - 24 * d, cx + 32 * d, cy + 28 * d), 218f, 104f, false, stroke)
            canvas.drawArc(RectF(cx - 22 * d, cy - 13 * d, cx + 22 * d, cy + 23 * d), 218f, 104f, false, stroke)
            canvas.drawArc(RectF(cx - 11 * d, cy - 2 * d, cx + 11 * d, cy + 17 * d), 218f, 104f, false, stroke)
            canvas.drawCircle(cx, cy + 20 * d, 2.6f * d, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = stroke.color; style = Paint.Style.FILL })
            canvas.drawLine(cx + 16 * d, cy + 8 * d, cx + 34 * d, cy + 26 * d, redStroke)
            canvas.drawLine(cx + 34 * d, cy + 8 * d, cx + 16 * d, cy + 26 * d, redStroke)
        }
    }

    private data class NextEpisode(
        val categoria: String,
        val slug: String,
        val titulo: String,
        val filmeId: String = "",
        val thumb: String = "",
        val tipo: String = "episodio",
        val serieCategoria: String = "",
        val serieSlug: String = "",
        val duracao: String = "",
        val temporada: Int = 0,
        val episodio: Int = 0,
    )

    private val progressRunnable = object : Runnable {
        override fun run() {
            updateProgress()
            handler.postDelayed(this, 500L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        markStep("PlayerActivity criada")
        loadEpisodeContext()
        try {
            // A orientação landscape já é declarada no Manifesto. Repetir a troca aqui
            // durante o primeiro onCreate pode provocar uma recriação enquanto a UI nasce.
            if (!downloadOnly) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            markStep("iniciando criação da interface")
            buildUi()
            // A DecorView só é garantidamente criada depois de setContentView.
            // O modo imersivo e o player são iniciados no próximo ciclo do layout.
            window.decorView.post {
                if (!activityDestroyed && !isFinishing && !isDestroyedCompat()) {
                    if (!downloadOnly) enterImmersiveMode()
                    if (!activityDestroyed && !isFinishing && !isDestroyedCompat()) {
                        initializePlayer()
                    }
                }
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Falha ao criar a interface do player", error)
            showStartupError(error)
        }
    }

    private fun enterImmersiveMode() {
        if (!isActivityAlive()) return
        try {
            window.setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN)
            val decorView = window.decorView
            @Suppress("DEPRECATION")
            val legacyFlags = (
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                val controller = decorView.windowInsetsController
                if (controller != null) {
                    controller.systemBarsBehavior =
                        android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    controller.hide(WindowInsets.Type.systemBars())
                } else {
                    @Suppress("DEPRECATION")
                    decorView.systemUiVisibility = legacyFlags
                    Log.w(TAG, "WindowInsetsController ainda nulo; usando flags legadas")
                }
            } else {
                @Suppress("DEPRECATION")
                decorView.systemUiVisibility = legacyFlags
            }
            markStep("modo imersivo aplicado")
        } catch (error: Throwable) {
            // O modo imersivo é visual e não pode impedir a criação do player.
            Log.w(TAG, "Não foi possível aplicar modo imersivo; continuando com a UI", error)
            try {
                @Suppress("DEPRECATION")
                window.decorView.systemUiVisibility = (
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    )
            } catch (fallbackError: Throwable) {
                Log.w(TAG, "Fallback do modo imersivo também falhou", fallbackError)
            }
        }
    }


    /** Detecta reprodução de episódio usando os metadados atuais. */
    private fun isEpisodePlayback(): Boolean {
        if (currentTipo.contains("epis", ignoreCase = true)) return true
        if (allSeriesEpisodes.isNotEmpty() || nextEpisodes.isNotEmpty()) return true
        if (currentSlug.contains("--s", ignoreCase = true) ||
            Regex("""s\d+e\d+""", RegexOption.IGNORE_CASE).containsMatchIn(currentSlug)
        ) return true
        return currentSerieSlug.isNotBlank() || currentSerieCategoria.isNotBlank()
    }

    private fun loadEpisodeContext() {
        downloadOnly = intent.getBooleanExtra(EXTRA_DOWNLOAD_ONLY, false)
        downloadMetadata = try { JSONObject(intent.getStringExtra(EXTRA_DOWNLOAD_METADATA).orEmpty()) } catch (_: Throwable) { JSONObject() }
        offlinePlayback = intent.getStringExtra(EXTRA_OFFLINE_DOWNLOAD_ID).orEmpty().isNotBlank()
        currentCategoria = intent.getStringExtra(EXTRA_CATEGORIA).orEmpty().trim()
        currentSlug = intent.getStringExtra(EXTRA_SLUG).orEmpty().trim()
        currentTitle = intent.getStringExtra(EXTRA_TITULO).orEmpty().trim().ifBlank { "Tedflix" }
        currentFilmeId = intent.getStringExtra(EXTRA_FILME_ID).orEmpty().trim().ifBlank { currentSlug }
        currentThumb = intent.getStringExtra(EXTRA_THUMB).orEmpty().trim()
        currentTipo = intent.getStringExtra(EXTRA_TIPO).orEmpty().trim()
        currentSerieCategoria = intent.getStringExtra(EXTRA_SERIE_CATEGORIA).orEmpty().trim()
        currentSerieSlug = intent.getStringExtra(EXTRA_SERIE_SLUG).orEmpty().trim()
        if (!offlinePlayback && !downloadOnly) loadRemoteProgress()
        nextEpisodes.clear()
        allSeriesEpisodes.clear()
        recommendations.clear()
        readPlaybackItems(intent.getStringExtra(EXTRA_NEXT_EPISODES), nextEpisodes, "episodio")
        readPlaybackItems(intent.getStringExtra(EXTRA_SERIES_EPISODES), allSeriesEpisodes, "episodio")
        readPlaybackItems(intent.getStringExtra(EXTRA_RECOMMENDATIONS), recommendations, "filme")
    }

    private fun readPlaybackItems(rawJson: String?, target: MutableList<NextEpisode>, defaultType: String) {
        val raw = rawJson.orEmpty().trim()
        if (raw.isBlank() || raw == "[]") return
        try {
            val array = JSONArray(raw)
            for (index in 0 until array.length()) {
                val item = array.optJSONObject(index) ?: continue
                val categoria = item.optString("categoria").trim()
                val slug = item.optString("slug").trim()
                val titulo = item.optString("titulo").trim().ifBlank {
                    if (defaultType.contains("epis", ignoreCase = true)) "Próximo episódio" else "Recomendado"
                }
                val filmeId = item.optString("filmeId").trim().ifBlank { slug }
                val thumb = item.optString("thumb").trim()
                val tipo = item.optString("tipo").trim().ifBlank { defaultType }
                // A fila criada pela página da série pode não repetir o contexto em
                // cada item; nesse caso, herdamos o contexto do episódio atual.
                val serieCategoria = item.optString("serieCategoria").trim()
                    .ifBlank { currentSerieCategoria }
                val serieSlug = item.optString("serieSlug").trim()
                    .ifBlank { currentSerieSlug }
                val duracao = item.optString("duracao").trim()
                var temporada = item.optInt("temporada", 0)
                var episodio = item.optInt("episodio", 0)
                if (temporada <= 0 || episodio <= 0) {
                    val parsed = ContinueWatchingStore.parseEpisodeMeta(titulo, slug)
                    if (temporada <= 0) temporada = parsed.first
                    if (episodio <= 0) episodio = parsed.second
                }
                // Número do episódio no título "4. Nome"
                if (episodio <= 0) {
                    val m = Regex("""^(\d{1,3})\.\s""").find(titulo)
                    episodio = m?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0
                }
                if (categoria.isNotBlank() && slug.isNotBlank()) {
                    target += NextEpisode(
                        categoria,
                        slug,
                        titulo,
                        filmeId,
                        thumb,
                        tipo,
                        serieCategoria,
                        serieSlug,
                        duracao,
                        temporada,
                        episodio,
                    )
                }
            }
        } catch (error: Throwable) {
            Log.w(TAG, "Lista de reprodução inválida; continuando sem avanço automático", error)
        }
    }

    private fun updateNextEpisodeButton() {
        if (::nextButton.isInitialized) {
            nextButton.visibility = if (nextEpisodes.isNotEmpty() && playerReady) View.VISIBLE else View.GONE
        }
        if (::episodesButton.isInitialized) {
            episodesButton.visibility =
                if (allSeriesEpisodes.size > 1 && playerReady) View.VISIBLE else View.GONE
        }
        if (::pipButton.isInitialized) {
            pipButton.visibility = if (playerReady && supportsPip()) View.VISIBLE else View.GONE
        }
    }

    private fun playNextEpisode() {
        if (!isActivityAlive() || nextEpisodes.isEmpty()) return
        hideNextCountdown()
        val next = nextEpisodes.removeAt(0)
        startPlaybackItem(next)
    }

    private fun startPlaybackItem(next: NextEpisode) {
        if (!isActivityAlive()) return
        currentCategoria = next.categoria
        currentSlug = next.slug
        currentTitle = next.titulo
        currentFilmeId = next.filmeId.ifBlank { currentSlug }
        currentThumb = next.thumb
        currentTipo = next.tipo.ifBlank { "episodio" }
        currentSerieCategoria = next.serieCategoria.ifBlank { currentSerieCategoria }
        currentSerieSlug = next.serieSlug.ifBlank { currentSerieSlug }
        remotePositionMs = null
        remotePositionLoaded = false
        remotePositionApplied = false
        lastRemoteSaveAt = 0L
        autoPlayTriggered = false
        hideNextCountdown()
        loadRemoteProgress()
        titleView.text = currentTitle
        playerReady = false
        updateNextEpisodeButton()
        setLoadingVisible(true)
        setControlsVisible(false)
        handler.removeCallbacks(progressRunnable)
        playerView.player = null
        player?.release()
        player = null
        initializePlayer()
    }

    private fun playRecommendation() {
        if (!isActivityAlive() || recommendations.isEmpty()) return
        val next = recommendations.removeAt(0)
        nextEpisodes.clear()
        allSeriesEpisodes.clear()
        startPlaybackItem(next)
    }

    private fun showEpisodes() {
        if (allSeriesEpisodes.isEmpty()) return
        if (AuthSession.hasToken() && !remotePositionLoaded) {
            Thread {
                val result = AuthSession.continueWatching()
                remoteHistory = result.value.orEmpty()
                remotePositionLoaded = true
                runOnUiThread { if (isActivityAlive()) showEpisodes() }
            }.apply { name = "TedflixEpisodeProgress"; start() }
            return
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(4), 0, dp(4), 0)
        }
        lateinit var dialog: android.app.AlertDialog
        allSeriesEpisodes.forEachIndexed { index, episode ->
            val card = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(18), dp(12), dp(18), dp(12))
            }
            val isCurrent = episode.categoria == currentCategoria && episode.slug == currentSlug
            val label = if (isCurrent) "▶ ${episode.titulo}" else episode.titulo
            card.addView(TextView(this).apply {
                text = label
                textSize = 16f
                setTextColor(Color.WHITE)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            episode.duracao.takeIf { it.isNotBlank() }?.let { duration ->
                card.addView(TextView(this).apply {
                    text = duration
                    textSize = 12f
                    setTextColor(Color.LTGRAY)
                }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(3) })
            }
            val percent = episodeProgressPercent(episode)
            card.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 100
                progress = percent
                progressTintList = android.content.res.ColorStateList.valueOf(Color.rgb(229, 9, 20))
                progressBackgroundTintList = android.content.res.ColorStateList.valueOf(Color.rgb(75, 75, 80))
            }, LinearLayout.LayoutParams(-1, dp(4)).apply { topMargin = dp(8) })
            card.setOnClickListener {
                if (isCurrent) {
                    dialog.dismiss()
                } else {
                    nextEpisodes.clear()
                    nextEpisodes.addAll(allSeriesEpisodes.drop(index + 1))
                    dialog.dismiss()
                    startPlaybackItem(episode)
                }
            }
            container.addView(card, LinearLayout.LayoutParams(-1, -2))
        }
        val scroll = ScrollView(this).apply { addView(container) }
        dialog = android.app.AlertDialog.Builder(this, R.style.TedflixDialog)
            .setTitle("Episódios")
            .setView(scroll)
            .setNegativeButton("Fechar", null)
            .create()
        dialog.show()
    }

    private fun episodeProgressPercent(episode: NextEpisode): Int {
        val local = ContinueWatchingStore.read(this).firstOrNull {
            it.categoria == episode.categoria && it.slug == episode.slug
        }
        if (local != null) return local.percent
        val remote = remoteHistory.firstOrNull {
            it.categoria == episode.categoria && it.slug == episode.slug
        } ?: remoteHistory.firstOrNull {
            !episode.tipo.contains("epis", ignoreCase = true) &&
                episode.filmeId.isNotBlank() && it.filmeId == episode.filmeId
        } ?: return 0
        val position = PlaybackRules.remoteTimeToMillis(remote.tempo) ?: return 0
        val duration = PlaybackRules.catalogDurationToMillis(episode.duracao)
        return PlaybackRules.percentage(position, duration)
    }

    private fun buildUi() {
        if (downloadOnly) {
            // Resolver invisível: mantém a Activity anterior visível e reutiliza
            // toda a resolução de fontes do player, sem abrir uma tela preta.
            val root = FrameLayout(this).apply { setBackgroundColor(Color.TRANSPARENT) }
            playerView = PlayerView(this).apply {
                visibility = View.INVISIBLE
                alpha = 0f
                useController = false
                setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
                setBackgroundColor(Color.TRANSPARENT)
            }
            root.addView(playerView, FrameLayout.LayoutParams(1, 1, Gravity.TOP or Gravity.START))
            setContentView(root)
            window.setBackgroundDrawableResource(android.R.color.transparent)
            window.setDimAmount(0f)
            // A janela transparente não bloqueia toques: o usuário continua navegando
            // na WebView enquanto o resolvedor busca a fonte do conteúdo.
            window.addFlags(
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
            )
            return
        }
        markStep("criando raiz da interface")
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        markStep("criando PlayerView")
        playerView = PlayerView(this).apply {
            useController = false
            // Preenche a área total do player; o vídeo pode cortar somente a sobra
            // mínima de proporção, como no player original do app.
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            // O spinner interno ALWAYS continuava aparecendo mesmo com o vídeo pronto.
            // O loader customizado abaixo será controlado exclusivamente por STATE_READY.
            setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER)
            setBackgroundColor(Color.BLACK)
            setOnClickListener { toggleControls() }
        }
        root.addView(playerView, FrameLayout.LayoutParams(-1, -1))
        markStep("PlayerView criada")

        overlay = FrameLayout(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
            // O toque em área livre alterna: fecha os controles quando abertos
            // e permite reabri-los quando já estão ocultos.
            setOnClickListener { if (playerReady) toggleControls() }
        }
        root.addView(overlay, FrameLayout.LayoutParams(-1, -1))
        markStep("overlay criado")
        buildTopBar()
        markStep("barra superior criada")
        buildCenterControls()
        markStep("controles centrais criados")
        buildBottomControls()
        markStep("controles inferiores criados")

        loadingPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            isClickable = false
            elevation = 0f
            setBackgroundColor(Color.TRANSPARENT)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        loading = ProgressBar(this).apply {
            visibility = View.VISIBLE
            indeterminateTintList = android.content.res.ColorStateList.valueOf(Color.rgb(229, 28, 42))
        }
        loadingPanel.addView(loading, LinearLayout.LayoutParams(dp(42), dp(42)))
        loadingPanel.addView(TextView(this).apply {
            text = if (downloadOnly) "Preparando download..." else "Carregando vídeo..."
            textSize = 16f
            setTextColor(Color.WHITE)
            setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(10) })
        overlay.addView(loadingPanel, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        markStep("loading criado")
        setContentView(root)
        markStep("setContentView concluído")
        // Enquanto o manifesto e o primeiro frame não estão prontos, somente o
        // loader fica visível. Os controles entram após STATE_READY.
        setControlsVisible(false)
        setupPlayerGestures()
        markStep("interface pronta")
    }

    private fun buildTopBar() {
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(22), dp(14), dp(22), dp(14))
            // Overlay transparente: título e ações ficam diretamente sobre o vídeo,
            // sem a faixa escura atrás do cabeçalho.
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
            setOnClickListener { if (playerReady) setControlsVisible(false) }
        }
        val back = controlButton("‹", 34).apply {
            contentDescription = "Voltar"
            setOnClickListener { finish() }
        }
        bar.addView(back, LinearLayout.LayoutParams(dp(54), dp(54)))
        titleView = TextView(this).apply {
            text = intent.getStringExtra(EXTRA_TITULO).orEmpty().ifBlank { "Tedflix" }
            setTextColor(Color.WHITE)
            textSize = 20f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(16), 0, dp(16), 0)
        }
        bar.addView(titleView, LinearLayout.LayoutParams(0, -2, 1f))
        nextButton = controlButton("Próximo ›", 13).apply {
            contentDescription = "Próximo episódio"
            visibility = View.GONE
            setOnClickListener { playNextEpisode() }
        }
        bar.addView(nextButton, LinearLayout.LayoutParams(dp(112), dp(54)))
        episodesButton = controlButton("Episódios", 13).apply {
            contentDescription = "Ver todos os episódios"
            visibility = View.GONE
            setOnClickListener { showEpisodes() }
        }
        bar.addView(episodesButton, LinearLayout.LayoutParams(dp(112), dp(54)))

        pipButton = controlButton("PiP", 13).apply {
            contentDescription = "Mini player (Picture-in-Picture)"
            setOnClickListener { enterPipMode() }
            visibility = View.GONE
        }
        bar.addView(pipButton, LinearLayout.LayoutParams(dp(72), dp(54)))
        updateNextEpisodeButton()
        val reload = controlButton("↻", 28).apply {
            contentDescription = "Recarregar"
            setOnClickListener { reloadStream() }
        }
        bar.addView(reload, LinearLayout.LayoutParams(dp(54), dp(54)))
        topBar = bar
        val params = FrameLayout.LayoutParams(-1, dp(82), Gravity.TOP)
        overlay.addView(bar, params)
    }

    private fun buildCenterControls() {
        val center = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(18), 0, dp(18), 0)
            isClickable = true
            setOnClickListener { if (playerReady) toggleControls() }
        }
        val back10 = roundButton("↺\n10", 16).apply {
            contentDescription = "Retroceder 10 segundos"
            setOnClickListener { seekBy(-10_000L) }
        }
        val space = LinearLayout.LayoutParams(dp(92), dp(92)).apply {
            setMargins(dp(18), 0, dp(18), 0)
        }
        center.addView(back10, LinearLayout.LayoutParams(dp(80), dp(80)))
        playButton = roundButton("▶", 31).apply {
            contentDescription = "Reproduzir ou pausar"
            setOnClickListener { togglePlay() }
        }
        center.addView(playButton, space)
        val forward10 = roundButton("10\n↻", 16).apply {
            contentDescription = "Avançar 10 segundos"
            setOnClickListener { seekBy(10_000L) }
        }
        center.addView(forward10, LinearLayout.LayoutParams(dp(80), dp(80)))
        val params = FrameLayout.LayoutParams(-1, dp(150), Gravity.CENTER)
        overlay.addView(center, params)
    }

    private fun buildBottomControls() {
        val bottom = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(8), dp(22), dp(20))
            // Controles inferiores sem painel/badge escuro, no estilo Netflix.
            setBackgroundColor(Color.TRANSPARENT)
            isClickable = true
            setOnClickListener { if (playerReady) toggleControls() }
        }
        val seekRow = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        currentTime = timeText("0:00")
        durationTime = timeText("0:00")
        seekRow.addView(currentTime, LinearLayout.LayoutParams(dp(68), -2).apply { gravity = Gravity.CENTER_VERTICAL })
        progress = SeekBar(this).apply {
            max = 1000
            progress = 0
            // Padding vertical evita a bolinha ficar escondida sob os tempos
            setPadding(dp(4), dp(10), dp(4), dp(10))
            minimumHeight = dp(36)
            splitTrack = false
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar?, value: Int, fromUser: Boolean) {
                    if (fromUser && lastDuration > 0) currentTime.text = formatTime(lastDuration * value / 1000L)
                }
                override fun onStartTrackingTouch(seekBar: SeekBar?) { handler.removeCallbacks(hideRunnable) }
                override fun onStopTrackingTouch(seekBar: SeekBar?) {
                    player?.seekTo(lastDuration * (seekBar?.progress ?: 0) / 1000L)
                    // Atualiza o store local imediatamente após o seek; a API continua
                    // sendo sincronizada em segundo plano pelo mesmo fluxo.
                    handler.post { savePlaybackProgress() }
                    scheduleHide()
                }
            })
        }
        seekRow.addView(progress, LinearLayout.LayoutParams(0, dp(34), 1f))
        seekRow.addView(durationTime, LinearLayout.LayoutParams(dp(72), -2))
        bottom.addView(seekRow, LinearLayout.LayoutParams(-1, dp(42)))

        val menuRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        addMenuButton(menuRow, "🔊  Áudio") { showAudioMenu() }
        addMenuButton(menuRow, "▣  Legendas") { showSubtitleMenu() }
        addMenuButton(menuRow, "⚙  Qualidade") { showQualityMenu() }
        addMenuButton(menuRow, "◷  Velocidade") { showSpeedMenu() }
        bottom.addView(menuRow, LinearLayout.LayoutParams(-1, dp(52)))
        overlay.addView(bottom, FrameLayout.LayoutParams(-1, dp(126), Gravity.BOTTOM))

        // Countdown próximo episódio (canto inferior direito)
        nextCountdownPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.argb(220, 18, 18, 22))
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), Color.argb(80, 255, 255, 255))
            }
            elevation = dp(8).toFloat()
        }
        nextCountdownTitle = TextView(this).apply {
            text = "Próximo episódio"
            textSize = 12f
            setTextColor(Color.argb(200, 255, 255, 255))
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        nextCountdownSeconds = TextView(this).apply {
            text = "10s"
            textSize = 28f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(0, dp(2), 0, dp(4))
        }
        val cancelBtn = TextView(this).apply {
            text = "Cancelar"
            textSize = 12f
            setTextColor(Color.argb(220, 255, 120, 120))
            setPadding(0, dp(4), 0, 0)
            setOnClickListener { cancelNextCountdown() }
        }
        val head = TextView(this).apply {
            text = "PRÓXIMO EM"
            textSize = 10f
            setTextColor(Color.argb(160, 255, 255, 255))
            letterSpacing = 0.08f
        }
        nextCountdownPanel.addView(head)
        nextCountdownPanel.addView(nextCountdownSeconds)
        nextCountdownPanel.addView(nextCountdownTitle)
        nextCountdownPanel.addView(cancelBtn)
        val cdParams = FrameLayout.LayoutParams(dp(168), -2, Gravity.BOTTOM or Gravity.END)
        cdParams.setMargins(dp(16), 0, dp(16), dp(140))
        overlay.addView(nextCountdownPanel, cdParams)
    }

    private fun addMenuButton(row: LinearLayout, label: String, action: () -> Unit) {
        val button = Button(this).apply {
            text = label
            textSize = 14f
            setTextColor(Color.WHITE)
            setAllCaps(false)
            setPadding(dp(10), 0, dp(10), 0)
            // Ação leve sobre o vídeo, sem cápsula escura atrás do texto.
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { action() }
        }
        row.addView(button, LinearLayout.LayoutParams(0, dp(46), 1f).apply {
            setMargins(dp(4), 0, dp(4), 0)
        })
    }

    private fun initializePlayer() {
        try {
            markStep("Intent recebido")
            val categoria = currentCategoria
            val slug = currentSlug
            val titulo = currentTitle
            val offlineId = intent.getStringExtra(EXTRA_OFFLINE_DOWNLOAD_ID).orEmpty()
            if (offlineId.isNotBlank()) {
                playOfflineDownload(offlineId)
                return
            }
            if (!AuthSession.hasToken()) {
                showDiagnosticScreen(
                    "Sessão ausente",
                    IllegalStateException("Faça login para reproduzir este conteúdo."),
                )
                return
            }
            if (categoria.isBlank() || slug.isBlank()) {
                showDiagnosticScreen(
                    "Intent/extras inválidos",
                    IllegalArgumentException("categoria ou slug vazio"),
                    "categoria='$categoria'\nslug='$slug'\ntitulo='$titulo'"
                )
                return
            }

            // TEDTOP (destaque): espera a URL MP4 assinada de /ingresso/:slug antes de tocar
            if (isTedtopOrigin()) {
                markStep("origem TEDTOP — aguardando ingresso MP4")
                // O modo download não precisa criar ExoPlayer: apenas resolve a fonte.
                if (!downloadOnly) ensurePlayerShell()
                fetchTedtopAndPlay("origem-tedtop") {
                    // A ficha TEDTOP é resolvida exclusivamente por /ingresso/:slug.
                    // Não reutilizar endpoints de outro catálogo se essa fonte falhar.
                    if (downloadOnly) {
                        finishDownloadResolutionFailure(
                            "Fonte TEDTOP não encontrada. O download foi cancelado."
                        )
                    } else {
                        showDiagnosticScreen(
                            "Fonte TEDTOP indisponível",
                            IllegalStateException("A API não retornou um direct_url MP4 válido para este slug."),
                        )
                    }
                }
                return
            }

            val streamUrl = resolveStreamUrl(categoria, slug)
            diagnosticUrl = streamUrl
            markStep("streamUrl montada ($categoria)")
            val buffer = getSharedPreferences(PREFS, MODE_PRIVATE).getString(BUFFER_KEY, "equilibrado")
            val requestProperties = streamRequestProperties()
            // Todo conteúdo V1–V5 usa exclusivamente o contrato unificado do Content Server v2.
            if (isUnifiedContentCategory(categoria)) {
                validationThread?.interrupt()
                validationThread = Thread {
                    try {
                        markStep("Content Server v2: resolvendo stream")
                        val client = contentStreamOkHttp()
                        val req = Request.Builder()
                            .url(streamUrl)
                            .header("Accept", "application/json")
                            .header("User-Agent", STREAM_USER_AGENT)
                            .get()
                            .build()
                        var respCode = 0
                        var body = ""
                        // Retry em 502/503 (Render cold start)
                        run {
                            var attempt = 0
                            var lastCode = 0
                            var lastBody = ""
                            while (attempt < 5) {
                                attempt++
                                markStep("Content Server: tentativa $attempt")
                                client.newCall(req).execute().use { resp ->
                                    lastCode = resp.code
                                    lastBody = resp.body?.string().orEmpty()
                                    if (resp.isSuccessful) {
                                        respCode = resp.code
                                        body = lastBody
                                        return@run
                                    }
                                    if (resp.code == 502 || resp.code == 503 || resp.code == 504) {
                                        try { Thread.sleep((1500L * attempt).coerceAtMost(6000L)) } catch (_: InterruptedException) { return@run }
                                    }
                                    if (resp.code != 502 && resp.code != 503 && resp.code != 504) {
                                        respCode = resp.code
                                        body = lastBody
                                        return@run
                                    }
                                }
                                try { Thread.sleep(1500L * attempt) } catch (_: InterruptedException) { }
                            }
                            respCode = lastCode
                            body = lastBody
                        }
                        run {
                            // Mesmo em 4xx/5xx o body pode trazer { ok:false, erro, code }
                            val json = try {
                                if (body.isNotBlank() && body.trimStart().startsWith("{"))
                                    org.json.JSONObject(body)
                                else null
                            } catch (_: Exception) { null }
                            if (respCode !in 200..299) {
                                val nestedError = json?.optJSONObject("error")
                                val msg = nestedError?.optString("message")?.takeIf { it.isNotBlank() }
                                    ?: json?.optString("erro")?.takeIf { it.isNotBlank() }
                                    ?: json?.optString("message")?.takeIf { it.isNotBlank() }
                                    ?: "Falha ao consultar o servidor de conteúdo (HTTP $respCode)"
                                val code = nestedError?.optString("code")?.takeIf { it.isNotBlank() }
                                    ?: json?.optString("code").orEmpty()
                                throw StreamValidationException(
                                    if (code.isNotBlank()) "$msg ($code)" else msg,
                                    body.take(500),
                                )
                            }
                            if (json != null && (json.optBoolean("ok", true).not() || json.optBoolean("success", true).not())) {
                                val nestedError = json.optJSONObject("error")
                                val message = nestedError?.optString("message")?.takeIf { it.isNotBlank() }
                                    ?: json.optString("erro").ifBlank { json.optString("message", "Stream indisponível") }
                                val code = nestedError?.optString("code")?.takeIf { it.isNotBlank() }
                                    ?: json.optString("code")
                                throw StreamValidationException(if (code.isNotBlank()) "$message ($code)" else message, body.take(500))
                            }
                            val safeJson = json ?: org.json.JSONObject(body)
                            val playback = safeJson.optJSONObject("playback")
                            // Escolha de qualidade: H.264 se device limitado; senão melhor disponível
                            var hls = ""
                            val preferAvc = devicePrefersAvc()
                            val qualities = safeJson.optJSONArray("qualities")
                            val ranked = mutableListOf<Pair<Int, String>>() // score, url
                            if (qualities != null && qualities.length() > 0) {
                                for (i in 0 until qualities.length()) {
                                    val q = qualities.optJSONObject(i) ?: continue
                                    val url = q.optString("stream").ifBlank { q.optString("url") }
                                    if (url.isBlank()) continue
                                    val codec = (q.optString("codec").ifBlank { q.optString("codecName") }).lowercase()
                                    val qLabel = q.optString("quality")
                                    val qNum = qLabel.filter { it.isDigit() }.toIntOrNull()
                                        ?: q.optInt("quality", 0).takeIf { it > 0 }
                                        ?: 0
                                    val isHevc = codec.contains("hevc") || codec.contains("h265") ||
                                        url.contains("/h265/") || url.contains("hevc")
                                    val isAvc = codec.contains("h264") || codec.contains("avc") ||
                                        url.contains("/h264/") || url.contains("/avc/")
                                    var score = qNum
                                    if (preferAvc) {
                                        if (isAvc) score += 10_000
                                        if (isHevc) score -= 5_000
                                    } else {
                                        // aparelho ok com HEVC: prefere maior qualidade
                                        if (isHevc && qNum >= 1080) score += 500
                                    }
                                    ranked.add(score to url)
                                }
                                ranked.sortByDescending { it.first }
                                hls = ranked.firstOrNull()?.second.orEmpty()
                            }
                            if (hls.isBlank()) {
                                hls = when {
                                    playback != null && playback.optString("url").isNotBlank() ->
                                        playback.optString("url")
                                    safeJson.optString("stream").isNotBlank() -> safeJson.optString("stream")
                                    safeJson.optString("stream_url").isNotBlank() -> safeJson.optString("stream_url")
                                    else -> ""
                                }
                            }
                            if (hls.isBlank()) {
                                throw StreamValidationException(
                                    "Sem URL de stream neste título",
                                    body.take(400),
                                )
                            }
                            markStep("JSON stream ok ($categoria)")
                            // Headers vêm da API. NÃO forçar vidlink.pro (causava 429/403).
                            // apply_headers=false / headers vazios = CDN R2 direto (só UA).
                            val hdrs = linkedMapOf<String, String>()
                            val hobj = safeJson.optJSONObject("playback")?.optJSONObject("headers")
                                ?: safeJson.optJSONObject("headers")
                            if (hobj != null) {
                                val keys = hobj.keys()
                                while (keys.hasNext()) {
                                    val k = keys.next()
                                    if (k.equals("Authorization", ignoreCase = true)) continue
                                    val v = hobj.optString(k)
                                    if (v.isNotBlank()) hdrs[k] = v
                                }
                            }
                            val playbackMeta = safeJson.optJSONObject("playback")
                            val applyHeaders = when {
                                playbackMeta != null && playbackMeta.has("apply_headers") ->
                                    playbackMeta.optBoolean("apply_headers", true)
                                else -> hdrs.isNotEmpty()
                            }
                            if (playbackMeta?.optBoolean("forbid_referer", false) == true) {
                                hdrs.remove("Referer")
                                hdrs.remove("Origin")
                            }
                            val uaApi = playbackMeta?.optString("user_agent").orEmpty()
                            if (hdrs["User-Agent"].isNullOrBlank()) {
                                hdrs["User-Agent"] = if (uaApi.isNotBlank()) uaApi else "ExoPlayer"
                            }
                            if (!applyHeaders) {
                                val ua = hdrs["User-Agent"] ?: "ExoPlayer"
                                hdrs.clear()
                                hdrs["User-Agent"] = ua
                                hdrs["Accept"] = "*/*"
                            } else {
                                hdrs.putIfAbsent("Accept", "*/*")
                            }
                            // Guarda stream_type para escolher HLS vs Progressive
                            val streamTypeApi = playbackMeta?.optString("format")?.ifBlank { null }
                                ?: safeJson.optString("stream_type").ifBlank { safeJson.optString("type") }
                            val normalizedStreamType = streamTypeApi.lowercase()
                            if (normalizedStreamType == "hls" || normalizedStreamType == "m3u8") {
                                lastStreamHeaders = hdrs.toMap() + mapOf("__STREAM_TYPE__" to "hls")
                            } else if (normalizedStreamType == "mp4") {
                                lastStreamHeaders = hdrs.toMap() + mapOf("__STREAM_TYPE__" to "mp4")
                            } else {
                                lastStreamHeaders = hdrs.toMap()
                            }
                            runOnUiThread {
                                if (activityDestroyed) return@runOnUiThread
                                pendingQualityUrls.clear()
                                qualityFallbackTried = false
                                ranked.filter { it.second != hls }.map { it.second }.distinct().forEach {
                                    pendingQualityUrls.add(it)
                                }
                                if (pendingQualityUrls.isEmpty() && qualities != null) {
                                    for (i in 0 until qualities.length()) {
                                        val q = qualities.optJSONObject(i) ?: continue
                                        val u = q.optString("stream").ifBlank { q.optString("url") }
                                        if (u.isNotBlank() && u != hls) pendingQualityUrls.add(u)
                                    }
                                }
                                if (hdrs.containsKey("Origin")) {
                                    pendingQualityUrls.add("__STRIP_ORIGIN__|$hls")
                                }
                                // Preserva stream_type no mapa passado ao player
                                if (normalizedStreamType == "hls" || normalizedStreamType == "m3u8") {
                                    hdrs["__STREAM_TYPE__"] = "hls"
                                } else if (normalizedStreamType == "mp4") {
                                    hdrs["__STREAM_TYPE__"] = "mp4"
                                }
                                lastStreamHeaders = hdrs.toMap()
                                createExoPlayer(
                                    hls,
                                    intent.getStringExtra(EXTRA_BUFFER) ?: "equilibrado",
                                    hdrs.filterKeys { true }, // inclui __STREAM_TYPE__
                                    longTimeouts = true,
                                )
                            }
                        }
                    } catch (e: StreamValidationException) {
                        runOnUiThread {
                            if (!activityDestroyed) showDiagnosticScreen("Servidor de conteúdo", e, e.details)
                        }
                    } catch (e: Throwable) {
                        runOnUiThread {
                            if (!activityDestroyed) showDiagnosticScreen("Servidor de conteúdo", e)
                        }
                    }
                }.also { it.start() }
                return
            }

        } catch (error: Throwable) {
            Log.e(TAG, "Falha antes de inicializar o player", error)
            showDiagnosticScreen("Preparação do player", error)
        }
    }


    /** Preferir H.264 em aparelhos antigos ou sem decoder HEVC. */
    private fun devicePrefersAvc(): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 24) return true
        return try {
            val list = android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS)
            list.codecInfos.none { info ->
                !info.isEncoder && info.supportedTypes.any { it.equals("video/hevc", ignoreCase = true) }
            }
        } catch (_: Exception) {
            true
        }
    }

    private fun isDecoderOrSourceError(error: PlaybackException): Boolean {
        val code = error.errorCode
        if (code == PlaybackException.ERROR_CODE_DECODING_FAILED ||
            code == PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES ||
            code == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
            code == PlaybackException.ERROR_CODE_IO_UNSPECIFIED ||
            code == PlaybackException.ERROR_CODE_IO_BAD_HTTP_STATUS ||
            code == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
            code == PlaybackException.ERROR_CODE_IO_INVALID_HTTP_CONTENT_TYPE
        ) return true
        val cause = error.cause?.message.orEmpty().lowercase()
        return cause.contains("hevc") || cause.contains("decoder") || cause.contains("source error")
    }

    private fun createExoPlayer(
        streamUrl: String,
        buffer: String?,
        requestProperties: Map<String, String>,
        longTimeouts: Boolean = false,
    ) {
        try {
            playerReady = false
            positionRestored = false
            setLoadingVisible(true)
            setControlsVisible(false)
            markStep("criando MediaItem")
            val lowerUrl = streamUrl.lowercase()
            val typeHint = (
                requestProperties["__STREAM_TYPE__"]
                    ?: lastStreamHeaders["__STREAM_TYPE__"]
                    ?: ""
                ).lowercase()
            // stream_type da API manda no tipo; senão deduz pela URL
            val isMp4 = when {
                typeHint == "dash" || typeHint == "mpd" -> false
                typeHint == "hls" || typeHint == "m3u8" -> false
                typeHint == "mp4" -> true
                lowerUrl.contains(".m3u8") || lowerUrl.contains("mpegurl") -> false
                lowerUrl.contains(".mp4") || lowerUrl.contains("/resource/") -> true
                lowerUrl.contains("vod-resolve") -> true // cineveo proxy costuma ser mp4
                lowerUrl.contains("clickhost") && lowerUrl.contains("/stream/") -> true
                else -> false
            }
            val isDash = typeHint == "dash" || typeHint == "mpd" ||
                (typeHint != "hls" && (lowerUrl.contains(".mpd") || lowerUrl.contains("dash")))
            val isHls = !isMp4 && !isDash
            val mediaItem = MediaItem.Builder()
                .setUri(streamUrl)
                .apply {
                    when {
                        isMp4 -> setMimeType(MimeTypes.VIDEO_MP4)
                        isDash -> setMimeType(MimeTypes.APPLICATION_MPD)
                        else -> setMimeType(MimeTypes.APPLICATION_M3U8)
                    }
                }
                .build()
            val isMega = currentCategoria.equals("v3", ignoreCase = true)
            // Proxy Render: buffer maior evita “Carregando…” no meio do ep
            val minBuf = if (isMega || longTimeouts) maxOf(bufferMin(buffer), 15_000) else bufferMin(buffer)
            val maxBuf = if (isMega || longTimeouts) maxOf(bufferMax(buffer), 50_000) else bufferMax(buffer)
            val loadControl = DefaultLoadControl.Builder()
                .setBufferDurationsMs(minBuf, maxBuf, if (isMega) 3_500 else 2_500, if (isMega) 8_000 else 5_000)
                .build()
            val connectMs = if (longTimeouts || isMega) 45_000 else 12_000
            val readMs = if (longTimeouts || isMega) 90_000 else 20_000
            // Usa os headers específicos recebidos no objeto playback do servidor.
            val useOkHttp = longTimeouts
            val propsRaw = when {
                requestProperties.isNotEmpty() -> requestProperties
                longTimeouts -> mapOf(
                    "Accept" to "*/*",
                    "Accept-Language" to "pt-BR,pt;q=0.9,en;q=0.8",
                    "User-Agent" to STREAM_USER_AGENT,
                    "Connection" to "keep-alive",
                )
                else -> requestProperties
            }
            // CDN de vídeo nunca deve levar token de login do app
            val props = propsRaw.filterKeys { !it.equals("Authorization", ignoreCase = true) && !it.startsWith("__") }
            if (downloadOnly) {
                val mime = when {
                    isDash -> MimeTypes.APPLICATION_MPD
                    isHls -> MimeTypes.APPLICATION_M3U8
                    else -> MimeTypes.VIDEO_MP4
                }
                completeDownloadResolution(streamUrl, props, mime)
                return
            }
            // MP4 progressivo usa DefaultHttpDataSource; HLS usa OkHttp neutro.
            // User-Agent: prioriza o que veio em props (API); STREAM_USER_AGENT só como fallback.
            val effectiveUa = props["User-Agent"]?.takeIf { it.isNotBlank() } ?: STREAM_USER_AGENT
            val propsNoUa = props.filterKeys { !it.equals("User-Agent", ignoreCase = true) }
            val dataSourceFactory: androidx.media3.datasource.DataSource.Factory = if (isMp4) {
                DefaultHttpDataSource.Factory()
                    .setDefaultRequestProperties(propsNoUa)
                    .setUserAgent(effectiveUa)
                    .setAllowCrossProtocolRedirects(true)
                    .setConnectTimeoutMs(connectMs.coerceAtLeast(15_000))
                    .setReadTimeoutMs(readMs.coerceAtLeast(20_000))
            } else if (useOkHttp) {
                val client = contentStreamOkHttp()
                OkHttpDataSource.Factory(client)
                    .setUserAgent(effectiveUa)
                    .setDefaultRequestProperties(propsNoUa)
            } else {
                DefaultHttpDataSource.Factory()
                    .setDefaultRequestProperties(propsNoUa)
                    .setUserAgent(effectiveUa)
                    .setAllowCrossProtocolRedirects(true)
                    .setConnectTimeoutMs(connectMs)
                    .setReadTimeoutMs(readMs)
            }
            markStep(when {
                isMp4 -> "criando ProgressiveMediaSource (MP4)"
                isDash -> "criando DashMediaSource (MPD)"
                else -> "criando HlsMediaSource (HLS)"
            })
            val mediaSource = when {
                isMp4 -> ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem)
                isDash -> DashMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem)
                else -> HlsMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem)
            }
            markStep("criando ExoPlayer")
            val exo = run {
                val trackSelector = DefaultTrackSelector(this).apply {
                    parameters = buildUponParameters()
                        .setPreferredTextLanguage("pt")
                        .setPreferredTextLanguage("pt-BR")
                        .setSelectUndeterminedTextLanguage(true)
                        .build()
                }
                ExoPlayer.Builder(this)
                    .setLoadControl(loadControl)
                    .setTrackSelector(trackSelector)
                    .build()
            }
            player = exo
            playerView.player = exo
            exo.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (activityDestroyed) return
                    if (state == Player.STATE_READY) {
                        playerReady = true
                        restoreSavedPosition(exo)
                        applyRemotePositionIfReady(exo)
                        updateNextEpisodeButton()
                        markStep("Player pronto: STATE_READY")
                        setLoadingVisible(false)
                        setControlsVisible(true)
                        scheduleHide()
                    } else if (state == Player.STATE_BUFFERING || state == Player.STATE_IDLE) {
                        // Durante a leitura do manifesto ou dos segmentos, o painel
                        // central reaparece sem remover a barra de voltar.
                        setLoadingVisible(true)
                        if (!playerReady) setControlsVisible(false)
                    }
                    if (state == Player.STATE_ENDED) {
                        setLoadingVisible(false)
                        setControlsVisible(true)
                    }
                }

                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (activityDestroyed) return
                    playButton.text = if (isPlaying) "Ⅱ" else "▶"
                    if (!playerReady) return
                    if (isPlaying) scheduleHide() else setControlsVisible(true)
                }

                override fun onPlayerError(error: PlaybackException) {
                    if (activityDestroyed) return
                    markStep("erro de playback: ${error.errorCodeName}")
                    Log.e(TAG, "Falha ao carregar stream: ${error.errorCodeName}", error)
                    // Tenta próxima qualidade (por exemplo, HEVC → H.264).
                    if (pendingQualityUrls.isNotEmpty() && isDecoderOrSourceError(error)) {
                        var next = pendingQualityUrls.removeAt(0)
                        var retryHeaders = lastStreamHeaders.ifEmpty { requestProperties }.toMutableMap()
                        if (next.startsWith("__STRIP_ORIGIN__|")) {
                            next = next.removePrefix("__STRIP_ORIGIN__|")
                            retryHeaders.remove("Origin")
                            markStep("retry CDN sem Origin")
                        } else {
                            markStep("retry qualidade alternativa")
                        }
                        try {
                            player?.release()
                        } catch (_: Exception) {}
                        player = null
                        lastStreamHeaders = retryHeaders
                        createExoPlayer(
                            next,
                            intent.getStringExtra(EXTRA_BUFFER) ?: "equilibrado",
                            retryHeaders,
                            longTimeouts = true,
                        )
                        return
                    }
                    // O ingresso alternativo pertence exclusivamente à origem TEDTOP.
                    if (!tedtopFallbackTried && currentSlug.isNotBlank() && isTedtopOrigin()) {
                        tedtopFallbackTried = true
                        markStep("tentando fallback TEDTOP ingresso")
                        Thread {
                            val result = AuthSession.getTedtopIngresso(currentSlug)
                            val direct = result.value?.optString("direct_url").orEmpty()
                            if (result.ok && direct.isNotBlank()) {
                                runOnUiThread {
                                    if (activityDestroyed) return@runOnUiThread
                                    try {
                                        markStep("TEDTOP direct_url obtido")
                                        playResolvedUrl(direct, fromTedtop = true)
                                    } catch (e: Throwable) {
                                        Log.e(TAG, "Fallback TEDTOP falhou", e)
                                        showDiagnosticScreen("Playback Media3/HTTP", error)
                                    }
                                }
                            } else {
                                runOnUiThread {
                                    if (!activityDestroyed) showDiagnosticScreen("Playback Media3/HTTP", error)
                                }
                            }
                        }.apply { name = "TedflixTedtopFallback"; start() }
                        return
                    }
                    showDiagnosticScreen("Playback Media3/HTTP", error)
                }
            })
            exo.setMediaSource(mediaSource)
            markStep("preparando ExoPlayer")
            exo.prepare()
            exo.playWhenReady = true
            bindMediaSession(exo)
            markStep("reprodução solicitada")
            handler.removeCallbacks(progressRunnable)
            handler.post(progressRunnable)
        } catch (error: Throwable) {
            Log.e(TAG, "Falha ao criar Media3/HlsMediaSource", error)
            player?.release()
            player = null
            if (::playerView.isInitialized) playerView.player = null
            showDiagnosticScreen("Inicialização Media3/HlsMediaSource", error)
        }
    }

    private fun streamRequestProperties(): Map<String, String> = buildMap {
        put("Accept", "*/*")
        put("Accept-Language", "pt-BR,pt;q=0.9")
        put("Cache-Control", "no-cache")
        put("Pragma", "no-cache")
        put("User-Agent", STREAM_USER_AGENT)
    }

    private fun readPreview(input: InputStream?): String {
        if (input == null) return "(resposta sem corpo)"
        return try {
            input.bufferedReader(Charsets.UTF_8).use { reader ->
                val chars = CharArray(8192)
                val count = reader.read(chars)
                if (count <= 0) "(corpo vazio)" else String(chars, 0, count)
            }
        } catch (error: Throwable) {
            "(não foi possível ler o corpo: ${error.message})"
        }
    }

    private fun isActivityAlive() = !activityDestroyed && !isFinishing && !isDestroyedCompat()

    private fun markStep(step: String) {
        lastStep = step
        Log.i(TAG, "[TEDFLIX] $step")
    }

    private class StreamValidationException(message: String, val details: String) : IllegalStateException(message)

    private fun reloadStream() {
        if (!isActivityAlive()) return
        playerReady = false
        positionRestored = false
        remotePositionApplied = false
        setLoadingVisible(true)
        setControlsVisible(false)
        player?.let { exo ->
            try {
                exo.stop()
                exo.seekTo(0)
                exo.prepare()
                exo.playWhenReady = true
            } catch (error: Throwable) {
                Log.e(TAG, "Falha ao recarregar o stream", error)
                showDiagnosticScreen("Recarregamento do stream", error)
            }
        }
    }

    private fun togglePlay() {
        player?.let { if (it.isPlaying) it.pause() else it.play() }
        setControlsVisible(true)
    }

    private fun seekBy(delta: Long) {
        player?.let { it.seekTo((it.currentPosition + delta).coerceIn(0L, it.duration.takeIf { d -> d > 0 } ?: Long.MAX_VALUE)) }
        setControlsVisible(true)
    }

    private fun updateProgress() {
        if (!::progress.isInitialized || !::currentTime.isInitialized || !::durationTime.isInitialized) return
        val exo = player ?: return
        val rawDur = exo.duration
        lastDuration = if (rawDur != C.TIME_UNSET && rawDur > 0L) rawDur else lastDuration
        val current = exo.currentPosition.coerceAtLeast(0L)
        if (lastDuration > 0L) {
            progress.isEnabled = true
            progress.progress = ((current * 1000L) / lastDuration).toInt().coerceIn(0, 1000)
        } else {
            // MP4 ainda sem duração conhecida — mantém barra utilizável
            progress.progress = 0
        }
        currentTime.text = formatTime(current)
        durationTime.text = if (lastDuration > 0L) formatTime(lastDuration) else "--:--"
        // Notificação estilo música + save local periódico
        try {
            val now = System.currentTimeMillis()
            if (now - lastNotifUpdateMs >= 900L) {
                lastNotifUpdateMs = now
                updatePlaybackNotification(exo)
            }
            // Progresso local a cada segundo (não só no onPause — a tela de detalhes
            // precisa refletir o ponto atual assim que o usuário retorna).
            if (playerReady && now - lastLocalSaveMs >= 1_000L) {
                lastLocalSaveMs = now
                savePlaybackProgress()
            }
        } catch (_: Throwable) {}
        // Sincroniza ícone play/pause (MP4 às vezes não dispara onIsPlayingChanged cedo)
        if (::playButton.isInitialized) {
            playButton.text = if (exo.isPlaying) "Ⅱ" else "▶"
        }
        // Notificação a cada 1s (tempo + barra mais fluidos)
        if (current / 1000 != (current - 500).coerceAtLeast(0) / 1000) {
            updatePlaybackNotification(exo)
        }
        maybeAutoPlay(exo, current, lastDuration)
    }

    /**
     * Nos últimos 10s de um episódio com fila: mostra contagem no canto
     * e só avança quando chega a 0. Cancelável pelo usuário.
     */
    private fun maybeAutoPlay(exo: ExoPlayer, current: Long, duration: Long) {
        // Duração real do ExoPlayer (ignora valores inválidos / placeholders)
        val realDur = exo.duration
        val dur = when {
            realDur != C.TIME_UNSET && realDur > 15_000L -> realDur
            duration > 15_000L -> duration
            else -> {
                hideNextCountdown()
                return
            }
        }
        if (autoPlayTriggered || !exo.isPlaying || current < 0L) {
            if (!exo.isPlaying) hideNextCountdown()
            return
        }
        val remaining = (dur - current).coerceAtLeast(0L)
        // Só nos ÚLTIMOS 10 segundos reais — nunca no meio do vídeo
        val inFinalWindow = remaining in 1L..10_000L
        val isEpisode = isEpisodePlayback()

        if (isEpisode && nextEpisodes.isNotEmpty()) {
            if (remaining <= 400L) {
                autoPlayTriggered = true
                hideNextCountdown()
                savePlaybackProgress()
                toast("Próximo episódio iniciando...")
                playNextEpisode()
                return
            }
            if (inFinalWindow) {
                val sec = ((remaining + 999L) / 1000L).toInt().coerceIn(1, 10)
                showNextCountdown(sec, nextEpisodes.firstOrNull()?.titulo.orEmpty())
            } else {
                hideNextCountdown()
            }
            return
        }

        hideNextCountdown()

        // Filme: recomendações no fim (sem card de countdown)
        if (!isEpisode && recommendations.isNotEmpty()) {
            if (remaining in 0L..PlaybackRules.AUTO_PLAY_WINDOW_MS) {
                autoPlayTriggered = true
                savePlaybackProgress()
                toast("Próximo recomendado iniciando...")
                playRecommendation()
            }
        }
    }

    private fun showNextCountdown(seconds: Int, nextTitle: String) {
        if (!::nextCountdownPanel.isInitialized || !isActivityAlive()) return
        if (lastCountdownSec == seconds && nextCountdownPanel.visibility == View.VISIBLE) return
        lastCountdownSec = seconds
        val clean = nextTitle.trim().ifBlank { "Próximo episódio" }
        nextCountdownTitle.text = clean.take(42)
        nextCountdownSeconds.text = "${seconds}s"
        nextCountdownPanel.visibility = View.VISIBLE
        // Mantém painel legível mesmo com controles escondidos
        nextCountdownPanel.bringToFront()
    }

    private fun hideNextCountdown() {
        lastCountdownSec = -1
        if (::nextCountdownPanel.isInitialized) {
            nextCountdownPanel.visibility = View.GONE
        }
    }

    private fun cancelNextCountdown() {
        autoPlayTriggered = true // impede auto-avanço neste ep
        hideNextCountdown()
        toast("Próximo episódio cancelado")
    }


    private fun showQualityMenu() {
        val options = linkedMapOf("Automático" to Int.MAX_VALUE)
        player?.currentTracks?.groups?.filter { it.type == C.TRACK_TYPE_VIDEO }?.forEach { group ->
            for (i in 0 until group.length) {
                val height = group.getTrackFormat(i).height
                if (height > 0) options["${height}p"] = height
            }
        }
        val labels = listOf("Máxima") + options.keys.sortedByDescending { options[it] ?: 0 }
        choose("Qualidade", labels) { label ->
            val height = if (label == "Máxima") Int.MAX_VALUE else (options[label] ?: Int.MAX_VALUE)
            player?.let { exo ->
                exo.trackSelectionParameters = exo.trackSelectionParameters
                    .buildUpon()
                    .clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                    .setMaxVideoSize(Int.MAX_VALUE, height)
                    .setForceHighestSupportedBitrate(label == "Máxima")
                    .build()
                toast(if (label == "Máxima") "Qualidade: máxima" else "Qualidade: $label")
            }
        }
    }

    private fun showAudioMenu() {
        val tracks = collectTracks(C.TRACK_TYPE_AUDIO)
        if (tracks.isEmpty()) {
            toast("Apenas uma faixa de áudio disponível")
            return
        }
        choose("Áudio", listOf("Automático") + tracks.map { it.label }) { label ->
            if (label == "Automático") {
                player?.let { exo ->
                    exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
                        .setPreferredAudioLanguage(null).build()
                }
            } else {
                val track = tracks.firstOrNull { it.label == label }
                player?.let { exo ->
                    exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
                        .setPreferredAudioLanguage(track?.format?.language).build()
                }
            }
        }
    }

    private fun showSubtitleMenu() {
        val tracks = collectTracks(C.TRACK_TYPE_TEXT)
        choose("Legendas", listOf("Desativadas") + tracks.map { it.label }) { label ->
            val builder = player?.trackSelectionParameters?.buildUpon() ?: return@choose
            if (label == "Desativadas") builder.setIgnoredTextSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            else builder.setPreferredTextLanguage(tracks.firstOrNull { it.label == label }?.format?.language)
            player?.trackSelectionParameters = builder.build()
        }
    }

    private fun showSpeedMenu() {
        val speeds = listOf("0,75x" to 0.75f, "Normal" to 1f, "1,25x" to 1.25f, "1,5x" to 1.5f, "2x" to 2f)
        choose("Velocidade", speeds.map { it.first }) { label ->
            player?.setPlaybackParameters(PlaybackParameters(speeds.firstOrNull { it.first == label }?.second ?: 1f))
        }
    }

    private data class TrackOption(val label: String, val format: Format)

    private fun collectTracks(type: Int): List<TrackOption> {
        val result = mutableListOf<TrackOption>()
        player?.currentTracks?.groups?.filter { it.type == type }?.forEach { group ->
            for (i in 0 until group.length) {
                val format = group.getTrackFormat(i)
                val label = format.label ?: format.language ?: "Faixa ${result.size + 1}"
                if (result.none { it.label == label }) result += TrackOption(label, format)
            }
        }
        return result
    }

    private fun choose(title: String, labels: List<String>, selected: (String) -> Unit) {
        val dialog = android.app.AlertDialog.Builder(this, R.style.TedflixDialog)
            .setTitle(title)
            .setItems(labels.toTypedArray()) { _, which ->
                selected(labels[which])
                setControlsVisible(false)
            }
            .create()
        dialog.setCanceledOnTouchOutside(true)
        dialog.setOnCancelListener { setControlsVisible(false) }
        dialog.show()
    }

    private fun restoreSavedPosition(exo: ExoPlayer) {
        if (positionRestored) return
        positionRestored = true
        val saved = ContinueWatchingStore.read(this).firstOrNull {
            it.categoria == currentCategoria && it.slug == currentSlug
        } ?: return
        val duration = exo.duration.takeIf { it > 0L } ?: saved.durationMs
        val target = saved.positionMs.coerceIn(0L, (duration - 1_000L).coerceAtLeast(0L))
        if (target >= 3_000L) {
            exo.seekTo(target)
            toast("Continuando de ${formatTime(target)}")
            Log.d(TAG, "Progresso restaurado: ${target}ms para ${saved.key}")
        }
    }

    private fun loadRemoteProgress() {
        if (!AuthSession.hasToken() || currentFilmeId.isBlank()) return
        val filmeId = currentFilmeId
        val categoria = currentCategoria
        val slug = currentSlug
        Thread {
            val result = AuthSession.continueWatching()
            remoteHistory = result.value.orEmpty()
            val exact = result.value.orEmpty().firstOrNull { item ->
                item.categoria == categoria && item.slug == slug
            }
            val match = exact ?: result.value.orEmpty().firstOrNull { item ->
                !isEpisodePlayback() && item.filmeId == filmeId
            }
            remotePositionMs = match?.tempo?.let { parseRemoteTime(it) }
            remotePositionLoaded = true
            runOnUiThread { player?.let { applyRemotePositionIfReady(it) } }
        }.apply { name = "TedflixRemoteProgressLoad"; start() }
    }

    private fun parseRemoteTime(raw: String): Long? {
        return PlaybackRules.remoteTimeToMillis(raw)
    }

    private fun applyRemotePositionIfReady(exo: ExoPlayer) {
        if (remotePositionApplied || !remotePositionLoaded) return
        val target = remotePositionMs ?: return
        val duration = exo.duration.takeIf { it > 0L } ?: return
        val safeTarget = target.coerceIn(0L, (duration - 1_000L).coerceAtLeast(0L))
        if (safeTarget >= 3_000L) {
            exo.seekTo(safeTarget)
            remotePositionApplied = true
            toast("Continuando de ${formatTime(safeTarget)}")
            Log.d(TAG, "Histórico remoto restaurado: ${safeTarget}ms para $currentFilmeId")
        }
    }

    
    
    private fun ensurePlayerShell() {
        if (player != null) return
        if (!::playerView.isInitialized) return
        val buffer = getSharedPreferences(PREFS, MODE_PRIVATE).getString(BUFFER_KEY, "equilibrado")
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(bufferMin(buffer), bufferMax(buffer), 2_500, 5_000)
            .build()
        val exo = ExoPlayer.Builder(this).setLoadControl(loadControl).build()
        player = exo
        playerView.player = exo
        exo.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (activityDestroyed) return
                if (state == Player.STATE_READY) {
                    playerReady = true
                    val d = exo.duration
                    if (d != C.TIME_UNSET && d > 0L) lastDuration = d
                    restoreSavedPosition(exo)
                    if (!offlinePlayback) applyRemotePositionIfReady(exo)
                    setLoadingVisible(false)
                    updateProgress()
                }
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (activityDestroyed) return
                if (::playButton.isInitialized) playButton.text = if (isPlaying) "Ⅱ" else "▶"
                if (isPlaying) scheduleHide() else setControlsVisible(true)
                updateProgress()
            }
            override fun onPlayerError(error: PlaybackException) {
                if (activityDestroyed) return
                markStep("erro: ${error.errorCodeName}")
                if (offlinePlayback) {
                    showDiagnosticScreen("Reprodução offline", error)
                    return
                }
                if (!tedtopRefreshTried) {
                    tedtopRefreshTried = true
                    fetchTedtopAndPlay("refresh-expirado") {
                        showDiagnosticScreen("Playback Media3/HTTP", error)
                    }
                    return
                }
                showDiagnosticScreen("Playback Media3/HTTP", error)
            }
        })
        handler.removeCallbacks(progressRunnable)
        handler.post(progressRunnable)
    }

    private fun isLikelyHls(url: String): Boolean {
        val u = url.lowercase()
        return u.contains(".m3u8")
            || u.contains("/proxy")
            || u.contains("filme-player")
            || u.contains("/hls")
            || u.contains("/hls/")
    }


    /** Cliente HTTP neutro para consumir streams resolvidos pelo Content Server v2. */
    private fun contentStreamOkHttp(): OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .addInterceptor { chain ->
                val request = chain.request().newBuilder()
                    .header("User-Agent", STREAM_USER_AGENT)
                    .header("Accept", "*/*")
                    .build()
                chain.proceed(request)
            }
            .build()

    /** Aceita somente os cinco providers publicados pelo Content Server v2. */
    private fun isUnifiedContentCategory(categoria: String): Boolean {
        return categoria.trim().lowercase() in setOf("v1", "v2", "v3", "v4", "v5")
    }

    /** Monta somente a rota unificada /api/play/:provider/:sourceId do servidor v2. */
    private fun resolveStreamUrl(categoria: String, slug: String): String {
        val provider = categoria.trim().lowercase()
        if (provider !in setOf("v1", "v2", "v3", "v4", "v5")) {
            throw IllegalArgumentException("Provider inválido no Content Server v2: $categoria")
        }
        val base = AuthSession.MOVIE_API_BASE.trimEnd('/')
        val trimmed = slug.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("Identificador do conteúdo vazio.")

        // slug de episódio: serie-{sourceId}-{season}-{episode}
        val isEpisodeSlug = trimmed.startsWith("serie-", ignoreCase = true)
        val tipoLc = currentTipo.lowercase()
        if (isEpisodeSlug || tipoLc == "episodio" || tipoLc == "episode") {
            val parts = trimmed.split("-").filter { it.isNotBlank() }
            if (parts.size >= 4 && parts[0].equals("serie", ignoreCase = true)) {
                val season = parts[parts.size - 2].toIntOrNull()
                    ?: throw IllegalArgumentException("Temporada inválida no identificador do episódio.")
                val episode = parts.last().toIntOrNull()
                    ?: throw IllegalArgumentException("Número do episódio inválido.")
                val sourceId = parts.subList(1, parts.size - 2).joinToString("-")
                if (sourceId.isBlank()) throw IllegalArgumentException("ID da série ausente no identificador do episódio.")
                val tqEp = currentTitle.trim().takeIf { it.isNotBlank() && !it.equals("Tedflix", true) }
                val extraEp = if (tqEp != null) "&title=" + Uri.encode(tqEp) else ""
                return "$base/api/play/$provider/${Uri.encode(sourceId)}?type=series&season=$season&episode=$episode$extraEp"
            }
            // Fallback: serieSlug + parse "s1e2" no filmeId / título
            val serieId = currentSerieSlug.ifBlank { trimmed }
            val seMatch = Regex("""s(\d+)e(\d+)""", RegexOption.IGNORE_CASE).find(currentFilmeId + " " + trimmed)
            if (seMatch != null) {
                val season = seMatch.groupValues[1].toInt()
                val episode = seMatch.groupValues[2].toInt()
                val tq2 = currentTitle.trim().takeIf { it.isNotBlank() && !it.equals("Tedflix", true) }
                val extra2 = if (tq2 != null) "&title=" + Uri.encode(tq2) else ""
                return "$base/api/play/$provider/${Uri.encode(serieId)}?type=series&season=$season&episode=$episode$extra2"
            }
            throw IllegalArgumentException("Identificador do episódio inválido: $slug")
        }

        val mediaType = if (tipoLc == "series" || tipoLc == "serie" || tipoLc == "série") "series" else "movie"
        val titleQ = currentTitle.trim().takeIf { it.isNotBlank() && !it.equals("Tedflix", true) }
        val qs = StringBuilder("type=$mediaType")
        if (titleQ != null) qs.append("&title=").append(Uri.encode(titleQ))
        return "$base/api/play/$provider/${Uri.encode(trimmed)}?$qs"
    }

    @OptIn(UnstableApi::class)
    private fun playOfflineDownload(downloadId: String) {
        markStep("carregando download offline")
        setLoadingVisible(true)
        Thread {
            val result = try {
                com.tedflix.app.downloads.DownloadRepository.getDownload(this, downloadId)
            } catch (error: Throwable) {
                runOnUiThread { if (!activityDestroyed) showDiagnosticScreen("Reprodução offline", error) }
                return@Thread
            }
            runOnUiThread {
                if (activityDestroyed || isFinishing || isDestroyedCompat()) return@runOnUiThread
                try {
                    val download = result ?: throw IllegalStateException("Download não encontrado.")
                    if (download.state != androidx.media3.exoplayer.offline.Download.STATE_COMPLETED) {
                        throw IllegalStateException("Este conteúdo ainda não terminou de baixar.")
                    }
                    offlinePlayback = true
                    markStep("abrindo conteúdo offline")
                    ensurePlayerShell()
                    val mediaItem = download.request.toMediaItem()
                    val source = com.tedflix.app.downloads.DownloadRepository
                        .offlineMediaSourceFactory(this)
                        .createMediaSource(mediaItem)
                    val exo = player ?: throw IllegalStateException("Player indisponível.")
                    exo.setMediaSource(source)
                    exo.prepare()
                    exo.playWhenReady = true
                    setLoadingVisible(true)
                    markStep("reprodução offline preparada")
                } catch (error: Throwable) {
                    Log.e(TAG, "Falha ao abrir download offline", error)
                    showDiagnosticScreen("Reprodução offline", error)
                }
            }
        }.apply { name = "TedflixOfflineLookup"; start() }
    }

    private fun isTedtopOrigin(): Boolean {

        val cat = currentCategoria.lowercase()
        return cat == "destaque" || cat == "tedtop" || currentTipo.equals("tedtop", true)
    }

    /**
     * Inicia (ou troca) a mídia: HLS (segmentos) ou MP4 progressivo (TEDTOP assinada).
     * Sempre chamado na main thread.
     */
    private fun completeDownloadResolution(url: String, headers: Map<String, String>, mimeType: String) {
        if (downloadResolutionHandled) return
        try {
            val safeUrl = url.trim()
            val parsedUrl = Uri.parse(safeUrl)
            val scheme = parsedUrl.scheme?.lowercase().orEmpty()
            if ((scheme != "http" && scheme != "https") || parsedUrl.host.isNullOrBlank()) {
                throw IllegalArgumentException("A API não retornou uma URL válida para download.")
            }
            val metadata = JSONObject(downloadMetadata.toString())
                .put("sourceCategory", currentCategoria)
                .put("sourceSlug", currentSlug)
                .put("filmId", currentFilmeId)
                .put("serieCategory", currentSerieCategoria)
                .put("serieSlug", currentSerieSlug)
                .put("seriesKey", if (currentSerieCategoria.isNotBlank() && currentSerieSlug.isNotBlank()) "${currentSerieCategoria}_${currentSerieSlug}".replace(Regex("[^A-Za-z0-9_-]"), "_") else downloadMetadata.optString("seriesKey"))
                .put("streamType", when (mimeType) {
                    MimeTypes.APPLICATION_M3U8 -> "hls"
                    MimeTypes.APPLICATION_MPD -> "dash"
                    else -> "progressive"
                })
                .put("createdAt", System.currentTimeMillis())
            val id: String = metadata.optString("id").ifBlank {
                "${currentCategoria}_${currentSlug}".replace(Regex("[^A-Za-z0-9_-]"), "_")
            }
            val safeHeaders = headers.filterKeys { !it.startsWith("__") }.toMutableMap()
            if (safeHeaders.keys.none { it.equals("User-Agent", ignoreCase = true) }) {
                safeHeaders["User-Agent"] = STREAM_USER_AGENT
            }
            com.tedflix.app.downloads.DownloadRepository.enqueue(
                this, id, safeUrl, mimeType, metadata.toString(), JSONObject(safeHeaders).toString()
            )
            downloadResolutionHandled = true
            val isQueuedSeriesEpisode = !intent.getStringExtra(EXTRA_DOWNLOAD_QUEUE).isNullOrBlank()
            com.tedflix.app.downloads.DownloadRepository
                .startNextFromQueue(this, intent.getStringExtra(EXTRA_DOWNLOAD_QUEUE))
            if (isQueuedSeriesEpisode) {
                finish()
            } else {
                TedflixDialogs.notice(
                    this,
                    "Download adicionado",
                    "O conteúdo foi adicionado à sua fila de downloads.",
                    icon = "download",
                    tone = "success",
                ) { finish() }
            }
        } catch (error: Throwable) {
            Log.e(TAG, "Falha ao adicionar download", error)
            finishDownloadResolutionFailure(
                error.message ?: "Não foi possível adicionar o conteúdo à fila."
            )
        }
    }

    /** Finaliza uma resolução de download com erro sem abrir UI de player. */
    private fun finishDownloadResolutionFailure(message: String) {
        if (!downloadOnly || downloadResolutionHandled) return
        if (Looper.myLooper() != Looper.getMainLooper()) {
            runOnUiThread { finishDownloadResolutionFailure(message) }
            return
        }
        downloadResolutionHandled = true
        val safeMessage = message.ifBlank { "Não foi possível localizar este conteúdo. Download cancelado." }
        Log.w(TAG, "Download cancelado na resolução: $safeMessage")
        val queuedEpisode = !intent.getStringExtra(EXTRA_DOWNLOAD_QUEUE).isNullOrBlank()
        try {
            com.tedflix.app.downloads.DownloadRepository.notifyResolutionFailure(
                this,
                currentTitle.ifBlank { "Conteúdo" },
                safeMessage,
            )
        } catch (notifyError: Throwable) {
            Log.w(TAG, "Não foi possível emitir aviso de falha do download", notifyError)
        }
        // Se era uma fila de série, pula apenas o episódio indisponível e segue
        // para o próximo. A tarefa que retornou 404 nunca chega ao DownloadManager.
        try {
            com.tedflix.app.downloads.DownloadRepository.startNextFromQueue(
                this, intent.getStringExtra(EXTRA_DOWNLOAD_QUEUE)
            )
        } catch (queueError: Throwable) {
            Log.w(TAG, "Não foi possível continuar a fila após falha", queueError)
        }
        if (queuedEpisode) {
            finish()
        } else {
            TedflixDialogs.error(this, "Download cancelado", safeMessage) { finish() }
        }
    }

    private fun playResolvedUrl(url: String, fromTedtop: Boolean = false) {
        if (activityDestroyed) return
        if (downloadOnly) {
            val lower = url.lowercase()
            val mime = when {
                lower.contains(".mpd") || lower.contains("dash") -> MimeTypes.APPLICATION_MPD
                isLikelyHls(url) ||
                    currentCategoria.equals("v3", true) ||
                    lastStreamHeaders["__STREAM_TYPE__"].equals("hls", true) -> MimeTypes.APPLICATION_M3U8
                else -> MimeTypes.VIDEO_MP4
            }
            completeDownloadResolution(url, lastStreamHeaders + streamRequestProperties(), mime)
            return
        }
        val exo = player ?: return
        diagnosticUrl = url
        markStep(if (fromTedtop) "reproduzindo MP4/TEDTOP" else "reproduzindo fonte")
        val hls = isLikelyHls(url) ||
            currentCategoria.equals("v3", ignoreCase = true)
        val mediaItem = MediaItem.Builder()
            .setUri(url)
            .apply {
                if (hls) setMimeType(MimeTypes.APPLICATION_M3U8)
                else if (url.lowercase().contains(".mp4")) setMimeType(MimeTypes.VIDEO_MP4)
            }
            .build()
        val dataSourceFactory = DefaultHttpDataSource.Factory()
            .setDefaultRequestProperties(streamRequestProperties())
            .setUserAgent(STREAM_USER_AGENT)
            .setAllowCrossProtocolRedirects(true)
        val mediaSource = if (hls) {
            HlsMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem)
        } else {
            ProgressiveMediaSource.Factory(dataSourceFactory).createMediaSource(mediaItem)
        }
        exo.setMediaSource(mediaSource)
        exo.prepare()
        exo.playWhenReady = true
        setLoadingVisible(true)
        handler.removeCallbacks(progressRunnable)
        handler.post(progressRunnable)
        updateProgress()
        markStep(if (hls) "HLS preparado" else "MP4 progressivo preparado")
    }

    /** Busca direct_url TEDTOP e toca. Link é temporário — não persistir. */
    private fun fetchTedtopAndPlay(reason: String, onFail: (() -> Unit)? = null) {
        if (currentSlug.isBlank()) {
            onFail?.invoke()
            return
        }
        markStep("TEDTOP ingresso ($reason)")
        Thread {
            val result = AuthSession.getTedtopIngresso(currentSlug)
            // O endpoint /ingresso/:slug entrega direct_url (MP4) e player_url
            // (página do player). O Media3 deve receber somente a mídia direta.
            val direct = result.value?.optString("direct_url").orEmpty().trim()
            runOnUiThread {
                if (activityDestroyed) return@runOnUiThread
                val parsed = Uri.parse(direct)
                val scheme = parsed.scheme?.lowercase().orEmpty()
                val validDirect = (scheme == "http" || scheme == "https") && !parsed.host.isNullOrBlank()
                if (result.ok && validDirect) {
                    tedtopFallbackTried = true
                    playResolvedUrl(direct, fromTedtop = true)
                } else {
                    markStep("TEDTOP ingresso falhou: ${result.message}")
                    val status = result.statusCode.takeIf { it > 0 }
                    val failureMessage = when {
                        status == 404 -> "Filme não encontrado na TEDTOP (HTTP 404)."
                        result.message.isNotBlank() -> result.message
                        else -> "A API não retornou um direct_url MP4 válido."
                    }
                    if (downloadOnly) {
                        finishDownloadResolutionFailure("$failureMessage Download cancelado.")
                    } else {
                        onFail?.invoke()
                    }
                }
            }
        }.apply { name = "TedflixTedtopIngresso"; start() }
    }


    private fun saveRemoteProgress(positionMs: Long) {
        if (!AuthSession.hasToken() || currentFilmeId.isBlank()) return
        val now = System.currentTimeMillis()
        if (now - lastRemoteSaveAt < 8_000L) return
        lastRemoteSaveAt = now
        // ExoPlayer só pode ser lido na main thread — capturar duration aqui.
        val durationSeconds = try {
            val d = player?.duration ?: 0L
            if (d > 0L && d != androidx.media3.common.C.TIME_UNSET) d / 1_000L else 0L
        } catch (_: Throwable) {
            0L
        }
        val tempo = formatRemoteTime(positionMs)
        // Progresso por EP: contentId = slug do episódio (nunca o id da série)
        val isEp = currentTipo.contains("epis", true) ||
            currentSerieSlug.isNotBlank() ||
            currentSlug.startsWith("serie-", ignoreCase = true)
        val filmeId = if (isEp && currentSlug.isNotBlank()) currentSlug
            else currentFilmeId.ifBlank { currentSlug }
        val titulo = currentTitle
        val thumb = currentThumb
        val categoria = currentCategoria
        val slug = currentSlug
        val tipo = if (isEp && !currentTipo.contains("epis", true)) "episodio" else currentTipo
        val serieCategoria = currentSerieCategoria.ifBlank {
            if (isEp) currentCategoria else ""
        }
        val serieSlug = currentSerieSlug.ifBlank {
            // serie-{id}-{t}-{e} → id
            Regex("""(?i)^serie-(\d+)-""").find(currentSlug)?.groupValues?.getOrNull(1).orEmpty()
        }
        Thread {
            val result = AuthSession.saveProgress(
                filmeId = filmeId,
                titulo = titulo,
                tempo = tempo,
                thumb = thumb,
                durationSeconds = durationSeconds,
                categoria = categoria,
                slug = slug,
                tipo = tipo,
                serieCategoria = serieCategoria,
                serieSlug = serieSlug,
            )
            if (!result.ok) Log.w(TAG, "Falha ao sincronizar histórico remoto: ${result.message}")
            else Log.d(TAG, "Histórico remoto sincronizado para $filmeId em $tempo")
        }.apply { name = "TedflixRemoteProgress"; start() }
    }

    private fun formatRemoteTime(positionMs: Long): String {
        val totalSeconds = (positionMs / 1_000L).coerceAtLeast(0L)
        val hours = totalSeconds / 3_600L
        val minutes = (totalSeconds % 3_600L) / 60L
        val seconds = totalSeconds % 60L
        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, seconds)
    }

    private fun savePlaybackProgress() {
        val exo = player ?: return
        if (!playerReady) return
        val rawDur = exo.duration
        val duration = when {
            rawDur != C.TIME_UNSET && rawDur > 0L -> rawDur
            lastDuration > 0L -> lastDuration
            else -> 0L
        }
        val position = exo.currentPosition.coerceAtLeast(0L)
        // Salva a partir de 2s (antes exigia duração válida e posição > 0 rígido demais)
        if (duration <= 0L || position < 2_000L) return
        val matchEp = allSeriesEpisodes.firstOrNull {
            it.categoria == currentCategoria && it.slug == currentSlug
        } ?: nextEpisodes.firstOrNull {
            it.categoria == currentCategoria && it.slug == currentSlug
        }
        val parsed = ContinueWatchingStore.parseEpisodeMeta(currentTitle, currentSlug)
        val temporada = (matchEp?.temporada ?: 0).takeIf { it > 0 } ?: parsed.first
        // E0 é válido (especiais); não usar takeIf { it > 0 }
        val episodio = if (matchEp != null && matchEp.episodio >= 0) matchEp.episodio
            else parsed.second
        ContinueWatchingStore.save(
            context = this,
            categoria = currentCategoria,
            slug = currentSlug,
            titulo = currentTitle,
            positionMs = position,
            filmeId = currentFilmeId,
            durationMs = duration,
            thumb = currentThumb,
            tipo = currentTipo,
            serieCategoria = currentSerieCategoria,
            serieSlug = currentSerieSlug,
            temporada = temporada,
            episodio = episodio,
        )
        if (!offlinePlayback) saveRemoteProgress(position)
        Log.d(TAG, "Progresso salvo: ${position}ms/${duration}ms para $currentCategoria:$currentSlug")
    }

    override fun onPause() {
        savePlaybackProgress()
        super.onPause()
    }

    override fun onStop() {
        savePlaybackProgress()
        handler.removeCallbacks(progressRunnable)
        super.onStop()
    }

    private fun showError(message: String) {
        setLoadingVisible(false)
        TedflixDialogs.error(this, "Não foi possível reproduzir", message)
        if (::overlay.isInitialized) setControlsVisible(true)
    }

    private fun showStartupError(error: Throwable) {
        showDiagnosticScreen("Criação da interface", error)
    }


    private fun supportsPip(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)
    }

    private fun enterPipMode() {
        if (!supportsPip()) {
            toast("Mini player não disponível neste aparelho")
            return
        }
        try {
            savePlaybackProgress()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val params = PictureInPictureParams.Builder()
                    .setAspectRatio(Rational(16, 9))
                    .build()
                enterPictureInPictureMode(params)
                markStep("PiP ativado")
            }
        } catch (e: Throwable) {
            Log.w(TAG, "Falha ao entrar em PiP", e)
            toast("Não foi possível abrir o mini player")
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (closingPlayer || isFinishing || isDestroyed) return
        val exo = player
        if (exo != null && exo.isPlaying && supportsPip() && !isInPictureInPictureMode) {
            enterPipMode()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode)
        if (isInPictureInPictureMode) {
            setControlsVisible(false)
            setLoadingVisible(false)
        } else if (isActivityAlive()) {
            setControlsVisible(true)
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(notifChannelId) != null) return
        val ch = NotificationChannel(
            notifChannelId,
            "Reprodução Tedflix",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Controles e progresso do player"
            setShowBadge(false)
        }
        nm.createNotificationChannel(ch)
    }

    private fun bindMediaSession(exo: ExoPlayer) {
        try {
            mediaSession?.release()
            mediaSession = MediaSession.Builder(this, exo)
                .setId("tedflix-player")
                .build()
            ensureNotificationChannel()
            updatePlaybackNotification(exo)
        } catch (e: Throwable) {
            Log.w(TAG, "MediaSession indisponível", e)
        }
    }


    private fun ensureMediaSessionCompat() {
        if (mediaSessionCompat != null) return
        try {
            mediaSessionCompat = MediaSessionCompat(this, "tedflix_playback").apply {
                setFlags(
                    MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                        MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS,
                )
                setCallback(object : MediaSessionCompat.Callback() {
                    override fun onPlay() {
                        player?.play()
                        updatePlaybackNotification(player ?: return)
                    }
                    override fun onPause() {
                        player?.pause()
                        updatePlaybackNotification(player ?: return)
                    }
                    override fun onSeekTo(pos: Long) {
                        player?.seekTo(pos)
                        updatePlaybackNotification(player ?: return)
                    }
                })
                isActive = true
            }
        } catch (e: Throwable) {
            Log.w(TAG, "MediaSessionCompat indisponível", e)
        }
    }

    private fun updatePlaybackNotification(exo: ExoPlayer) {
        try {
            ensureNotificationChannel()
            val open = PendingIntent.getActivity(
                this, 0,
                intent ?: android.content.Intent(this, PlayerActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val pos = exo.currentPosition.coerceAtLeast(0L)
            val rawDur = exo.duration
            val dur = if (rawDur != C.TIME_UNSET && rawDur > 0L && rawDur < Long.MAX_VALUE / 4) rawDur else lastDuration.coerceAtLeast(0L)
            val progressText = if (dur > 0L) {
                "${formatTime(pos)} / ${formatTime(dur)}"
            } else formatTime(pos)

            // Barra 0–1000 (compatível com OEMs; evita overflow de ms longos)
            val maxBar = 1000
            val progBar = if (dur > 0L) {
                ((pos * maxBar) / dur).toInt().coerceIn(0, maxBar)
            } else 0

            val playPauseAction = if (exo.isPlaying) {
                NotificationCompat.Action(
                    android.R.drawable.ic_media_pause,
                    "Pausar",
                    open,
                )
            } else {
                NotificationCompat.Action(
                    android.R.drawable.ic_media_play,
                    "Reproduzir",
                    open,
                )
            }

            // MediaSessionCompat = barra de progresso estilo Spotify/YouTube na notificação
            ensureMediaSessionCompat()
            try {
                mediaSessionCompat?.setMetadata(
                    MediaMetadataCompat.Builder()
                        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle.ifBlank { "Tedflix" })
                        .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, currentTitle.ifBlank { "Tedflix" })
                        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "Tedflix")
                        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, if (dur > 0L) dur else -1L)
                        .build(),
                )
                val pbState = if (exo.isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
                mediaSessionCompat?.setPlaybackState(
                    PlaybackStateCompat.Builder()
                        .setActions(
                            PlaybackStateCompat.ACTION_PLAY or
                                PlaybackStateCompat.ACTION_PAUSE or
                                PlaybackStateCompat.ACTION_PLAY_PAUSE or
                                PlaybackStateCompat.ACTION_SEEK_TO or
                                PlaybackStateCompat.ACTION_STOP,
                        )
                        .setState(pbState, pos, if (exo.isPlaying) 1.0f else 0f)
                        .setBufferedPosition(pos)
                        .build(),
                )
            } catch (e: Throwable) {
                Log.w(TAG, "Falha ao atualizar MediaSessionCompat", e)
            }

            val mediaStyle = androidx.media.app.NotificationCompat.MediaStyle()
                .setShowActionsInCompactView(0)
            try {
                val token = mediaSessionCompat?.sessionToken
                if (token != null) mediaStyle.setMediaSession(token)
            } catch (_: Throwable) {
                // MediaSessionCompat já fornece o token compatível com a notificação.
            }

            val builder = NotificationCompat.Builder(this, notifChannelId)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(currentTitle.ifBlank { "Tedflix" })
                .setContentText(progressText)
                .setSubText("Tedflix")
                .setContentIntent(open)
                .setOngoing(exo.isPlaying)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setUsesChronometer(false)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setColorized(true)
                .setColor(0xFFE50914.toInt())
                .addAction(playPauseAction)
                .setStyle(mediaStyle)
                .setProgress(maxBar, progBar, false)
                .setSound(null)
                .setVibrate(null)

            val nm = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            nm.notify(notifId, builder.build())
        } catch (e: Throwable) {
            Log.w(TAG, "Falha ao atualizar notificação", e)
        }
    }

    private fun clearPlaybackNotification() {
        try {
            getSystemService(NotificationManager::class.java)?.cancel(notifId)
        } catch (_: Throwable) {}
    }

    private fun showDiagnosticScreen(
        stage: String,
        error: Throwable,
        extra: String? = null,
    ) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            runOnUiThread { showDiagnosticScreen(stage, error, extra) }
            return
        }
        if (activityDestroyed || isFinishing || isDestroyedCompat()) return
        if (downloadOnly && !downloadResolutionHandled) {
            val reason = error.message?.takeIf { it.isNotBlank() } ?: stage
            val isNotFound = reason.contains("404") || stage.contains("404", ignoreCase = true)
            finishDownloadResolutionFailure(
                if (isNotFound) "Conteúdo não encontrado (HTTP 404). Download cancelado."
                else "$reason. Download cancelado."
            )
            return
        }
        markStep("tela amigável de erro exibida: $stage")
        validationThread?.interrupt()
        validationThread = null
        player?.release()
        player = null

        val reasonText = (error.message.orEmpty() + " " + extra.orEmpty()).lowercase()
        val notFound = reasonText.contains("404") || reasonText.contains("not_found") || reasonText.contains("not found") || reasonText.contains("não encontrado") || reasonText.contains("nao encontrado")
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
        }
        val backTop = controlButton("‹", 34).apply {
            contentDescription = "Voltar"
            setOnClickListener { finish() }
        }
        root.addView(backTop, FrameLayout.LayoutParams(dp(54), dp(54)).apply {
            gravity = Gravity.TOP or Gravity.START
            topMargin = dp(14)
            leftMargin = dp(22)
        })

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(18), 0, dp(18), dp(8))
        }
        val errorMark = TextView(this).apply {
            text = if (notFound) "404" else "!"
            gravity = Gravity.CENTER
            textSize = 38f
            setTextColor(Color.rgb(245, 32, 52))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.TRANSPARENT)
                setStroke(dp(3), Color.rgb(245, 32, 52))
            }
        }
        content.addView(errorMark, LinearLayout.LayoutParams(dp(88), dp(88)).apply { bottomMargin = dp(14) })
        content.addView(TextView(this).apply {
            text = if (notFound) "Vídeo não encontrado" else "Erro ao abrir o player"
            textSize = 23f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
        content.addView(TextView(this).apply {
            text = if (notFound) "Este conteúdo não está disponível nesta fonte ou foi removido.\nVolte ao catálogo para escolher outro título." else "Não foi possível reproduzir este conteúdo.\nVerifique sua conexão com a internet e tente novamente."
            textSize = 14f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(190, 190, 196))
            setLineSpacing(0f, 1.18f)
        }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(14) })

        val notice = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(16), dp(11), dp(16), dp(11))
            background = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(18).toFloat()
                setColor(Color.rgb(20, 20, 20))
                setStroke(dp(1), Color.rgb(48, 48, 52))
            }
        }
        notice.minimumHeight = dp(94)
        notice.addView(WifiErrorIconView(this), LinearLayout.LayoutParams(dp(62), dp(70)))
        notice.addView(LinearLayout(this@PlayerActivity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, 0, 0)
            addView(TextView(this@PlayerActivity).apply {
                text = "Falha de conexão"
                textSize = 16f
                setTextColor(Color.WHITE)
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
            addView(TextView(this@PlayerActivity).apply {
                val tip = error.message?.take(120)?.trim().orEmpty()
                text = if (tip.isNotBlank()) {
                    "$tip\nEtapa: $stage"
                } else {
                    "Não foi possível conectar ao servidor.\nVerifique sua internet e tente novamente."
                }
                textSize = 13f
                setTextColor(Color.rgb(175, 175, 182))
                setLineSpacing(0f, 1.16f)
            })
        }, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(notice, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val retry = controlButton("Tentar novamente", 14).apply {
            setOnClickListener {
                activityDestroyed = false
                buildUi()
                window.decorView.post { if (isActivityAlive()) initializePlayer() }
            }
        }
        val back = controlButton("Voltar", 14).apply { setOnClickListener { finish() } }
        actions.addView(retry, LinearLayout.LayoutParams(0, dp(48), 1f))
        actions.addView(back, LinearLayout.LayoutParams(0, dp(48), 1f))
        content.addView(actions, LinearLayout.LayoutParams(-1, dp(52)))
        root.addView(content, FrameLayout.LayoutParams(-1, -2).apply {
            gravity = Gravity.CENTER
            topMargin = dp(4)
            bottomMargin = dp(4)
        })
        setContentView(root)
    }


    private fun setupPlayerGestures() {
        if (!::overlay.isInitialized) return
        val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        gestureHint = TextView(this).apply {
            visibility = View.GONE
            textSize = 18f
            setTextColor(Color.WHITE)
            setPadding(dp(20), dp(12), dp(20), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.argb(200, 0, 0, 0))
                cornerRadius = dp(12).toFloat()
            }
            gravity = Gravity.CENTER
        }
        overlay.addView(
            gestureHint,
            FrameLayout.LayoutParams(-2, -2, Gravity.CENTER),
        )

        gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                if (playerReady) toggleControls()
                return true
            }
            override fun onDoubleTap(e: MotionEvent): Boolean {
                val w = overlay.width.coerceAtLeast(1)
                if (e.x < w / 2f) {
                    seekBy(-10_000L)
                    showGestureHint("−10s")
                } else {
                    seekBy(10_000L)
                    showGestureHint("+10s")
                }
                return true
            }
            override fun onDown(e: MotionEvent): Boolean {
                gestureStartY = e.y
                gestureStartX = e.x
                gestureMode = 0
                gestureStartVolume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
                gestureStartBrightness = window.attributes.screenBrightness.let {
                    if (it < 0f) 0.5f else it
                }
                return true
            }
        })

        overlay.isClickable = true
        overlay.setOnTouchListener { _, event ->
            val gd = gestureDetector.onTouchEvent(event)
            when (event.actionMasked) {
                MotionEvent.ACTION_MOVE -> {
                    val dy = gestureStartY - event.y
                    val dx = event.x - gestureStartX
                    if (gestureMode == 0 && kotlin.math.abs(dy) > dp(24) && kotlin.math.abs(dy) > kotlin.math.abs(dx) * 1.2f) {
                        val w = overlay.width.coerceAtLeast(1)
                        gestureMode = if (event.x < w / 2f) 2 else 1 // esq brilho, dir volume
                    }
                    if (gestureMode == 1) {
                        val maxV = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                        val delta = (dy / overlay.height.coerceAtLeast(1) * maxV * 1.2f).toInt()
                        val v = (gestureStartVolume + delta).coerceIn(0, maxV)
                        audio.setStreamVolume(AudioManager.STREAM_MUSIC, v, 0)
                        showGestureHint("Volume ${((v * 100f) / maxV.coerceAtLeast(1)).toInt()}%")
                    } else if (gestureMode == 2) {
                        val delta = dy / overlay.height.coerceAtLeast(1).toFloat()
                        val b = (gestureStartBrightness + delta).coerceIn(0.01f, 1f)
                        val lp = window.attributes
                        lp.screenBrightness = b
                        window.attributes = lp
                        showGestureHint("Brilho ${(b * 100).toInt()}%")
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (gestureMode != 0) {
                        // última dica some em 0.9s (showGestureHint já agenda)
                        gestureMode = 0
                    }
                    // garante que some mesmo se não houve MOVE de volume
                    handler.removeCallbacks(hideGestureHintRunnable)
                    handler.postDelayed(hideGestureHintRunnable, 900L)
                }
            }
            // consome só se gesto de volume/brilho ou double-tap; senão filhos (botões) funcionam
            gd || gestureMode != 0
        }
    }

    private fun showGestureHint(text: String) {
        if (!::gestureHint.isInitialized) return
        handler.removeCallbacks(hideGestureHintRunnable)
        gestureHint.text = text
        gestureHint.visibility = View.VISIBLE
        gestureHint.bringToFront()
        // sempre some sozinho — evita ficar travado na tela
        handler.postDelayed(hideGestureHintRunnable, 900L)
    }

    private fun hideGestureHintNow() {
        handler.removeCallbacks(hideGestureHintRunnable)
        if (::gestureHint.isInitialized) gestureHint.visibility = View.GONE
        gestureMode = 0
    }


    private fun setControlsVisible(visible: Boolean) {
        if (!::overlay.isInitialized) return
        hideGestureHintNow()
        controlsVisible = visible
        overlay.alpha = 1f
        overlay.children().forEach { child ->
            // O loader possui ciclo próprio e não pode ser escondido quando os
            // controles são fechados antes do primeiro STATE_READY.
            when {
                child === loading || child === loadingPanel -> {
                    child.visibility = if (!playerReady || loadingPanel.visibility == View.VISIBLE) View.VISIBLE else View.GONE
                }
                child === topBar -> {
                    // Durante o loading o Voltar permanece acessível. Depois que
                    // o player está pronto, a barra segue a mesma regra dos demais
                    // controles e desaparece ao tocar em uma área vazia.
                    child.visibility = if (!playerReady || visible) View.VISIBLE else View.INVISIBLE
                }
                // Countdown do próximo ep: SOMENTE maybeAutoPlay controla (últimos 10s).
                ::nextCountdownPanel.isInitialized && child === nextCountdownPanel -> {
                    /* no-op */
                }
                // Dica de volume/brilho: some sozinha; nunca forçar VISIBLE com controles
                ::gestureHint.isInitialized && child === gestureHint -> {
                    /* no-op */
                }
                else -> child.visibility = if (visible) View.VISIBLE else View.INVISIBLE
            }
        }
        if (visible) scheduleHide()
    }

    private fun setLoadingVisible(visible: Boolean) {
        if (::loading.isInitialized) loading.visibility = if (visible) View.VISIBLE else View.GONE
        if (::loadingPanel.isInitialized) loadingPanel.visibility = if (visible) View.VISIBLE else View.GONE
    }

    private fun scheduleHide() {
        handler.removeCallbacks(hideRunnable)
        if (player?.isPlaying == true) handler.postDelayed(hideRunnable, 4_000L)
    }

    private fun toggleControls() {
        setControlsVisible(!controlsVisible)
    }

    override fun onBackPressed() {
        finish()
    }

    
    override fun finish() {
        closingPlayer = true
        try {
            if (isInPictureInPictureMode) {
                // fecha o mini player ao sair de verdade
            }
        } catch (_: Exception) {}
        super.finish()
    }

override fun onDestroy() {
        savePlaybackProgress()
        mediaSession?.release()
        mediaSession = null
        try { mediaSessionCompat?.release() } catch (_: Throwable) {}
        mediaSessionCompat = null
        clearPlaybackNotification()

        activityDestroyed = true
        validationThread?.interrupt()
        validationThread = null
        handler.removeCallbacks(progressRunnable)
        handler.removeCallbacks(hideRunnable)
        if (::playerView.isInitialized) playerView.player = null
        player?.release()
        player = null
        super.onDestroy()
    }

    private fun controlButton(textValue: String, size: Int) = Button(this).apply {
        text = textValue
        textSize = size.toFloat()
        setTextColor(Color.WHITE)
        setAllCaps(false)
        setPadding(0, 0, 0, 0)
        background = android.graphics.drawable.ColorDrawable(Color.TRANSPARENT)
    }

    private fun roundButton(textValue: String, size: Int) = controlButton(textValue, size)

    private fun timeText(textValue: String) = TextView(this).apply {
        text = textValue
        textSize = 14f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
    }

    private fun centeredParams(width: Int, height: Int) = FrameLayout.LayoutParams(dp(width), dp(height), Gravity.CENTER)

    private fun bufferMin(buffer: String?) = when (buffer) {
        "economico" -> 15_000
        "generoso" -> 90_000
        else -> 30_000
    }

    private fun bufferMax(buffer: String?) = when (buffer) {
        "economico" -> 30_000
        "generoso" -> 180_000
        else -> 60_000
    }

    private fun formatTime(milliseconds: Long): String {
        val totalSeconds = (milliseconds / 1000L).coerceAtLeast(0L)
        val hours = totalSeconds / 3600L
        val minutes = (totalSeconds % 3600L) / 60L
        val seconds = totalSeconds % 60L
        return if (hours > 0) String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
        else String.format(Locale.US, "%d:%02d", minutes, seconds)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    private fun gradient(color: Int, tl: Float, tr: Float, br: Float, bl: Float) =
        android.graphics.drawable.GradientDrawable().apply {
            setColor(color)
            cornerRadii = floatArrayOf(dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat())
        }

    private fun toast(message: String) {
        if (!isFinishing && !isDestroyedCompat()) {
            Toast.makeText(applicationContext, message, Toast.LENGTH_LONG).show()
        }
    }

    private fun isDestroyedCompat(): Boolean = android.os.Build.VERSION.SDK_INT >= 17 && isDestroyed
}

private fun FrameLayout.children(): Sequence<View> = sequence {
    for (index in 0 until childCount) yield(getChildAt(index))
}
