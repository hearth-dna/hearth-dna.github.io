package com.hearth.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.hearth.Cloud
import com.hearth.Egress
import com.hearth.Secrets
import com.hearth.backup.Backups
import com.hearth.backup.BackupException
import com.hearth.backup.DriveFolder
import com.hearth.backup.DriveFolders
import com.hearth.backup.Place
import com.hearth.backup.Status
import com.hearth.backup.driveAccount
import com.hearth.backup.restoreBytes
import com.hearth.backup.snapshotBytes
import com.hearth.data.ConsentKind
import com.hearth.data.Repo
import com.hearth.export.OpenFormat
import com.hearth.export.findingsTable
import com.hearth.export.genotypeTable
import com.hearth.export.healthTable
import com.hearth.export.openFileName
import com.hearth.export.personColumns
import com.hearth.export.render
import com.hearth.i18n.LANGUAGES
import com.hearth.kb.Kb
import com.hearth.kb.computeFindings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.coroutines.resume

private fun clock(iso: String): String = runCatching {
    DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(iso))
}.getOrDefault(iso)

private fun mb(bytes: Long) = String.format(Locale.ROOT, "%.1f", bytes / 1024.0 / 1024.0)

/**
 * Settings & export (SettingsPage.tsx): language, the full dump, the backup place, open formats,
 * the Gemini key, consents with revoke, the sharing log, and erasing everything.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(repo: Repo, kb: Kb, backups: Backups, cloud: Cloud?, language: String, onLanguage: (String) -> Unit, onErased: () -> Unit) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    var reloads by remember { mutableStateOf(0) }
    val say: (String) -> Unit = { m -> scope.launch { snackbar.showSnackbar(m) } }
    val topBar = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(topBar.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(t("settingsPage.title")) },
                scrollBehavior = topBar,
                colors = TopAppBarDefaults.largeTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = 32.dp)) {
            item(key = "language") {
                Card(t("common.language")) {
                    Picker(t("common.language"), language, LANGUAGES.map { it.code to it.name }, modifier = Modifier.fillMaxWidth(), onPick = onLanguage)
                    Muted(t("settingsPage.languageNote"))
                }
            }
            item(key = "dump") { DumpCard(repo, say) { reloads++ } }
            item(key = "backup") { BackupCard(repo, backups, cloud, say) }
            item(key = "open") { OpenFormatsCard(repo, kb, say) }
            item(key = "gemini") { GeminiCard(say) }
            item(key = "consents") { ConsentsCard(repo, reloads, onErased) { reloads++ } }
            item(key = "sharing") { SharingCard(repo, reloads) }
            item(key = "erase") { EraseCard(repo, onErased) }
        }
    }
}

@Composable
private fun Card(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        content()
    }
    HorizontalDivider(Modifier.padding(horizontal = 16.dp))
}

@Composable
private fun Muted(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun Notice(text: String) = Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
    Text(text, Modifier.padding(12.dp), style = MaterialTheme.typography.bodyMedium)
}

@Composable
private fun Passphrase(label: String, value: String, enabled: Boolean = true, onDone: () -> Unit = {}, onChange: (String) -> Unit) =
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        enabled = enabled,
        label = { Text(label) },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = Modifier.fillMaxWidth(),
    )

/** Writes bytes to a document the user creates in the system picker; the file never passes through anything else. */
@Composable
private fun rememberSave(onPicked: (Uri) -> Unit) =
    rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri -> uri?.let(onPicked) }

// ---- full dump -------------------------------------------------------------------------------

@Composable
private fun DumpCard(repo: Repo, say: (String) -> Unit, onImported: () -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pass by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }
    val save = rememberSave { uri ->
        scope.launch {
            busy = t("settingsPage.buildingDump")
            val message = try {
                val bytes = withContext(Dispatchers.IO) {
                    snapshotBytes(repo, Backups.APP_VERSION, pass.ifEmpty { null }).also { b -> context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(b) } }
                }
                val name = context.displayName(uri)
                t(if (pass.isNotEmpty()) "exportDump.encrypted" else "exportDump.plaintext", "name" to name, "mb" to mb(bytes.size.toLong()))
            } catch (e: Exception) {
                t("eraseDialog.exportFailed", "error" to (e.message ?: e.javaClass.simpleName))
            }
            busy = null
            say(message)
        }
    }
    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = t("settingsPage.readingDump")
            val message = try {
                val r = withContext(Dispatchers.IO) {
                    restoreBytes(repo, context.contentResolver.openInputStream(uri)!!.use { it.readBytes() }, pass.ifEmpty { null }, onProgress = { key, params ->
                        busy = t(key, *params.map { (k, v) -> k to v }.toTypedArray())
                    })
                }
                onImported()
                t("settingsPage.imported", "people" to r.persons, "genomes" to r.genomes, "version" to 2, "exportedAt" to r.exportedAt)
            } catch (e: BackupException) {
                t("settingsPage.importFailed", "error" to t(e.key))
            } catch (e: Exception) {
                t("settingsPage.importFailed", "error" to (e.message ?: e.javaClass.simpleName))
            }
            busy = null
            say(message)
        }
    }
    Card(t("settingsPage.fullDump")) {
        Muted(t("native.fullDumpIntro"))
        Passphrase(t("settingsPage.passphrase"), pass) { pass = it }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = busy == null, onClick = { save.launch("hearth-${java.time.LocalDate.now()}.hearth") }) { Text(t("settingsPage.exportDump")) }
            OutlinedButton(enabled = busy == null, onClick = { open.launch(arrayOf("*/*")) }) { Text(t("settingsPage.importDump")) }
        }
        busy?.let { Muted(it); LinearProgressIndicator(Modifier.fillMaxWidth()) }
    }
}

// ---- backup place ----------------------------------------------------------------------------

/** Cloud.kt's callback API as a suspend call; it must be started on the main thread. */
private suspend fun Cloud.signInSuspending(provider: String): JSONObject? = suspendCancellableCoroutine { c ->
    signIn(provider) { r -> c.resume(r.getOrNull() as? JSONObject) }
}

/** The backup card (BackupCard.tsx): pick a place (with its consent), then its state and actions. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BackupCard(repo: Repo, backups: Backups, cloud: Cloud?, say: (String) -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val status by backups.status.collectAsState()
    var consenting by remember { mutableStateOf<String?>(null) }
    var changing by remember { mutableStateOf(false) }
    var forgetting by remember { mutableStateOf(false) }
    var drive by remember { mutableStateOf<Pair<JSONObject, DriveFolders>?>(null) }
    var pass by remember { mutableStateOf(backups.passphrase()) }
    var busy by remember { mutableStateOf<String?>(null) }
    val providers = remember { cloud?.providers()?.let { a -> (0 until a.length()).map(a::getString) } ?: emptyList() }

    fun take(uri: Uri): Boolean = runCatching {
        context.contentResolver.takePersistableUriPermission(uri, Backups.READ_WRITE)
        true
    }.getOrElse {
        say(t("native.providerRefuses"))
        false
    }
    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
        if (uri != null && take(uri)) { backups.choose(Place.Folder(uri.toString(), context.treeName(uri))); changing = false }
    }
    val newFile = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null && take(uri)) { backups.choose(Place.File(uri.toString(), context.displayName(uri))); changing = false }
    }
    val existingFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null && take(uri)) { backups.choose(Place.File(uri.toString(), context.displayName(uri))); changing = false }
    }

    fun signIn(provider: String) = scope.launch {
        val c = cloud ?: return@launch
        val signed = try {
            c.signInSuspending(provider) ?: return@launch
        } catch (e: Exception) {
            say(e.message ?: e.javaClass.simpleName)
            return@launch
        }
        if (provider == "dropbox") {
            val label = signed.optString("label")
            backups.choose(Place.Cloud("dropbox", signed.getString("account"), label, "${t("backupCard.dropbox")} ($label)"))
            changing = false
        } else {
            // Play services does not always say who signed in; Drive does, and the account is how
            // every later token is found.
            val token = signed.getString("token")
            val account = signed.optString("account").ifEmpty { withContext(Dispatchers.IO) { runCatching { driveAccount { token } }.getOrDefault("") } }
            if (account.isEmpty()) return@launch say("Google Drive did not say which account signed in")
            drive = signed.put("account", account) to DriveFolders { token }
        }
    }

    fun choose(mode: String) = scope.launch {
        val kind = if (mode == "google" || mode == "dropbox") ConsentKind.CLOUD_BACKUP else ConsentKind.BACKUP_FOLDER
        if (!withContext(Dispatchers.IO) { repo.hasConsent(kind) }) { consenting = mode; return@launch }
        when (mode) {
            "google", "dropbox" -> signIn(mode)
            "folder" -> folderPicker.launch(null)
            "newFile" -> newFile.launch("hearth-backup.hearth")
            else -> existingFile.launch(arrayOf("*/*"))
        }
    }

    val labels = mapOf(
        "google" to t("backupCard.google"), "dropbox" to t("backupCard.dropbox"), "folder" to t("backupCard.chooseFolder"),
        "newFile" to t("backupCard.newFile"), "existingFile" to t("backupCard.existingFile"),
    )
    val pickButtons: @Composable () -> Unit = {
        if (providers.isNotEmpty()) {
            Muted(t("backupCard.cloudHint"))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) { for (p in providers) Button(onClick = { choose(p) }) { Text(labels.getValue(p)) } }
        }
        Text(if (providers.isNotEmpty()) rich(t("backupCard.otherPlacesHint")) else rich(t("backupCard.pickHintAndroid")), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (m in listOf("folder", "newFile", "existingFile")) OutlinedButton(onClick = { choose(m) }) { Text(labels.getValue(m)) }
            if (changing) TextButton(onClick = { changing = false }) { Text(t("common.cancel")) }
        }
    }

    Card(t("backupCard.title")) {
        Muted(t(if (providers.isNotEmpty()) "backupCard.introCloud" else "backupCard.introPhone"))
        consenting?.let { mode ->
            val kind = if (mode == "google" || mode == "dropbox") ConsentKind.CLOUD_BACKUP else ConsentKind.BACKUP_FOLDER
            val ticks = rememberTicks(kind)
            Text(t(kind.titleKey), style = MaterialTheme.typography.titleMedium)
            ConsentChecks(kind, ticks)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = ticks.all { it }, onClick = {
                    scope.launch {
                        withContext(Dispatchers.IO) { repo.grantConsent(kind) }
                        consenting = null
                        choose(mode)
                    }
                }) { Text(labels.getValue(mode)) }
                TextButton(onClick = { consenting = null }) { Text(t("common.cancel")) }
            }
        }
        drive?.let { (signed, folders) -> DriveFolderChooser(folders) { folder ->
            drive = null
            if (folder == null) return@DriveFolderChooser
            val account = signed.getString("account")
            val label = signed.optString("label").ifEmpty { account }
            val name = if (folder.second.isEmpty()) "${t("backupCard.google")} ($label)" else "${t("backupCard.google")} › ${folder.second}"
            backups.choose(Place.Cloud("google", account, label, name, folder.first))
            changing = false
        } }
        val s = status
        if (s is Status.None && consenting == null && drive == null) pickButtons()
        if (s !is Status.None) {
            val name = backups.saved?.place?.name ?: ""
            Text(rich(t(if (backups.single) "backupCard.file" else "backupCard.folder", "name" to name)), style = MaterialTheme.typography.bodyLarge)
            if (s is Status.Ready) {
                val bits = listOfNotNull(
                    s.lastAt?.let { t("backupCard.lastBackup", "time" to clock(it)) },
                    if (s.pending) t("backupCard.pending") else null,
                    if (s.attachmentsPending > 0) t("backupCard.attachmentsPending", "n" to s.attachmentsPending) else null,
                )
                if (bits.isNotEmpty()) Muted(bits.joinToString("").removePrefix(" · "))
            }
            if (backups.single) Muted(t("backupCard.singleNote"))
            if (backups.saved?.place is Place.Cloud) Muted(t("backupCard.cloudNote"))
            if (s is Status.Ready && s.attachmentsMissing > 0 && !backups.single) {
                Notice(t("backupCard.attachmentsMissing", "n" to s.attachmentsMissing))
                OutlinedButton(onClick = {
                    scope.launch {
                        val (pulled, missing) = backups.pullDocuments()
                        say(t("backupCard.attachmentsFetched", "n" to pulled, "missing" to missing))
                    }
                }) { Text(t("backupCard.fetchAttachments")) }
            }
            val activity = (s as? Status.Writing)?.let {
                t(
                    when (it.step) {
                        "loading" -> "backupCard.loading"
                        "building" -> "backupCard.building"
                        "attachments" -> "backupCard.copyingAttachments"
                        else -> "backupCard.writingFile"
                    },
                    "name" to it.name,
                )
            } ?: busy
            activity?.let { Muted(it); LinearProgressIndicator(Modifier.fillMaxWidth()) }
            Passphrase(t(if (backups.plain) "backupCard.passphraseNotUsed" else "backupCard.passphraseRequired"), pass, enabled = !backups.plain, onDone = {
                // Applied when typing is done, never per keystroke: half a passphrase must not encrypt a backup.
                if (pass != backups.passphrase()) backups.setPassphrase(pass)
            }) { pass = it }
            if (!backups.plain) Muted(t("backupCard.passphraseKept"))
            SwitchLine(t("backupCard.autoSync"), backups.auto) { backups.setAuto(it) }
            SwitchLine(t("backupCard.storeUnencrypted"), backups.plain) { backups.setPlain(it) }
            when (s) {
                is Status.Reconnect -> {
                    Notice(t("backupCard.reconnectNoticeNative", "name" to s.name))
                    Button(onClick = { changing = true }) { Text(t("backupCard.pickAgain")) }
                }
                is Status.NeedsPassphrase -> Notice(t("backupCard.needsPassphrase"))
                is Status.Error -> Text(t("backupCard.failed", "message" to t(s.message)), color = MaterialTheme.colorScheme.error)
                else -> Unit
            }
            val working = s is Status.Writing || busy != null
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(enabled = !working && (s is Status.Ready || s is Status.Error), onClick = {
                    if (pass != backups.passphrase()) backups.setPassphrase(pass)
                    scope.launch {
                        backups.backupNow()
                        (backups.status.value as? Status.Ready)?.let { r -> say(t("backupCard.done", "name" to r.name, "time" to (r.lastAt?.let(::clock) ?: ""))) }
                    }
                }) { Text(t("backupCard.backUpNow")) }
                if (s is Status.Ready) OutlinedButton(enabled = !working, onClick = {
                    scope.launch {
                        busy = t("backupCard.loading", "name" to s.name)
                        val message = try {
                            val r = backups.loadFromPlace()
                            t("backupCard.loaded", "people" to r.persons, "genomes" to r.genomes, "name" to s.name, "exportedAt" to r.exportedAt)
                        } catch (e: BackupException) {
                            t("backupCard.failed", "message" to t(e.key))
                        } catch (e: Exception) {
                            t("backupCard.failed", "message" to (e.message ?: e.javaClass.simpleName))
                        }
                        busy = null
                        say(message)
                    }
                }) { Text(t("backupCard.loadFromFolder")) }
                OutlinedButton(enabled = !working, onClick = { changing = true }) { Text(t("backupCard.changeFolder")) }
                TextButton(enabled = !working, onClick = { forgetting = true }) { Text(t("backupCard.forgetFolder"), color = MaterialTheme.colorScheme.error) }
            }
            if (changing && consenting == null && drive == null) pickButtons()
        }
    }

    if (forgetting) {
        AlertDialog(
            onDismissRequest = { forgetting = false },
            text = { Text(t("backupCard.forgetConfirm")) },
            confirmButton = {
                TextButton(onClick = {
                    forgetting = false
                    scope.launch {
                        val (n, files) = backups.forget(true)
                        withContext(Dispatchers.IO) { repo.revokeConsent("backup_folder", "") }
                        say(t("backupCard.forgottenDeletedWithFiles", "n" to n, "files" to files))
                    }
                }) { Text(t("common.delete").cap(), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = {
                    forgetting = false
                    scope.launch {
                        backups.forget(false)
                        withContext(Dispatchers.IO) { repo.revokeConsent("backup_folder", "") }
                        say(t("backupCard.forgottenKept"))
                    }
                }) { Text(t("native.keepFiles")) }
            },
        )
    }
}

@Composable
private fun SwitchLine(label: String, on: Boolean, onChange: (Boolean) -> Unit) =
    Row(Modifier.fillMaxWidth().clickable { onChange(!on) }, verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = on, onCheckedChange = onChange)
    }

/** A picked folder's name as the provider shows it. */
private fun android.content.Context.treeName(tree: Uri): String {
    val doc = android.provider.DocumentsContract.buildDocumentUriUsingTree(tree, android.provider.DocumentsContract.getTreeDocumentId(tree))
    return displayName(doc)
}

/**
 * Where on Drive the backup goes (DriveFolderChooser.tsx): a folder that already holds one (the
 * backup from another device is one tap away), a folder found by name, or a `Hearth` folder in My
 * Drive. Answers (id, path) or null when the user backs out; an empty path means the default.
 */
@Composable
private fun DriveFolderChooser(folders: DriveFolders, onDone: (Pair<String?, String>?) -> Unit) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    var withBackup by remember { mutableStateOf<List<DriveFolder>?>(null) }
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf(emptyList<DriveFolder>()) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        withBackup = withContext(Dispatchers.IO) { runCatching { folders.withBackup() }.onFailure { error = it.message }.getOrDefault(emptyList()) }
    }
    fun pick(f: DriveFolder) = scope.launch { onDone(f.id to withContext(Dispatchers.IO) { runCatching { folders.path(f.id) }.getOrDefault(f.name) }) }
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(t("driveFolder.title"), style = MaterialTheme.typography.titleMedium)
            val backups = withBackup
            if (backups == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            else if (backups.isNotEmpty()) {
                Muted(t("driveFolder.withBackup"))
                for (f in backups) TextButton(onClick = { pick(f) }) { Text(f.name) }
            }
            OutlinedTextField(query, { query = it }, placeholder = { Text(t("driveFolder.search")) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {
                    scope.launch { found = withContext(Dispatchers.IO) { runCatching { folders.search(query.trim()) }.onFailure { error = it.message }.getOrDefault(emptyList()) } }
                }))
            for (f in found) TextButton(onClick = { pick(f) }) { Text(f.name) }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onDone(null to "") }) { Text(t("native.driveDefault")) }
                TextButton(onClick = { onDone(null) }) { Text(t("common.cancel")) }
            }
        }
    }
}

// ---- open formats ---------------------------------------------------------------------------

@Composable
private fun OpenFormatsCard(repo: Repo, kb: Kb, say: (String) -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var format by remember { mutableStateOf(OpenFormat.CSV) }
    var shared by remember { mutableStateOf(true) }
    var what by remember { mutableStateOf("genotypes") }
    var busy by remember { mutableStateOf<String?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            busy = t("openFormats.building", "what" to t("openFormats.${if (what == "health-log") "healthLog" else what}"))
            val message = try {
                val (bytes, rows) = withContext(Dispatchers.IO) {
                    val persons = repo.listPersons()
                    val table = when (what) {
                        "genotypes" -> genotypeTable(repo.sql, personColumns(persons), shared)
                        "findings" -> findingsTable(persons.map { p -> p to computeFindings(kb, repo.personCallsFor(p.id, kb.entries.map { it.rsid })) })
                        else -> {
                            val log = repo.listHealthLog()
                            val counts = repo.attachmentsByEntry().mapValues { it.value.size }
                            healthTable(persons.map { p -> p to log.filter { it.personId == p.id } }, counts)
                        }
                    }
                    val b = render(table, format).toByteArray()
                    context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(b) }
                    b to table.rows.size
                }
                t("native.saved", "name" to context.displayName(uri), "rows" to rows.grouped(), "mb" to mb(bytes.size.toLong()))
            } catch (e: Exception) {
                t("openFormats.failed", "error" to (e.message ?: e.javaClass.simpleName))
            }
            busy = null
            say(message)
        }
    }
    Card(t("openFormats.title")) {
        Muted(t("openFormats.intro"))
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            OpenFormat.entries.forEachIndexed { i, f ->
                SegmentedButton(selected = format == f, onClick = { format = f }, shape = SegmentedButtonDefaults.itemShape(i, 2)) { Text(t("openFormats.${f.ext}")) }
            }
        }
        Row(Modifier.fillMaxWidth().clickable { shared = !shared }, verticalAlignment = Alignment.Top) {
            Checkbox(checked = shared, onCheckedChange = { shared = it })
            Text(t("openFormats.sharedOnly"), Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium)
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((w, key) in listOf("genotypes" to "openFormats.genotypes", "findings" to "openFormats.findings", "health-log" to "openFormats.healthLog")) {
                FilledTonalButton(enabled = busy == null, onClick = { what = w; save.launch(openFileName(w, format)) }) { Text(t(key)) }
            }
        }
        Muted(t("openFormats.plaintextWarning"))
        busy?.let { Muted(it); LinearProgressIndicator(Modifier.fillMaxWidth()) }
    }
}

// ---- Gemini key -----------------------------------------------------------------------------

@Composable
private fun GeminiCard(say: (String) -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val secrets = remember { Secrets(context) }
    var stored by remember { mutableStateOf(secrets.get(GEMINI_KEY) != null) }
    var key by remember { mutableStateOf("") }
    var model by remember { mutableStateOf(secrets.get(GEMINI_MODEL) ?: Egress.GEMINI_DEFAULT_MODEL) }
    Card(t("settingsPage.documentReading")) {
        Muted(t("native.documentReadingIntro"))
        Notice(t("settingsPage.freeTierNotice"))
        if (!stored) GeminiKeySteps()
        Passphrase(t("settingsPage.apiKey") + if (stored) " " + t("settingsPage.stored") else "", key) { key = it }
        OutlinedTextField(model, { model = it }, label = { Text(t("settingsPage.model")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = key.isNotBlank() || stored, onClick = {
                if (key.isNotBlank()) secrets.set(GEMINI_KEY, key.trim())
                if (model.trim() == Egress.GEMINI_DEFAULT_MODEL || model.isBlank()) secrets.delete(GEMINI_MODEL) else secrets.set(GEMINI_MODEL, model.trim())
                key = ""
                stored = secrets.get(GEMINI_KEY) != null
                say(t("settingsPage.geminiSaved"))
            }) { Text(t("common.save")) }
            if (stored) TextButton(onClick = {
                secrets.delete(GEMINI_KEY)
                stored = false
                say(t("settingsPage.geminiRemoved"))
            }) { Text(t("settingsPage.removeKey"), color = MaterialTheme.colorScheme.error) }
        }
    }
}

// ---- consents, sharing log, erase -----------------------------------------------------------

@Composable
private fun ConsentsCard(repo: Repo, reloads: Int, onFirstLaunchRevoked: () -> Unit, onChanged: () -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var consents by remember { mutableStateOf(emptyList<Repo.ConsentRecord>()) }
    var names by remember { mutableStateOf(emptyMap<String, String>()) }
    var confirming by remember { mutableStateOf<Repo.ConsentRecord?>(null) }
    LaunchedEffect(reloads) {
        withContext(Dispatchers.IO) {
            consents = repo.listConsents()
            names = repo.listPersons().associate { it.id to it.displayName }
        }
    }
    fun revoke(c: Repo.ConsentRecord) = scope.launch {
        withContext(Dispatchers.IO) {
            repo.revokeConsent(c.kind, c.subject)
            if (c.kind == "read_document_byok") Secrets(context).delete(GEMINI_KEY)
        }
        // Withdrawing the first-launch consent puts the app back behind the gate.
        if (c.kind == "first_launch") onFirstLaunchRevoked() else onChanged()
    }
    Card(t("settingsPage.consents")) {
        if (consents.isEmpty()) Muted(t("settingsPage.noneRecorded"))
        for (c in consents) {
            val kind = ConsentKind.entries.firstOrNull { it.id == c.kind }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${kind?.let { t(it.titleKey) } ?: c.kind} v${c.version}", style = MaterialTheme.typography.bodyMedium)
                    Muted(listOf(names[c.subject] ?: c.subject.ifEmpty { "—" }, c.grantedAt.take(16).replace('T', ' ')).joinToString(" · "))
                }
                TextButton(onClick = {
                    if (c.kind == "import_document" || c.kind == "import_genome" || c.kind == "import_minor") confirming = c else revoke(c)
                }) { Text(t("settingsPage.revoke").cap(), color = MaterialTheme.colorScheme.error) }
            }
        }
    }
    confirming?.let { c ->
        AlertDialog(
            onDismissRequest = { confirming = null },
            text = { Text(t("settingsPage.revokeConfirm", "who" to (names[c.subject] ?: c.subject), "what" to t(if (c.kind == "import_document") "settingsPage.healthLog" else "settingsPage.genome"))) },
            confirmButton = { TextButton(onClick = { confirming = null; revoke(c) }) { Text(t("settingsPage.revoke").cap(), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text(t("common.cancel")) } },
        )
    }
}

@Composable
private fun SharingCard(repo: Repo, reloads: Int) {
    val t = LocalStrings.current
    var log by remember { mutableStateOf(emptyList<Repo.Shared>()) }
    var open by remember { mutableStateOf<Long?>(null) }
    LaunchedEffect(reloads) { log = withContext(Dispatchers.IO) { repo.listSharing() } }
    Card(t("settingsPage.sharingLog")) {
        Muted(t("settingsPage.sharingLogIntro"))
        if (log.isEmpty()) Muted(t("common.empty"))
        for (s in log) {
            Text(
                t("settingsPage.sharingSummary", "date" to s.createdAt.take(16).replace('T', ' '), "kind" to s.kind, "destination" to s.destination, "chars" to s.payload.length),
                Modifier.fillMaxWidth().clickable { open = if (open == s.id) null else s.id }.padding(vertical = 6.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            if (open == s.id) Text(s.payload, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun EraseCard(repo: Repo, onErased: () -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var asking by remember { mutableStateOf(false) }
    var pass by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    val save = rememberSave { uri ->
        scope.launch {
            message = try {
                val bytes = withContext(Dispatchers.IO) { snapshotBytes(repo, Backups.APP_VERSION, pass.ifEmpty { null }).also { b -> context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(b) } } }
                t(if (pass.isNotEmpty()) "exportDump.encrypted" else "exportDump.plaintext", "name" to context.displayName(uri), "mb" to mb(bytes.size.toLong()))
            } catch (e: Exception) {
                t("eraseDialog.exportFailed", "error" to (e.message ?: e.javaClass.simpleName))
            }
        }
    }
    Card(t("settingsPage.eraseEverything")) {
        Muted(t("native.eraseIntro"))
        OutlinedButton(onClick = { asking = true }, colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Text(t("settingsPage.eraseAllData")) }
    }
    if (asking) {
        AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text(t("eraseDialog.title")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(t("native.eraseIntro"))
                    Text(rich(t("eraseDialog.exportFirst")))
                    Passphrase(t("eraseDialog.passphrase"), pass) { pass = it }
                    OutlinedButton(onClick = { save.launch("hearth-${java.time.LocalDate.now()}.hearth") }) { Text(t("eraseDialog.exportDump")) }
                    message?.let { Muted(it) }
                    Muted(t("eraseDialog.attachmentsNotice"))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    scope.launch {
                        withContext(Dispatchers.IO) { repo.eraseEverything() }
                        onErased()
                    }
                }) { Text(t("eraseDialog.eraseEverything"), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text(t("common.cancel")) } },
        )
    }
}

// ---- the sync button ------------------------------------------------------------------------

/** The header's sync state (SyncButton.tsx): tap to sync now; it says why it cannot when it cannot. */
@Composable
fun SyncAction(backups: Backups) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    val s by backups.status.collectAsState()
    val (label, color) = when (val x = s) {
        is Status.None -> return
        is Status.Reconnect -> t("sync.reconnect") to MaterialTheme.colorScheme.error
        is Status.NeedsPassphrase -> t("sync.passphrase") to MaterialTheme.colorScheme.error
        is Status.Writing -> t("sync.syncing") to MaterialTheme.colorScheme.onSurfaceVariant
        is Status.Error -> t("sync.error") to MaterialTheme.colorScheme.error
        is Status.Ready -> when {
            x.pending -> t("sync.pending") to MaterialTheme.colorScheme.onSurfaceVariant
            x.dirty -> t("sync.unsynced") to severityColor(4)
            x.lastAt != null -> t("sync.syncedAt", "time" to clock(x.lastAt)) to MaterialTheme.colorScheme.primary
            else -> t("sync.synced") to MaterialTheme.colorScheme.primary
        }
    }
    TextButton(onClick = { scope.launch { backups.sync() } }) { Text(label, color = color, style = MaterialTheme.typography.labelLarge) }
}
