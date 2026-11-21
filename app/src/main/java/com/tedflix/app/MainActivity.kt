package com.tedflix.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ArrayAdapter
import android.widget.AdapterView
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.media3.common.util.UnstableApi
import com.tedflix.app.auth.AuthActivity
import org.json.JSONObject
import com.tedflix.app.auth.AuthSession
import com.tedflix.app.auth.FavoritesActivity
import com.tedflix.app.ui.TedflixDialogs
import java.net.HttpURLConnection
import java.net.URL

@UnstableApi
class MainActivity : Activity() {
    companion object {
        const val EXTRA_OPEN_FAVORITE_TITLE = "open_favorite_title"
        const val EXTRA_OPEN_FAVORITE_CATEGORY = "open_favorite_category"
        const val EXTRA_OPEN_FAVORITE_SLUG = "open_favorite_slug"
        const val EXTRA_OPEN_FAVORITE_TYPE = "open_favorite_type"
        const val EXTRA_OPEN_DOWNLOADS = "open_downloads"
        private const val PROFILE_PREFS = "tedflix_local_profiles"
        private val DEFAULT_AVATAR_SEEDS = listOf(
            "tedflix-avatar-01", "tedflix-avatar-02", "tedflix-avatar-03",
            "tedflix-avatar-04", "tedflix-avatar-05", "tedflix-avatar-06",
            "tedflix-avatar-07", "tedflix-avatar-08", "tedflix-avatar-09",
            "tedflix-avatar-10", "tedflix-avatar-11", "tedflix-avatar-12",
            "tedflix-avatar-13", "tedflix-avatar-14", "tedflix-avatar-15",
        )
    }

    private data class LocalProfile(
        val id: String,
        val name: String,
        val avatarSeed: String,
        val avatarStyle: String = "fun-emoji",
        val username: String = "",
        val isKids: Boolean = false,
    )

    private lateinit var webView: WebView
    private var manageProfilesDialog: AlertDialog? = null
    private var playerWasOpened = false
    private var pendingDownloadQueueResumeChecked = false
    @Volatile private var authRedirectInProgress = false
    @Volatile private var historyRefreshInFlight = false
    @Volatile private var remoteHistoryProfileId = ""
    @Volatile private var remoteHistoryCache: List<AuthSession.HistoryItem> = emptyList()
    @Volatile private var favoriteCache: List<AuthSession.Favorite> = emptyList()
    @Volatile private var favoriteCount = 0
    @Volatile private var searchHistoryRequestInFlight = false
    @Volatile private var searchHistoryRequestProfileId = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(5, 6, 9)
        window.navigationBarColor = Color.rgb(5, 6, 9)
        AuthSession.init(applicationContext)
        // O token corrente pode ter sido perdido sem que os perfis locais tenham
        // sido removidos. Restaure o perfil ativo antes de abrir o seletor/WebView.
        AuthSession.restoreActiveProfileIfNeeded()

        val previousCrash = TedflixApplication.consumeLastCrash(this)
        if (!previousCrash.isNullOrBlank()) {
            showCrashRecovery(previousCrash)
            return
        }
        if (AuthSession.hasToken() || AuthSession.hasLocalProfiles()) {
            // Abre com os perfis locais imediatamente. A rede atualiza os dados
            // depois, sem bloquear a primeira tela nem impedir o modo offline.
            if (AuthSession.hasLocalProfiles()) {
                showProfileChooser()
                if (AuthSession.hasToken()) Thread {
                    try { AuthSession.ensureFreshToken() } catch (_: Throwable) {}
                    try { AuthSession.refreshAccount() } catch (_: Throwable) {}
                    val refreshed = AuthSession.refreshProfiles()
                    if (refreshed.statusCode == 401) {
                        val renewed = AuthSession.refreshSession()
                        if (renewed.ok) {
                            try { AuthSession.refreshAccount() } catch (_: Throwable) {}
                            AuthSession.refreshProfiles()
                        }
                    }
                }.apply { name = "TedflixBackgroundProfileSync"; start() }
            } else {
                setContentView(TedflixLoading.create(this))
                Thread {
                    val result = AuthSession.refreshProfiles()
                    runOnUiThread {
                        if (result.ok) showProfileChooser()
                        else startActivity(Intent(this, AuthActivity::class.java)).also { finish() }
                    }
                }.apply { name = "TedflixInitialProfileSync"; start() }
            }
        } else {
            startActivity(Intent(this, AuthActivity::class.java))
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
            finish()
        }
    }

    fun ensureDownloadNotificationPermission() {
        if (android.os.Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 8821)
        }
    }

    private fun showProfileLoadError(message: String) {
        TedflixDialogs.confirm(
            activity = this,
            title = "Não foi possível carregar os perfis",
            message = message,
            icon = "error",
            confirmText = "Tentar novamente",
            cancelText = "Sair",
            tone = "warning",
            onConfirm = { recreate() },
            onCancel = {
                AuthSession.clear()
                startActivity(Intent(this, AuthActivity::class.java))
                finish()
            },
        )
    }

    private fun refreshHeaderBadges() {
        // A tela de seleção ainda não possui perfil ativo; não consulte
        // /profiles/:id/favorites nesse momento, pois isso gera o falso aviso
        // de conexão mostrado sobre o seletor de perfis.
        if (!AuthSession.hasToken() || AuthSession.activeProfileId().isBlank()) return
        Thread {
            val favorites = AuthSession.listFavorites()
            if (favorites.ok) favoriteCache = favorites.value.orEmpty()
            favoriteCount = favoriteCache.size
            publishBadgeCounts()
        }.apply { name = "TedflixHeaderBadges"; start() }
    }

    private fun publishBadgeCounts() {
        if (!::webView.isInitialized || isFinishing || isDestroyed) return
        val favorites = favoriteCount.coerceAtLeast(0)
        webView.post {
            if (isFinishing || isDestroyed) return@post
            webView.evaluateJavascript(
                """(() => {
                    const applyBadge = (id, value) => {
                        const badge = document.getElementById(id);
                        if (!badge) return;
                        const count = Number(value) || 0;
                        badge.textContent = count > 99 ? '99+' : String(count);
                        badge.classList.toggle('visible', count > 0);
                        badge.setAttribute('aria-hidden', count > 0 ? 'false' : 'true');
                    };
                    applyBadge('fav-badge', $favorites);
                })();""".trimIndent(),
                null,
            )
        }
    }

    private fun showProfileChooser() {
        val profiles = loadProfiles()
        val selectedId = AuthSession.activeProfileId().ifBlank { profiles.firstOrNull()?.id.orEmpty() }
        val screenHeight = resources.displayMetrics.heightPixels
        val screenWidthDp = resources.displayMetrics.widthPixels / resources.displayMetrics.density

        val root = android.widget.FrameLayout(this).apply {
            setBackgroundColor(Color.rgb(5, 5, 7))
        }

        // Reaproveita o banner original do TEDFLIX: a mudança é somente de composição.
        val bannerHeight = (screenHeight * 0.68f).toInt()
        val banner = ImageView(this).apply {
            setImageResource(R.drawable.tedflix_auth_banner)
            scaleType = ImageView.ScaleType.CENTER_CROP
            contentDescription = "Banner do TEDFLIX"
        }
        root.addView(banner, android.widget.FrameLayout.LayoutParams(-1, bannerHeight, Gravity.TOP))

        val bannerShade = View(this).apply {
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(
                    Color.argb(20, 0, 0, 0),
                    Color.argb(95, 0, 0, 0),
                    Color.argb(230, 5, 5, 7),
                ),
            )
        }
        root.addView(bannerShade, android.widget.FrameLayout.LayoutParams(-1, bannerHeight, Gravity.TOP))

        // Marca centralizada na área da arte, mantendo o logo original do app.
        val logo = TextView(this).apply {
            text = "TEDFLIX"
            textSize = 27f
            setTextColor(Color.rgb(229, 9, 20))
            gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            letterSpacing = 0.08f
            setShadowLayer(dp(8).toFloat(), 0f, dp(2).toFloat(), Color.BLACK)
        }
        root.addView(
            logo,
            android.widget.FrameLayout.LayoutParams(-1, dp(54), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply {
                topMargin = dp(18)
            },
        )

        // Painel inferior com bordas superiores arredondadas, como na referência.
        val panel = android.widget.FrameLayout(this).apply {
            background = GradientDrawable().apply {
                cornerRadii = floatArrayOf(
                    dp(30).toFloat(), dp(30).toFloat(),
                    dp(30).toFloat(), dp(30).toFloat(),
                    0f, 0f, 0f, 0f,
                )
                setColor(Color.parseColor("#000000"))
                setStroke(dp(1), Color.argb(42, 255, 255, 255))
            }
            elevation = dp(8).toFloat()
        }
        val panelHeight = (screenHeight * 0.58f).toInt()
        val panelParams = android.widget.FrameLayout.LayoutParams(-1, panelHeight, Gravity.BOTTOM)
        root.addView(panel, panelParams)

        val scroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_NEVER
            clipToPadding = false
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(32), dp(24), dp(36))
        }
        content.addView(TextView(this).apply {
            text = "Quem está assistindo?"
            textSize = 23f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(7) })
        content.addView(TextView(this).apply {
            text = "Escolha seu perfil para continuar"
            textSize = 13f
            setTextColor(Color.rgb(172, 172, 178))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(22) })

        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val perRow = if (screenWidthDp >= 600f) 3 else 2
        profiles.chunked(perRow).forEach { rowProfiles ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
            }
            rowProfiles.forEach { profile ->
                row.addView(
                    createProfileTile(profile, profile.id == selectedId) {
                        selectProfileAndOpen(root, content, profile)
                    },
                    LinearLayout.LayoutParams(dp(118), -2).apply {
                        leftMargin = dp(6)
                        rightMargin = dp(6)
                        bottomMargin = dp(16)
                    },
                )
            }
            grid.addView(row, LinearLayout.LayoutParams(-1, -2))
        }

        val addTile = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isClickable = true
            isFocusable = true
            setOnClickListener { showAddProfileDialog() }
        }
        val addBox = TextView(this).apply {
            text = "+"
            textSize = 35f
            gravity = Gravity.CENTER
            setTextColor(Color.rgb(160, 160, 166))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.rgb(30, 31, 35))
                setStroke(dp(1), Color.rgb(83, 84, 90))
            }
        }
        addTile.addView(addBox, LinearLayout.LayoutParams(dp(100), dp(100)))
        addTile.addView(TextView(this).apply {
            text = "Adicionar perfil"
            textSize = 13f
            setTextColor(Color.rgb(174, 174, 180))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })

        if (profiles.isEmpty()) {
            grid.addView(addTile, LinearLayout.LayoutParams(dp(118), -2))
        } else {
            val lastRow = grid.getChildAt(grid.childCount - 1) as? LinearLayout
            if (lastRow != null && lastRow.childCount < perRow) {
                lastRow.addView(addTile, LinearLayout.LayoutParams(dp(118), -2).apply {
                    leftMargin = dp(6)
                    rightMargin = dp(6)
                    bottomMargin = dp(16)
                })
            } else {
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER
                }
                row.addView(addTile, LinearLayout.LayoutParams(dp(118), -2).apply {
                    leftMargin = dp(6)
                    rightMargin = dp(6)
                    bottomMargin = dp(16)
                })
                grid.addView(row, LinearLayout.LayoutParams(-1, -2))
            }
        }
        content.addView(grid, LinearLayout.LayoutParams(-1, -2))

        content.addView(TextView(this).apply {
            text = "Gerenciar perfis"
            textSize = 14f
            setTextColor(Color.rgb(220, 220, 224))
            gravity = Gravity.CENTER
            setPadding(dp(22), dp(12), dp(22), dp(12))
            background = GradientDrawable().apply {
                setColor(Color.TRANSPARENT)
                setStroke(dp(1), Color.rgb(83, 84, 90))
                cornerRadius = dp(5).toFloat()
            }
            isClickable = true
            isFocusable = true
            setOnClickListener { showManageProfilesDialog() }
        }, LinearLayout.LayoutParams(-2, -2).apply {
            topMargin = dp(18)
            gravity = Gravity.CENTER_HORIZONTAL
        })

        val entryLoader = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            visibility = View.GONE
            tag = "entry_loader"
        }
        entryLoader.addView(ProgressBar(this).apply {
            indeterminateTintList = android.content.res.ColorStateList.valueOf(Color.rgb(229, 9, 20))
        }, LinearLayout.LayoutParams(dp(32), dp(32)).apply { topMargin = dp(16) })
        entryLoader.addView(TextView(this).apply {
            text = "Entrando…"
            textSize = 13f
            setTextColor(Color.rgb(200, 200, 200))
            gravity = Gravity.CENTER
        }, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(7) })
        content.addView(entryLoader, LinearLayout.LayoutParams(-1, -2))

        scroll.addView(content)
        panel.addView(scroll, android.widget.FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
    }

    private fun createProfileTile(profile: LocalProfile, selected: Boolean, onClick: () -> Unit): View {
        val cell = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
            tag = "profile_${profile.id}"
        }
        val size = dp(108)
        val frame = android.widget.FrameLayout(this)
        val avatar = ImageView(this).apply {
            tag = profile.avatarSeed
            scaleType = ImageView.ScaleType.CENTER_CROP
            contentDescription = profile.name
            clipToOutline = true
            outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(view: View, outline: android.graphics.Outline) {
                    outline.setOval(0, 0, view.width, view.height)
                }
            }
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.rgb(45, 45, 45))
            }
        }
        frame.addView(avatar, android.widget.FrameLayout.LayoutParams(size, size, Gravity.CENTER))
        // Borda circular com glow vermelho no perfil selecionado (estilo Netflix / referência)
        if (selected) {
            frame.foreground = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.TRANSPARENT)
                setStroke(dp(3), Color.rgb(229, 9, 20))
            }
            // leve “glow” via elevation no frame
            frame.elevation = dp(6).toFloat()
        }
        cell.addView(frame, LinearLayout.LayoutParams(size, size).apply { topMargin = dp(4) })
        cell.addView(TextView(this).apply {
            text = profile.name
            textSize = 13f
            setTextColor(if (selected) Color.WHITE else Color.rgb(170, 170, 170))
            gravity = Gravity.CENTER
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        if (profile.isKids) {
            cell.addView(TextView(this).apply {
                text = "Infantil"
                textSize = 10f
                setTextColor(Color.WHITE)
                setPadding(dp(6), dp(2), dp(6), dp(2))
                background = GradientDrawable().apply {
                    setColor(Color.rgb(229, 9, 20))
                    cornerRadius = dp(3).toFloat()
                }
            }, LinearLayout.LayoutParams(-2, -2).apply {
                topMargin = dp(4)
                gravity = Gravity.CENTER_HORIZONTAL
            })
        }
        loadDiceBearAvatar(avatar, profile.avatarSeed, profile.avatarStyle)
        return cell
    }

    private fun selectProfileAndOpen(root: android.widget.FrameLayout, content: LinearLayout, profile: LocalProfile) {
        val activated = AuthSession.activateProfileOffline(profile.id)
        if (!activated.ok) {
            TedflixDialogs.error(this, "Não foi possível selecionar o perfil", activated.message.ifBlank { "Tente novamente." })
            return
        }
        refreshHeaderBadges()
        getSharedPreferences(PROFILE_PREFS, Context.MODE_PRIVATE).edit()
            .putString("selected_profile_id", profile.id).apply()

        // Destaca o perfil escolhido e mostra loader abaixo (estilo Netflix)
        for (i in 0 until content.childCount) {
            val child = content.getChildAt(i)
            if (child is LinearLayout && child.tag == "entry_loader") {
                child.visibility = View.VISIBLE
            }
        }
        // Desabilita cliques nos perfis
        content.isEnabled = false
        root.isClickable = true

        root.postDelayed({ setupWebView() }, 280L)
    }

    private fun hasNetworkConnection(): Boolean {
        val connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
            ?: return false
        val network = connectivity.activeNetwork ?: return false
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    private fun loadProfiles(): MutableList<LocalProfile> {
        val accountName = AuthSession.cachedUser()?.username.orEmpty()
        AuthSession.ensureCurrentProfile(accountName, DEFAULT_AVATAR_SEEDS.first())
        return AuthSession.profiles().map { profile ->
            LocalProfile(profile.id, profile.name, profile.avatarSeed, profile.avatarStyle, profile.username, profile.isKids)
        }.toMutableList()
    }

    private fun updateProfile(profile: LocalProfile, name: String = profile.name, avatarSeed: String = profile.avatarSeed) {
        AuthSession.updateProfile(profile.id, name, avatarSeed)
    }

    private fun avatarUrl(seed: String, style: String = "fun-emoji"): String = "https://api.dicebear.com/9.x/${Uri.encode(style)}/png?seed=${Uri.encode(seed)}&size=256"

    private fun loadDiceBearAvatar(image: ImageView, seed: String, style: String = "fun-emoji") {
        Thread {
            try {
                val connection = URL(avatarUrl(seed, style)).openConnection() as HttpURLConnection
                connection.connectTimeout = 8_000; connection.readTimeout = 8_000; connection.instanceFollowRedirects = true
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Tedflix/1.0")
                connection.setRequestProperty("Accept", "image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
                val bitmap = if (connection.responseCode in 200..299) {
                    connection.inputStream.use { BitmapFactory.decodeStream(it) }
                } else null
                connection.disconnect()
                if (bitmap != null) runOnUiThread { if (image.tag == seed) image.setImageBitmap(bitmap) }
            } catch (error: Throwable) { Log.w("TedflixProfiles", "Falha ao carregar avatar DiceBear $seed", error) }
        }.apply { name = "TedflixAvatar-$seed"; start() }
    }

    private fun showAddProfileDialog() {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(24), dp(8), dp(24), 0) }
        val selectedSeed = arrayOf(DEFAULT_AVATAR_SEEDS[loadProfiles().size % DEFAULT_AVATAR_SEEDS.size])
        val selectedStyle = arrayOf("fun-emoji")
        val preview = ImageView(this).apply {
            tag = selectedSeed[0]
            scaleType = ImageView.ScaleType.FIT_CENTER
            clipToOutline = true
            outlineProvider = ViewOutlineProvider.BACKGROUND
            setPadding(dp(4), dp(4), dp(4), dp(4))
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.rgb(24, 26, 34))
                setStroke(dp(1), Color.rgb(70, 73, 84))
            }
        }
        panel.addView(preview, LinearLayout.LayoutParams(dp(96), dp(96)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(8) })
        loadDiceBearAvatar(preview, selectedSeed[0])
        panel.addView(Button(this).apply {
            text = "Escolher outro avatar"; setAllCaps(false)
            setOnClickListener { showAvatarPicker(selectedSeed[0]) { seed -> selectedSeed[0] = seed; loadDiceBearAvatar(preview, seed, selectedStyle[0]) } }
        }, LinearLayout.LayoutParams(-1, dp(46)))
        val nameInput = EditText(this).apply { hint = "Nome do perfil"; setSingleLine(true) }
        panel.addView(nameInput, LinearLayout.LayoutParams(-1, dp(54)).apply { topMargin = dp(8) })
        val usernameInput = EditText(this).apply { hint = "Username (opcional)"; setSingleLine(true) }
        panel.addView(usernameInput, LinearLayout.LayoutParams(-1, dp(54)))
        val styleSpinner = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("fun-emoji", "clay", "adventurer-neutral")); onItemSelectedListener = object : AdapterView.OnItemSelectedListener { override fun onNothingSelected(parent: AdapterView<*>?) = Unit; override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { selectedStyle[0] = parent?.getItemAtPosition(position)?.toString().orEmpty().ifBlank { "fun-emoji" }; loadDiceBearAvatar(preview, selectedSeed[0], selectedStyle[0]) } } }
        panel.addView(styleSpinner, LinearLayout.LayoutParams(-1, dp(52)))
        val kidsSwitch = Switch(this).apply { text = "Perfil infantil"; setTextColor(Color.WHITE); isChecked = false }
        panel.addView(kidsSwitch, LinearLayout.LayoutParams(-1, dp(52)))
        val dialog = AlertDialog.Builder(this, R.style.TedflixDialog).setTitle("Criar perfil").setView(ScrollView(this).apply { addView(panel) }).setNegativeButton("Cancelar", null).setPositiveButton("Criar perfil", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val name = nameInput.text.toString().trim()
                when {
                    name.isBlank() -> nameInput.error = "Informe um nome"
                    else -> {
                        val action = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                        action.isEnabled = false
                        action.text = "Criando..."
                        Thread {
                            val result = AuthSession.createRemoteProfile(name, kidsSwitch.isChecked, selectedStyle[0], selectedSeed[0], usernameInput.text.toString().trim())
                            runOnUiThread {
                                if (result.ok) {
                                    dialog.dismiss()
                                    showProfileChooser()
                                    TedflixDialogs.notice(this, "Perfil adicionado", "Selecione o novo perfil para entrar.", icon = "success", tone = "success")
                                } else {
                                    action.isEnabled = true
                                    action.text = "Validar e adicionar"
                                    TedflixDialogs.error(this, "Não foi possível criar o perfil", result.message.ifBlank { "Tente novamente." })
                                }
                            }
                        }.apply { this.name = "TedflixCreateProfile"; start() }
                    }
                }
            }
        }
        dialog.show()
    }

    private fun showAvatarPicker(currentSeed: String, onPick: (String) -> Unit) {
        val grid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), 0, dp(18), 0) }
        var picker: AlertDialog? = null
        DEFAULT_AVATAR_SEEDS.chunked(4).forEach { seeds ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
            seeds.forEach { seed ->
                val avatar = ImageView(this).apply {
                    tag = seed
                    scaleType = ImageView.ScaleType.FIT_CENTER
                    clipToOutline = true
                    outlineProvider = ViewOutlineProvider.BACKGROUND
                    setPadding(dp(4), dp(4), dp(4), dp(4))
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(Color.rgb(24, 26, 34))
                        setStroke(if (seed == currentSeed) dp(3) else dp(1), if (seed == currentSeed) Color.rgb(229, 9, 20) else Color.rgb(70, 73, 84))
                    }
                    setOnClickListener { onPick(seed); picker?.dismiss() }
                }
                loadDiceBearAvatar(avatar, seed)
                row.addView(avatar, LinearLayout.LayoutParams(dp(68), dp(68)).apply { leftMargin = dp(5); rightMargin = dp(5); bottomMargin = dp(10) })
            }
            grid.addView(row)
        }
        picker = AlertDialog.Builder(this, R.style.TedflixDialog).setTitle("Escolha seu avatar").setView(ScrollView(this).apply { addView(grid) }).setNegativeButton("Cancelar", null).create()
        picker.show()
    }

    private fun showManageProfilesDialog() {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), 0, dp(16), 0) }
        val profiles = loadProfiles()
        profiles.forEach { profile ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(6), 0, dp(6)) }
            val avatar = ImageView(this).apply {
                tag = profile.avatarSeed
                scaleType = ImageView.ScaleType.FIT_CENTER
                clipToOutline = true
                outlineProvider = ViewOutlineProvider.BACKGROUND
                setPadding(dp(3), dp(3), dp(3), dp(3))
                background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.rgb(24, 26, 34)) }
            }
            loadDiceBearAvatar(avatar, profile.avatarSeed)
            row.addView(avatar, LinearLayout.LayoutParams(dp(54), dp(54)))
            row.addView(TextView(this).apply { text = profile.name; textSize = 15f; setTextColor(Color.WHITE); setPadding(dp(10), 0, dp(4), 0) }, LinearLayout.LayoutParams(0, -2, 1f))
            row.addView(Button(this).apply { text = "Editar"; setAllCaps(false); setOnClickListener { manageProfilesDialog?.dismiss(); showEditProfileDialog(profile) } }, LinearLayout.LayoutParams(dp(76), dp(44)))
            if (profiles.size > 1) row.addView(Button(this).apply { text = "Excluir"; setAllCaps(false); setOnClickListener { confirmDeleteProfile(profile) } }, LinearLayout.LayoutParams(dp(82), dp(44)))
            panel.addView(row)
        }
        manageProfilesDialog = AlertDialog.Builder(this, R.style.TedflixDialog)
            .setTitle("Gerenciar perfis")
            .setView(ScrollView(this).apply { addView(panel) })
            .setNegativeButton("Fechar", null)
            .setPositiveButton("Adicionar perfil") { _, _ -> showAddProfileDialog() }
            .show()
    }

    private fun showEditProfileDialog(profile: LocalProfile) {
        val panel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), 0, dp(22), 0) }
        val nameInput = EditText(this).apply { setSingleLine(true); setText(profile.name); hint = "Nome do perfil" }
        val usernameInput = EditText(this).apply { setSingleLine(true); setText(profile.username); hint = "Username (opcional)" }
        val styleSpinner = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, listOf("fun-emoji", "clay", "adventurer-neutral")); setSelection(listOf("fun-emoji", "clay", "adventurer-neutral").indexOf(profile.avatarStyle).coerceAtLeast(0)) }
        val kidsSwitch = Switch(this).apply { text = "Perfil infantil"; setTextColor(Color.WHITE); isChecked = profile.isKids }
        panel.addView(nameInput, LinearLayout.LayoutParams(-1, dp(54)))
        panel.addView(usernameInput, LinearLayout.LayoutParams(-1, dp(54)))
        panel.addView(styleSpinner, LinearLayout.LayoutParams(-1, dp(52)))
        panel.addView(kidsSwitch, LinearLayout.LayoutParams(-1, dp(52)))
        AlertDialog.Builder(this, R.style.TedflixDialog).setTitle("Editar perfil").setView(panel).setNegativeButton("Cancelar", null).setPositiveButton("Salvar") { _, _ ->
            val name = nameInput.text.toString().trim().ifBlank { profile.name }
            val style = styleSpinner.selectedItem?.toString().orEmpty().ifBlank { profile.avatarStyle }
            val result = AuthSession.updateProfileFull(profile.id, name, usernameInput.text.toString().trim(), style, profile.avatarSeed, kidsSwitch.isChecked)
            if (!result.ok) TedflixDialogs.error(this, "Não foi possível atualizar o perfil", result.message.ifBlank { "Tente novamente." })
            else TedflixDialogs.notice(this, "Perfil atualizado", "As alterações do perfil foram salvas.", icon = "success", tone = "success")
            showProfileChooser()
        }.setNeutralButton("Alterar avatar") { _, _ -> showAvatarPicker(profile.avatarSeed) { seed ->
            updateProfile(profile, avatarSeed = seed)
            showProfileChooser()
        } }.show()
    }

    private fun confirmDeleteProfile(profile: LocalProfile) {
        manageProfilesDialog?.dismiss()
        manageProfilesDialog = null
        val profiles = loadProfiles()
        if (profiles.size <= 1) {
            TedflixDialogs.notice(this, "Não é possível excluir", "O último perfil da conta não pode ser removido.", icon = "warning", tone = "warning") {
                showManageProfilesDialog()
            }
            return
        }
        TedflixDialogs.confirm(
            activity = this,
            title = "Excluir perfil?",
            message = "Deseja excluir o perfil “${profile.name}”? Esta ação não pode ser desfeita.",
            icon = "trash",
            confirmText = "Excluir",
            cancelText = "Cancelar",
            onConfirm = {
                if (AuthSession.deleteProfile(profile.id)) {
                    val remaining = loadProfiles()
                    getSharedPreferences(PROFILE_PREFS, Context.MODE_PRIVATE).edit()
                        .putString("selected_profile_id", AuthSession.activeProfileId().ifBlank { remaining.firstOrNull()?.id.orEmpty() }).apply()
                    TedflixDialogs.notice(this, "Perfil excluído", "O perfil “${profile.name}” foi removido.", icon = "success", tone = "success") {
                        showManageProfilesDialog()
                    }
                } else {
                    TedflixDialogs.error(this, "Falha ao excluir perfil", "Não foi possível excluir o perfil. Tente novamente.") {
                        showManageProfilesDialog()
                    }
                }
            },
            onCancel = { showManageProfilesDialog() },
        )
    }

    private fun currentProfileName(): String {
        val activeId = AuthSession.activeProfileId()
        return AuthSession.profiles().firstOrNull { it.id == activeId }?.name
            ?: AuthSession.cachedUser()?.username?.ifBlank { "Meu perfil" }
            ?: "Meu perfil"
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(5, 6, 9))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.blockNetworkImage = false
            // A interface é de aplicativo: não permitir pinch-to-zoom nem
            // os controles de escala do WebView.
            @Suppress("DEPRECATION")
            settings.setSupportZoom(false)
            @Suppress("DEPRECATION")
            settings.builtInZoomControls = false
            @Suppress("DEPRECATION")
            settings.displayZoomControls = false
            @Suppress("DEPRECATION")
            settings.useWideViewPort = false
            @Suppress("DEPRECATION")
            settings.loadWithOverviewMode = false
            settings.textZoom = 100
            @Suppress("DEPRECATION")
            // O HTML e os assets são empacotados no APK; o modo padrão evita
            // recarregar tudo a cada retorno sem afetar as requisições /api.
            settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            @Suppress("DEPRECATION")
            settings.allowUniversalAccessFromFileURLs = true
            webChromeClient = object : WebChromeClient() {
                // Fallback de segurança: nenhum alerta padrão do navegador deve
                // expor o cabeçalho "A página em file:// diz" no aplicativo.
                override fun onJsAlert(
                    view: WebView?,
                    url: String?,
                    message: String?,
                    result: android.webkit.JsResult,
                ): Boolean {
                    if (isFinishing || isDestroyed) {
                        result.cancel()
                        return true
                    }
                    TedflixDialogs.notice(
                        this@MainActivity,
                        "Aviso",
                        message.orEmpty(),
                        icon = "info",
                        tone = "info",
                        buttonText = "Entendi",
                        onDismiss = { result.confirm() },
                    )
                    return true
                }

                override fun onJsConfirm(
                    view: WebView?,
                    url: String?,
                    message: String?,
                    result: android.webkit.JsResult,
                ): Boolean {
                    if (isFinishing || isDestroyed) {
                        result.cancel()
                        return true
                    }
                    TedflixDialogs.confirm(
                        activity = this@MainActivity,
                        title = "Confirmar ação?",
                        message = message.orEmpty(),
                        icon = "warning",
                        confirmText = "Confirmar",
                        cancelText = "Cancelar",
                        onConfirm = { result.confirm() },
                        onCancel = { result.cancel() },
                    )
                    return true
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return request.url.toString().startsWith("file:///android_asset/").not()
                }

                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): android.webkit.WebResourceResponse? {
                    // WebView/Android falha de forma seletiva ao buscar alguns
                    // WebP longos do CDN. Baixar pelo Android com User-Agent e
                    // Referer corretos elimina capas quebradas sem alterar a API.
                    val image = AuthSession.proxyExternalImageRequest(request)
                    if (image != null) return image
                    val response = AuthSession.proxyMovieRequest(request)
                    // Não transformar uma falha de autorização do servidor de filmes
                    // em logout automático. O token pode continuar válido no auth;
                    // o fetch do WebView recebe o status e a tela mostra o erro real.
                    return if (response != null) AuthSession.toWebResourceResponse(response)
                    else super.shouldInterceptRequest(view, request)
                }

                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    publishBadgeCounts()
                }
            }
            addJavascriptInterface(AndroidPlayerBridge(this@MainActivity), "AndroidPlayer")
            loadUrl("file:///android_asset/tedflix/index.html${routeFromIntent(intent)}")
        }
        // Status bar color only — o HTML controla o espaçamento da topbar (evita "buraco" duplo)
        setContentView(webView)
        if (!pendingDownloadQueueResumeChecked && AuthSession.hasToken()) {
            pendingDownloadQueueResumeChecked = true
            webView.post {
                try {
                    com.tedflix.app.downloads.DownloadRepository.resumePendingQueue(this)
                } catch (error: Throwable) {
                    Log.w("TedflixDownload", "Não foi possível retomar a fila de episódios", error)
                }
            }
        }
    }

    private fun routeFromIntent(sourceIntent: Intent): String {
        val favoriteTitle = sourceIntent.getStringExtra(EXTRA_OPEN_FAVORITE_TITLE).orEmpty().trim()
        val favoriteCategory = sourceIntent.getStringExtra(EXTRA_OPEN_FAVORITE_CATEGORY).orEmpty().trim()
        val favoriteSlug = sourceIntent.getStringExtra(EXTRA_OPEN_FAVORITE_SLUG).orEmpty().trim()
        val favoriteType = sourceIntent.getStringExtra(EXTRA_OPEN_FAVORITE_TYPE).orEmpty().lowercase().let {
            if (it.contains("séri") || it.contains("serie")) "serie" else "filme"
        }
        return when {
            sourceIntent.getBooleanExtra(EXTRA_OPEN_DOWNLOADS, false) -> "#/config?secao=downloads"
            favoriteCategory.isNotBlank() && favoriteSlug.isNotBlank() ->
                "#/titulo/$favoriteType/${Uri.encode(favoriteCategory)}/${Uri.encode(favoriteSlug)}"
            favoriteTitle.isNotBlank() -> "#/favorito?titulo=${Uri.encode(favoriteTitle)}"
            else -> ""
        }
    }

    private fun loadRouteFromIntent(sourceIntent: Intent) {
        webView.loadUrl("file:///android_asset/tedflix/index.html${routeFromIntent(sourceIntent)}")
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        if (intent == null) return
        setIntent(intent)
        if (!::webView.isInitialized) {
            setupWebView()
            return
        }
        webView.post { loadRouteFromIntent(intent) }
    }

    private fun handleSessionExpired() {
        if (authRedirectInProgress) return
        authRedirectInProgress = true
        runOnUiThread {
            AuthSession.clear()
            TedflixDialogs.notice(
                this,
                "Sessão expirada",
                "Sua sessão expirou. Entre novamente para continuar usando o TEDFLIX.",
                icon = "warning",
                tone = "warning",
            ) { openLogin() }
        }
    }

    private fun openLogin() {
        startActivity(Intent(this, AuthActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
        })
        finish()
    }

    private fun showCrashRecovery(report: String) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
            setBackgroundColor(Color.BLACK)
        }
        val title = TextView(this).apply {
            text = "Tedflix capturou um erro"
            textSize = 22f
            setTextColor(Color.WHITE)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        root.addView(title, LinearLayout.LayoutParams(-1, -2))
        val explanation = TextView(this).apply {
            text = "O erro abaixo foi salvo antes do encerramento. Envie esta tela para identificar a causa exata."
            textSize = 14f
            setTextColor(Color.LTGRAY)
            setPadding(0, dp(12), 0, dp(12))
        }
        root.addView(explanation, LinearLayout.LayoutParams(-1, -2))
        val details = TextView(this).apply {
            text = report
            textSize = 12f
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.MONOSPACE
            setTextIsSelectable(true)
            setPadding(0, dp(8), 0, dp(16))
        }
        root.addView(ScrollView(this).apply {
            isFillViewport = true
            addView(details)
        }, LinearLayout.LayoutParams(-1, 0, 1f))
        val continueButton = Button(this).apply {
            text = "Continuar para o Tedflix"
            setAllCaps(false)
            setOnClickListener { setupWebView() }
        }
        root.addView(continueButton, LinearLayout.LayoutParams(-1, dp(54)))
        setContentView(root)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onResume() {
        // Renova access token se necessário (login.tedflix.site /api/auth/refresh)
        if (AuthSession.hasToken()) {
            Thread {
                try { AuthSession.ensureFreshToken() } catch (_: Throwable) {}
            }.apply { name = "tedflix-token-refresh"; isDaemon = true }.start()
        }
        super.onResume()
        if (::webView.isInitialized) {
            webView.onResume()
            webView.resumeTimers()
        }
        if (AuthSession.hasToken()) refreshHeaderBadges()
        if (::webView.isInitialized && playerWasOpened) {
            playerWasOpened = false
            webView.postDelayed({
                webView.evaluateJavascript("if (location.hash.indexOf('#/assistir/') === 0) history.back();", null)
            }, 120)
        }
    }

    override fun onPause() {
        if (::webView.isInitialized) {
            // Evita que carrosséis, timers de UI e polling JS continuem consumindo
            // CPU enquanto outra Activity (player/resolvedor) está em primeiro plano.
            webView.onPause()
            webView.pauseTimers()
        }
        super.onPause()
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("AndroidPlayer")
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }

    private class AndroidPlayerBridge(private val activity: MainActivity) {
        

        @JavascriptInterface
        fun openLivePlayer(
            channelId: String?,
            title: String?,
            logo: String?,
            serversJson: String?,
            program: String?,
            category: String?,
        ) {
            val id = channelId.orEmpty().trim()
            val name = title.orEmpty().trim().ifBlank { "Canal ao vivo" }
            val servers = serversJson.orEmpty().trim()
            activity.runOnUiThread {
                if (id.isBlank() || servers.isBlank()) {
                    TedflixDialogs.error(activity, "Canal indisponível", "Nenhum servidor de transmissão está disponível para este canal.")
                    return@runOnUiThread
                }
                try {
                    val intent = android.content.Intent(activity, LivePlayerActivity::class.java).apply {
                        putExtra(LivePlayerActivity.EXTRA_CHANNEL_ID, id)
                        putExtra(LivePlayerActivity.EXTRA_TITLE, name)
                        putExtra(LivePlayerActivity.EXTRA_LOGO, logo.orEmpty().trim())
                        putExtra(LivePlayerActivity.EXTRA_SERVERS, servers)
                        putExtra(LivePlayerActivity.EXTRA_PROGRAM, program.orEmpty().trim())
                        putExtra(LivePlayerActivity.EXTRA_CATEGORY, category.orEmpty().trim())
                    }
                    activity.startActivity(intent)
                } catch (e: Throwable) {
                    TedflixDialogs.error(activity, "Não foi possível abrir o canal", e.message ?: "Tente novamente mais tarde.")
                }
            }
        }

        @JavascriptInterface
        fun openPlayer(
            categoria: String?,
            slug: String?,
            titulo: String?,
            filaJson: String?,
            filmeId: String? = null,
            thumb: String? = null,
            tipo: String? = null,
            serieCategoria: String? = null,
            serieSlug: String? = null,
            episodiosJson: String? = null,
            recomendadosJson: String? = null,
        ) {
            val categoriaValue = categoria.orEmpty().trim()
            val slugValue = slug.orEmpty().trim()
            val tituloValue = titulo.orEmpty().trim()
            activity.runOnUiThread {
                if (!AuthSession.hasToken()) {
                    activity.startActivity(Intent(activity, AuthActivity::class.java))
                    return@runOnUiThread
                }
                if (categoriaValue.isBlank() || slugValue.isBlank()) {
                    TedflixDialogs.error(activity, "Título inválido", "Não foi possível identificar o conteúdo solicitado.")
                    return@runOnUiThread
                }
                try {
                    val intent = Intent(activity, PlayerActivity::class.java).apply {
                        putExtra(PlayerActivity.EXTRA_CATEGORIA, categoriaValue)
                        putExtra(PlayerActivity.EXTRA_SLUG, slugValue)
                        putExtra(PlayerActivity.EXTRA_TITULO, tituloValue)
                        putExtra(PlayerActivity.EXTRA_NEXT_EPISODES, filaJson.orEmpty())
                        putExtra(PlayerActivity.EXTRA_FILME_ID, filmeId.orEmpty().trim().ifBlank { slugValue })
                        putExtra(PlayerActivity.EXTRA_THUMB, thumb.orEmpty().trim())
                        putExtra(PlayerActivity.EXTRA_TIPO, tipo.orEmpty().trim())
                        putExtra(PlayerActivity.EXTRA_SERIE_CATEGORIA, serieCategoria.orEmpty().trim())
                        putExtra(PlayerActivity.EXTRA_SERIE_SLUG, serieSlug.orEmpty().trim())
                        putExtra(PlayerActivity.EXTRA_SERIES_EPISODES, episodiosJson.orEmpty())
                        putExtra(PlayerActivity.EXTRA_RECOMMENDATIONS, recomendadosJson.orEmpty())
                    }
                    activity.playerWasOpened = true
                    activity.startActivity(intent)
                } catch (error: Throwable) {
                    Log.e("TedflixMain", "Falha ao abrir o PlayerActivity", error)
                    activity.playerWasOpened = false
                    TedflixDialogs.error(activity, "Não foi possível abrir o player", "Ocorreu um erro ao iniciar a reprodução.")
                }
            }
        }

        @JavascriptInterface
        fun downloadContent(
            categoria: String?,
            slug: String?,
            titulo: String?,
            thumb: String?,
            tipo: String?,
            filmeId: String?,
            metadataJson: String?,
            serieCategoria: String?,
            serieSlug: String?,
        ): String {
            val cat = categoria.orEmpty().trim()
            val contentSlug = slug.orEmpty().trim()
            if (cat.isBlank() || contentSlug.isBlank()) return """{"success":false,"error":"Conteúdo inválido"}"""
            if (!AuthSession.hasToken()) return """{"success":false,"error":"Entre na conta para resolver o conteúdo antes de baixar"}"""
            activity.runOnUiThread { activity.ensureDownloadNotificationPermission() }
            return try {
                val metadata = try { JSONObject(metadataJson.orEmpty()) } catch (_: Throwable) { JSONObject() }
                metadata.put("id", metadata.optString("id").ifBlank { "${cat}_${contentSlug}".replace(Regex("[^A-Za-z0-9_-]"), "_") })
                metadata.put("title", titulo.orEmpty())
                metadata.put("poster", thumb.orEmpty())
                metadata.put("mediaType", tipo.orEmpty())
                val intent = Intent(activity, DownloadResolverActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_CATEGORIA, cat)
                    putExtra(PlayerActivity.EXTRA_SLUG, contentSlug)
                    putExtra(PlayerActivity.EXTRA_TITULO, titulo.orEmpty())
                    putExtra(PlayerActivity.EXTRA_FILME_ID, filmeId.orEmpty().ifBlank { contentSlug })
                    putExtra(PlayerActivity.EXTRA_THUMB, thumb.orEmpty())
                    putExtra(PlayerActivity.EXTRA_TIPO, tipo.orEmpty())
                    putExtra(PlayerActivity.EXTRA_SERIE_CATEGORIA, serieCategoria.orEmpty())
                    putExtra(PlayerActivity.EXTRA_SERIE_SLUG, serieSlug.orEmpty())
                    putExtra(PlayerActivity.EXTRA_DOWNLOAD_ONLY, true)
                    putExtra(PlayerActivity.EXTRA_DOWNLOAD_METADATA, metadata.toString())
                    addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION)
                }
                activity.runOnUiThread {
                    android.widget.Toast.makeText(
                        activity,
                        "Verificando a disponibilidade do conteúdo…",
                        android.widget.Toast.LENGTH_SHORT,
                    ).show()
                    activity.startActivity(intent)
                    activity.overridePendingTransition(0, 0)
                }
                """{"success":true}"""
            } catch (error: Throwable) {
                Log.e("TedflixDownload", "Falha ao preparar download", error)
                """{"success":false,"error":${JSONObject.quote(error.message ?: "Falha ao preparar download")}}"""
            }
        }

        @JavascriptInterface
        fun enqueueDownloadQueue(itemsJson: String?): String {
            if (!AuthSession.hasToken()) return """{"success":false,"error":"Entre na conta para baixar conteúdo."}"""
            activity.runOnUiThread { activity.ensureDownloadNotificationPermission() }
            return try {
                val ok = com.tedflix.app.downloads.DownloadRepository.startDownloadQueue(
                    activity, itemsJson.orEmpty()
                )
                if (ok) """{"success":true}""" else """{"success":false,"error":"A fila não contém episódios válidos."}"""
            } catch (error: Throwable) {
                Log.e("TedflixDownload", "Falha ao iniciar fila de episódios", error)
                """{"success":false,"error":${JSONObject.quote(error.message ?: "Falha ao iniciar fila")}}"""
            }
        }

        @JavascriptInterface
        fun getDownloads(): String = try {
            JSONObject().put("success", true)
                .put("items", com.tedflix.app.downloads.DownloadRepository.listDownloads(activity))
                .put("pendingQueue", com.tedflix.app.downloads.DownloadRepository.pendingQueueCount(activity))
                .toString()
        } catch (error: Throwable) {
            """{"success":false,"error":${JSONObject.quote(error.message ?: "Falha ao listar downloads")}}"""
        }

        @JavascriptInterface
        fun pauseAllDownloads(): String = downloadCommand(com.tedflix.app.downloads.TedflixDownloadService.ACTION_PAUSE_ALL)

        @JavascriptInterface
        fun resumeAllDownloads(): String = downloadCommand(com.tedflix.app.downloads.TedflixDownloadService.ACTION_RESUME_ALL)

        @JavascriptInterface
        fun pauseDownload(id: String?): String = downloadCommand(
            com.tedflix.app.downloads.TedflixDownloadService.ACTION_PAUSE, id
        )

        @JavascriptInterface
        fun resumeDownload(id: String?): String = downloadCommand(
            com.tedflix.app.downloads.TedflixDownloadService.ACTION_RESUME, id
        )

        @JavascriptInterface
        fun removeDownload(id: String?): String = downloadCommand(
            com.tedflix.app.downloads.TedflixDownloadService.ACTION_REMOVE, id
        )

        @JavascriptInterface
        fun resumePendingDownloadQueue(): String {
            return try {
                val ok = com.tedflix.app.downloads.DownloadRepository.resumePendingQueue(activity)
                if (ok) """{"success":true}""" else """{"success":false,"error":"Não há episódios aguardando preparação."}"""
            } catch (error: Throwable) {
                """{"success":false,"error":${JSONObject.quote(error.message ?: "Falha ao retomar fila")}}"""
            }
        }

        @JavascriptInterface
        fun cancelPendingDownloadQueue(): String {
            return try {
                com.tedflix.app.downloads.DownloadRepository.cancelPendingQueue(activity)
                """{"success":true}"""
            } catch (error: Throwable) {
                """{"success":false,"error":${JSONObject.quote(error.message ?: "Falha ao cancelar fila")}}"""
            }
        }

        @JavascriptInterface
        fun retryDownload(id: String?): String = downloadCommand(
            com.tedflix.app.downloads.TedflixDownloadService.ACTION_RETRY, id
        )

        @JavascriptInterface
        fun playDownloaded(id: String?): String {
            val downloadId = id.orEmpty().trim()
            if (downloadId.isBlank()) return """{"success":false,"error":"Download inválido."}"""
            return try {
                val download = com.tedflix.app.downloads.DownloadRepository.getDownload(activity, downloadId)
                    ?: return """{"success":false,"error":"Download não encontrado."}"""
                if (download.state != androidx.media3.exoplayer.offline.Download.STATE_COMPLETED) {
                    return """{"success":false,"error":"O download ainda não foi concluído."}"""
                }
                val metadata = com.tedflix.app.downloads.DownloadRepository.metadata(download)
                val intent = Intent(activity, PlayerActivity::class.java).apply {
                    putExtra(PlayerActivity.EXTRA_OFFLINE_DOWNLOAD_ID, downloadId)
                    putExtra(PlayerActivity.EXTRA_TITULO, metadata.optString("title", "TEDFLIX"))
                    putExtra(PlayerActivity.EXTRA_THUMB, metadata.optString("poster", ""))
                    putExtra(PlayerActivity.EXTRA_CATEGORIA, metadata.optString("sourceCategory", "offline"))
                    putExtra(PlayerActivity.EXTRA_SLUG, metadata.optString("sourceSlug", downloadId))
                    putExtra(PlayerActivity.EXTRA_FILME_ID, metadata.optString("filmId", downloadId))
                    putExtra(PlayerActivity.EXTRA_TIPO, metadata.optString("mediaType", "filme"))
                    putExtra(PlayerActivity.EXTRA_SERIE_CATEGORIA, metadata.optString("serieCategory", ""))
                    putExtra(PlayerActivity.EXTRA_SERIE_SLUG, metadata.optString("serieSlug", ""))
                }
                activity.runOnUiThread { activity.startActivity(intent) }
                """{"success":true}"""
            } catch (error: Throwable) {
                Log.e("TedflixDownload", "Falha ao abrir download", error)
                """{"success":false,"error":${JSONObject.quote(error.message ?: "Falha ao abrir conteúdo")}}"""
            }
        }

        private fun downloadCommand(action: String, id: String? = null): String {
            return try {
                com.tedflix.app.downloads.DownloadRepository.command(activity, action, id)
                """{"success":true}"""
            } catch (error: Throwable) {
                """{"success":false,"error":${JSONObject.quote(error.message ?: "Falha no comando")}}"""
            }
        }

        @JavascriptInterface
        fun getProfileName(): String = activity.currentProfileName()

        @JavascriptInterface
        fun openFavorites() {
            // Seção SPA (#/favoritos) — evita tela nativa cinza/corte
            activity.runOnUiThread {
                try {
                    if (!activity::webView.isInitialized) return@runOnUiThread
                    activity.webView.evaluateJavascript("location.hash = '#/favoritos';", null)
                } catch (error: Throwable) {
                    Log.e("TedflixMain", "Falha ao abrir favoritos", error)
                }
            }
        }

        @JavascriptInterface
        fun refreshContinueWatching() {
            val profileId = AuthSession.activeProfileId()
            // A Home consulta diretamente o endpoint de progresso usando a sessão
            // já preservada no dispositivo; ela não abre nem depende da tela de login.
            if (!AuthSession.hasToken()) {
                activity.runOnUiThread { notifyHistoryReady() }
                return
            }
            if (activity.historyRefreshInFlight) return
            activity.historyRefreshInFlight = true
            activity.remoteHistoryProfileId = profileId
            activity.remoteHistoryCache = emptyList()
            Thread {
                try {
                    val result = AuthSession.continueWatching()
                    if (!result.ok) {
                        Log.w("TedflixMain", "Histórico remoto indisponível: ${result.message}")
                        return@Thread
                    }
                    val base = result.value.orEmpty().map { item ->
                        if (item.categoria.isNotBlank() && item.slug.isNotBlank()) return@map item
                        val resolved = AuthSession.resolveCatalogItem(item.titulo, item.filmeId).value
                            ?: return@map item
                        item.copy(
                            titulo = item.titulo.ifBlank { resolved.titulo },
                            thumb = item.thumb.ifBlank { resolved.thumb },
                            categoria = item.categoria.ifBlank { resolved.categoria },
                            slug = item.slug.ifBlank { resolved.slug },
                            tipo = item.tipo.ifBlank { resolved.tipo },
                        )
                    }
                    // Enriquece cada item com progresso (position/duration) da API de progress.
                    // Histórico antigo só trazia metadados — sem isso a barrinha não aparece.
                    val enriched = base.map { item ->
                        if (item.positionSeconds > 0L && item.durationSeconds > 0L) return@map item
                        val contentId = item.filmeId.ifBlank { item.slug }
                        if (contentId.isBlank()) return@map item
                        try {
                            val prog = AuthSession.getProgress(contentId).value ?: return@map item
                            item.copy(
                                positionSeconds = if (prog.positionSeconds > 0) prog.positionSeconds else item.positionSeconds,
                                durationSeconds = if (prog.durationSeconds > 0) prog.durationSeconds else item.durationSeconds,
                                thumb = item.thumb.ifBlank { prog.thumb },
                                titulo = item.titulo.ifBlank { prog.titulo },
                                categoria = item.categoria.ifBlank { prog.categoria },
                                slug = item.slug.ifBlank { prog.slug },
                                tipo = item.tipo.ifBlank { prog.tipo },
                            )
                        } catch (_: Throwable) {
                            item
                        }
                    }
                    // Espelha no store local para a próxima abertura ser instantânea (capa + %)
                    enriched.forEach { item ->
                        val cat = item.categoria.trim()
                        val slug = item.slug.trim()
                        if (cat.isBlank() || slug.isBlank()) return@forEach
                        val posMs = item.positionSeconds * 1000L
                        val durMs = item.durationSeconds * 1000L
                        if (posMs >= 10_000L && durMs > 0L) {
                            try {
                                ContinueWatchingStore.save(
                                    activity,
                                    cat,
                                    slug,
                                    item.titulo,
                                    posMs,
                                    durMs,
                                    item.filmeId.ifBlank { slug },
                                    item.thumb,
                                    item.tipo,
                                    item.serieCategoria,
                                    item.serieSlug,
                                )
                            } catch (_: Throwable) {}
                        }
                    }
                    activity.remoteHistoryCache = enriched
                    Log.d("TedflixMain", "Histórico remoto carregado: ${enriched.size} item(ns)")
                } catch (error: Throwable) {
                    Log.w("TedflixMain", "Falha ao atualizar histórico remoto", error)
                } finally {
                    activity.historyRefreshInFlight = false
                    activity.runOnUiThread { notifyHistoryReady() }
                }
            }.apply { name = "TedflixHistoryRefresh"; start() }
        }

        private fun notifyHistoryReady() {
            if (!activity.isFinishing && !activity.isDestroyed) {
                activity.webView.evaluateJavascript(
                    "window.__tedflixHistoryReady && window.__tedflixHistoryReady();",
                    null,
                )
            }
        }

        @JavascriptInterface
        fun removeContinueWatching(categoria: String?, slug: String?): String {
            return try {
                val cat = categoria?.trim().orEmpty()
                val s = slug?.trim().orEmpty()
                if (cat.isNotBlank() && s.isNotBlank()) {
                    ContinueWatchingStore.remove(activity, cat, s)
                }
                // invalida cache remoto mesclado
                activity.remoteHistoryCache = activity.remoteHistoryCache.filterNot {
                    (cat.isNotBlank() && it.categoria == cat && it.slug == s) ||
                        (s.isNotBlank() && it.slug == s)
                }
                """{"success":true}"""
            } catch (error: Throwable) {
                """{"success":false,"error":${JSONObject.quote(error.message ?: "erro")}}"""
            }
        }

        @JavascriptInterface
        fun clearContinueWatching(): String {
            return try {
                val all = ContinueWatchingStore.read(activity)
                all.forEach { ContinueWatchingStore.remove(activity, it.categoria, it.slug) }
                activity.remoteHistoryCache = emptyList()
                """{"success":true}"""
            } catch (error: Throwable) {
                """{"success":false,"error":${JSONObject.quote(error.message ?: "erro")}}"""
            }
        }

        @JavascriptInterface
        fun getContinueWatching(): String {
            return try {
                val local = org.json.JSONArray(ContinueWatchingStore.toJson(activity))
                if (!AuthSession.hasToken()) return local.toString()
                val activeProfileId = AuthSession.activeProfileId()
                val remote = if (AuthSession.hasToken() &&
                    (activeProfileId.isBlank() || activeProfileId == activity.remoteHistoryProfileId)
                ) {
                    activity.remoteHistoryCache
                } else {
                    emptyList()
                }
                for (i in 0 until local.length()) {
                    val item = local.optJSONObject(i) ?: continue
                    val filmeId = item.optString("filmeId").ifBlank { item.optString("slug") }
                    val slug = item.optString("slug")
                    val categoria = item.optString("categoria")
                    val exactMatch = remote.firstOrNull { remoteItem ->
                        categoria.isNotBlank() && slug.isNotBlank() &&
                            remoteItem.categoria == categoria && remoteItem.slug == slug
                    }
                    val itemIsEpisode = item.optBoolean("isEpisode") ||
                        item.optString("tipo").contains("epis", ignoreCase = true) ||
                        item.optString("serieSlug").isNotBlank()
                    val match = exactMatch ?: remote.firstOrNull { remoteItem ->
                        !itemIsEpisode && filmeId.isNotBlank() && remoteItem.filmeId == filmeId
                    }
                    if (match != null) {
                        if (match.thumb.isNotBlank()) item.put("thumb", match.thumb)
                        if (match.tempo.isNotBlank()) item.put("tempo", match.tempo)
                        if (item.optString("categoria").isBlank() && match.categoria.isNotBlank()) item.put("categoria", match.categoria)
                        if (item.optString("slug").isBlank() && match.slug.isNotBlank()) item.put("slug", match.slug)
                        if (item.optString("tipo").isBlank() && match.tipo.isNotBlank()) item.put("tipo", match.tipo)
                        if (item.optString("serieCategoria").isBlank() && match.serieCategoria.isNotBlank()) item.put("serieCategoria", match.serieCategoria)
                        if (item.optString("serieSlug").isBlank() && match.serieSlug.isNotBlank()) item.put("serieSlug", match.serieSlug)
                        // Progresso remoto (segundos → ms) quando local não tem ou remoto é mais recente
                        val localPos = item.optLong("positionMs", 0L)
                        val localDur = item.optLong("durationMs", 0L)
                        if (match.positionSeconds > 0L && match.durationSeconds > 0L) {
                            val remotePosMs = match.positionSeconds * 1000L
                            val remoteDurMs = match.durationSeconds * 1000L
                            if (localPos <= 0L || remotePosMs > localPos) {
                                item.put("positionMs", remotePosMs)
                                item.put("durationMs", remoteDurMs)
                                val pct = ((remotePosMs * 100L) / remoteDurMs).toInt().coerceIn(1, 99)
                                item.put("percent", pct)
                                item.put("progresso", pct)
                            }
                        }
                        if (item.optInt("percent", 0) <= 0 && item.optLong("durationMs", 0L) > 0L) {
                            val pct = ((item.optLong("positionMs") * 100L) / item.optLong("durationMs")).toInt().coerceIn(0, 99)
                            if (pct > 0) {
                                item.put("percent", pct)
                                item.put("progresso", pct)
                            }
                        }
                        item.put("remote", true)
                    }
                }
                remote.forEach { remoteItem ->
                    val categoria = remoteItem.categoria.trim()
                    val slug = remoteItem.slug.trim()
                    val alreadyPresent = (0 until local.length()).any { index ->
                        val item = local.optJSONObject(index) ?: return@any false
                        val sameEpisode = categoria.isNotBlank() && slug.isNotBlank() &&
                            item.optString("categoria") == categoria && item.optString("slug") == slug
                        val itemIsEpisode = item.optBoolean("isEpisode") ||
                            item.optString("tipo").contains("epis", ignoreCase = true) ||
                            item.optString("serieSlug").isNotBlank()
                        val remoteIsEpisode = remoteItem.tipo.contains("epis", ignoreCase = true) ||
                            remoteItem.serieSlug.isNotBlank()
                        val sameId = !itemIsEpisode && !remoteIsEpisode &&
                            remoteItem.filmeId.isNotBlank() && item.optString("filmeId") == remoteItem.filmeId
                        val sameTitle = remoteItem.filmeId.isBlank() && remoteItem.titulo.isNotBlank() &&
                            item.optString("titulo").equals(remoteItem.titulo, ignoreCase = true)
                        sameEpisode || sameId || sameTitle
                    }
                    if (alreadyPresent) return@forEach
                    val parsedEp = ContinueWatchingStore.parseEpisodeMeta(remoteItem.titulo, slug)
                    local.put(org.json.JSONObject().apply {
                        put("categoria", categoria)
                        put("slug", slug)
                        put("filmeId", remoteItem.filmeId.ifBlank { slug })
                        put("titulo", remoteItem.titulo)
                        put("thumb", remoteItem.thumb)
                        put("tempo", remoteItem.tempo)
                        put("tipo", remoteItem.tipo)
                        put("serieCategoria", remoteItem.serieCategoria)
                        put("serieSlug", remoteItem.serieSlug)
                        put("temporada", parsedEp.first)
                        put("episodio", parsedEp.second)
                        if (parsedEp.first > 0 && parsedEp.second > 0) {
                            put("epLabel", "S${parsedEp.first}E${parsedEp.second}")
                        } else if (parsedEp.second > 0) {
                            put("epLabel", "E${parsedEp.second}")
                        }
                        val isEp = remoteItem.tipo.contains("epis", true) ||
                            remoteItem.serieSlug.isNotBlank() ||
                            parsedEp.second > 0
                        put("isEpisode", isEp)
                        val posMs = remoteItem.positionSeconds * 1000L
                        val durMs = remoteItem.durationSeconds * 1000L
                        if (posMs > 0L) put("positionMs", posMs)
                        if (durMs > 0L) put("durationMs", durMs)
                        if (posMs > 0L && durMs > 0L) {
                            val pct = ((posMs * 100L) / durMs).toInt().coerceIn(1, 99)
                            put("percent", pct)
                            put("progresso", pct)
                        }
                        put("remote", true)
                    })
                }
                local.toString()
            } catch (error: Throwable) {
                Log.w("TedflixMain", "Falha ao combinar histórico remoto", error)
                try { ContinueWatchingStore.toJson(activity) } catch (_: Throwable) { "[]" }
            }
        }

        @JavascriptInterface
        fun getFavorites(): String {
            return org.json.JSONObject().put("success", true).put("favoritos", org.json.JSONArray().apply {
                activity.favoriteCache.forEach { item ->
                    put(org.json.JSONObject().apply {
                        put("filmeId", item.filmeId)
                        put("titulo", item.titulo)
                        put("thumb", item.thumb)
                        put("imagem", item.thumb)
                        put("adicionadoEm", item.adicionadoEm)
                        put("categoria", item.categoria)
                        put("slug", item.slug)
                        put("tipo", item.tipo)
                        put("contentType", item.tipo)
                    })
                }
            }).toString()
        }

        /**
         * Solicita o histórico remoto sem bloquear a chamada JavaScript.
         * A URL/rota e o contrato da API permanecem no AuthSession, sem alterações.
         */
        @JavascriptInterface
        fun requestSearchHistoryAsync() {
            val profileId = AuthSession.activeProfileId()
            if (!AuthSession.hasToken() || profileId.isBlank()) return

            synchronized(activity) {
                if (activity.searchHistoryRequestInFlight &&
                    activity.searchHistoryRequestProfileId == profileId
                ) return
                activity.searchHistoryRequestInFlight = true
                activity.searchHistoryRequestProfileId = profileId
            }

            Thread {
                try {
                    val result = AuthSession.listSearchHistory()
                    // A resposta só pode ser entregue ao mesmo perfil que iniciou a consulta.
                    if (AuthSession.activeProfileId() != profileId) return@Thread
                    val payload = org.json.JSONObject().apply {
                        put("success", result.ok)
                        put("history", org.json.JSONArray().apply {
                            (result.value ?: emptyList()).forEach { item ->
                                put(org.json.JSONObject().apply {
                                    put("id", item.id)
                                    put("query", item.query)
                                    put("lastSearchedAt", item.lastSearchedAt)
                                })
                            }
                        })
                        if (result.message.isNotBlank()) put("error", result.message)
                    }.toString()
                    val quotedPayload = org.json.JSONObject.quote(payload)
                    activity.runOnUiThread {
                        if (activity.isFinishing || activity.isDestroyed ||
                            AuthSession.activeProfileId() != profileId ||
                            !activity::webView.isInitialized
                        ) return@runOnUiThread
                        activity.webView.evaluateJavascript(
                            "window.__tedflixSearchHistoryReady && window.__tedflixSearchHistoryReady($quotedPayload);",
                            null,
                        )
                    }
                } catch (error: Throwable) {
                    Log.w("TedflixMain", "Falha ao carregar histórico de busca em background", error)
                } finally {
                    synchronized(activity) {
                        if (activity.searchHistoryRequestProfileId == profileId) {
                            activity.searchHistoryRequestInFlight = false
                            activity.searchHistoryRequestProfileId = ""
                        }
                    }
                }
            }.apply { name = "TedflixSearchHistoryAsync"; start() }
        }

        @JavascriptInterface
        fun getSearchHistory(): String {
            return try {
                val result = AuthSession.listSearchHistory()
                org.json.JSONObject().apply {
                    put("success", result.ok)
                    put("history", org.json.JSONArray().apply {
                        (result.value ?: emptyList()).forEach { item ->
                            put(org.json.JSONObject().apply {
                                put("id", item.id)
                                put("query", item.query)
                                put("lastSearchedAt", item.lastSearchedAt)
                            })
                        }
                    })
                    if (result.message.isNotBlank()) put("error", result.message)
                }.toString()
            } catch (error: Throwable) {
                Log.w("TedflixMain", "Falha ao listar histórico de busca", error)
                """{"success":false,"history":[],"error":"Não foi possível carregar o histórico."}"""
            }
        }

        @JavascriptInterface
        fun saveSearchHistory(query: String?): String {
            val q = query.orEmpty().trim()
            if (q.length < 2) return """{"success":false,"error":"Query inválida."}"""
            // Nunca bloqueia a WebView: grava na API em background
            Thread {
                try {
                    AuthSession.saveSearchHistory(q)
                } catch (error: Throwable) {
                    Log.w("TedflixMain", "Falha ao salvar busca", error)
                }
            }.apply { name = "TedflixSaveSearch"; start() }
            return """{"success":true,"queued":true}"""
        }

        @JavascriptInterface
        fun deleteSearchHistoryItem(searchId: String?): String {
            val id = searchId.orEmpty().trim()
            if (id.isBlank()) return """{"success":false,"error":"ID inválido."}"""
            Thread {
                try { AuthSession.deleteSearchHistoryItem(id) }
                catch (error: Throwable) { Log.w("TedflixMain", "Falha ao apagar busca", error) }
            }.apply { name = "TedflixDelSearch"; start() }
            return """{"success":true,"queued":true}"""
        }

        @JavascriptInterface
        fun clearSearchHistory(): String {
            Thread {
                try { AuthSession.clearSearchHistory() }
                catch (error: Throwable) { Log.w("TedflixMain", "Falha ao limpar histórico de busca", error) }
            }.apply { name = "TedflixClearSearch"; start() }
            return """{"success":true,"queued":true}"""
        }

        @JavascriptInterface
        fun toggleFavorite(filmeId: String?, titulo: String?, thumb: String?, contentType: String?): String {
            val id = filmeId.orEmpty()
            val wasFavorite = activity.favoriteCache.any { it.filmeId == id }
            Thread {
                val result = AuthSession.toggleFavorite(id, titulo.orEmpty(), thumb.orEmpty(), contentType.orEmpty().ifBlank { "movie" })
                if (!result.ok) Log.w("TedflixMain", "Falha ao alternar favorito", Exception(result.message))
                activity.refreshHeaderBadges()
            }.apply { name = "TedflixToggleFavorite"; start() }
            return org.json.JSONObject().put("success", true).put("favorito", !wasFavorite).toString()
        }

        @JavascriptInterface
        fun getProfiles(): String {
            return try {
                AuthSession.restoreActiveProfileIfNeeded()
                val user = AuthSession.cachedUser()
                AuthSession.ensureCurrentProfile(
                    user?.username.orEmpty().ifBlank { user?.email.orEmpty() },
                    "tedflix-avatar-01",
                )
                val profiles = AuthSession.profiles()
                org.json.JSONObject().apply {
                    put("success", true)
                    put("activeId", AuthSession.activeProfileId())
                    put("profiles", org.json.JSONArray().apply {
                        profiles.forEach { profile ->
                            put(org.json.JSONObject().apply {
                                put("id", profile.id)
                                put("name", profile.name)
                                put("avatarSeed", profile.avatarSeed)
                                put("avatarStyle", profile.avatarStyle)
                                put("email", profile.email)
                            })
                        }
                    })
                }.toString()
            } catch (error: Throwable) {
                Log.w("TedflixMain", "Falha ao listar perfis", error)
                "{\"success\":false,\"error\":\"Não foi possível carregar os perfis.\"}"
            }
        }

        @JavascriptInterface
        fun activateProfileFromSettings(profileId: String?): String {
            return try {
                val result = AuthSession.activateProfileOffline(profileId.orEmpty().trim())
                if (result.ok) {
                    activity.remoteHistoryProfileId = ""
                    activity.remoteHistoryCache = emptyList()
                    activity.refreshHeaderBadges()
                }
                org.json.JSONObject().apply {
                    put("success", result.ok)
                    result.value?.id?.let { put("profileId", it) }
                    if (result.message.isNotBlank()) put("error", result.message)
                }.toString()
            } catch (error: Throwable) {
                Log.w("TedflixMain", "Falha ao ativar perfil", error)
                "{\"success\":false,\"error\":\"Não foi possível selecionar o perfil.\"}"
            }
        }

        @JavascriptInterface
        fun updateStoredProfile(profileId: String?, name: String?, avatarSeed: String?): String {
            return try {
                AuthSession.restoreActiveProfileIfNeeded()
                val requestedId = profileId.orEmpty().trim()
                val user = AuthSession.cachedUser()
                val profiles = AuthSession.profiles()
                val requested = profiles.firstOrNull { it.id == requestedId }
                val active = profiles.firstOrNull { it.id == AuthSession.activeProfileId() }
                val ensured = if (requested == null && active == null) {
                    AuthSession.ensureCurrentProfile(
                        user?.username.orEmpty().ifBlank { user?.email.orEmpty() },
                        "tedflix-avatar-01",
                    )
                } else null
                val id = requested?.id ?: active?.id ?: ensured?.id.orEmpty()
                if (id.isBlank()) {
                    return org.json.JSONObject()
                        .put("success", false)
                        .put("error", "Nenhum perfil autenticado foi encontrado.")
                        .toString()
                }
                val updated = AuthSession.updateProfile(id, name.orEmpty(), avatarSeed.orEmpty())
                if (updated && id == AuthSession.activeProfileId()) activity.refreshHeaderBadges()
                org.json.JSONObject().put("success", updated).apply {
                    if (!updated) put("error", "Perfil não encontrado.")
                }.toString()
            } catch (error: Throwable) {
                Log.w("TedflixMain", "Falha ao atualizar perfil", error)
                "{\"success\":false,\"error\":\"Não foi possível salvar o perfil.\"}"
            }
        }

        @JavascriptInterface
        fun createProfileFromSettings(code: String?, email: String?, password: String?, name: String?, avatarSeed: String?): String {
            return try {
                val result = AuthSession.createRemoteProfile(
                    name.orEmpty(), false, "fun-emoji", avatarSeed.orEmpty(), "",
                )
                org.json.JSONObject().apply {
                    put("success", result.ok)
                    result.value?.id?.let { put("profileId", it) }
                    if (result.message.isNotBlank()) put("error", result.message)
                }.toString()
            } catch (error: Throwable) {
                Log.w("TedflixMain", "Falha ao criar perfil", error)
                "{\"success\":false,\"error\":\"Não foi possível adicionar o perfil.\"}"
            }
        }

        @JavascriptInterface
        fun deleteProfileFromSettings(profileId: String?): String {
            return try {
                val deleted = AuthSession.deleteProfile(profileId.orEmpty().trim())
                if (deleted) activity.refreshHeaderBadges()
                org.json.JSONObject().put("success", deleted).apply {
                    if (!deleted) put("error", "O perfil principal não pode ser excluído ou não foi encontrado.")
                }.toString()
            } catch (error: Throwable) {
                Log.w("TedflixMain", "Falha ao excluir perfil", error)
                "{\"success\":false,\"error\":\"Não foi possível excluir o perfil.\"}"
            }
        }

        @JavascriptInterface
        fun openAccount() {
            activity.runOnUiThread {
                if (!activity::webView.isInitialized) return@runOnUiThread
                activity.webView.evaluateJavascript("location.hash = '#/config';", null)
            }
        }

        @JavascriptInterface
        fun getAccountStatus(): String {
            return try {
                val user = AuthSession.cachedUser()
                org.json.JSONObject().put("success", true).put("status", org.json.JSONObject().apply {
                    put("status", user?.accountStatus.orEmpty())
                    put("accountStatus", user?.accountStatus.orEmpty())
                    put("expiresAt", user?.expiresAt.orEmpty())
                    put("accountExpiresAt", user?.expiresAt.orEmpty())
                    user?.daysRemaining?.let { put("daysRemaining", it) }
                    put("createdAt", user?.createdAt.orEmpty())
                    put("lastUsedAt", user?.lastUsedAt.orEmpty())
                }).toString()
            } catch (error: Throwable) {
                "{\"success\":false,\"error\":\"Não foi possível carregar o status da conta.\"}"
            }
        }

        @JavascriptInterface
        fun getActiveProfile(): String {
            return try {
                val id = AuthSession.activeProfileId()
                val profile = AuthSession.profiles().firstOrNull { it.id == id }
                    ?: AuthSession.profiles().firstOrNull()
                if (profile == null) {
                    org.json.JSONObject().put("success", false).toString()
                } else {
                    org.json.JSONObject()
                        .put("success", true)
                        .put("id", profile.id)
                        .put("name", profile.name)
                        .put("avatarSeed", profile.avatarSeed)
                        .put("avatarStyle", profile.avatarStyle)
                        .put("username", profile.username)
                        .put("isKids", profile.isKids)
                        .toString()
                }
            } catch (error: Throwable) {
                Log.w("TedflixMain", "getActiveProfile", error)
                JSONObject().put("success", false).toString()
            }
        }

        @JavascriptInterface
        fun getAccountProfile(): String {
            return try {
                val user = AuthSession.cachedUser()
                org.json.JSONObject().apply {
                    put("success", user != null)
                    put("user", org.json.JSONObject().apply {
                        put("id", user?.id.orEmpty())
                        put("email", user?.email.orEmpty())
                        put("username", user?.username.orEmpty())
                        put("accountExpiresAt", user?.expiresAt.orEmpty())
                        put("accountStatus", user?.accountStatus.orEmpty())
                        user?.daysRemaining?.let { put("daysRemaining", it) }
                        put("createdAt", user?.createdAt.orEmpty())
                        put("lastUsedAt", user?.lastUsedAt.orEmpty())
                    })
                }.toString()
            } catch (error: Throwable) {
                Log.w("TedflixMain", "Falha ao carregar os dados da conta", error)
                "{\"success\":false,\"error\":\"Não foi possível carregar os dados da conta.\"}"
            }
        }

        @JavascriptInterface
        fun logoutFromSettings(): String {
            return try {
                val result = AuthSession.logout()
                if (result.ok) activity.runOnUiThread { activity.openLogin() }
                org.json.JSONObject().put("success", result.ok).apply {
                    if (result.message.isNotBlank()) put("error", result.message)
                }.toString()
            } catch (_: Throwable) {
                "{\"success\":false,\"error\":\"Não foi possível sair da conta.\"}"
            }
        }

        @JavascriptInterface
        fun setBuffer(buffer: String?) {
            activity.getSharedPreferences(PlayerActivity.PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(PlayerActivity.BUFFER_KEY, buffer.orEmpty())
                .apply()
        }
    }
}
