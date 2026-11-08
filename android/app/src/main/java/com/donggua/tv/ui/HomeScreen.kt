package com.donggua.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Android
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.donggua.tv.DongguaApi
import com.donggua.tv.ServerConfig
import com.donggua.tv.TmdbItem
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

@Composable
fun HomeScreen(
    api: DongguaApi,
    appName: String,
    onSearch: (String) -> Unit,
    onSettings: () -> Unit,
    onOpenTmdb: (TmdbItem) -> Unit
) {
    val context = LocalContext.current
    var query by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(true) }
    var refreshKey by remember { mutableIntStateOf(0) }
    var config by remember { mutableStateOf<ServerConfig?>(null) }
    var trending by remember { mutableStateOf<List<TmdbItem>>(emptyList()) }
    var popularMovies by remember { mutableStateOf<List<TmdbItem>>(emptyList()) }
    var popularTv by remember { mutableStateOf<List<TmdbItem>>(emptyList()) }
    var topRated by remember { mutableStateOf<List<TmdbItem>>(emptyList()) }
    var airing by remember { mutableStateOf<List<TmdbItem>>(emptyList()) }
    var error by remember { mutableStateOf("") }

    LaunchedEffect(refreshKey) {
        loading = true
        error = ""
        coroutineScope {
            val configTask = async { runCatching { api.config() } }
            val trendingTask = async { runCatching { api.tmdbTrending() } }
            val movieTask = async { runCatching { api.tmdbPopular("movie") } }
            val tvTask = async { runCatching { api.tmdbPopular("tv") } }
            val topTask = async { runCatching { api.tmdbTopRated("movie") } }
            val airingTask = async { runCatching { api.tmdbAiringToday() } }

            config = configTask.await().getOrNull()
            trending = trendingTask.await().getOrDefault(emptyList())
            popularMovies = movieTask.await().getOrDefault(emptyList())
            popularTv = tvTask.await().getOrDefault(emptyList())
            topRated = topTask.await().getOrDefault(emptyList())
            airing = airingTask.await().getOrDefault(emptyList())

            val firstError = listOf(trendingTask, movieTask, tvTask, topTask, airingTask)
                .mapNotNull { it.await().exceptionOrNull() }
                .firstOrNull()
            if (trending.isEmpty() && popularMovies.isEmpty() && popularTv.isEmpty()) {
                error = firstError?.message?.let { "暂时无法读取推荐内容：$it" }
                    ?: "TMDb 推荐暂时不可用，可以直接搜索片名"
            }
        }
        loading = false
    }

    fun submitSearch() {
        val value = query.trim()
        if (value.isNotBlank()) onSearch(value)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        AppTopBar(
            title = appName,
            onSettings = onSettings,
            onRefresh = { refreshKey++ }
        )
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 28.dp)
        ) {
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
                    placeholder = { Text("搜索电影、电视剧、综艺或网盘资源") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { submitSearch() })
                )
            }

            if (config?.android?.available == true) {
                item {
                    AndroidDownloadBanner(
                        config = config!!,
                        onDownload = { openExternal(context, api.absoluteUrl(config!!.android!!.downloadUrl)) }
                    )
                }
            }

            if (trending.isNotEmpty()) {
                item { HeroBanner(api, trending.first(), onOpenTmdb, onSearch) }
                item { TmdbRow("本周热门", trending.drop(1).take(18), api, onOpenTmdb) }
            } else if (loading) {
                item { LoadingPane("正在读取本周热门…") }
            } else if (error.isNotBlank()) {
                item { ErrorPane(error) }
            }

            if (popularMovies.isNotEmpty()) {
                item { SectionTitle("热门电影", "TMDb") }
                item { TmdbRowContent(popularMovies.take(18), api, onOpenTmdb) }
            }
            if (popularTv.isNotEmpty()) {
                item { SectionTitle("热门剧集", "TMDb") }
                item { TmdbRowContent(popularTv.take(18), api, onOpenTmdb) }
            }
            if (airing.isNotEmpty()) {
                item { SectionTitle("今日播出") }
                item { TmdbRowContent(airing.take(18), api, onOpenTmdb) }
            }
            if (topRated.isNotEmpty()) {
                item { SectionTitle("高分经典") }
                item { TmdbRowContent(topRated.take(18), api, onOpenTmdb) }
            }
            if (config != null && config?.siteCount == 0) {
                item {
                    EmptyPane(
                        "站长还没有配置采集站",
                        "请先在网页版管理后台添加 Maccms 采集接口，然后重新打开应用。"
                    )
                }
            }
        }
    }
}

@Composable
private fun HeroBanner(
    api: DongguaApi,
    item: TmdbItem,
    onOpenTmdb: (TmdbItem) -> Unit,
    onSearch: (String) -> Unit
) {
    Box(
        modifier = Modifier.fillMaxWidth().height(430.dp).padding(top = 8.dp)
    ) {
        AsyncImage(
            model = api.imageUrl(item.backdropPath ?: item.posterPath, "w780"),
            contentDescription = item.title,
            modifier = Modifier.matchParentSize(),
            contentScale = ContentScale.Crop
        )
        Box(
            modifier = Modifier.matchParentSize().background(
                Brush.verticalGradient(
                    listOf(Color.Transparent, Color(0x66000000), Color(0xF20B0B0C)),
                    startY = 60f
                )
            )
        )
        Column(
            modifier = Modifier.align(Alignment.BottomStart).padding(20.dp).fillMaxWidth()
        ) {
            Text(
                "本周热门",
                color = MaterialTheme.colorScheme.primary,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(5.dp))
            Text(
                item.title,
                color = Color.White,
                fontSize = 32.sp,
                fontWeight = FontWeight.Black,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            if (item.overview.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text(
                    item.overview,
                    color = Color(0xFFD6D6DA),
                    fontSize = 13.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = { onOpenTmdb(item) },
                    shape = RoundedCornerShape(50)
                ) {
                    Text("查看详情", fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(10.dp))
                OutlinedButton(
                    onClick = { onSearch(item.title) },
                    shape = RoundedCornerShape(50),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                ) {
                    Text("搜索片源")
                }
            }
        }
    }
}

@Composable
private fun TmdbRow(
    title: String,
    items: List<TmdbItem>,
    api: DongguaApi,
    onOpen: (TmdbItem) -> Unit
) {
    if (items.isEmpty()) return
    SectionTitle(title)
    TmdbRowContent(items, api, onOpen)
}

@Composable
private fun TmdbRowContent(items: List<TmdbItem>, api: DongguaApi, onOpen: (TmdbItem) -> Unit) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(items, key = { it.mediaType + it.id }) { item ->
            PosterCard(api = api, item = item, onClick = { onOpen(item) })
        }
    }
}

@Composable
private fun AndroidDownloadBanner(config: ServerConfig, onDownload: () -> Unit) {
    val release = config.android ?: return
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icons.Filled.Android.let { icon ->
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(30.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("Android 客户端", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)
                Text(
                    "原生播放 · 版本 ${release.version.ifBlank { "1.0.0" }}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp
                )
            }
            Button(onClick = onDownload, shape = RoundedCornerShape(50)) {
                Text("下载 APK")
            }
        }
    }
}
