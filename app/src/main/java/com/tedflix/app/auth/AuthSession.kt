package com.tedflix.app.auth

import android.content.Context
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Sessão Tedflix: ID token e refresh token ficam cifrados no Android Keystore. */
object AuthSession {
    private const val TAG = "TedflixAuthSession"
    // User/Admin Server documentado em 02/10/2026. O Catalog Server continua separado.
    private const val AUTH_BASE = "https://login.tedflix.site"
    const val MOVIE_API_BASE = "https://api.tedflix.site"
    const val MOVIE_API_HOST = "api.tedflix.site"
    /** TEDTOP v6 — catálogo, ficha e ingresso/player direto (público, sem auth). */
    const val TEDTOP_API_BASE = "https://v6-tedtop.onrender.com"
    const val TEDTOP_API_HOST = "v6-tedtop.onrender.com"
    private const val PREFS = "tedflix_auth_session"
    private const val TOKEN_KEY = "encrypted_access_token"
    private const val REFRESH_KEY = "encrypted_refresh_token"
    private const val KEY_ALIAS = "TedflixAuthBearerKey"
    private const val PROFILES_PREFS = "tedflix_saved_profiles"
    private const val PROFILES_KEY = "profiles_json"
    private const val ACTIVE_PROFILE_KEY = "active_profile_id"

    data class User(val id:String="", val email:String="", val username:String="", val expiresAt:String="", val accountStatus:String="", val daysRemaining:Int?=null, val createdAt:String="", val lastUsedAt:String="", val warning:JSONObject?=null, val name:String="", val role:String="", val emailVerified:Boolean?=null, val approvalStatus:String="")
    data class Profile(val id:String, val name:String, val avatarSeed:String, val avatarStyle:String="fun-emoji", val email:String="", val username:String="", val isKids:Boolean=false, val isPrimary:Boolean=false)
    private data class StoredProfile(val id:String,val name:String,val avatarSeed:String,val avatarStyle:String,val email:String,val username:String,val isKids:Boolean,val isPrimary:Boolean,val user:User,val encryptedToken:String)
    data class Favorite(val filmeId:String,val titulo:String,val thumb:String,val adicionadoEm:String,val categoria:String="",val slug:String="",val tipo:String="")
    data class CatalogMatch(val filmeId:String,val titulo:String,val thumb:String,val categoria:String,val slug:String,val tipo:String)
    data class HistoryItem(val filmeId:String,val titulo:String,val tempo:String,val thumb:String,val ultimoAcesso:String,val categoria:String="",val slug:String="",val tipo:String="",val serieCategoria:String="",val serieSlug:String="",val positionSeconds:Long=0,val durationSeconds:Long=0)
    data class Result<T>(val ok:Boolean,val value:T?=null,val message:String="",val statusCode:Int=0)
    data class RawResponse(val statusCode:Int,val body:String,val contentType:String)
    private lateinit var appContext:Context
    fun init(context:Context){ appContext=context.applicationContext }
    fun hasToken()=token()?.isNotBlank()==true
    fun isPendingApproval():Boolean {
        val u = cachedUser() ?: return false
        return u.approvalStatus.equals("pending", ignoreCase = true)
    }

    fun token():String? = readSecret(TOKEN_KEY)
    private fun refreshToken():String? = readSecret(REFRESH_KEY)
    private fun readSecret(key:String):String? { if(!::appContext.isInitialized)return null; val raw=appContext.getSharedPreferences(PREFS,0).getString(key,null)?:return null; return try{decrypt(raw)}catch(_:Throwable){null} }
    fun saveLogin(accessToken:String,user:User?,refresh:String?=null){ if(accessToken.isBlank())return; val e=appContext.getSharedPreferences(PREFS,0).edit().putString(TOKEN_KEY,encrypt(accessToken)); if(!refresh.isNullOrBlank())e.putString(REFRESH_KEY,encrypt(refresh)); e.putString("user_id",user?.id.orEmpty()).putString("user_email",user?.email.orEmpty()).putString("user_name",user?.username.orEmpty()).putString("user_real_name",user?.name.orEmpty()).putString("expires_at",user?.expiresAt.orEmpty()).putString("account_status",user?.accountStatus.orEmpty()).putInt("days_remaining",user?.daysRemaining?:-1).putString("created_at",user?.createdAt.orEmpty()).putString("last_used_at",user?.lastUsedAt.orEmpty()).putString("role",user?.role.orEmpty()).putString("approval_status",user?.approvalStatus.orEmpty()).commit() }
    fun cachedUser():User? { if(!hasToken())return null; val p=appContext.getSharedPreferences(PREFS,0); return User(p.getString("user_id","").orEmpty(),p.getString("user_email","").orEmpty(),p.getString("user_name","").orEmpty(),p.getString("expires_at","").orEmpty(),p.getString("account_status","").orEmpty(),p.getInt("days_remaining",-1).takeIf{it>=0},p.getString("created_at","").orEmpty(),p.getString("last_used_at","").orEmpty(),name=p.getString("user_real_name","").orEmpty(),role=p.getString("role","").orEmpty(),approvalStatus=p.getString("approval_status","").orEmpty()) }
    fun clear(){ if(!::appContext.isInitialized)return; appContext.getSharedPreferences(PREFS,0).edit().clear().apply(); appContext.getSharedPreferences(PROFILES_PREFS,0).edit().clear().apply() }
    fun profiles():List<Profile> = readStoredProfiles().map{it.public()}
    /** Perfis já sincronizados permanecem disponíveis localmente, mesmo sem rede. */
    fun hasLocalProfiles(): Boolean = readStoredProfiles().isNotEmpty()
    /** Seleção local para inicialização offline; não concede acesso a endpoints protegidos. */
    fun activateProfileOffline(id: String): Result<Profile> {
        val profile = readStoredProfiles().firstOrNull { it.id == id }
            ?: return Result(false, message = "Perfil local não encontrado.")
        appContext.getSharedPreferences(PROFILES_PREFS, 0).edit()
            .putString(ACTIVE_PROFILE_KEY, id).commit()
        return Result(true, profile.public())
    }
    fun activeProfileId():String { val p=appContext.getSharedPreferences(PROFILES_PREFS,0); val id=p.getString(ACTIVE_PROFILE_KEY,"").orEmpty(); return readStoredProfiles().firstOrNull{it.id==id}?.id?:readStoredProfiles().firstOrNull()?.id.orEmpty() }
    fun restoreActiveProfileIfNeeded()=hasToken()
    fun ensureCurrentProfile(defaultName:String,defaultAvatarSeed:String):Profile? { val existing=readStoredProfiles().firstOrNull(); if(existing!=null)return existing.public(); return null }

    fun register(name:String,email:String,password:String):Result<User>{
        if(name.isBlank()||email.isBlank()||password.isBlank())return Result(false,message="Preencha nome, e-mail e senha.")
        return authRequest("/api/auth/register",JSONObject().put("name",name.trim()).put("email",email.trim()).put("password",password),true)
    }
    fun login(email:String,password:String):Result<User>{
        if(email.isBlank()||password.isBlank())return Result(false,message="Informe e-mail e senha.")
        return authRequest("/api/auth/login",JSONObject().put("email",email.trim()).put("password",password),true)
    }
    private fun authRequest(path:String,body:JSONObject,save:Boolean):Result<User>{ return try{ val r=rawRequest("POST",path,body.toString(),false); val j=parseObject(r.body); if(r.statusCode !in 200..299)return Result(false,message=serverMessage(j,r.statusCode),statusCode=r.statusCode); val (token, refreshTok)=extractTokens(j); if(token.isBlank())return Result(false,message="O servidor não devolveu uma sessão válida.",statusCode=r.statusCode); val accObj=j.optJSONObject("account")?:j.optJSONObject("user");
            val baseUser=(parseUser(accObj)?:User(email=body.optString("email"),name=body.optString("name"))).let{ u ->
                val ap = accObj?.optString("approvalStatus").orEmpty().ifBlank{ u.approvalStatus }
                val st = accObj?.optString("status").orEmpty().ifBlank{ u.accountStatus }
                u.copy(approvalStatus=ap, accountStatus=st.ifBlank{u.accountStatus})
            };
 val sub=j.optJSONObject("subscription")
            val expires = (sub?.optString("expiresAt").orEmpty()).ifBlank{baseUser.expiresAt}
            val started = (sub?.optString("startedAt").orEmpty()).ifBlank{firestoreTimestampToIso(sub?.opt("createdAt"))}.ifBlank{baseUser.createdAt}
            val updated = firestoreTimestampToIso(sub?.opt("updatedAt")).ifBlank{baseUser.lastUsedAt}
            val status = (sub?.optString("status").orEmpty()).ifBlank{baseUser.accountStatus}.ifBlank{"active"}
            val days = daysUntil(expires) ?: baseUser.daysRemaining
            val user = baseUser.copy(expiresAt=expires, accountStatus=status, daysRemaining=days, createdAt=started, lastUsedAt=updated)
            saveLogin(token,user,refreshTok)
            syncProfiles(j)
            Result(true,user,statusCode=r.statusCode) }catch(e:Throwable){Result(false,message=friendlyNetworkError(e))} }
    private fun syncProfiles(j:JSONObject){ val arr=j.optJSONArray("profiles")?:j.optJSONObject("data")?.optJSONArray("profiles")?:return; val token=token()?:return; val user=cachedUser()?:User(); val list=mutableListOf<StoredProfile>(); for(i in 0 until arr.length()){val p=arr.optJSONObject(i)?:continue; val av=p.optJSONObject("avatar"); val seed=av?.optString("seed").orEmpty().ifBlank{p.optString("avatarSeed").ifBlank{"tedflix-avatar-${i+1}"}}; list+=StoredProfile(p.optString("id").ifBlank{p.optString("profileId")},p.optString("name").ifBlank{"Meu perfil"},seed,av?.optString("style").orEmpty().ifBlank{p.optString("avatarStyle").ifBlank{"fun-emoji"}},user.email,p.optString("username"),p.optBoolean("isKids",false),p.optBoolean("isPrimary",false),user,encrypt(token))}; if(list.isNotEmpty())saveStoredProfiles(list,list.firstOrNull{it.isPrimary}?.id?:list.first().id) else appContext.getSharedPreferences(PROFILES_PREFS,0).edit().clear().apply() }
    
    private fun firestoreTimestampToIso(v:Any?):String{
        if(v==null)return ""
        if(v is String)return v
        return try{
            val o = v as? JSONObject ?: return ""
            val sec = o.optLong("_seconds", 0L)
            if(sec<=0L) return ""
            java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply{
                timeZone = java.util.TimeZone.getTimeZone("UTC")
            }.format(java.util.Date(sec*1000L))
        }catch(_:Throwable){""}
    }
    private fun daysUntil(iso:String):Int?{
        if(iso.isBlank())return null
        return try{
            val formats = arrayOf(
                "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                "yyyy-MM-dd'T'HH:mm:ss'Z'",
                "yyyy-MM-dd"
            )
            var date:java.util.Date?=null
            for(f in formats){
                try{
                    date = java.text.SimpleDateFormat(f, java.util.Locale.US).apply{
                        timeZone = java.util.TimeZone.getTimeZone("UTC")
                    }.parse(iso)
                    if(date!=null)break
                }catch(_:Throwable){}
            }
            if(date==null)return null
            val diff = date.time - System.currentTimeMillis()
            (diff / (24L*60L*60L*1000L)).toInt().coerceAtLeast(0)
        }catch(_:Throwable){null}
    }
    /** Atualiza conta + assinatura a partir de /api/auth/me */
    fun refreshAccount():Result<User>{
        if(!hasToken())return Result(false,message="Sem sessão.",statusCode=401)
        return try{
            val r = rawRequest("GET","/api/auth/me",null,true)
            val j = parseObject(r.body)
            if(r.statusCode==401){
                val refreshed = refreshSession()
                if(refreshed.ok){
                    val r2 = rawRequest("GET","/api/auth/me",null,true)
                    val j2 = parseObject(r2.body)
                    if(r2.statusCode !in 200..299) return Result(false,message=serverMessage(j2,r2.statusCode),statusCode=r2.statusCode)
                    return persistAccountFromMe(j2)
                }
                return Result(false,message=refreshed.message,statusCode=401)
            }
            if(r.statusCode !in 200..299) return Result(false,message=serverMessage(j,r.statusCode),statusCode=r.statusCode)
            persistAccountFromMe(j)
        }catch(e:Throwable){Result(false,message=friendlyNetworkError(e))}
    }
    private fun persistAccountFromMe(j:JSONObject):Result<User>{
        val account = j.optJSONObject("account") ?: j.optJSONObject("user") ?: j
        val sub = j.optJSONObject("subscription")
        val base = parseUser(account) ?: User()
        val expires = (sub?.optString("expiresAt").orEmpty())
            .ifBlank{ base.expiresAt }
            .ifBlank{ account.optString("expiresAt") }
        val started = (sub?.optString("startedAt").orEmpty())
            .ifBlank{ firestoreTimestampToIso(sub?.opt("createdAt")) }
            .ifBlank{ account.optString("createdAt") }
            .ifBlank{ base.createdAt }
        val updated = firestoreTimestampToIso(sub?.opt("updatedAt"))
            .ifBlank{ account.optString("lastUsedAt") }
            .ifBlank{ account.optString("lastLoginAt") }
            .ifBlank{ base.lastUsedAt }
        val status = (sub?.optString("status").orEmpty())
            .ifBlank{ account.optString("status") }
            .ifBlank{ base.accountStatus }
            .ifBlank{ "active" }
        val days = daysUntil(expires) ?: base.daysRemaining
        val user = base.copy(
            expiresAt = expires,
            accountStatus = status,
            daysRemaining = days,
            createdAt = started,
            lastUsedAt = updated,
            name = base.name.ifBlank{ account.optString("name") },
            username = base.username.ifBlank{ account.optString("name") }.ifBlank{ account.optString("username") },
            email = base.email.ifBlank{ account.optString("email") },
            id = base.id.ifBlank{ account.optString("uid") }.ifBlank{ account.optString("id") },
        )
        // Regrava sem perder o token
        val token = token() ?: return Result(true, user)
        saveLogin(token, user, refreshToken())
        return Result(true, user)
    }

    fun refreshProfiles():Result<List<Profile>> { return try { val r=rawRequest("GET","/api/profiles",null,true); val j=parseObject(r.body); if(r.statusCode !in 200..299)return Result(false,message=serverMessage(j,r.statusCode),statusCode=r.statusCode); syncProfiles(j); Result(true,profiles(),statusCode=r.statusCode) } catch(e:Throwable) { Result(false,message=friendlyNetworkError(e)) } }
    fun activateProfile(id:String):Result<Profile>{
        val profile = readStoredProfiles().firstOrNull { it.id == id }
            ?: return Result(false, message = "Perfil não encontrado.")
        val selected = authenticatedJson("POST", "/api/profiles/${Uri.encode(id)}/select", "{}")
        if (!selected.ok) return Result(false, message = selected.message, statusCode = selected.statusCode)
        val accessResult = authenticatedJson("GET", "/api/profiles/${Uri.encode(id)}/access")
        if (!accessResult.ok) return Result(false, message = accessResult.message, statusCode = accessResult.statusCode)
        val access = accessResult.value?.optJSONObject("access")
            ?: return Result(false, message = "A API não devolveu o estado de acesso do perfil.", statusCode = accessResult.statusCode)
        if (!access.optBoolean("allowed", false)) return Result(false, message = "Este perfil não tem acesso liberado no momento.", statusCode = accessResult.statusCode)
        appContext.getSharedPreferences(PROFILES_PREFS, 0).edit().putString(ACTIVE_PROFILE_KEY, id).apply()
        return Result(true, profile.public(), statusCode = accessResult.statusCode)
    }
    fun createProfile(code:String,email:String,password:String,name:String,avatarSeed:String):Result<Profile> = createRemoteProfile(name,false,"fun-emoji",avatarSeed)
    fun createRemoteProfile(name:String,isKids:Boolean,style:String,seed:String="",username:String=""):Result<Profile>{ val body=JSONObject().put("name",name).put("isKids",isKids).put("avatar",JSONObject().put("style",style).put("seed",seed.ifBlank{name})); if(username.isNotBlank())body.put("username",username); return try{val r=rawRequest("POST","/api/profiles",body.toString(),true); val j=parseObject(r.body); if(r.statusCode !in 200..299)return Result(false,message=serverMessage(j,r.statusCode),statusCode=r.statusCode); val p=j.optJSONObject("profile")?:j.optJSONObject("createdProfile")?:j; val token=token()?:return Result(false,message="Sessão expirada."); val sp=StoredProfile(p.optString("id").ifBlank{p.optString("profileId")},p.optString("name").ifBlank{name},p.optJSONObject("avatar")?.optString("seed").orEmpty().ifBlank{seed.ifBlank{name}},p.optJSONObject("avatar")?.optString("style").orEmpty().ifBlank{style},cachedUser()?.email.orEmpty(),p.optString("username").ifBlank{username},p.optBoolean("isKids",isKids),p.optBoolean("isPrimary",false),cachedUser()?:User(),encrypt(token)); val all=readStoredProfiles()+sp; saveStoredProfiles(all,sp.id); Result(true,sp.public(),statusCode=r.statusCode)}catch(e:Throwable){Result(false,message=friendlyNetworkError(e))} }
    fun updateProfile(id:String,name:String,avatarSeed:String):Boolean{ val old=readStoredProfiles().firstOrNull{it.id==id}?:return false; return try{val body=JSONObject().put("name",name.ifBlank{old.name}).put("avatar",JSONObject().put("style",old.avatarStyle).put("seed",avatarSeed.ifBlank{old.avatarSeed})); val r=rawRequest("PATCH","/api/profiles/${Uri.encode(id)}",body.toString(),true); if(r.statusCode !in 200..299)return false; saveStoredProfiles(readStoredProfiles().map{if(it.id==id)it.copy(name=name.ifBlank{it.name},avatarSeed=avatarSeed.ifBlank{it.avatarSeed})else it},activeProfileId());true}catch(_:Throwable){false} }
    fun deleteProfile(id:String):Boolean{ val p=readStoredProfiles().firstOrNull{it.id==id}?:return false;if(p.isPrimary)return false; return try{val r=rawRequest("DELETE","/api/profiles/${Uri.encode(id)}",null,true);if(r.statusCode !in 200..299)return false;saveStoredProfiles(readStoredProfiles().filterNot{it.id==id},readStoredProfiles().firstOrNull{it.id!=id}?.id.orEmpty());true}catch(_:Throwable){false} }
    fun updateProfileFull(id:String,name:String,username:String,style:String,seed:String,isKids:Boolean):Result<JSONObject>{ val result=authenticatedJson("PATCH","/api/profiles/${Uri.encode(id)}",JSONObject().put("name",name).put("username",username).put("isKids",isKids).put("avatar",JSONObject().put("style",style).put("seed",seed)).toString()); if(result.ok){ val current=readStoredProfiles(); saveStoredProfiles(current.map{if(it.id==id)it.copy(name=name,username=username,avatarStyle=style,avatarSeed=seed,isKids=isKids)else it},activeProfileId()) }; return result }
    fun verify():Result<User> = profile()
    fun profile():Result<User> = authenticatedJson("GET","/api/auth/me").map{parseUser(it.optJSONObject("account")?:it)?:cachedUser()?:User()}
    fun status():Result<JSONObject> = authenticatedJson("GET","/api/subscription")
    
    /** Extrai access + refresh de respostas do login.tedflix.site (vários formatos). */
    private fun extractTokens(j: JSONObject): Pair<String, String?> {
        val auth = j.optJSONObject("auth") ?: j.optJSONObject("data") ?: j
        val token = sequenceOf(
            auth.optString("idToken"),
            auth.optString("accessToken"),
            auth.optString("access_token"),
            auth.optString("token"),
            j.optString("idToken"),
            j.optString("accessToken"),
            j.optString("access_token"),
            j.optString("token"),
        ).map { it.trim() }.firstOrNull { it.isNotBlank() }.orEmpty()
        val refresh = sequenceOf(
            auth.optString("refreshToken"),
            auth.optString("refresh_token"),
            j.optString("refreshToken"),
            j.optString("refresh_token"),
        ).map { it.trim() }.firstOrNull { it.isNotBlank() }
        return token to refresh
    }

    /** true se o JWT access token já expirou (ou expira em < 60s). Sem JWT → false. */
    private fun isAccessTokenExpiredOrNear(): Boolean {
        val t = token() ?: return true
        return try {
            val parts = t.split(".")
            if (parts.size < 2) return false
            var payload = parts[1]
            while (payload.length % 4 != 0) payload += "="
            val json = String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP))
            val exp = JSONObject(json).optLong("exp", 0L)
            if (exp <= 0L) return false
            val now = System.currentTimeMillis() / 1000L
            now >= (exp - 60L)
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * Garante token válido antes de chamadas autenticadas.
     * Se o access token estiver vencido (ou perto), chama /api/auth/refresh.
     */
    @Synchronized
    fun ensureFreshToken(): Boolean {
        if (!hasToken() && refreshToken().isNullOrBlank()) return false
        if (!isAccessTokenExpiredOrNear() && hasToken()) return true
        if (refreshToken().isNullOrBlank()) return hasToken()
        val r = refreshSession()
        return r.ok || hasToken()
    }


    /** Renova o idToken com o refreshToken. Não limpa a sessão se falhar por rede. */
    @Synchronized
    fun refreshSession():Result<User>{
        val rt = refreshToken()
        if (rt.isNullOrBlank()) return Result(false, message="Sessão expirada. Faça login novamente.", statusCode=401)
        return try {
            // Tenta os formatos aceitos pelo login.tedflix.site
            val body = JSONObject()
                .put("refreshToken", rt)
                .put("refresh_token", rt)
                .toString()
            val r = rawRequest("POST", "/api/auth/refresh", body, false)
            val j = parseObject(r.body)
            if (r.statusCode !in 200..299) {
                // Rede/5xx: não limpa sessão
                if (r.statusCode in listOf(400, 401, 403)) {
                    Log.w(TAG, "refreshSession rejected HTTP ${r.statusCode}: ${r.body.take(200)}")
                    clear()
                } else {
                    Log.w(TAG, "refreshSession transient HTTP ${r.statusCode}")
                }
                return Result(false, message=serverMessage(j, r.statusCode), statusCode=r.statusCode)
            }
            val (token, newRefresh) = extractTokens(j)
            if (token.isBlank()) return Result(false, message="Não foi possível renovar a sessão.", statusCode=r.statusCode)
            val user = parseUser(j.optJSONObject("account") ?: j.optJSONObject("user") ?: j.optJSONObject("data")) ?: cachedUser()
            // Mantém o refresh antigo se o server não devolver um novo
            saveLogin(token, user, newRefresh ?: rt)
            Log.i(TAG, "refreshSession ok")
            Result(true, user, statusCode=r.statusCode)
        } catch (e: Throwable) {
            Log.w(TAG, "refreshSession network: ${e.message}")
            Result(false, message=friendlyNetworkError(e))
        }
    }

    fun forgotPassword(email:String):Result<JSONObject>{
        if(email.isBlank())return Result(false,message="Informe o e-mail.")
        return try{
            val r=rawRequest("POST","/api/auth/forgot-password",JSONObject().put("email",email.trim()).toString(),false)
            val j=parseObject(r.body)
            if(r.statusCode in 200..299) Result(true,j,statusCode=r.statusCode)
            else Result(false,message=serverMessage(j,r.statusCode),statusCode=r.statusCode)
        }catch(e:Throwable){Result(false,message=friendlyNetworkError(e))}
    }

    private fun profilePath(suffix:String)="/api/profiles/${Uri.encode(activeProfileId())}$suffix"
    fun listFavorites():Result<List<Favorite>> = authenticatedJson("GET",profilePath("/favorites")).map{j->val a=j.optJSONArray("favorites")?:j.optJSONArray("favoritos")?:JSONArray();buildList{for(i in 0 until a.length()){val x=a.optJSONObject(i)?:continue;add(Favorite(x.optString("contentId").ifBlank{x.optString("filmeId")},x.optString("title").ifBlank{x.optString("titulo")},x.optString("thumb").ifBlank{x.optString("imagem")},x.optString("createdAt").ifBlank{x.optString("adicionadoEm")},x.optString("categoria"),x.optString("slug"),x.optString("contentType").ifBlank{x.optString("tipo")}))}}}
    fun toggleFavorite(filmeId:String,titulo:String,thumb:String,contentType:String="movie")=authenticatedJson("POST",profilePath("/favorites/toggle"),JSONObject().put("contentId",filmeId).put("title",titulo).put("thumb",thumb).put("contentType",contentType).toString()).map{it.optBoolean("favorited",it.optBoolean("favorito"))}
    fun continueWatching():Result<List<HistoryItem>> = authenticatedJson("GET",profilePath("/history")).map{j->val a=j.optJSONArray("history")?:j.optJSONArray("items")?:j.optJSONArray("resultados")?:JSONArray();buildList{for(i in 0 until a.length()){val x=a.optJSONObject(i)?:continue;val pos=x.optLong("positionSeconds",x.optLong("tempoSeconds",0));val dur=x.optLong("durationSeconds",0);add(HistoryItem(x.optString("contentId").ifBlank{x.optString("filmeId")},x.optString("title").ifBlank{x.optString("titulo")},x.optString("tempo").ifBlank{pos.toString()},x.optString("thumb").ifBlank{x.optString("imagem")},x.optString("updatedAt").ifBlank{x.optString("lastWatchedAt")},x.optString("categoria"),x.optString("slug"),x.optString("contentType").ifBlank{x.optString("tipo")},positionSeconds=pos,durationSeconds=dur))}}}

    /** Progresso individual — GET /api/profiles/:id/progress?contentId= */
    fun getProgress(contentId:String):Result<HistoryItem?>{
        val id=contentId.trim(); if(id.isBlank())return Result(true,null)
        return try{
            val r=authenticatedJson("GET", profilePath("/progress")+"?contentId="+Uri.encode(id))
            if(!r.ok)return Result(false,message=r.message,statusCode=r.statusCode)
            val j=r.value?:return Result(true,null)
            val p=j.optJSONObject("progress")?:j.optJSONObject("data")?:j
            if(p.optString("contentId").isBlank() && p.optString("filmeId").isBlank() && !p.has("positionSeconds"))return Result(true,null)
            val pos=p.optLong("positionSeconds",p.optLong("tempoSeconds",0))
            val dur=p.optLong("durationSeconds",0)
            Result(true, HistoryItem(
                p.optString("contentId").ifBlank{p.optString("filmeId")}.ifBlank{id},
                p.optString("title").ifBlank{p.optString("titulo")},
                p.optString("tempo").ifBlank{pos.toString()},
                p.optString("thumb").ifBlank{p.optString("imagem")},
                p.optString("updatedAt"),
                p.optString("categoria"),
                p.optString("slug"),
                p.optString("contentType").ifBlank{p.optString("tipo")},
                positionSeconds=pos,
                durationSeconds=dur
            ), statusCode=r.statusCode)
        }catch(e:Throwable){Result(false,message=friendlyNetworkError(e))}
    }
    fun resolveCatalogItem(query:String,filmeId:String=""):Result<CatalogMatch?> {
        val q = query.ifBlank { filmeId }.trim()
        if (q.isBlank()) return Result(true, null)
        return try {
            // Usa a pesquisa unificada pública do Content Server.
            val r = rawRequest("GET", "/api/search?q=${Uri.encode(q)}&type=all&page=1", null, false)
            val j = parseObject(r.body)
            if (r.statusCode !in 200..299) return Result(false, message=serverMessage(j, r.statusCode), statusCode=r.statusCode)
            val a = j.optJSONArray("results") ?: j.optJSONArray("resultados") ?: JSONArray()
            val candidates = (0 until a.length()).mapNotNull { a.optJSONObject(it) }
            val id = filmeId.trim()
            val x = candidates.firstOrNull {
                val sourceId = it.optString("sourceId").ifBlank { it.optString("id") }
                val sourceSlug = it.optString("sourceSlug").ifBlank { it.optString("slug") }
                (id.isNotBlank() && (sourceId == id || sourceSlug == id || it.optString("id") == id || "$sourceId:$sourceSlug" == id)) ||
                (q.isNotBlank() && (it.optString("title").equals(q, true) || sourceSlug.equals(q, true)))
            } ?: candidates.firstOrNull()
            if (x == null) return Result(true, null, statusCode=r.statusCode)
            val api = x.optString("api").ifBlank { x.optString("provider") }
            val sourceId = x.optString("sourceId").ifBlank { x.optString("id") }
            val sourceSlug = x.optString("sourceSlug").ifBlank { x.optString("slug").ifBlank { sourceId } }
            val type = x.optString("type").ifBlank { "movie" }
            Result(true, CatalogMatch(
                "$api:$sourceId",
                x.optString("title").ifBlank { x.optString("name") },
                x.optString("poster").ifBlank { x.optString("image") },
                api,
                if (api == "v1") sourceId else sourceSlug,
                if (type.equals("series", true)) "Série" else "Filme"
            ), statusCode=r.statusCode)
        } catch (e: Throwable) {
            Result(false, message=friendlyNetworkError(e))
        }
    }

    fun saveProgress(filmeId:String,titulo:String,tempo:String,thumb:String,durationSeconds:Long=0,categoria:String="",slug:String="",tipo:String="",serieCategoria:String="",serieSlug:String=""):Result<JSONObject>{
        val p=tempo.split(":").mapNotNull{it.toLongOrNull()}
        val pos=when(p.size){3->p[0]*3600+p[1]*60+p[2];2->p[0]*60+p[1];1->p[0];else->0}
        val contentType = when {
            tipo.contains("epis", true) || serieSlug.isNotBlank() -> "episode"
            tipo.contains("sér", true) || tipo.contains("serie", true) -> "series"
            else -> "movie"
        }
        val body = JSONObject()
            .put("contentId", filmeId)
            .put("title", titulo)
            .put("thumb", thumb)
            .put("contentType", contentType)
            .put("positionSeconds", pos)
            .put("durationSeconds", durationSeconds)
        if (categoria.isNotBlank()) body.put("categoria", categoria)
        if (slug.isNotBlank()) body.put("slug", slug)
        if (tipo.isNotBlank()) body.put("tipo", tipo)
        if (serieCategoria.isNotBlank()) body.put("serieCategoria", serieCategoria)
        if (serieSlug.isNotBlank()) body.put("serieSlug", serieSlug)
        return authenticatedJson("PUT", profilePath("/progress"), body.toString())
    }

    data class SearchHistoryItem(val id:String, val query:String, val lastSearchedAt:String="")

    fun saveSearchHistory(query:String):Result<JSONObject>{
        val q=query.trim(); if(q.length<2)return Result(false,message="Query inválida.")
        return authenticatedJson("POST", profilePath("/search-history"), JSONObject().put("query", q).toString())
    }

    fun listSearchHistory():Result<List<SearchHistoryItem>> = authenticatedJson("GET", profilePath("/search-history")).map{j->
        val a=j.optJSONArray("history")?:j.optJSONArray("items")?:JSONArray()
        buildList{
            for(i in 0 until a.length()){
                val x=a.optJSONObject(i)?:continue
                val q=x.optString("query").ifBlank{x.optString("q")}
                if(q.isBlank())continue
                add(SearchHistoryItem(
                    x.optString("id").ifBlank{x.optString("_id")}.ifBlank{java.net.URLEncoder.encode(q.lowercase(), "UTF-8")},
                    q,
                    x.optString("lastSearchedAt").ifBlank{x.optString("updatedAt")}
                ))
            }
        }
    }

    fun deleteSearchHistoryItem(searchId:String):Result<JSONObject>{
        val id=searchId.trim(); if(id.isBlank())return Result(false,message="ID inválido.")
        return authenticatedJson("DELETE", profilePath("/search-history/" + Uri.encode(id)))
    }

    fun clearSearchHistory():Result<JSONObject> = authenticatedJson("DELETE", profilePath("/search-history"))

    fun getTedtopIngresso(slug:String):Result<JSONObject>{
        if(slug.isBlank())return Result(false,message="Slug inválido.")
        return try{
            val r=rawRequest("GET","$TEDTOP_API_BASE/ingresso/${Uri.encode(slug)}",null,false)
            val j=parseObject(r.body)
            if(r.statusCode !in 200..299)return Result(false,message=serverMessage(j,r.statusCode),statusCode=r.statusCode)
            Result(true,j,statusCode=r.statusCode)
        }catch(e:Throwable){Result(false,message=friendlyNetworkError(e))}
    }
    fun getTedtopFilme(slug:String):Result<JSONObject>{
        if(slug.isBlank())return Result(false,message="Slug inválido.")
        return try{
            val r=rawRequest("GET","$TEDTOP_API_BASE/filme/${Uri.encode(slug)}",null,false)
            val j=parseObject(r.body)
            if(r.statusCode !in 200..299)return Result(false,message=serverMessage(j,r.statusCode),statusCode=r.statusCode)
            Result(true,j,statusCode=r.statusCode)
        }catch(e:Throwable){Result(false,message=friendlyNetworkError(e))}
    }
    fun logout():Result<JSONObject>{clear();return Result(true,JSONObject(),statusCode=200)}

    fun proxyMovieRequest(request:WebResourceRequest):RawResponse?{val u=request.url;if(u.host!=MOVIE_API_HOST||!u.path.orEmpty().startsWith("/api/"))return null;return try{rawRequest(request.method.ifBlank{"GET"},u.encodedPath.orEmpty()+u.encodedQuery.orEmpty().let{if(it.isBlank())"" else "?$it"},null,true)}catch(e:Throwable){RawResponse(599,JSONObject().put("error",friendlyNetworkError(e)).toString(),"application/json")}}
    fun proxyExternalImageRequest(request:WebResourceRequest):WebResourceResponse? {
        val u=request.url
        val host=u.host.orEmpty().lowercase()
        val path=u.path.orEmpty().lowercase()
        val allowed=host==MOVIE_API_HOST || host=="image.tmdb.org" || host=="api.dicebear.com"
        if(!allowed || request.method.uppercase()!="GET") return null
        return try {
            val c=(URL(u.toString()).openConnection() as HttpURLConnection).apply {
                connectTimeout=12000; readTimeout=20000; instanceFollowRedirects=true; useCaches=true
                setRequestProperty("User-Agent","Mozilla/5.0 (Linux; Android) Tedflix/1.0")
                setRequestProperty("Accept","image/avif,image/webp,image/apng,image/*,*/*;q=0.8")
                if(host==MOVIE_API_HOST) setRequestProperty("Referer","$MOVIE_API_BASE/")
            }
            val code=c.responseCode
            if(code !in 200..299){c.disconnect();return null}
            val bytes=c.inputStream.use{it.readBytes()}
            val type=c.contentType?.substringBefore(';')?.ifBlank{null} ?: when {
                path.endsWith(".webp")->"image/webp"
                path.endsWith(".png")->"image/png"
                else->"image/jpeg"
            }
            c.disconnect()
            WebResourceResponse(type,null,200,"OK",mapOf("Cache-Control" to "public, max-age=3600"),ByteArrayInputStream(bytes))
        } catch(_:Throwable){null}
    }
    fun toWebResourceResponse(r:RawResponse)=WebResourceResponse(r.contentType.substringBefore(';').ifBlank{"application/json"},"UTF-8",r.statusCode.coerceIn(100,599),"OK",mapOf("Cache-Control" to "no-store","Pragma" to "no-cache"),ByteArrayInputStream(r.body.toByteArray(StandardCharsets.UTF_8)))
    private fun <T>Result<JSONObject>.map(f:(JSONObject)->T):Result<T> = if(ok)Result(true,f(value?:JSONObject()),statusCode=statusCode) else Result(false,message=message,statusCode=statusCode)
    private fun authenticatedJson(method:String,path:String,body:String?=null):Result<JSONObject>{
        return try{
            // Renova proativamente se o access token já expirou
            ensureFreshToken()
            val r=rawRequest(method,path,body,true)
            val j=parseObject(r.body)
            if(r.statusCode in 200..299) return Result(true,j,statusCode=r.statusCode)
            // 401: tenta renovar token uma vez antes de deslogar
            if(r.statusCode==401){
                val refreshed = refreshSession()
                if(refreshed.ok){
                    val r2=rawRequest(method,path,body,true)
                    val j2=parseObject(r2.body)
                    if(r2.statusCode in 200..299) return Result(true,j2,statusCode=r2.statusCode)
                    if(r2.statusCode==401||r2.statusCode==403) clear()
                    return Result(false,message=serverMessage(j2,r2.statusCode),statusCode=r2.statusCode)
                }
                return Result(false,message=refreshed.message.ifBlank{serverMessage(j,r.statusCode)},statusCode=r.statusCode)
            }
            Result(false,message=serverMessage(j,r.statusCode),statusCode=r.statusCode)
        }catch(e:Throwable){Result(false,message=friendlyNetworkError(e))}
    }
    fun rawRequest(method:String,path:String,body:String?=null,includeBearer:Boolean):RawResponse{
        val contentPath = path.startsWith("/api/search") ||
            path.startsWith("/api/categories") ||
            path.startsWith("/api/sources") ||
            path.startsWith("/api/health") ||
            path.startsWith("/health") ||
            path.startsWith("/api/catalog/") ||
            path.startsWith("/api/content/") ||
            path.startsWith("/api/play/")
        val url = if(path.startsWith("http")) path else if(contentPath) "$MOVIE_API_BASE$path" else "$AUTH_BASE$path"
        val c = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method.uppercase(); connectTimeout = 20000; readTimeout = 60000
            instanceFollowRedirects = true; useCaches = false
            setRequestProperty("Accept", "application/json"); setRequestProperty("Cache-Control", "no-store")
            if(body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json; charset=utf-8") }
            if(includeBearer) token()?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        return try {
            if(body != null) c.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
            val status = c.responseCode
            val stream = if(status in 200..399) c.inputStream else c.errorStream
            RawResponse(status, stream?.bufferedReader(StandardCharsets.UTF_8)?.use { it.readText() }.orEmpty(), c.contentType ?: "application/json")
        } finally { c.disconnect() }
    }
    private fun parseObject(s:String)=try{if(s.trim().startsWith("{"))JSONObject(s)else JSONObject()}catch(_:Throwable){JSONObject()}
    private fun parseUser(j:JSONObject?):User?{if(j==null)return null;return User(j.optString("uid").ifBlank{j.optString("id")},j.optString("email"),j.optString("username").ifBlank{j.optString("name")},j.optString("expiresAt").ifBlank{j.optString("subscriptionExpiresAt")},j.optString("status").ifBlank{j.optString("accountStatus")},j.optInt("daysRemaining",-1).takeIf{it>=0},j.optString("createdAt"),j.optString("lastLoginAt"),name=j.optString("name"),role=j.optString("role"),emailVerified=if(j.has("emailVerified"))j.optBoolean("emailVerified")else null,approvalStatus=j.optString("approvalStatus"))}
    private fun serverMessage(j:JSONObject,c:Int)=j.optString("error").ifBlank{j.optString("message")}.ifBlank{when(c){400->"Confira os dados informados.";401->"Sessão inválida ou credenciais incorretas.";403->"Acesso negado para esta conta.";404->"Recurso não encontrado.";409->"E-mail ou username já utilizado.";429->"Muitas tentativas. Aguarde alguns minutos.";in 500..599->"Servidor indisponível no momento.";else->"Não foi possível concluir a operação."}}
    private fun friendlyNetworkError(e:Throwable)="Não foi possível conectar ao servidor. Verifique sua internet."
    private fun readStoredProfiles():List<StoredProfile>{if(!::appContext.isInitialized)return emptyList();return try{val a=JSONArray(appContext.getSharedPreferences(PROFILES_PREFS,0).getString(PROFILES_KEY,"[]"));buildList{for(i in 0 until a.length()){val x=a.optJSONObject(i)?:continue;val enc=x.optString("encryptedToken");if(enc.isBlank())continue;add(StoredProfile(x.optString("id"),x.optString("name").ifBlank{"Meu perfil"},x.optString("avatarSeed").ifBlank{"tedflix-avatar-01"},x.optString("avatarStyle").ifBlank{"fun-emoji"},x.optString("email"),x.optString("username"),x.optBoolean("isKids"),x.optBoolean("isPrimary"),User(email=x.optString("email"),username=x.optString("username")),enc))}}}catch(_:Throwable){emptyList()}}
    private fun saveStoredProfiles(ps:List<StoredProfile>,active:String){val a=JSONArray();ps.forEach{p->a.put(JSONObject().put("id",p.id).put("name",p.name).put("avatarSeed",p.avatarSeed).put("avatarStyle",p.avatarStyle).put("email",p.email).put("username",p.username).put("isKids",p.isKids).put("isPrimary",p.isPrimary).put("encryptedToken",p.encryptedToken))};appContext.getSharedPreferences(PROFILES_PREFS,0).edit().putString(PROFILES_KEY,a.toString()).putString(ACTIVE_PROFILE_KEY,active).apply()}
    private fun StoredProfile.public()=Profile(id,name,avatarSeed,avatarStyle,email,username,isKids,isPrimary)
    private fun key():SecretKey{val ks=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};val old=ks.getKey(KEY_ALIAS,null) as? SecretKey;if(old!=null)return old;val g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(KeyGenParameterSpec.Builder(KEY_ALIAS,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return g.generateKey()}
    private fun encrypt(v:String):String{val c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());return Base64.encodeToString(c.iv,Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(v.toByteArray()),Base64.NO_WRAP)}
    private fun decrypt(v:String):String{val p=v.split(":",limit=2);val c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));return String(c.doFinal(Base64.decode(p[1],Base64.NO_WRAP)))}
}
