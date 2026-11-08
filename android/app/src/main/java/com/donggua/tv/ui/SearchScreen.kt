package com.donggua.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.donggua.tv.CloudItem
import com.donggua.tv.CloudSearchResult
import com.donggua.tv.DongguaApi
import com.donggua.tv.TmdbItem
import com.donggua.tv.VideoGroup
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

@Composable
fun SearchScreen(
    api: DongguaApi,
    initialQuery: String,
    onBack: () -> Unit,
    onSettings: () -> Unit,
    onOpenTmdb: (TmdbItem) -> Unit,
    onOpenGroup: (VideoGroup) -> Unit
) {
    val context = LocalContext.current
    var query by remember(initialQuery) { mutableStateOf(initialQuery) }
    var submitted by remember(initialQuery) { mutableStateOf(initialQuery) }
    var searchTick by remember { mutableIntStateOf(0) }
    var tab by remember { mutableIntStateOf(0) }
    var loadingVideo by remember { mutableStateOf(initialQuery.isNotBlank()) }
    var loadingCloud by remember { mutableStateOf(initialQuery.isNotBlank()) }
    var loadingTmdb by remember { mutableStateOf(initialQuery.isNotBlank()) }
    var groups by remember { mutableStateOf<List<VideoGroup>>(emptyList()) }
    var tmdbMatches by remember { mutableStateOf<List<TmdbItem>>(emptyList()) }
    var cloud by remember { mutableStateOf<CloudSearchResult?>(null) }
    var videoError by remember { mutableStateOf("") }
    var cloudError by remember { mutableStateOf("") }
    var siteCount by remember { mutableIntStateOf(0) }
    var sourceErrors by remember { mutableIntStateOf(0) }

    LaunchedEffect(submitted, searchTick) {
        if (submitted.isBlank()) {
            loadingVideo = false
            loadingCloud = false
            loadingTmdb = false
            return@LaunchedEffect
        }
        loadingVideo = true
        loadingCloud = true
        loadingTmdb = true
        videoError = ""
        cloudError = ""
        groups = emptyList()
        tmdbMatches = emptyList()
        cloud = null

        coroutineScope {
            val videoTask = async { runCatching { api.search(submitted) } }
            val cloudTask = async { runCatching { api.cloudSearch(submitted) } }
            val tmdbTask = async { runCatching { api.tmdbSearch(submitted) } }

            videoTask.await().onSuccess { result ->
                groups = result.groups
                siteCount = result.siteCount
                sourceErrors = result.errors
            }.onFailure { videoError = it.message ?: "影视搜索失败" }
            loadingVideo = false

            cloudTask.await().onSuccess { result ->
                cloud = result
            }.onFailure { cloudError = it.message ?: "网盘搜索失败" }
            loadingCloud = false

            tmdbTask.await().onSuccess { tmdbMatches = it }
            loadingTmdb = false
        }
    }

    fun submit() {
        val value = query.trim()
        if (value.isBlank()) return
        if (value == submitted) searchTick++ else submitted = value
    }

    Column(modifier = Modifier.fillMaxSize()) {
        AppTopBar(title = "搜索", onBack = onBack, onSettings = onSettings)
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            placeholder = { Text("输入片名、演员或关键词") },
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            trailingIcon = {
                Button(onClick = { submit() }, shape = RoundedCornerShape(50)) {
                    Text("搜索", fontSize = 12.sp)
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { submit() })
        )
        TabRow(
            selectedTabIndex = tab,
            containerColor = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.primary
        ) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("影视片源") })
            Tab(
                selected = tab == 1,
                onClick = { tab = 1 },
                text = { Text("网盘资源" + if (cloud?.list?.isNotEmpty() == true) " (${cloud!!.list.size})" else "") }
            )
        }

        if (submitted.isBlank()) {
            EmptyPane("搜索你想看的内容", "输入片名后回车，会同时聚合采集站和网盘资源。")
            return@Column
        }

        Box(modifier = Modifier.fillMaxSize()) {
            if (tab == 0) {
                VideoResults(
                    api = api,
                    groups = groups,
                    tmdbMatches = tmdbMatches,
                    loading = loadingVideo,
                    loadingTmdb = loadingTmdb,
                    error = videoError,
                    siteCount = siteCount,
                    sourceErrors = sourceErrors,
                    onOpenGroup = onOpenGroup,
                    onOpenTmdb = onOpenTmdb
                )
            } else {
                CloudResults(
                    context = context,
                    result = cloud,
                    loading = loadingCloud,
                    error = cloudError
                )
            }
        }
    }
}

@Composable
private fun VideoResults(
    api: DongguaApi,
    groups: List<VideoGroup>,
    tmdbMatches: List<TmdbItem>,
    loading: Boolean,
    loadingTmdb: Boolean,
    error: String,
    siteCount: Int,
    sourceErrors: Int,
    onOpenGroup: (VideoGroup) -> Unit,
    onOpenTmdb: (TmdbItem) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 24.dp)
    ) {
        if (tmdbMatches.isNotEmpty()) {
            item { SectionTitle("TMDb 匹配", "点击查看详情") }
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(tmdbMatches.take(12), key = { it.mediaType + it.id }) { item ->
                        PosterCard(api = api, item = item, onClick = { onOpenTmdb(item) })
                    }
                }
            }
        } else if (loadingTmdb) {
            item { LoadingPane("正在匹配影片资料…") }
        }

        if (loading) {
            item { LoadingPane("正在搜索采集站…") }
        } else if (error.isNotBlank()) {
            item { ErrorPane(error) }
        } else if (groups.isEmpty()) {
            item {
                EmptyPane(
                    "没有找到影视资源",
                    if (siteCount == 0) {
                        "站长还没有配置采集站，请先到网页版管理后台添加。"
                    } else {
                        "已搜索 $siteCount 个采集站" + if (sourceErrors > 0) "，其中 $sourceErrors 个暂时不可用" else ""
                    }
                )
            }
        } else {
            item { SectionTitle("影视片源", "${groups.size} 个结果") }
            items(groups, key = { it.name }) { group ->
                VideoResultCard(api, group, onOpenGroup)
            }
        }
    }
}

@Composable
private fun VideoResultCard(api: DongguaApi, group: VideoGroup, onClick: (VideoGroup) -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable { onClick(group) }.padding(horizontal = 16.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(width = 70.dp, height = 102.dp).clip(RoundedCornerShape(10.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            AsyncImage(
                model = api.imageUrl(group.pic, "w185"),
                contentDescription = group.name,
                modifier = Modifier.matchParentSize(),
                contentScale = ContentScale.Crop
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                group.name,
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(5.dp))
            Text(
                listOf(group.year, group.remarks).filter { it.isNotBlank() }.joinToString(" · "),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
                maxLines = 1
            )
            Spacer(Modifier.height(5.dp))
            Text(
                "${group.sources.size} 个采集源 · " + group.sources.take(3).joinToString(" / ") { it.siteName },
                color = MaterialTheme.colorScheme.primary,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun CloudResults(
    context: android.content.Context,
    result: CloudSearchResult?,
    loading: Boolean,
    error: String
) {
    when {
        loading -> LoadingPane("正在搜索网盘资源…")
        error.isNotBlank() -> ErrorPane(error)
        result == null -> EmptyPane("正在等待结果")
        !result.enabled -> EmptyPane("站长还没有开启网盘搜索", result.message)
        result.error.isNotBlank() -> ErrorPane(result.error)
        result.list.isEmpty() -> EmptyPane("没有找到网盘资源", result.message.ifBlank { "换一个关键词试试" })
        else -> {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
            ) {
                item { SectionTitle("网盘资源", "${result.list.size} 条") }
                items(result.list) { item -> CloudCard(context, item) }
            }
        }
    }
}

@Composable
private fun CloudCard(context: android.content.Context, item: CloudItem) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(14.dp),
        modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)
    ) {
        Column(Modifier.padding(13.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.title.ifBlank { "网盘资源" },
                    color = MaterialTheme.colorScheme.onSurface,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (item.channel.isNotBlank()) {
                    Text(item.channel, color = MaterialTheme.colorScheme.primary, fontSize = 10.sp)
                }
            }
            if (item.content.isNotBlank()) {
                Spacer(Modifier.height(5.dp))
                Text(
                    item.content,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 12.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (item.tags.isNotEmpty()) {
                Spacer(Modifier.height(7.dp))
                Row {
                    item.tags.take(4).forEach { tag -> Pill(tag) }
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.url,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (item.password.isNotBlank()) {
                    Text(" 提取码 ${item.password}", color = Color(0xFFFFD166), fontSize = 11.sp)
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { openExternal(context, item.url) }, shape = RoundedCornerShape(50)) {
                    Text("打开链接", fontSize = 12.sp)
                }
                OutlinedButton(
                    onClick = {
                        copyToClipboard(
                            context,
                            item.url + if (item.password.isNotBlank()) "  提取码: ${item.password}" else ""
                        )
                    },
                    shape = RoundedCornerShape(50)
                ) {
                    Text("复制", fontSize = 12.sp)
                }
            }
        }
    }
}
