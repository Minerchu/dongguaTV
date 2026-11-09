package com.donggua.tv

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.compose.rememberNavController
import coil.compose.AsyncImage
import com.donggua.tv.ui.MainNavigation
import com.donggua.tv.ui.PairingBus
import com.donggua.tv.ui.ScanServerButton
import kotlinx.coroutines.launch

private val DongguaColorScheme = darkColorScheme(
    primary = Color(0xFFF6121D),
    onPrimary = Color.White,
    primaryContainer = Color(0xFF7A0710),
    onPrimaryContainer = Color.White,
    secondary = Color(0xFFE5B45A),
    background = Color(0xFF0B0B0C),
    onBackground = Color(0xFFF4F4F5),
    surface = Color(0xFF151518),
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF252529),
    onSurfaceVariant = Color(0xFFB9B9C0),
    outline = Color(0xFF44444B)
)

@Composable
fun DongguaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DongguaColorScheme,
        typography = MaterialTheme.typography.copy(
            headlineLarge = MaterialTheme.typography.headlineLarge.copy(fontWeight = FontWeight.Black),
            headlineMedium = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
            titleLarge = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            titleMedium = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold)
        ),
        content = content
    )
}

class AppSession {
    var selectedGroup by mutableStateOf<VideoGroup?>(null)
    var selectedTmdb by mutableStateOf<TmdbItem?>(null)
    var playingEpisodes by mutableStateOf<List<Episode>>(emptyList())
    var playingIndex by mutableIntStateOf(0)
    var playingTitle by mutableStateOf("")
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PairingBus.emit(intent?.dataString)
        setContent {
            DongguaTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    DongguaApp()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        PairingBus.emit(intent.dataString)
    }
}

@Composable
private fun DongguaApp() {
    val context = LocalContext.current
    val prefs = remember { AppPrefs(context) }
    val api = remember { DongguaApi(prefs) }
    var serverUrl by remember { mutableStateOf(prefs.serverUrl) }
    val appName = stringResource(R.string.app_name)
    val pendingPairing by PairingBus.pending.collectAsState()

    LaunchedEffect(pendingPairing) {
        val target = pendingPairing ?: return@LaunchedEffect
        try {
            val config = api.probe(target)
            if (config.siteCount == 0) {
                Toast.makeText(context, "连接成功，但站长还没有配置采集站", Toast.LENGTH_LONG).show()
            } else {
                prefs.saveServerUrl(target)
                serverUrl = prefs.serverUrl
                Toast.makeText(context, "已连接 ${config.siteCount} 个采集站", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            Toast.makeText(context, e.message ?: "二维码里的服务器无法连接", Toast.LENGTH_LONG).show()
        } finally {
            PairingBus.consume()
        }
    }

    if (serverUrl.isBlank()) {
        SetupScreen(
            api = api,
            appName = appName,
            onConnected = { connectedUrl ->
                prefs.saveServerUrl(connectedUrl)
                serverUrl = prefs.serverUrl
            }
        )
    } else {
        key(serverUrl) {
            MainNavigation(
                api = api,
                prefs = prefs,
                appName = appName,
                onServerChanged = { newUrl ->
                    if (newUrl.isBlank()) prefs.clearServerUrl() else prefs.saveServerUrl(newUrl)
                    serverUrl = prefs.serverUrl
                }
            )
        }
    }
}

@Composable
private fun SetupScreen(api: DongguaApi, appName: String, onConnected: (String) -> Unit) {
    val scope = rememberCoroutineScope()
    var input by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }

    fun connect(raw: String) {
        if (raw.isBlank()) {
            error = "请填写服务器地址"
            return
        }
        scope.launch {
            loading = true
            error = ""
            try {
                val config = api.probe(raw)
                if (config.siteCount == 0) {
                    error = "连接成功，但站长还没有配置采集站"
                } else {
                    onConnected(normalizeServerUrl(raw))
                }
            } catch (e: Exception) {
                error = e.message ?: "无法连接到服务器"
            } finally {
                loading = false
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            AsyncImage(
                model = painterResource(R.drawable.ic_launcher_512),
                contentDescription = null,
                modifier = Modifier.size(92.dp).clip(RoundedCornerShape(24.dp)),
                contentScale = ContentScale.Crop
            )
            Spacer(Modifier.height(20.dp))
            Text(appName, color = MaterialTheme.colorScheme.onBackground, fontSize = 30.sp, fontWeight = FontWeight.Black)
            Text(
                "连接站长提供的服务器即可开始",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp, bottom = 28.dp)
            )
            OutlinedTextField(
                value = input,
                onValueChange = { input = it; error = "" },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("服务器地址") },
                placeholder = { Text("例如 http://192.168.1.10:3000") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp)
            )
            ScanServerButton(
                modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                label = "扫码连接服务器"
            ) { scanned ->
                input = scanned
                connect(scanned)
            }
            if (error.isNotBlank()) {
                Text(
                    error,
                    color = MaterialTheme.colorScheme.primary,
                    fontSize = 13.sp,
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                    textAlign = TextAlign.Start
                )
            }
            Button(
                onClick = { connect(input) },
                enabled = !loading,
                modifier = Modifier.fillMaxWidth().padding(top = 18.dp).height(50.dp),
                shape = RoundedCornerShape(14.dp)
            ) {
                if (loading) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
                } else {
                    Text("连接服务器", fontWeight = FontWeight.Bold)
                }
            }
            Text(
                "地址由站点管理员提供，通常以 http:// 或 https:// 开头",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 18.dp)
            )
        }
    }
}
