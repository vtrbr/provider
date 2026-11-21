package com.tedflix.app.auth

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import androidx.media3.common.util.UnstableApi
import com.tedflix.app.MainActivity
import com.tedflix.app.R
import com.tedflix.app.ui.TedflixDialogs

/**
 * Tela de autenticação TEDFLIX.
 * Login/cadastro via USER API (Firebase ID Token).
 * Sem código de acesso antigo.
 */
@UnstableApi
class AuthActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var content: LinearLayout
    private var loadingOverlay: FrameLayout? = null
    private var busy = false

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK
        AuthSession.init(applicationContext)
        showLogin(null)
    }

    private fun showLogin(error: String?) {
        root = backdrop()
        content = column()
        content.addView(
            ImageView(this).apply {
                setImageResource(R.drawable.tedflix_auth_logo)
                scaleType = ImageView.ScaleType.FIT_CENTER
            },
            LinearLayout.LayoutParams(-1, dp(78)).apply { bottomMargin = dp(14) },
        )
        content.addView(title("Entrar no Tedflix"))
        content.addView(subtitle("Use o e-mail e a senha da sua conta"))

        val email = field("E-mail", "seu@email.com", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val pass = passwordField("Senha", "Sua senha")
        content.addView(email, fieldParams())
        content.addView(pass, fieldParams())

        content.addView(button("ENTRAR", primary = true) {
            login(email.text?.toString().orEmpty(), passwordText(pass))
        }, buttonParams())
        content.addView(button("Esqueci minha senha", primary = false) { showForgot() }, buttonParams())
        content.addView(button("Criar uma conta", primary = false) { showRegister(null) }, buttonParams())

        finishLayout(error)
    }

    private fun showRegister(error: String?) {
        root = backdrop()
        content = column()
        content.addView(
            ImageView(this).apply {
                setImageResource(R.drawable.tedflix_auth_logo)
                scaleType = ImageView.ScaleType.FIT_CENTER
            },
            LinearLayout.LayoutParams(-1, dp(70)).apply { bottomMargin = dp(10) },
        )
        content.addView(title("Criar sua conta"))
        content.addView(subtitle("Sem código de acesso: o cadastro é seu e-mail e senha"))

        val name = field("Nome", "Como devemos te chamar?", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PERSON_NAME)
        val email = field("E-mail", "seu@email.com", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        val pass = passwordField("Senha", "Mínimo 6 caracteres")
        val confirm = passwordField("Confirmar senha", "Repita a senha")
        content.addView(name, fieldParams())
        content.addView(email, fieldParams())
        content.addView(pass, fieldParams())
        content.addView(confirm, fieldParams())

        content.addView(button("CRIAR CONTA", primary = true) {
            register(
                name.text?.toString().orEmpty(),
                email.text?.toString().orEmpty(),
                passwordText(pass),
                passwordText(confirm),
            )
        }, buttonParams())
        content.addView(button("Já tenho conta", primary = false) { showLogin(null) }, buttonParams())

        finishLayout(error)
    }

    private fun showForgot() {
        root = backdrop()
        content = column()
        content.addView(title("Recuperar senha"))
        content.addView(subtitle("Se o e-mail existir, enviaremos as instruções"))
        val email = field("E-mail", "seu@email.com", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        content.addView(email, fieldParams())
        content.addView(button("ENVIAR INSTRUÇÕES", primary = true) {
            val value = email.text?.toString().orEmpty().trim()
            if (value.isBlank()) {
                showError("Informe o e-mail.")
                return@button
            }
            runAuth("Enviando…", {
                AuthSession.forgotPassword(value)
            }, { result ->
                if (result.ok) {
                    TedflixDialogs.notice(
                        this,
                        "Confira seu e-mail",
                        "Se o endereço informado existir, enviaremos as instruções para redefinir sua senha.",
                        icon = "success",
                        tone = "success",
                    ) { showLogin(null) }
                } else {
                    showForgot()
                    showError(result.message.ifBlank { "Não foi possível enviar." })
                }
            })
        }, buttonParams())
        content.addView(button("Voltar", primary = false) { showLogin(null) }, buttonParams())
        finishLayout(null)
    }

    private fun login(email: String, password: String) {
        val e = email.trim()
        val p = password
        when {
            e.isBlank() || p.isBlank() -> {
                showLogin("Informe e-mail e senha.")
                return
            }
            p.length < 6 -> {
                showLogin("A senha deve ter pelo menos 6 caracteres.")
                return
            }
        }
        runAuth("Entrando…", {
            AuthSession.login(e, p)
        }, { result ->
            if (result.ok) {
                val user = result.value
                val pending = user?.approvalStatus?.equals("pending", ignoreCase = true) == true
                    || AuthSession.isPendingApproval()
                if (pending) {
                    AuthSession.clear()
                    showPendingApproval(
                        name = user?.name.orEmpty(),
                        email = e,
                        fromRegister = false,
                    )
                } else {
                    TedflixDialogs.notice(this, "Login realizado", "Sua sessão foi iniciada com sucesso.", icon = "success", tone = "success") {
                        openMain()
                    }
                }
            } else {
                showLogin(result.message.ifBlank { "Não foi possível entrar." })
            }
        })
    }

    private fun register(name: String, email: String, password: String, confirm: String) {
        val n = name.trim()
        val e = email.trim()
        val p = password
        val c = confirm
        when {
            n.isBlank() -> {
                showRegister("Informe seu nome.")
                return
            }
            e.isBlank() -> {
                showRegister("Informe seu e-mail.")
                return
            }
            p.length < 6 -> {
                showRegister("A senha deve ter pelo menos 6 caracteres.")
                return
            }
            p != c -> {
                showRegister("As senhas não conferem.")
                return
            }
        }
        runAuth("Criando conta…", {
            AuthSession.register(n, e, p)
        }, { result ->
            if (result.ok) {
                val user = result.value
                val pending = user?.approvalStatus?.equals("pending", ignoreCase = true) == true
                if (pending) {
                    // Não entra no app até o admin aprovar
                    AuthSession.clear()
                    showPendingApproval(
                        name = n,
                        email = e,
                        fromRegister = true,
                    )
                } else {
                    TedflixDialogs.notice(this, "Conta criada", "Sua conta foi criada com sucesso.", icon = "success", tone = "success") {
                        openMain()
                    }
                }
            } else {
                showRegister(result.message.ifBlank { "Não foi possível criar a conta." })
            }
        })
    }

    private fun <T> runAuth(
        loadingText: String,
        block: () -> AuthSession.Result<T>,
        onDone: (AuthSession.Result<T>) -> Unit,
    ) {
        if (busy) return
        busy = true
        showLoading(loadingText)
        Thread {
            val result = try {
                block()
            } catch (e: Throwable) {
                AuthSession.Result(
                    false,
                    message = e.message?.takeIf { it.isNotBlank() } ?: "Erro inesperado. Tente de novo.",
                )
            }
            runOnUiThread {
                busy = false
                hideLoading()
                try {
                    onDone(result)
                } catch (e: Throwable) {
                    showLogin(null)
                    TedflixDialogs.error(this, "Não foi possível abrir o aplicativo", e.message ?: "Tente novamente.")
                }
            }
        }.apply { name = "TedflixAuth"; start() }
    }


    /**
     * Tela pós-cadastro / login com conta aguardando aprovação admin.
     */
    private fun showPendingApproval(name: String, email: String, fromRegister: Boolean) {
        root = backdrop()
        content = column()

        val iconWrap = FrameLayout(this)
        val circle = View(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(Color.parseColor("#33E50914"))
            }
        }
        iconWrap.addView(circle, FrameLayout.LayoutParams(dp(88), dp(88), Gravity.CENTER))
        val icon = TextView(this).apply {
            text = if (fromRegister) "✓" else "⏳"
            setTextColor(Color.parseColor("#E50914"))
            textSize = 36f
            gravity = Gravity.CENTER
            typeface = Typeface.DEFAULT_BOLD
        }
        iconWrap.addView(icon, FrameLayout.LayoutParams(dp(88), dp(88), Gravity.CENTER))
        content.addView(
            iconWrap,
            LinearLayout.LayoutParams(-2, dp(96)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(18)
            },
        )

        content.addView(title(if (fromRegister) "Pedido enviado!" else "Aguardando aprovação"))
        content.addView(
            subtitle(
                if (fromRegister) {
                    "Recebemos seu cadastro. Nossa equipe vai analisar e liberar o acesso em breve."
                } else {
                    "Sua conta ainda não foi liberada pelo administrador."
                },
            ),
        )

        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = android.graphics.drawable.GradientDrawable().apply {
                setColor(Color.parseColor("#14141C"))
                cornerRadius = dp(14).toFloat()
                setStroke(dp(1), Color.parseColor("#2A2A35"))
            }
        }
        fun addRow(label: String, value: String) {
            card.addView(
                TextView(this).apply {
                    text = "$label\n$value"
                    setTextColor(Color.parseColor("#CFCFD8"))
                    textSize = 13f
                    setPadding(0, dp(4), 0, dp(4))
                    setLineSpacing(0f, 1.15f)
                },
            )
        }
        if (name.isNotBlank()) addRow("Nome", name)
        if (email.isNotBlank()) addRow("E-mail", email)
        addRow("Status", "Aguardando aprovação")
        content.addView(
            card,
            LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = dp(8)
                bottomMargin = dp(16)
            },
        )

        content.addView(
            TextView(this).apply {
                text = "Você receberá o acesso assim que um administrador aprovar sua conta. Enquanto isso, não é possível entrar no app."
                setTextColor(Color.parseColor("#8B8B98"))
                textSize = 13f
                gravity = Gravity.CENTER
                setLineSpacing(0f, 1.25f)
            },
            LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(20) },
        )

        content.addView(
            button("Entendi — voltar ao login", primary = true) { showLogin(null) },
            buttonParams(),
        )
        content.addView(
            button("Já fui aprovado? Tentar entrar", primary = false) { showLogin(null) },
            buttonParams(),
        )

        finishLayout(null)
    }

    private fun openMain() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK,
                ),
        )
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
        finish()
    }

    private fun finishLayout(error: String?) {
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(content)
        }
        root.addView(scroll, FrameLayout.LayoutParams(-1, -1))
        loadingOverlay = FrameLayout(this).apply {
            visibility = View.GONE
            setBackgroundColor(Color.argb(180, 0, 0, 0))
            isClickable = true
            val box = LinearLayout(this@AuthActivity).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setPadding(dp(24), dp(24), dp(24), dp(24))
                addView(ProgressBar(this@AuthActivity))
                addView(
                    TextView(this@AuthActivity).apply {
                        text = "Aguarde…"
                        setTextColor(Color.WHITE)
                        textSize = 15f
                        gravity = Gravity.CENTER
                        setPadding(0, dp(12), 0, 0)
                        tag = "loading_text"
                    },
                )
            }
            addView(box, FrameLayout.LayoutParams(-2, -2, Gravity.CENTER))
        }
        root.addView(loadingOverlay, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        if (!error.isNullOrBlank()) showError(error)
    }

    private fun showLoading(text: String) {
        loadingOverlay?.let { overlay ->
            overlay.visibility = View.VISIBLE
            val box = overlay.getChildAt(0) as? LinearLayout
            val label = box?.findViewWithTag<TextView>("loading_text")
            label?.text = text
        }
    }

    private fun hideLoading() {
        loadingOverlay?.visibility = View.GONE
    }

    private fun showError(s: String) {
        TedflixDialogs.error(this, "Não foi possível continuar", s)
    }

    private fun column() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        setPadding(dp(25), dp(30), dp(25), dp(28))
    }

    private fun title(t: String) = TextView(this).apply {
        text = t
        textSize = 27f
        setTextColor(Color.WHITE)
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        setPadding(0, 0, 0, dp(7))
    }

    private fun subtitle(t: String) = TextView(this).apply {
        text = t
        textSize = 15f
        setTextColor(Color.LTGRAY)
        gravity = Gravity.CENTER
        setPadding(0, 0, 0, dp(22))
    }

    private fun field(label: String, hintText: String, type: Int) = EditText(this).apply {
        hint = hintText
        contentDescription = label
        inputType = type
        setSingleLine(true)
        textSize = 16f
        setTextColor(Color.WHITE)
        setHintTextColor(Color.GRAY)
        setPadding(dp(14), 0, dp(14), 0)
        background = rounded(Color.rgb(15, 15, 15), dp(9), Color.DKGRAY, dp(1))
    }


    private fun passwordText(wrap: View): String {
        val et = wrap.findViewWithTag<EditText>("password_input")
        return et?.text?.toString().orEmpty()
    }

    /** Campo de senha com botão mostrar/esconder. */
    private fun passwordField(label: String, hintText: String): FrameLayout {
        val wrap = FrameLayout(this)
        val input = field(label, hintText, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD).apply {
            tag = "password_input"
            setPadding(dp(14), 0, dp(52), 0)
        }
        val toggle = TextView(this).apply {
            text = "👁"
            textSize = 18f
            gravity = Gravity.CENTER
            setTextColor(Color.LTGRAY)
            contentDescription = "Mostrar ou esconder senha"
            isClickable = true
            isFocusable = true
            setPadding(dp(8), 0, dp(12), 0)
            setOnClickListener {
                val showing = (input.inputType and InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD) == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                if (showing) {
                    input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
                    text = "👁"
                    contentDescription = "Mostrar senha"
                } else {
                    input.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                    text = "🙈"
                    contentDescription = "Esconder senha"
                }
                input.setSelection(input.text?.length ?: 0)
            }
        }
        wrap.addView(input, FrameLayout.LayoutParams(-1, -1))
        wrap.addView(toggle, FrameLayout.LayoutParams(dp(48), -1, Gravity.END or Gravity.CENTER_VERTICAL))
        return wrap
    }

    private fun button(textValue: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = textValue
        isAllCaps = false
        textSize = 16f
        setTextColor(Color.WHITE)
        background = rounded(
            if (primary) Color.rgb(229, 9, 20) else Color.rgb(38, 38, 42),
            dp(10),
            Color.TRANSPARENT,
            0,
        )
        setOnClickListener {
            if (!busy) onClick()
        }
    }

    private fun fieldParams() = LinearLayout.LayoutParams(-1, dp(54)).apply { bottomMargin = dp(12) }
    private fun buttonParams() = LinearLayout.LayoutParams(-1, dp(52)).apply { bottomMargin = dp(5) }

    private fun backdrop() = FrameLayout(this).apply {
        setBackgroundColor(Color.BLACK)
        addView(
            ImageView(this@AuthActivity).apply {
                setImageResource(R.drawable.tedflix_auth_banner)
                scaleType = ImageView.ScaleType.CENTER_CROP
                alpha = 0.5f
            },
            FrameLayout.LayoutParams(-1, -1),
        )
        addView(
            View(this@AuthActivity).apply { setBackgroundColor(Color.argb(175, 0, 0, 0)) },
            FrameLayout.LayoutParams(-1, -1),
        )
    }

    private fun rounded(fill: Int, radius: Int, stroke: Int, width: Int) =
        android.graphics.drawable.GradientDrawable().apply {
            setColor(fill)
            cornerRadius = radius.toFloat()
            if (width > 0) setStroke(width, stroke)
        }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
