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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.donggua.tv.AppSession
import com.donggua.tv.DongguaApi
import com.donggua.tv.TmdbDetail

@Composable
fun TmdbDetailScreen(
    api: DongguaApi,
    session: AppSession,
    onBack: () -> Unit,
    onSearchSources: (String) -> Unit
) {
    val item = session.selectedTmdb
    if (item == null) {
        Column(Modifier.fillMaxSize()) {
            AppTopBar(title = "影片详情", onBack = onBack)
            EmptyPane("没有可显示的影片")
        }
        return
    }

    var detail by remember(item) { mutableStateOf<TmdbDetail?>(null) }
    var loading by remember(item) { mutableStateOf(true) }
    var error by remember(item) { mutableStateOf("") }

    LaunchedEffect(item) {
        loading = true
        error = ""
        runCatching { api.tmdbDetail(item.mediaType, item.id) }
            .onSuccess { detail = it }
            .onFailure { error = it.message ?: "读取 TMDb 详情失败" }
        loading = false
    }

    Column(modifier = Modifier.fillMaxSize()) {
        AppTopBar(title = item.title, onBack = onBack)
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 30.dp)
        ) {
            item { BackdropHeader(api, item.posterPath ?: item.backdropPath, item.backdropPath, item.title) }
            item {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (item.year.isNotBlank()) {
                            Text(item.year, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                        }
                        if (item.voteAverage > 0) {
                            Spacer(Modifier.width(12.dp))
                            Text(
                                "★ ${String.format("%.1f", item.voteAverage)}",
                                color = Color(0xFFFFD166),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        val runtime = detail?.runtime.orEmpty()
                        if (runtime.isNotBlank()) {
                            Spacer(Modifier.width(12.dp))
                            Text(runtime, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp)
                        }
                    }
                    if (item.originalTitle.isNotBlank() && item.originalTitle != item.title) {
                        Spacer(Modifier.height(3.dp))
                        Text(item.originalTitle, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp)
                    }
                    Spacer(Modifier.height(16.dp))
                    Button(
                        onClick = { onSearchSources(item.title) },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = RoundedCornerShape(14.dp)
                    ) {
                        Text("搜索可播放片源", fontWeight = FontWeight.Bold)
                    }
                }
            }
            if (loading) {
                item { LoadingPane("正在读取影片资料…") }
            } else if (error.isNotBlank()) {
                item { ErrorPane(error) }
            } else {
                val info = detail
                if (info != null) {
                    if (info.genres.isNotEmpty()) {
                        item {
                            LazyRow(
                                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 14.dp),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                items(info.genres) { genre -> Pill(genre) }
                            }
                        }
                    }
                    if (info.tagline.isNotBlank()) {
                        item {
                            Text(
                                info.tagline,
                                color = MaterialTheme.colorScheme.primary,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                            )
                        }
                    }
                    if (info.item.overview.isNotBlank()) {
                        item {
                            Text(
                                info.item.overview,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 14.sp,
                                lineHeight = 21.sp,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp)
                            )
                        }
                    }
                    if (info.cast.isNotEmpty()) {
                        item { SectionTitle("演员") }
                        item {
                            LazyRow(
                                contentPadding = PaddingValues(horizontal = 16.dp),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                items(info.cast) { cast ->
                                    Column(Modifier.width(76.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                        Box(
                                            modifier = Modifier.size(62.dp).clip(CircleShape)
                                                .background(MaterialTheme.colorScheme.surfaceVariant)
                                        ) {
                                            AsyncImage(
                                                model = api.imageUrl(cast.profilePath, "w185"),
                                                contentDescription = cast.name,
                                                modifier = Modifier.matchParentSize(),
                                                contentScale = ContentScale.Crop
                                            )
                                        }
                                        Spacer(Modifier.height(5.dp))
                                        Text(
                                            cast.name,
                                            color = MaterialTheme.colorScheme.onBackground,
                                            fontSize = 11.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        if (cast.character.isNotBlank()) {
                                            Text(
                                                cast.character,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                fontSize = 9.sp,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                    item {
                        Text(
                            "影片资料来自 TMDb。播放资源请在搜索页进入采集站片源。",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun BackdropHeader(
    api: DongguaApi,
    posterPath: String?,
    backdropPath: String?,
    title: String
) {
    Box(modifier = Modifier.fillMaxWidth().height(300.dp)) {
        AsyncImage(
            model = api.imageUrl(backdropPath ?: posterPath, "w780"),
            contentDescription = title,
            modifier = Modifier.matchParentSize(),
            contentScale = ContentScale.Crop
        )
        Box(
            modifier = Modifier.matchParentSize().background(
                Brush.verticalGradient(listOf(Color.Transparent, Color(0xE60B0B0C)))
            )
        )
        Text(
            title,
            color = Color.White,
            fontSize = 28.sp,
            fontWeight = FontWeight.Black,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.BottomStart).padding(18.dp)
        )
    }
}
