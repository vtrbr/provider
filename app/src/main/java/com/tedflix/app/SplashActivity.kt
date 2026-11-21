package com.tedflix.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import androidx.media3.common.util.UnstableApi
import com.tedflix.app.auth.AuthActivity
import com.tedflix.app.auth.AuthSession

@UnstableApi
class SplashActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Fundo preto imediato (sem flash cinza do sistema)
        window.statusBarColor = Color.rgb(5, 6, 9)
        window.navigationBarColor = Color.rgb(5, 6, 9)
        window.setBackgroundDrawableResource(android.R.color.black)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        AuthSession.init(applicationContext)
        setContentView(TedflixLoading.create(this))
        window.decorView.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            val next = if (AuthSession.hasToken()) {
                Intent(this, MainActivity::class.java)
            } else {
                Intent(this, AuthActivity::class.java)
            }
            startActivity(next)
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
            finish()
        }, 180L)
    }
}
