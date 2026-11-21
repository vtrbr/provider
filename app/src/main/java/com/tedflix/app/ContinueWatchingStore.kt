package com.tedflix.app

import android.content.Context
import com.tedflix.app.auth.AuthSession
import org.json.JSONArray
import org.json.JSONObject

/** Progresso local por perfil; sincroniza com a API de histórico/progresso. */
object ContinueWatchingStore {
    private const val LEGACY_PREFS = "tedflix_continue_watching"
    private const val ITEMS = "items"
    private const val MAX_ITEMS = 30

    private fun prefs(context: Context): android.content.SharedPreferences {
        val profileId = AuthSession.activeProfileId().trim()
        if (profileId.isBlank()) return context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
        val scopedName = "${LEGACY_PREFS}_$profileId"
        val scoped = context.getSharedPreferences(scopedName, Context.MODE_PRIVATE)
        if (!scoped.contains(ITEMS)) {
            val legacy = context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
            if (legacy.contains(ITEMS)) {
                scoped.edit().putString(ITEMS, legacy.getString(ITEMS, "[]")).apply()
            }
        }
        return scoped
    }

    data class Entry(
        val categoria: String,
        val slug: String,
        val titulo: String,
        val filmeId: String = "",
        val positionMs: Long,
        val durationMs: Long,
        val updatedAt: Long,
        val thumb: String = "",
        val tipo: String = "",
        val serieCategoria: String = "",
        val serieSlug: String = "",
        val temporada: Int = 0,
        val episodio: Int = 0,
        val serieTitulo: String = "",
    ) {
        val key: String get() = "$categoria:$slug"
        val percent: Int get() = if (durationMs > 0) ((positionMs * 100L) / durationMs).toInt().coerceIn(0, 99) else 0
        val isEpisode: Boolean
            get() = tipo.contains("epis", ignoreCase = true) ||
                serieSlug.isNotBlank() ||
                temporada > 0 ||
                episodio > 0
        /** Rótulo Netflix: S2E4 */
        val epLabel: String
            get() = when {
                temporada > 0 && episodio > 0 -> "S${temporada}E${episodio}"
                episodio > 0 -> "E${episodio}"
                else -> ""
            }
    }

    /**
     * Extrai temporada/episódio de títulos tipo "4. Nome", "S02E04", "T2 E4", etc.
     */
    fun parseEpisodeMeta(titulo: String, slug: String = ""): Pair<Int, Int> {
        val t = titulo.trim()
        val s = slug.trim()
        val patterns = listOf(
            Regex("""(?i)s(\d{1,2})\s*e(\d{1,3})"""),
            Regex("""(?i)t(\d{1,2})\s*e(\d{1,3})"""),
            Regex("""(?i)temporada\s*(\d{1,2}).{0,12}epis[oó]dio\s*(\d{1,3})"""),
            Regex("""^(\d{1,2})[x×](\d{1,3})\b"""),
        )
        for (p in patterns) {
            val m = p.find(t) ?: p.find(s)
            if (m != null) {
                val a = m.groupValues.getOrNull(1)?.toIntOrNull() ?: 0
                val b = m.groupValues.getOrNull(2)?.toIntOrNull() ?: 0
                if (a > 0 && b > 0) return a to b
            }
        }
        // "12. Título do episódio"
        val numbered = Regex("""^(\d{1,3})\.\s+\S""").find(t)
        if (numbered != null) {
            val ep = numbered.groupValues[1].toIntOrNull() ?: 0
            if (ep > 0) return 0 to ep
        }
        return 0 to 0
    }

    fun save(
        context: Context,
        categoria: String,
        slug: String,
        titulo: String,
        positionMs: Long,
        durationMs: Long,
        filmeId: String = "",
        thumb: String = "",
        tipo: String = "",
        serieCategoria: String = "",
        serieSlug: String = "",
        temporada: Int = 0,
        episodio: Int = 0,
        serieTitulo: String = "",
    ) {
        if (categoria.isBlank() || slug.isBlank() || positionMs < 10_000L || durationMs <= 0L) return
        if (positionMs >= (durationMs * 0.9f).toLong()) {
            remove(context, categoria, slug)
            return
        }
        val parsed = parseEpisodeMeta(titulo, slug)
        val temp = if (temporada > 0) temporada else parsed.first
        val ep = if (episodio > 0) episodio else parsed.second
        val fid = filmeId.ifBlank { slug }
        val sSlug = serieSlug.trim()
        // Remove apenas a mesma mídia. Episódios da mesma série precisam coexistir.
        val entries = read(context).filterNot { existing ->
            existing.key == "$categoria:$slug" ||
                (fid.isNotBlank() && existing.filmeId.equals(fid, ignoreCase = true) &&
                    temp <= 0 && existing.temporada <= 0 &&
                    !tipo.contains("episod", ignoreCase = true) &&
                    !existing.tipo.contains("episod", ignoreCase = true))
        }.toMutableList()
        entries.add(
            0,
            Entry(
                categoria,
                slug,
                titulo.ifBlank { "Tedflix" },
                fid,
                positionMs,
                durationMs,
                System.currentTimeMillis(),
                thumb,
                tipo,
                serieCategoria,
                sSlug,
                temp,
                ep,
                serieTitulo,
            ),
        )
        write(context, entries.take(MAX_ITEMS))
    }

    fun remove(context: Context, categoria: String, slug: String) {
        write(context, read(context).filterNot { it.key == "$categoria:$slug" })
    }

    fun read(context: Context): List<Entry> {
        val raw = prefs(context).getString(ITEMS, "[]") ?: "[]"
        return try {
            val json = JSONArray(raw)
            buildList {
                for (i in 0 until json.length()) {
                    val item = json.optJSONObject(i) ?: continue
                    val categoria = item.optString("categoria")
                    val slug = item.optString("slug")
                    if (categoria.isBlank() || slug.isBlank()) continue
                    val titulo = item.optString("titulo", "Tedflix")
                    var temp = item.optInt("temporada", 0)
                    var ep = item.optInt("episodio", 0)
                    if (temp <= 0 || ep <= 0) {
                        val parsed = parseEpisodeMeta(titulo, slug)
                        if (temp <= 0) temp = parsed.first
                        if (ep <= 0) ep = parsed.second
                    }
                    add(
                        Entry(
                            categoria,
                            slug,
                            titulo,
                            item.optString("filmeId", slug),
                            item.optLong("positionMs"),
                            item.optLong("durationMs"),
                            item.optLong("updatedAt"),
                            item.optString("thumb"),
                            item.optString("tipo"),
                            item.optString("serieCategoria"),
                            item.optString("serieSlug"),
                            temp,
                            ep,
                            item.optString("serieTitulo"),
                        ),
                    )
                }
            }.sortedByDescending { it.updatedAt }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    fun toJson(context: Context): String = JSONArray().apply {
        read(context).forEach { item ->
            put(
                JSONObject().apply {
                    put("categoria", item.categoria)
                    put("slug", item.slug)
                    put("titulo", item.titulo)
                    put("filmeId", item.filmeId)
                    put("positionMs", item.positionMs)
                    put("durationMs", item.durationMs)
                    put("percent", item.percent)
                    put("progresso", item.percent)
                    put("thumb", item.thumb)
                    put("tipo", item.tipo)
                    put("serieCategoria", item.serieCategoria)
                    put("serieSlug", item.serieSlug)
                    put("temporada", item.temporada)
                    put("episodio", item.episodio)
                    put("serieTitulo", item.serieTitulo)
                    put("epLabel", item.epLabel)
                    put("isEpisode", item.isEpisode)
                },
            )
        }
    }.toString()

    private fun write(context: Context, entries: List<Entry>) {
        val json = JSONArray().apply {
            entries.forEach { item ->
                put(
                    JSONObject().apply {
                        put("categoria", item.categoria)
                        put("slug", item.slug)
                        put("titulo", item.titulo)
                        put("filmeId", item.filmeId)
                        put("positionMs", item.positionMs)
                        put("durationMs", item.durationMs)
                        put("updatedAt", item.updatedAt)
                        put("thumb", item.thumb)
                        put("tipo", item.tipo)
                        put("serieCategoria", item.serieCategoria)
                        put("serieSlug", item.serieSlug)
                        put("temporada", item.temporada)
                        put("episodio", item.episodio)
                        put("serieTitulo", item.serieTitulo)
                    },
                )
            }
        }
        prefs(context).edit().putString(ITEMS, json.toString()).apply()
    }
}
