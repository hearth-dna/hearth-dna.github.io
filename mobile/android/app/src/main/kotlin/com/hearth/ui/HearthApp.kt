package com.hearth.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.hearth.Cloud
import com.hearth.backup.Backups
import com.hearth.i18n.LANGUAGES
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.hearth.backup.BackupException
import com.hearth.backup.isEncrypted
import com.hearth.backup.isSealedV1
import com.hearth.backup.LoadResult
import com.hearth.backup.NamedBytes
import com.hearth.backup.PersonRef
import com.hearth.backup.elsewhereNames
import com.hearth.backup.isSealedSidecar
import com.hearth.backup.loadFiles
import com.hearth.data.Blobs
import com.hearth.data.ConsentKind
import com.hearth.data.Db
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.i18n.Strings
import com.hearth.kb.Kb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** The preference that remembers the database file is damaged until a repair has run. */
private const val DAMAGED = "database.damaged"

/** The string catalogue, reachable from every screen as `LocalStrings.current("key")`. */
val LocalStrings = staticCompositionLocalOf<Strings> { error("Strings not provided") }

/** "delete" → "Delete": the web keeps some button labels lower-case; native buttons are capitalised. */
fun String.cap(): String = replaceFirstChar { it.titlecase() }

/**
 * Root of the native app (ADR 0010): the first-launch consent, then the health log. Reads and
 * writes go to the app's own database on the IO dispatcher; the screens only ever see lists.
 */
@Composable
fun HearthApp(cloud: Cloud? = null) {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("hearth.native", Context.MODE_PRIVATE) }
    var language by remember { mutableStateOf(prefs.getString("language", null)) }
    val strings = remember(language) { Strings.load(context, language) }
    val db = remember { Db.get(context) }
    val repo = remember { Repo(db, Blobs(File(context.filesDir, "blobs"))) }
    // The database file turned out damaged, at start-up or since: the repair screen replaces the app.
    // Remembered across a crash: a screen that queries without a catch can take the process down
    // before the repair screen composes, and it would crash again on every start.
    var damaged by remember { mutableStateOf(prefs.getString(DAMAGED, null)) }
    // Bumped after a repair, so the screens are built again over the new file.
    var epoch by remember { mutableStateOf(0) }
    DisposableEffect(db) {
        db.onCorrupt = { message ->
            prefs.edit().putString(DAMAGED, message).commit()
            damaged = message
        }
        onDispose { db.onCorrupt = null }
    }
    val backups = remember { Backups(context.applicationContext, repo, cloud) }
    var consented by remember { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(epoch) {
        consented = try {
            withContext(Dispatchers.IO) { repo.hasConsent(ConsentKind.FIRST_LAUNCH) }
        } catch (e: android.database.sqlite.SQLiteException) {
            // Db has told onCorrupt already; any other database error is not ours to hide.
            if (!Db.isCorrupt(e)) throw e
            null
        }
    }
    // Back in the foreground: another device may have written to the backup meanwhile.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_RESUME) backups.refreshSoon() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val rtl = LANGUAGES.firstOrNull { it.code == strings.language }?.rtl ?: false

    CompositionLocalProvider(LocalStrings provides strings, LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr) {
        val broken = damaged
        if (broken != null) {
            RepairScreen(db, repo, broken) {
                prefs.edit().remove(DAMAGED).commit()
                damaged = null
                consented = null
                epoch++
            }
        } else {
            when (consented) {
                null -> Unit
                false -> FirstLaunch { withContext(Dispatchers.IO) { repo.grantConsent(ConsentKind.FIRST_LAUNCH) }; consented = true }
                true -> key(epoch) {
                    Tabs(repo, backups, cloud, strings.language, onLanguage = { code ->
                        prefs.edit().putString("language", code).apply()
                        language = code
                    }) { consented = false }
                }
            }
        }
    }
}

/**
 * The web's top-level pages that fit a phone's bottom bar, in the web's order (App.tsx). The family
 * lookup, a "More" page on the web, opens from a marker on the DNA tab instead of having a tab.
 */
private enum class Tab(val labelKey: String) {
    PEOPLE("app.navPeople"),
    HEALTH("app.navHealth"),
    DNA("app.navDna"),
    ASK("app.navAsk"),
    SETTINGS("app.tabSettings"),
}

@Composable
private fun Tabs(repo: Repo, backups: Backups, cloud: Cloud?, language: String, onLanguage: (String) -> Unit, onErased: () -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val kb = remember { Kb.parse(context.assets.open("kb.json").use { it.readBytes().decodeToString() }) }
    var tab by rememberSaveable { mutableStateOf(Tab.HEALTH) }
    // A person's report sits on top of People, which stays lit (TabBar.tsx); the health log can be
    // opened from it already scoped to that person.
    var open by remember { mutableStateOf<Person?>(null) }
    var healthScope by rememberSaveable { mutableStateOf("") }
    var lookup by rememberSaveable { mutableStateOf<String?>(null) }
    val dnaFilters = remember { DnaFilters() }
    // Back from the lookup returns to the DNA tab rather than leaving the app.
    BackHandler(enabled = lookup != null) { lookup = null }
    Scaffold(
        bottomBar = {
            NavigationBar {
                for (x in Tab.entries) {
                    NavigationBarItem(
                        selected = tab == x,
                        onClick = { tab = x; open = null; lookup = null; if (x == Tab.HEALTH) healthScope = "" },
                        icon = { Icon(x.icon, contentDescription = null) },
                        label = { Text(t(x.labelKey)) },
                    )
                }
            }
        },
    ) { padding ->
        // Each screen draws its own top bar; the navigation bar has already taken the bottom inset.
        Box(Modifier.padding(bottom = padding.calculateBottomPadding()).consumeWindowInsets(padding)) {
            val person = open
            when {
                tab == Tab.PEOPLE && person != null -> PersonScreen(repo, kb, person, onBack = { open = null }) {
                    healthScope = person.id
                    open = null
                    tab = Tab.HEALTH
                }
                tab == Tab.PEOPLE -> PeopleScreen(repo, backups, onOpen = { open = it })
                tab == Tab.HEALTH -> HealthScreen(repo, backups, healthScope)
                tab == Tab.DNA && lookup != null -> FamilyScreen(repo, kb, start = lookup, onBack = { lookup = null })
                tab == Tab.DNA -> DnaScreen(repo, kb, dnaFilters, onLookup = { lookup = it })
                tab == Tab.ASK -> AskScreen(repo, kb)
                tab == Tab.SETTINGS -> SettingsScreen(repo, kb, backups, cloud, language, onLanguage, onErased)
            }
        }
    }
}

private val Tab.icon
    get() = when (this) {
        Tab.PEOPLE -> HearthIcons.Group
        Tab.DNA -> HearthIcons.Dna
        Tab.ASK -> HearthIcons.Chat
        Tab.SETTINGS -> Icons.Filled.Settings
        Tab.HEALTH -> Icons.Filled.FavoriteBorder
    }

/**
 * A consent's statements, one checkbox each, and the "recorded locally" note (ConsentForm.tsx).
 * [ticked] holds one flag per statement; the caller enables its confirm button when all are set.
 */
@Composable
fun ConsentChecks(kind: ConsentKind, ticked: SnapshotStateList<Boolean>, statementKey: (Int, String) -> String = { _, k -> k }) {
    val t = LocalStrings.current
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        kind.statementKeys.forEachIndexed { i, key ->
            Row(Modifier.fillMaxWidth().clickable { ticked[i] = !ticked[i] }, verticalAlignment = Alignment.Top) {
                Checkbox(checked = ticked[i], onCheckedChange = { ticked[i] = it })
                Text(t(statementKey(i, key)), Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium)
            }
        }
        Text(
            t("consentForm.recorded", "version" to kind.version),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun rememberTicks(kind: ConsentKind): SnapshotStateList<Boolean> = remember(kind) { mutableStateListOf(*Array(kind.statements) { false }) }

/** The web's consent gate: every statement ticked before anything is stored (design §13.1). */
@Composable
private fun FirstLaunch(onAgree: suspend () -> Unit) {
    val t = LocalStrings.current
    val kind = ConsentKind.FIRST_LAUNCH
    val ticked = rememberTicks(kind)
    val scope = rememberCoroutineScope()
    Scaffold { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(t(kind.titleKey), style = MaterialTheme.typography.headlineMedium)
            Text(t("native.intro"), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            // Statement 1 is about where data lives, which on a phone is not a browser.
            ConsentChecks(kind, ticked) { i, key -> if (i == 0) "native.firstLaunchStorage" else key }
            Button(onClick = { scope.launch { onAgree() } }, enabled = ticked.all { it }, modifier = Modifier.fillMaxWidth()) {
                Text(t("consentGate.start"))
            }
        }
    }
}

/** Whether a picked file needs a passphrase before it can be read: a backup, or a sealed genome file. */
fun sealed(bytes: ByteArray) = isEncrypted(bytes) || isSealedV1(bytes) || isSealedSidecar(bytes)

/**
 * What loading picked files says (BackupCard.tsx `useFileLoader`): what came in, whose DNA each
 * genome file was, what was not used or could not be opened, and who still waits for a genome file.
 * The web's wording that names a browser is the phone's own under `native.*`.
 */
fun loadMessage(t: Strings, r: LoadResult, waiting: List<PersonRef>): String = listOf(
    if (r.dumps > 0) t("backupCard.loaded", "people" to r.people, "genomes" to r.genomes, "exportedAt" to r.exportedAt, "name" to r.name)
    else t("backupCard.genomesLoaded", "n" to r.genomes),
    *r.dna.map { (file, name) -> t("backupCard.dnaFrom", "name" to name, "file" to file) }.toTypedArray(),
    if (r.missing.isNotEmpty()) t("restore.missingGenomes", "names" to r.missing.joinToString(", ") { it.name }) else "",
    if (waiting.isNotEmpty()) t("restore.genomesElsewhere", "names" to waiting.joinToString(", ") { it.name }) + " " + t("native.pickGenomes") else "",
    if (r.unused.isNotEmpty()) t("native.notUsed", "files" to r.unused.joinToString(", ")) else "",
    if (r.unopened.isNotEmpty()) t("backupCard.notOpened", "files" to r.unopened.joinToString(", ")) else "",
).filter { it.isNotEmpty() }.joinToString(" ")

/**
 * "Restore a backup…": the system picker, several files at once (a folder backup's snapshot and
 * its genome files, or a zip of the whole folder), a passphrase when one is sealed, then a merge
 * into this app's database. [passphrase] is tried first when the caller already has one typed.
 * Returns the launcher to call; the outcome goes to [say].
 */
@Composable
fun rememberRestore(repo: Repo, say: (String) -> Unit, passphrase: String = "", onRestored: () -> Unit): () -> Unit {
    val context = LocalContext.current
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<List<NamedBytes>?>(null) }
    var wrong by remember { mutableStateOf(false) }

    fun run(files: List<NamedBytes>, pass: String?) = scope.launch {
        val message = try {
            val (r, waiting) = withContext(Dispatchers.IO) { loadFiles(repo, files, pass) to repo.elsewhereNames() }
            pending = null
            onRestored()
            loadMessage(t, r, waiting)
        } catch (e: BackupException) {
            if (pass != null && (e.key == "app.wrongPassphrase" || e.key == "native.encryptedTitle")) {
                wrong = true
                pending = files
                return@launch
            }
            pending = null
            t("backupCard.loadFailed", "message" to t(e.key))
        } catch (e: Exception) {
            pending = null
            t("backupCard.loadFailed", "message" to (e.message ?: e.javaClass.simpleName))
        }
        say(message)
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val files = withContext(Dispatchers.IO) {
                uris.mapNotNull { uri -> context.contentResolver.openInputStream(uri)?.use { NamedBytes(context.displayName(uri), it.readBytes()) } }
            }
            wrong = false
            when {
                files.none { sealed(it.bytes) } -> run(files, null)
                passphrase.isNotEmpty() -> run(files, passphrase)
                else -> pending = files
            }
        }
    }

    pending?.let { files ->
        var typed by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { pending = null },
            title = { Text(t("native.encryptedTitle")) },
            text = {
                OutlinedTextField(
                    value = typed,
                    onValueChange = { typed = it; wrong = false },
                    label = { Text(t("app.passphrase")) },
                    singleLine = true,
                    isError = wrong,
                    supportingText = if (wrong) ({ Text(t("app.wrongPassphrase")) }) else null,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
            },
            confirmButton = { TextButton(onClick = { run(files, typed) }, enabled = typed.isNotEmpty()) { Text(t("native.open")) } },
            dismissButton = { TextButton(onClick = { pending = null }) { Text(t("common.cancel")) } },
        )
    }
    return { picker.launch(arrayOf("*/*")) }
}
