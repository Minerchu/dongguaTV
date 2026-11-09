package com.donggua.tv.ui

import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.donggua.tv.AppPrefs
import com.donggua.tv.AndroidRelease
import com.donggua.tv.DongguaApi
import com.donggua.tv.ServerConfig
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(
    api: DongguaApi,
    prefs: AppPrefs,
    appName: String,
    onBack: () -> Unit,
    onServerChanged: (String) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var serverUrl by remember { mutableStateOf(api.baseUrl) }
    var testing by remember { mutableStateOf(false) }
    var config by remember { mutableStateOf<ServerConfig?>(null) }
    var message by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var latestRelease by remember { mutableStateOf<AndroidRelease?>(null) }
    var updateMessage by remember { mutableStateOf("") }
    var checkingUpdate by remember { mutableStateOf(false) }

    fun checkForUpdate() {
        scope.launch {
            checkingUpdate = true
            updateMessage = ""
            runCatching { api.config() }
                .onSuccess { current ->
                    config = current
                    val release = current.android
                    if (release == null || !release.available) {
                        latestRelease = null
                        updateMessage = "站长还没有生成可用的 Android 安装包"
                    } else if (release.versionCode > prefs.bundledVersionCode) {
                        latestRelease = release
                        updateMessage = "发现新版本 v${release.version.ifBlank { release.versionCode.toString() }}"
                    } else {
                        latestRelease = null
                        updateMessage = "已是最新版本"
                    }
                }
                .onFailure { updateMessage = it.message ?: "检查更新失败" }
            checkingUpdate = false
        }
    }

    LaunchedEffect(Unit) { checkForUpdate() }

    Column(modifier = Modifier.fillMaxSize()) {
        AppTopBar(title = "设置", onBack = onBack)
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)
        ) {
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("服务器", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(10.dp))
                    OutlinedTextField(
                        value = serverUrl,
                        onValueChange = { serverUrl = it; error = ""; message = "" },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("站点地址") },
                        placeholder = { Text("http://192.168.1.10:3000") },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp)
                    )
                    ScanServerButton(
                        modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                        label = "扫码更换服务器"
                    ) { scanned ->
                        serverUrl = scanned
                        error = ""
                        message = ""
                        scope.launch {
                            testing = true
                            runCatching { api.probe(scanned) }
                                .onSuccess {
                                    onServerChanged(normalize(scanned))
                                    Toast.makeText(context, "已通过二维码连接服务器", Toast.LENGTH_SHORT).show()
                                }
                                .onFailure { error = it.message ?: "二维码里的服务器无法连接" }
                            testing = false
                        }
                    }
                    if (error.isNotBlank()) {
                        Text(error, color = MaterialTheme.colorScheme.primary, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                    }
                    if (message.isNotBlank()) {
                        Text(message, color = Color(0xFF79D98A), fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    testing = true
                                    error = ""
                                    message = ""
                                    runCatching { api.probe(serverUrl) }
                                        .onSuccess {
                                            config = it
                                            message = "连接正常：${it.siteCount} 个采集站" + if (it.cloudEnabled) "，网盘搜索已开启" else ""
                                        }
                                        .onFailure { error = it.message ?: "连接失败" }
                                    testing = false
                                }
                            },
                            enabled = !testing,
                            shape = RoundedCornerShape(50)
                        ) {
                            if (testing) {
                                CircularProgressIndicator(modifier = Modifier.height(16.dp), strokeWidth = 2.dp)
                            } else {
                                Text("测试连接")
                            }
                        }
                        Button(
                            onClick = {
                                scope.launch {
                                    testing = true
                                    error = ""
                                    message = ""
                                    runCatching { api.probe(serverUrl) }
                                        .onSuccess {
                                            val normalized = normalize(serverUrl)
                                            onServerChanged(normalized)
                                            Toast.makeText(context, "服务器已更新", Toast.LENGTH_SHORT).show()
                                        }
                                        .onFailure { error = it.message ?: "无法保存，请检查地址" }
                                    testing = false
                                }
                            },
                            enabled = !testing,
                            shape = RoundedCornerShape(50)
                        ) {
                            Text("保存并重连")
                        }
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text("关于", color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(8.dp))
                    InfoRow("应用", appName)
                    InfoRow("客户端版本", prefs.bundledVersionName)
                    InfoRow("客户端版本号", prefs.bundledVersionCode.toString())
                    config?.let {
                        InfoRow("采集站", "${it.siteCount} 个")
                        InfoRow("网盘搜索", if (it.cloudEnabled) "已开启" else "未开启")
                        it.android?.let { release ->
                            InfoRow("站点客户端", "v${release.version.ifBlank { "1.0.0" }}")
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    OutlinedButton(
                        onClick = { checkForUpdate() },
                        enabled = !checkingUpdate,
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(50)
                    ) {
                        if (checkingUpdate) {
                            CircularProgressIndicator(modifier = Modifier.height(16.dp), strokeWidth = 2.dp)
                        } else {
                            Text("检查客户端更新")
                        }
                    }
                    if (updateMessage.isNotBlank()) {
                        Text(
                            updateMessage,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(top = 8.dp)
                        )
                    }
                    latestRelease?.let { release ->
                        Button(
                            onClick = { openExternal(context, release.downloadUrl) },
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            shape = RoundedCornerShape(50)
                        ) {
                            Text("下载并安装 v${release.version.ifBlank { release.versionCode.toString() }}")
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Text(
                        "这是原生 Android 客户端，使用站点公开接口搜索、查看详情和播放；网盘搜索结果由站长配置的 PanSou 服务提供。",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 12.sp,
                        lineHeight = 18.sp
                    )
                }
            }

            Spacer(Modifier.height(14.dp))
            OutlinedButton(
                onClick = { openExternal(context, api.baseUrl) },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(50)
            ) {
                Text("打开网页版")
            }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = { onServerChanged("") },
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(50)
            ) {
                Text("更换服务器")
            }
            Spacer(Modifier.height(22.dp))
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, modifier = Modifier.weight(1f))
        Text(value, color = MaterialTheme.colorScheme.onSurface, fontSize = 13.sp)
    }
}

private fun normalize(value: String): String {
    var result = value.trim()
    if (!result.startsWith("http://", true) && !result.startsWith("https://", true)) {
        result = "http://$result"
    }
    return result.trimEnd('/')
}
