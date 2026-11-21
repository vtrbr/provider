package com.tedflix.app.ui

import android.app.Activity
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import android.graphics.drawable.ColorDrawable

/**
 * Diálogos nativos do TEDFLIX com a mesma linguagem visual do componente da WebView:
 * fundo escurecido, cartão escuro arredondado, ícone destacado e ações claras.
 */
object TedflixDialogs {
    fun confirm(
        activity: Activity,
        title: String,
        message: String,
        icon: String = "trash",
        confirmText: String = "Confirmar",
        cancelText: String = "Cancelar",
        tone: String = "danger",
        onConfirm: () -> Unit,
        onCancel: (() -> Unit)? = null,
    ) {
        show(activity, title, message, icon, true, confirmText, cancelText, onConfirm, onCancel, tone)
    }

    fun notice(
        activity: Activity,
        title: String,
        message: String,
        icon: String = "info",
        tone: String = "info",
        buttonText: String = "Entendi",
        onDismiss: (() -> Unit)? = null,
    ) {
        val dismiss: () -> Unit = { onDismiss?.invoke(); Unit }
        show(activity, title, message, if (tone == "error") "error" else icon, false, buttonText, "", dismiss, dismiss, tone)
    }

    fun error(activity: Activity, title: String, message: String, onDismiss: (() -> Unit)? = null) {
        notice(activity, title, message, icon = "error", tone = "error", onDismiss = onDismiss)
    }

    private fun show(
        activity: Activity,
        title: String,
        message: String,
        icon: String,
        needsChoice: Boolean,
        acceptText: String,
        cancelText: String,
        onAccept: () -> Unit,
        onCancel: (() -> Unit)?,
        tone: String = "danger",
    ) {
        if (activity.isFinishing || (android.os.Build.VERSION.SDK_INT >= 17 && activity.isDestroyed)) return
        val dialog = Dialog(activity, com.tedflix.app.R.style.TedflixDialog)
        val card = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(activity, 22), dp(activity, 25), dp(activity, 22), dp(activity, 20))
            background = GradientDrawable().apply {
                setColor(Color.rgb(19, 19, 24))
                cornerRadius = dp(activity, 25).toFloat()
                setStroke(dp(activity, 1), Color.rgb(60, 60, 70))
            }
        }

        val closeRow = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END
        }
        val close = TextView(activity).apply {
            text = "×"
            textSize = 27f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = rounded(activity, Color.rgb(43, 43, 50), 50)
            isClickable = true
            isFocusable = true
            setOnClickListener {
                dialog.dismiss()
                onCancel?.invoke()
            }
        }
        closeRow.addView(close, LinearLayout.LayoutParams(dp(activity, 38), dp(activity, 38)))
        card.addView(closeRow)

        val iconColor = when (tone) {
            "success" -> Color.rgb(55, 214, 138)
            "warning" -> Color.rgb(255, 198, 91)
            "info" -> Color.rgb(117, 191, 255)
            else -> Color.rgb(255, 38, 52)
        }
        val iconBox = android.widget.FrameLayout(activity).apply {
            background = GradientDrawable().apply {
                setColor(Color.argb(28, Color.red(iconColor), Color.green(iconColor), Color.blue(iconColor)))
                cornerRadius = dp(activity, 18).toFloat()
                setStroke(dp(activity, 1), Color.argb(105, Color.red(iconColor), Color.green(iconColor), Color.blue(iconColor)))
            }
            addView(DialogSymbolView(context, icon, iconColor), android.widget.FrameLayout.LayoutParams(-1, -1))
        }
        card.addView(iconBox, LinearLayout.LayoutParams(dp(activity, 68), dp(activity, 68)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            topMargin = dp(activity, 2)
            bottomMargin = dp(activity, 17)
        })

        val heading = TextView(activity).apply {
            text = title
            textSize = 22f
            setTextColor(Color.WHITE)
            typeface = Typeface.create("sans-serif", Typeface.BOLD)
            gravity = Gravity.CENTER
        }
        card.addView(heading, LinearLayout.LayoutParams(-1, -2).apply {
            bottomMargin = dp(activity, 10)
        })

        val body = TextView(activity).apply {
            text = message
            textSize = 15.5f
            setTextColor(Color.rgb(218, 218, 224))
            gravity = Gravity.CENTER
            setLineSpacing(dp(activity, 2).toFloat(), 1.0f)
        }
        card.addView(body, LinearLayout.LayoutParams(-1, -2).apply {
            bottomMargin = dp(activity, 23)
        })

        val actions = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }
        if (needsChoice) {
            val cancel = actionButton(activity, cancelText, false)
            cancel.setOnClickListener {
                dialog.dismiss()
                onCancel?.invoke()
            }
            actions.addView(cancel, LinearLayout.LayoutParams(0, dp(activity, 49), 1f).apply {
                marginEnd = dp(activity, 7)
            })
        }
        val accept = actionButton(activity, acceptText, true)
        accept.setOnClickListener {
            dialog.dismiss()
            onAccept()
        }
        actions.addView(accept, LinearLayout.LayoutParams(0, dp(activity, 49), 1f).apply {
            if (needsChoice) marginStart = dp(activity, 7)
        })
        card.addView(actions)

        dialog.setContentView(card)
        dialog.setCancelable(true)
        dialog.setCanceledOnTouchOutside(true)
        dialog.setOnCancelListener { onCancel?.invoke() }
        dialog.window?.let { window ->
            window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            val params = window.attributes
            params.dimAmount = 0.78f
            window.attributes = params
        }
        dialog.show()
        dialog.window?.setLayout(
            minOf(activity.resources.displayMetrics.widthPixels - dp(activity, 40), dp(activity, 420)),
            WindowManager.LayoutParams.WRAP_CONTENT,
        )
    }

    private class DialogSymbolView(context: Context, private val kind: String, color: Int) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color
            style = Paint.Style.STROKE
            strokeWidth = 1.9f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val unit = minOf(width, height) / 24f
            canvas.save()
            canvas.translate((width - 24f * unit) / 2f, (height - 24f * unit) / 2f)
            canvas.scale(unit, unit)
            when (kind) {
                "trash" -> {
                    canvas.drawLine(4f, 6f, 20f, 6f, paint)
                    canvas.drawLine(9f, 6f, 9f, 4f, paint)
                    canvas.drawLine(15f, 6f, 15f, 4f, paint)
                    canvas.drawRoundRect(RectF(6f, 8f, 18f, 21f), 1.5f, 1.5f, paint)
                    canvas.drawLine(10f, 11f, 10f, 18f, paint)
                    canvas.drawLine(14f, 11f, 14f, 18f, paint)
                }
                "heart" -> {
                    val path = Path().apply {
                        moveTo(12f, 21f)
                        cubicTo(10f, 19f, 3f, 13.5f, 3f, 8.2f)
                        cubicTo(3f, 2.5f, 9.3f, 1.2f, 12f, 6.4f)
                        cubicTo(14.7f, 1.2f, 21f, 2.5f, 21f, 8.2f)
                        cubicTo(21f, 13.5f, 14f, 19f, 12f, 21f)
                    }
                    canvas.drawPath(path, paint)
                }
                "logout" -> {
                    canvas.drawLine(10f, 17f, 15f, 12f, paint)
                    canvas.drawLine(15f, 12f, 10f, 7f, paint)
                    canvas.drawLine(15f, 12f, 3f, 12f, paint)
                    canvas.drawPath(Path().apply { moveTo(13f, 3f); lineTo(19f, 3f); lineTo(21f, 5f); lineTo(21f, 19f); lineTo(19f, 21f); lineTo(13f, 21f) }, paint)
                }
                "warning" -> {
                    canvas.drawPath(Path().apply { moveTo(12f, 3f); lineTo(22f, 21f); lineTo(2f, 21f); close() }, paint)
                    canvas.drawLine(12f, 9f, 12f, 14f, paint)
                    canvas.drawCircle(12f, 17.5f, .6f, paint)
                }
                "error" -> {
                    canvas.drawCircle(12f, 12f, 9f, paint)
                    canvas.drawLine(9f, 9f, 15f, 15f, paint)
                    canvas.drawLine(15f, 9f, 9f, 15f, paint)
                }
                "success" -> {
                    canvas.drawPath(Path().apply { moveTo(4f, 12f); lineTo(9f, 17f); lineTo(20f, 6f) }, paint)
                }
                "download" -> {
                    canvas.drawPath(Path().apply { moveTo(12f, 3f); lineTo(12f, 16f); moveTo(7f, 11f); lineTo(12f, 16f); lineTo(17f, 11f) }, paint)
                    canvas.drawPath(Path().apply { moveTo(4f, 18f); lineTo(4f, 21f); lineTo(20f, 21f); lineTo(20f, 18f) }, paint)
                }
                else -> {
                    canvas.drawCircle(12f, 12f, 9f, paint)
                    canvas.drawLine(12f, 11f, 12f, 16f, paint)
                    canvas.drawCircle(12f, 8f, .6f, paint)
                }
            }
            canvas.restore()
        }
    }

    private fun actionButton(activity: Activity, label: String, primary: Boolean) = TextView(activity).apply {
        text = label
        textSize = 15f
        gravity = Gravity.CENTER
        maxLines = 2
        setPadding(dp(activity, 8), dp(activity, 7), dp(activity, 8), dp(activity, 7))
        typeface = Typeface.create("sans-serif", Typeface.BOLD)
        setTextColor(Color.WHITE)
        background = if (primary) {
            GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.rgb(240, 24, 43), Color.rgb(229, 9, 20))).apply {
                cornerRadius = dp(activity, 28).toFloat()
            }
        } else {
            GradientDrawable().apply {
                setColor(Color.rgb(28, 28, 34))
                cornerRadius = dp(activity, 28).toFloat()
                setStroke(dp(activity, 1), Color.rgb(93, 93, 103))
            }
        }
        isClickable = true
        isFocusable = true
    }

    private fun rounded(activity: Activity, color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(activity, radius).toFloat()
    }

    private fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()

}
