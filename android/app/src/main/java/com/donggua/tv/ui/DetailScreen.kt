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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.donggua.tv.AppSession
import com.donggua.tv.DongguaApi
import com.donggua.tv.Episode
import com.donggua.tv.VideoDetail
import com.donggua.tv.VideoGroup

@Composable
fun DetailScreen(
    api: DongguaApi,
    session: AppSession,
    onBack: () -> Unit,
    onPlay: (List<Episode>, Int, String) -> Unit
) {
    val group = session.selectedGroup
    if (group == null) {
        Column(Modifier.fillMaxSize()) {
            AppTopBar(title = "详情", onBack = onBack)
            EmptyPane("没有可显示的影片")
        }
        return
    }

    var sourceIndex by remember(group) { mutableIntStateOf(0) }
    var detail by remember(group) { mutableStateOf<VideoDetail?>(null) }
    var loading by remember(group) { mutableStateOf(true) }
    var error by remember(group) { mutableStateOf("") }

    LaunchedEffect(group, sourceIndex) {
        val source = group.sources.getOrNull(sourceIndex) ?: return@LaunchedEffect
        loading = true
        error = ""
        detail = null
        runCatching { api.detail(source.siteKey, source.vodId) }
            .onSuccess { detail = it }
            .onFailure { error = it.message ?: "读取详情失败" }
        loading = false
    }

    Column(modifier = Modifier.fillMaxSize()) {
        AppTopBar(title = group.name, onBack = onBack)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 30.dp)
        ) {
            item { DetailHeader(api, group, detail) }
            item { SourceSelector(group, sourceIndex) { sourceIndex = it } }

            if (loading) {
                item { LoadingPane("正在读取播放列表…") }
            } else if (error.isNotBlank()) {
                item { ErrorPane(error) }
            } else {
                val info = detail
                if (info != null) {
                    if (info.content.isNotBlank()) {
                        item {
                            Text(
                                info.content,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 13.sp,
                                lineHeight = 20.sp,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                            )
                        }
                    }
                    if (info.actors.isNotBlank() || info.director.isNotBlank()) {
                        item {
                            Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
                                if (info.director.isNotBlank()) {
                                    Text("导演：${info.director}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                                }
                                if (info.actors.isNotBlank()) {
                                    Text("主演：${info.actors}", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                    item { SectionTitle("选集", "${info.episodes.size} 集") }
                    if (info.episodes.isEmpty()) {
                        item { EmptyPane("这个采集源暂时没有播放地址", "切换到其他采集源试试。") }
                    } else {
                        itemsIndexed(info.episodes.chunked(4)) { rowIndex, row ->
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                row.forEachIndexed { columnIndex, episode ->
                                    val episodeIndex = rowIndex * 4 + columnIndex
                                    OutlinedButton(
                                        onClick = { onPlay(info.episodes, episodeIndex, group.name) },
                                        modifier = Modifier.weight(1f).height(44.dp),
                                        shape = RoundedCornerShape(10.dp),
                                        contentPadding = PaddingValues(horizontal = 4.dp)
                                    ) {
                                        Text(
                                            episode.name,
                                            fontSize = 11.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                                repeat(4 - row.size) {
                                    Spacer(Modifier.weight(1f))
                                }
                            }
                        }
                    }
                } else {
                    item { EmptyPane("没有读取到详情") }
                }
            }
        }
    }
}

@Composable
private fun DetailHeader(api: DongguaApi, group: VideoGroup, detail: VideoDetail?) {
    Row(modifier = Modifier.fillMaxWidth().padding(16.dp)) {
        Box(
            modifier = Modifier.size(width = 116.dp, height = 168.dp)
                .clip(RoundedCornerShape(13.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant)
        ) {
            AsyncImage(
                model = api.imageUrl(detail?.pic ?: group.pic, "w342"),
                contentDescription = group.name,
                modifier = Modifier.matchParentSize(),
                contentScale = ContentScale.Crop
            )
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f).padding(top = 4.dp)) {
            Text(
                group.name,
                color = MaterialTheme.colorScheme.onBackground,
                fontSize = 22.sp,
                fontWeight = FontWeight.Black,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(8.dp))
            val meta = listOf(group.year, detail?.area.orEmpty(), detail?.remarks ?: group.remarks)
                .filter { it.isNotBlank() }
                .joinToString(" · ")
            if (meta.isNotBlank()) {
                Text(meta, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
            }
            Spacer(Modifier.height(8.dp))
            Row {
                Pill("${group.sources.size} 个片源", emphasized = true)
                detail?.episodes?.size?.takeIf { it > 0 }?.let { Pill("$it 集") }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "选择下方采集源，不同来源的清晰度和集数可能不同。",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 11.sp
            )
        }
    }
}

@Composable
private fun SourceSelector(group: VideoGroup, selected: Int, onSelect: (Int) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 2.dp)) {
        Text(
            "采集源",
            color = MaterialTheme.colorScheme.onBackground,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 7.dp)
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(group.sources.size) { index ->
                val source = group.sources[index]
                val active = index == selected
                Surface(
                    color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                    shape = RoundedCornerShape(50),
                    modifier = Modifier.clickable { onSelect(index) }
                ) {
                    Text(
                        source.siteName,
                        color = if (active) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 13.dp, vertical = 8.dp)
                    )
                }
            }
        }
    }
}
