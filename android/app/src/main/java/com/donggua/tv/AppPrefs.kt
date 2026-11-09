package com.donggua.tv

import android.content.Context
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject

class AppPrefs(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("donggua_client", Context.MODE_PRIVATE)

    private val bundled: JSONObject by lazy {
        runCatching {
            val text = appContext.assets.open("app-config.json").bufferedReader().use { it.readText() }
            JSONObject(text)
        }.getOrDefault(JSONObject())
    }

    val bundledServerUrl: String get() = normalizeServerUrl(bundled.optString("serverUrl"))
    val bundledAppName: String get() = bundled.optString("appName").ifBlank { "冬瓜TV" }
    val bundledVersionName: String get() = bundled.optString("versionName").ifBlank { "1.0.0" }
    val bundledVersionCode: Int get() = bundled.optInt("versionCode", 1).coerceAtLeast(1)

    var serverUrl: String
        get() {
            val saved = prefs.getString("server_url", "").orEmpty()
            return normalizeServerUrl(if (saved.isBlank()) bundledServerUrl else saved)
        }
        set(value) {
            prefs.edit().putString("server_url", normalizeServerUrl(value)).apply()
        }

    fun saveServerUrl(value: String): String {
        val normalized = normalizeServerUrl(value)
        prefs.edit().putString("server_url", normalized).apply()
        return normalized
    }

    fun clearServerUrl() = prefs.edit().remove("server_url").apply()
}

fun normalizeServerUrl(raw: String?): String {
    var value = raw.orEmpty().trim()
    if (value.isBlank()) return ""
    if (!value.startsWith("http://", ignoreCase = true) && !value.startsWith("https://", ignoreCase = true)) {
        value = "http://$value"
    }
    val parsed = value.toHttpUrlOrNull() ?: return ""
    return parsed.newBuilder().query(null).fragment(null).build().toString().trimEnd('/')
}
