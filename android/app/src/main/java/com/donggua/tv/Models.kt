package com.donggua.tv

data class AndroidRelease(
    val available: Boolean,
    val downloadUrl: String,
    val version: String,
    val size: Long,
    val builtAt: String
)

data class ServerConfig(
    val cloudEnabled: Boolean,
    val siteCount: Int,
    val android: AndroidRelease?
)

data class TmdbItem(
    val id: Int,
    val mediaType: String,
    val title: String,
    val originalTitle: String,
    val overview: String,
    val posterPath: String?,
    val backdropPath: String?,
    val voteAverage: Double,
    val year: String
)

data class TmdbCast(
    val name: String,
    val character: String,
    val profilePath: String?
)

data class TmdbDetail(
    val item: TmdbItem,
    val tagline: String,
    val genres: List<String>,
    val runtime: String,
    val cast: List<TmdbCast>
)

data class VideoSource(
    val siteKey: String,
    val siteName: String,
    val vodId: String,
    val name: String,
    val pic: String,
    val remarks: String,
    val year: String,
    val typeName: String
)

data class VideoGroup(
    val name: String,
    val pic: String,
    val remarks: String,
    val year: String,
    val sources: List<VideoSource>
)

data class VideoSearchResult(
    val groups: List<VideoGroup>,
    val errors: Int,
    val siteCount: Int
)

data class Episode(
    val name: String,
    val url: String
)

data class VideoDetail(
    val title: String,
    val pic: String,
    val content: String,
    val actors: String,
    val director: String,
    val year: String,
    val area: String,
    val remarks: String,
    val episodes: List<Episode>
)

data class CloudItem(
    val title: String,
    val content: String,
    val channel: String,
    val datetime: String,
    val type: String,
    val url: String,
    val password: String,
    val tags: List<String>
)

data class CloudSearchResult(
    val enabled: Boolean,
    val list: List<CloudItem>,
    val message: String,
    val error: String
)
