package com.donggua.tv

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class ApiException(message: String, val statusCode: Int = 0) : Exception(message)

class DongguaApi(private val prefs: AppPrefs) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .callTimeout(50, TimeUnit.SECONDS)
        .build()

    val baseUrl: String get() = prefs.serverUrl

    fun absoluteUrl(path: String): String {
        if (path.isBlank()) return ""
        if (path.startsWith("http://", true) || path.startsWith("https://", true)) return path
        return baseUrl.trimEnd('/') + "/" + path.trimStart('/')
    }

    fun imageUrl(path: String?, size: String = "w500"): String? {
        if (path.isNullOrBlank()) return null
        if (path.startsWith("http://", true) || path.startsWith("https://", true)) return path
        if (baseUrl.isBlank()) return null
        return baseUrl.trimEnd('/') + "/tmdb/t/p/" + size + "/" + path.trimStart('/')
    }

    suspend fun config(): ServerConfig = configAt(baseUrl)

    suspend fun configAt(rawBase: String): ServerConfig {
        val normalized = normalizeServerUrl(rawBase)
        if (normalized.isBlank()) throw ApiException("服务器地址格式不正确")
        val root = getJsonAt(normalized, "/api/config")
        val androidJson = root.optJSONObject("android")
        val release = androidJson?.let {
            AndroidRelease(
                available = it.optBoolean("available", false),
                downloadUrl = absoluteUrlFor(normalized, it.optString("downloadUrl")),
                version = it.optString("version"),
                versionCode = it.optInt("versionCode", 1).coerceAtLeast(1),
                size = it.optLong("size", 0L),
                builtAt = it.optString("builtAt")
            )
        }
        return ServerConfig(
            cloudEnabled = root.optBoolean("cloudEnabled", false),
            siteCount = root.optInt("siteCount", 0),
            android = release
        )
    }

    suspend fun probe(rawBase: String): ServerConfig = configAt(rawBase)

    suspend fun tmdbTrending(): List<TmdbItem> {
        val root = getJson("/tmdb/3/trending/all/week", mapOf("language" to "zh-CN"))
        return parseTmdbList(root.optJSONArray("results"), "")
    }

    suspend fun tmdbPopular(type: String): List<TmdbItem> {
        val root = getJson("/tmdb/3/$type/popular", mapOf("language" to "zh-CN", "page" to "1"))
        return parseTmdbList(root.optJSONArray("results"), type)
    }

    suspend fun tmdbTopRated(type: String): List<TmdbItem> {
        val root = getJson("/tmdb/3/$type/top_rated", mapOf("language" to "zh-CN", "page" to "1"))
        return parseTmdbList(root.optJSONArray("results"), type)
    }

    suspend fun tmdbAiringToday(): List<TmdbItem> {
        val root = getJson("/tmdb/3/tv/airing_today", mapOf("language" to "zh-CN", "page" to "1"))
        return parseTmdbList(root.optJSONArray("results"), "tv")
    }

    suspend fun tmdbSearch(query: String): List<TmdbItem> {
        val root = getJson(
            "/tmdb/3/search/multi",
            mapOf("query" to query, "language" to "zh-CN", "include_adult" to "false", "page" to "1")
        )
        return parseTmdbList(root.optJSONArray("results"), "")
            .filter { it.mediaType == "movie" || it.mediaType == "tv" }
    }

    suspend fun tmdbDetail(type: String, id: Int): TmdbDetail {
        val safeType = if (type == "tv") "tv" else "movie"
        val root = getJson(
            "/tmdb/3/$safeType/$id",
            mapOf("language" to "zh-CN", "append_to_response" to "credits")
        )
        val item = parseTmdbItem(root, safeType) ?: throw ApiException("影片详情为空")
        val genres = mutableListOf<String>()
        val genreArray = root.optJSONArray("genres")
        if (genreArray != null) {
            for (i in 0 until genreArray.length()) {
                val name = genreArray.optJSONObject(i)?.optString("name").orEmpty()
                if (name.isNotBlank()) genres += name
            }
        }
        val runtime = if (safeType == "tv") {
            val seasons = root.optInt("number_of_seasons", 0)
            val episodes = root.optInt("number_of_episodes", 0)
            buildString {
                if (seasons > 0) append("$seasons 季")
                if (episodes > 0) {
                    if (isNotEmpty()) append(" · ")
                    append("$episodes 集")
                }
            }
        } else {
            val minutes = root.optInt("runtime", 0)
            if (minutes > 0) "$minutes 分钟" else ""
        }
        val cast = mutableListOf<TmdbCast>()
        val credits = root.optJSONObject("credits")
        val castArray = credits?.optJSONArray("cast")
        if (castArray != null) {
            for (i in 0 until minOf(castArray.length(), 16)) {
                val person = castArray.optJSONObject(i) ?: continue
                val name = person.optString("name")
                if (name.isBlank()) continue
                cast += TmdbCast(
                    name = name,
                    character = person.optString("character"),
                    profilePath = person.nullableString("profile_path")
                )
            }
        }
        return TmdbDetail(
            item = item,
            tagline = root.optString("tagline"),
            genres = genres,
            runtime = runtime,
            cast = cast
        )
    }

    suspend fun search(keyword: String): VideoSearchResult {
        val root = getJson("/api/search", mapOf("wd" to keyword))
        val list = root.optJSONArray("list") ?: JSONArray()
        val grouped = linkedMapOf<String, MutableList<VideoSource>>()
        for (i in 0 until list.length()) {
            val obj = list.optJSONObject(i) ?: continue
            val name = obj.optString("vod_name").ifBlank { keyword }
            val source = VideoSource(
                siteKey = obj.optString("site_key"),
                siteName = obj.optString("site_name").ifBlank { obj.optString("site_key") },
                vodId = obj.optString("vod_id"),
                name = name,
                pic = obj.optString("vod_pic"),
                remarks = obj.optString("vod_remarks"),
                year = obj.optString("vod_year"),
                typeName = obj.optString("type_name")
            )
            if (source.siteKey.isBlank() || source.vodId.isBlank()) continue
            grouped.getOrPut(name) { mutableListOf() } += source
        }
        val groups = grouped.map { (name, sources) ->
            val bestPic = sources.firstOrNull { !isPlaceholderPic(it.pic) }?.pic.orEmpty()
            VideoGroup(
                name = name,
                pic = bestPic,
                remarks = sources.firstOrNull()?.remarks.orEmpty(),
                year = sources.firstOrNull()?.year.orEmpty(),
                sources = sources
            )
        }.sortedWith(compareByDescending<VideoGroup> { it.sources.size }.thenBy { it.name })
        return VideoSearchResult(
            groups = groups,
            errors = root.optInt("errors", 0),
            siteCount = root.optInt("siteCount", 0)
        )
    }

    suspend fun detail(siteKey: String, id: String): VideoDetail {
        val root = getJson("/api/detail", mapOf("site_key" to siteKey, "id" to id))
        val data = root.optJSONObject("data")
        val list = root.optJSONArray("list") ?: data?.optJSONArray("list") ?: JSONArray()
        if (list.length() == 0) throw ApiException("该采集站没有返回详情")
        val item = list.optJSONObject(0) ?: throw ApiException("详情格式不正确")
        return VideoDetail(
            title = item.optString("vod_name"),
            pic = item.optString("vod_pic"),
            content = cleanHtml(item.optString("vod_content")),
            actors = item.optString("vod_actor"),
            director = item.optString("vod_director"),
            year = item.optString("vod_year"),
            area = item.optString("vod_area"),
            remarks = item.optString("vod_remarks"),
            episodes = parseEpisodes(item.optString("vod_play_url"), siteKey)
        )
    }

    suspend fun cloudSearch(keyword: String): CloudSearchResult {
        val root = getJson("/api/cloud/search", mapOf("wd" to keyword))
        val list = root.optJSONArray("list") ?: JSONArray()
        val items = mutableListOf<CloudItem>()
        for (i in 0 until list.length()) {
            val obj = list.optJSONObject(i) ?: continue
            val url = obj.optString("url")
            if (url.isBlank()) continue
            val tags = mutableListOf<String>()
            val tagArray = obj.optJSONArray("tags")
            if (tagArray != null) {
                for (j in 0 until tagArray.length()) tags += tagArray.optString(j)
            }
            items += CloudItem(
                title = obj.optString("title"),
                content = obj.optString("content"),
                channel = obj.optString("channel"),
                datetime = obj.optString("datetime"),
                type = obj.optString("type"),
                url = url,
                password = obj.optString("password"),
                tags = tags
            )
        }
        return CloudSearchResult(
            enabled = root.optBoolean("enabled", true),
            list = items,
            message = root.optString("message"),
            error = root.optString("error")
        )
    }

    private suspend fun getJson(path: String, params: Map<String, String> = emptyMap()): JSONObject {
        return getJsonAt(baseUrl, path, params)
    }

    private suspend fun getJsonAt(
        rawBase: String,
        path: String,
        params: Map<String, String> = emptyMap()
    ): JSONObject {
        val base = normalizeServerUrl(rawBase)
        if (base.isBlank()) throw ApiException("还没有设置服务器地址")
        val urlBuilder = (base + path).toHttpUrlOrNull()?.newBuilder()
            ?: throw ApiException("服务器地址格式不正确")
        params.forEach { (key, value) -> urlBuilder.addQueryParameter(key, value) }
        val request = Request.Builder()
            .url(urlBuilder.build())
            .header("Accept", "application/json")
            .header("User-Agent", "DongguaTV-Android/1.0")
            .get()
            .build()
        return withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val message = runCatching { JSONObject(body).optString("error") }.getOrNull()
                        ?.takeIf { it.isNotBlank() }
                        ?: "请求失败（HTTP ${response.code}）"
                    throw ApiException(message, response.code)
                }
                try {
                    JSONObject(body)
                } catch (e: Exception) {
                    throw ApiException("服务器返回的不是有效 JSON")
                }
            }
        }
    }

    private fun proxyPlaybackUrl(raw: String, siteKey: String): String {
        if (raw.isBlank() || raw.contains("/api/play/proxy?")) return raw
        val base = normalizeServerUrl(baseUrl)
        if (base.isBlank()) return raw
        val endpoint = (base + "/api/play/proxy").toHttpUrlOrNull() ?: return raw
        return endpoint.newBuilder()
            .addQueryParameter("url", raw)
            .addQueryParameter("site", siteKey)
            .build()
            .toString()
    }

    private fun parseEpisodes(raw: String, siteKey: String): List<Episode> {
        if (raw.isBlank()) return emptyList()
        var playSource = raw
        if (raw.contains("$$$")) {
            val sets = raw.split("$$$")
            playSource = sets.firstOrNull { it.contains("m3u8", ignoreCase = true) } ?: sets.first()
        }
        val seen = mutableSetOf<String>()
        return playSource.split("#").mapNotNull { chunk ->
            val value = chunk.trim()
            if (value.isBlank()) return@mapNotNull null
            val index = value.indexOf('$')
            val name = if (index > 0) value.substring(0, index).trim() else "正片"
            var url = if (index > 0) value.substring(index + 1).trim() else value
            if (url.startsWith("//")) url = "https:$url"
            if (!url.startsWith("http://", true) && !url.startsWith("https://", true)) return@mapNotNull null
            if (!seen.add(url)) return@mapNotNull null
            Episode(name = name.ifBlank { "正片" }, url = proxyPlaybackUrl(url, siteKey))
        }
    }

    private fun cleanHtml(raw: String): String {
        return raw
            .replace(Regex("<[^>]+>"), "")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&quot;", "\u0022")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .trim()
    }

    private fun isPlaceholderPic(url: String): Boolean {
        if (url.isBlank()) return true
        val lower = url.lowercase()
        return lower.contains("mac_default") || lower.contains("nopic") || lower.contains("noimage")
    }

    private fun parseTmdbList(array: JSONArray?, fallbackType: String): List<TmdbItem> {
        if (array == null) return emptyList()
        val out = mutableListOf<TmdbItem>()
        for (i in 0 until array.length()) {
            val obj = array.optJSONObject(i) ?: continue
            parseTmdbItem(obj, fallbackType)?.let { out += it }
        }
        return out
    }

    private fun parseTmdbItem(obj: JSONObject, fallbackType: String): TmdbItem? {
        val id = obj.optInt("id", 0)
        if (id <= 0) return null
        val type = obj.optString("media_type").ifBlank { fallbackType }
        if (type != "movie" && type != "tv") return null
        val title = obj.optString("title").ifBlank { obj.optString("name") }
        if (title.isBlank()) return null
        val date = obj.optString("release_date").ifBlank { obj.optString("first_air_date") }
        return TmdbItem(
            id = id,
            mediaType = type,
            title = title,
            originalTitle = obj.optString("original_title").ifBlank { obj.optString("original_name") },
            overview = obj.optString("overview"),
            posterPath = obj.nullableString("poster_path"),
            backdropPath = obj.nullableString("backdrop_path"),
            voteAverage = obj.optDouble("vote_average", 0.0),
            year = date.take(4)
        )
    }

    private fun absoluteUrlFor(base: String, path: String): String {
        if (path.isBlank()) return ""
        if (path.startsWith("http://", true) || path.startsWith("https://", true)) return path
        return base.trimEnd('/') + "/" + path.trimStart('/')
    }
}

private fun JSONObject.nullableString(key: String): String? {
    if (isNull(key)) return null
    val value = optString(key)
    return value.takeIf { it.isNotBlank() && it != "null" }
}
