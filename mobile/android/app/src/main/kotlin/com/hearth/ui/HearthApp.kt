package com.hearth.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.hearth.backup.BackupException
import com.hearth.backup.isEncrypted
import com.hearth.backup.openContainer
import com.hearth.data.ConsentKind
import com.hearth.data.Db
import com.hearth.data.Repo
import com.hearth.i18n.Strings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** The string catalogue, reachable from every screen as `LocalStrings.current("key")`. */
val LocalStrings = staticCompositionLocalOf<Strings> { error("Strings not provided") }

/** "delete" → "Delete": the web keeps some button labels lower-case; native buttons are capitalised. */
fun String.cap(): String = replaceFirstChar { it.titlecase() }

/**
 * Root of the native app (ADR 0010): the first-launch consent, then the health log. Reads and
 * writes go to the app's own database on the IO dispatcher; the screens only ever see lists.
 */
@Composable
fun HearthApp() {
    val context = LocalContext.current
    val strings = remember { Strings.load(context) }
    val repo = remember { Repo(Db.get(context)) }
    var consented by remember { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(Unit) { consented = withContext(Dispatchers.IO) { repo.hasConsent(ConsentKind.FIRST_LAUNCH) } }

    CompositionLocalProvider(LocalStrings provides strings) {
        when (consented) {
            null -> Unit
            false -> FirstLaunch { withContext(Dispatchers.IO) { repo.grantConsent(ConsentKind.FIRST_LAUNCH) }; consented = true }
            true -> HealthScreen(repo)
        }
    }
}

/** The web's consent gate: every statement ticked before anything is stored (design §13.1). */
@Composable
private fun FirstLaunch(onAgree: suspend () -> Unit) {
    val t = LocalStrings.current
    val kind = ConsentKind.FIRST_LAUNCH
    val ticked = remember { mutableStateListOf(*Array(kind.statements) { false }) }
    val scope = rememberCoroutineScope()
    Scaffold { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(t(kind.titleKey), style = MaterialTheme.typography.headlineMedium)
            Text(t("native.intro"), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            kind.statementKeys.forEachIndexed { i, statement ->
                Row(verticalAlignment = Alignment.Top) {
                    Checkbox(checked = ticked[i], onCheckedChange = { ticked[i] = it })
                    // Statement 1 is about where data lives, which on a phone is not a browser.
                    val key = if (i == 0) "native.firstLaunchStorage" else statement
                    Text(t(key), Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium)
                }
            }
            Text(
                t("consentForm.recorded", "version" to kind.version),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Button(onClick = { scope.launch { onAgree() } }, enabled = ticked.all { it }, modifier = Modifier.fillMaxWidth()) {
                Text(t("consentGate.start"))
            }
        }
    }
}

/**
 * "Restore a backup…": the system picker, a passphrase when the file is encrypted, then a merge
 * into this app's database. Returns the launcher to call; results land in the snackbar.
 */
@Composable
fun rememberRestore(repo: Repo, snackbar: SnackbarHostState, onRestored: () -> Unit): () -> Unit {
    val context = LocalContext.current
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<ByteArray?>(null) }
    var wrong by remember { mutableStateOf(false) }

    fun run(bytes: ByteArray, passphrase: String?) = scope.launch {
        val message = try {
            val r = withContext(Dispatchers.IO) { repo.restore(openContainer(bytes, passphrase)) }
            pending = null
            onRestored()
            t("native.restored", "people" to r.persons, "entries" to r.healthEntries)
        } catch (e: BackupException) {
            if (passphrase != null && isEncrypted(bytes)) {
                wrong = true
                return@launch
            }
            t(e.key)
        } catch (e: Exception) {
            pending = null
            t("native.error", "error" to (e.message ?: e.javaClass.simpleName))
        }
        snackbar.showSnackbar(message)
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val bytes = withContext(Dispatchers.IO) { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                ?: return@launch
            wrong = false
            if (isEncrypted(bytes)) pending = bytes else run(bytes, null)
        }
    }

    pending?.let { bytes ->
        var passphrase by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { pending = null },
            title = { Text(t("native.encryptedTitle")) },
            text = {
                OutlinedTextField(
                    value = passphrase,
                    onValueChange = { passphrase = it; wrong = false },
                    label = { Text(t("app.passphrase")) },
                    singleLine = true,
                    isError = wrong,
                    supportingText = if (wrong) ({ Text(t("app.wrongPassphrase")) }) else null,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
            },
            confirmButton = { TextButton(onClick = { run(bytes, passphrase) }, enabled = passphrase.isNotEmpty()) { Text(t("native.open")) } },
            dismissButton = { TextButton(onClick = { pending = null }) { Text(t("common.cancel")) } },
        )
    }
    return { picker.launch(arrayOf("*/*")) }
}
