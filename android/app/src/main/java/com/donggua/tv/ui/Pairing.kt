package com.donggua.tv.ui

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.donggua.tv.normalizeServerUrl
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object PairingBus {
    private val pendingValue = MutableStateFlow<String?>(null)
    val pending: StateFlow<String?> = pendingValue.asStateFlow()

    fun emit(raw: String?) {
        parsePairingLink(raw)?.let { pendingValue.value = it }
    }

    fun consume() {
        pendingValue.value = null
    }
}

fun parsePairingLink(raw: String?): String? {
    val value = raw.orEmpty().trim()
    if (value.isBlank()) return null
    val uri = runCatching { Uri.parse(value) }.getOrNull() ?: return null
    val candidate = when {
        uri.scheme.equals("dongguatv", ignoreCase = true) && uri.host.equals("connect", ignoreCase = true) ->
            uri.getQueryParameter("url")
        value.startsWith("http://", ignoreCase = true) || value.startsWith("https://", ignoreCase = true) -> value
        else -> null
    }
    return normalizeServerUrl(candidate).ifBlank { null }
}

@Composable
fun ScanServerButton(
    modifier: Modifier = Modifier,
    label: String = "扫码绑定",
    onUrl: (String) -> Unit
) {
    val context = LocalContext.current
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val url = parsePairingLink(result.contents)
        if (url == null) {
            if (!result.contents.isNullOrBlank()) Toast.makeText(context, "二维码不是冬瓜TV服务器地址", Toast.LENGTH_SHORT).show()
        } else {
            onUrl(url)
        }
    }

    fun launchScanner() {
        scanLauncher.launch(
            ScanOptions().apply {
                setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                setPrompt("扫描后台 Android 页面里的二维码")
                setBeepEnabled(false)
                setOrientationLocked(false)
            }
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchScanner() else Toast.makeText(context, "需要相机权限才能扫码", Toast.LENGTH_SHORT).show()
    }

    OutlinedButton(
        onClick = {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                launchScanner()
            } else {
                permissionLauncher.launch(Manifest.permission.CAMERA)
            }
        },
        modifier = modifier,
        shape = RoundedCornerShape(50)
    ) {
        Row {
            Icon(Icons.Filled.QrCodeScanner, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(label)
        }
    }
}
