package com.hearth.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.hearth.data.ConsentKind
import com.hearth.data.Person
import com.hearth.data.Provider
import com.hearth.data.Repo
import com.hearth.data.Sex
import com.hearth.genome.ImportProgress
import com.hearth.genome.ImportSummary
import com.hearth.genome.NoCallsException
import com.hearth.genome.importGenomeFile
import com.hearth.genome.personFromFileName
import com.hearth.i18n.Strings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Year

/** A picked document's name as the provider shows it; only used for display and person names. */
fun Context.displayName(uri: Uri): String =
    contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    } ?: uri.lastPathSegment ?: "genome.txt"

private fun Context.readBytes(uri: Uri): ByteArray =
    contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("cannot read $uri")

private fun Strings.progress(p: ImportProgress) = this(p.key, *p.params.map { (k, v) -> k to (if (v is Int) v.grouped() else v) }.toTypedArray())

private fun Strings.summary(s: ImportSummary) =
    this("importFile.summary", "n" to s.calls.grouped(), "provider" to s.provider.label, "build" to s.build, "skipped" to s.skipped.grouped()) + "."

private fun Strings.failure(e: Throwable) = if (e is NoCallsException) this("importFile.noRows") else this("native.error", "error" to (e.message ?: e.javaClass.simpleName))

private val ACCEPTED = arrayOf("text/*", "application/zip", "application/gzip", "application/x-gzip", "application/octet-stream", "*/*")

/** Auto-detect, then every provider by its label (the web's provider select). */
@Composable
private fun ProviderPicker(labelKey: String, autoKey: String, value: Provider?, onPick: (Provider?) -> Unit) {
    val t = LocalStrings.current
    Picker(
        t(labelKey),
        value?.id ?: "",
        listOf("" to t(autoKey)) + Provider.entries.map { it.id to it.label },
        modifier = Modifier.fillMaxWidth(),
    ) { onPick(if (it.isEmpty()) null else Provider.of(it)) }
}

private sealed interface Stage {
    data object Consent : Stage
    data object Pick : Stage
    data class Working(val msg: String, val pct: Float) : Stage
    data class Done(val msg: String) : Stage
    data class Failed(val msg: String) : Stage
}

/**
 * One DNA file for one person (ImportDialog.tsx): the genome consent the first time, with the
 * guardian's statement and `import_minor` for someone under 18, then the provider and the file,
 * then progress while it is unpacked, parsed and stored on this phone.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportSheet(repo: Repo, person: Person, onDismiss: () -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val minor = person.birthYear?.let { Year.now().value - it < 18 } ?: false
    var stage by remember { mutableStateOf<Stage?>(null) }
    var forced by remember { mutableStateOf<Provider?>(null) }
    var guardian by remember { mutableStateOf(!minor) }
    val ticked = rememberTicks(ConsentKind.IMPORT_GENOME)
    LaunchedEffect(person.id) {
        stage = if (withContext(Dispatchers.IO) { repo.hasConsent(ConsentKind.IMPORT_GENOME, person.id) }) Stage.Pick else Stage.Consent
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            stage = Stage.Working(t("importFile.unpacking"), 0f)
            stage = try {
                val s = withContext(Dispatchers.Default) {
                    importGenomeFile(repo, person.id, context.readBytes(uri), context.displayName(uri), forced) { p ->
                        stage = Stage.Working(t.progress(p), p.pct)
                    }
                }
                Stage.Done(t.summary(s))
            } catch (e: Exception) {
                Stage.Failed(t.failure(e))
            }
        }
    }

    // Parsing a genome takes seconds; the sheet stays until it is finished.
    val busy = stage is Stage.Working
    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy }),
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(t("importDialog.title", "name" to person.displayName), style = MaterialTheme.typography.titleLarge)
            when (val s = stage) {
                null -> Unit
                Stage.Consent -> {
                    Text(t(ConsentKind.IMPORT_GENOME.titleKey), style = MaterialTheme.typography.titleMedium)
                    if (minor) {
                        Surface(color = MaterialTheme.colorScheme.errorContainer, shape = MaterialTheme.shapes.medium) {
                            Column(Modifier.padding(12.dp)) {
                                Text(t("importDialog.under18"), style = MaterialTheme.typography.titleSmall)
                                Row(Modifier.clickable { guardian = !guardian }, verticalAlignment = Alignment.Top) {
                                    Checkbox(checked = guardian, onCheckedChange = { guardian = it })
                                    Text(t("importDialog.guardianStatement"), Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                    ConsentChecks(ConsentKind.IMPORT_GENOME, ticked)
                    Button(
                        enabled = guardian && ticked.all { it },
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    repo.grantConsent(ConsentKind.IMPORT_GENOME, person.id)
                                    if (minor) repo.grantConsent(ConsentKind.IMPORT_MINOR, person.id)
                                }
                                stage = Stage.Pick
                            }
                        },
                    ) { Text(t("consentForm.confirm")) }
                }
                Stage.Pick -> {
                    Text(t("native.importAccepted"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    ProviderPicker("importDialog.provider", "importDialog.autoDetect", forced) { forced = it }
                    Button(onClick = { picker.launch(ACCEPTED) }, modifier = Modifier.fillMaxWidth()) { Text(t("native.chooseFile")) }
                }
                is Stage.Working -> {
                    Text(s.msg)
                    LinearProgressIndicator(progress = { s.pct / 100f }, modifier = Modifier.fillMaxWidth())
                }
                is Stage.Done -> {
                    Text(s.msg, color = MaterialTheme.colorScheme.primary)
                    Button(onClick = onDismiss, modifier = Modifier.fillMaxWidth()) { Text(t("common.close")) }
                }
                is Stage.Failed -> {
                    Text(s.msg, color = MaterialTheme.colorScheme.error)
                    OutlinedButton(onClick = { stage = Stage.Pick }, modifier = Modifier.fillMaxWidth()) { Text(t("importDialog.tryAgain")) }
                }
            }
        }
    }
}

private class BatchRow(val uri: Uri, val name: String) {
    var status by mutableStateOf("queued")
    var msg by mutableStateOf("")
    var pct by mutableStateOf(0f)
}

/**
 * Several DNA files at once (BatchImportDialog.tsx): one new person per file, named after it, one
 * genome consent for the batch recorded for each person created. No one here can be a minor: the
 * birth year is unknown until the user sets it.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BatchImportSheet(repo: Repo, onDismiss: () -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val rows = remember { mutableStateListOf<BatchRow>() }
    var forced by remember { mutableStateOf<Provider?>(null) }
    var stage by remember { mutableStateOf("pick") }
    val ticked = rememberTicks(ConsentKind.IMPORT_GENOME)
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        rows.clear()
        rows.addAll(uris.map { BatchRow(it, context.displayName(it)) })
    }

    fun run() = scope.launch {
        stage = "running"
        for (r in rows) {
            r.status = "working"
            r.msg = t("batchImportDialog.creatingPerson")
            try {
                val s = withContext(Dispatchers.Default) {
                    val (label, name) = personFromFileName(r.name)
                    val p = repo.addPerson(label, name, Sex.UNKNOWN, null)
                    repo.grantConsent(ConsentKind.IMPORT_GENOME, p.id)
                    importGenomeFile(repo, p.id, context.readBytes(r.uri), r.name, forced) { pr -> r.msg = t.progress(pr); r.pct = pr.pct }
                }
                r.status = "done"
                r.msg = t.summary(s)
                r.pct = 100f
            } catch (e: Exception) {
                r.status = "error"
                r.msg = t.failure(e)
            }
        }
        stage = "done"
    }

    val busy = stage == "running"
    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy }),
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(t("batchImportDialog.title"), style = MaterialTheme.typography.titleLarge)
            when (stage) {
                "pick" -> {
                    Text(t("batchImportDialog.intro"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    ProviderPicker("batchImportDialog.provider", "batchImportDialog.autoDetectPerFile", forced) { forced = it }
                    OutlinedButton(onClick = { picker.launch(ACCEPTED) }, modifier = Modifier.fillMaxWidth()) { Text(t("native.chooseFiles")) }
                    for (r in rows) {
                        Text(rich(t("batchImportDialog.fileToPerson", "file" to r.name, "name" to personFromFileName(r.name).second)), style = MaterialTheme.typography.bodyMedium)
                    }
                    Button(enabled = rows.isNotEmpty(), onClick = { stage = "consent" }, modifier = Modifier.fillMaxWidth()) {
                        Text(t("batchImportDialog.continue"))
                    }
                }
                "consent" -> {
                    Text(t(ConsentKind.IMPORT_GENOME.titleKey), style = MaterialTheme.typography.titleMedium)
                    Text(t("batchImportDialog.consentNote"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    ConsentChecks(ConsentKind.IMPORT_GENOME, ticked)
                    Button(enabled = ticked.all { it }, onClick = { run() }, modifier = Modifier.fillMaxWidth()) { Text(t("consentForm.confirm")) }
                }
                else -> {
                    for (r in rows) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(personFromFileName(r.name).second, style = MaterialTheme.typography.titleSmall)
                            Text(
                                if (r.status == "queued") t("batchImportDialog.queued") else r.msg,
                                style = MaterialTheme.typography.bodyMedium,
                                color = when (r.status) {
                                    "error" -> MaterialTheme.colorScheme.error
                                    "done" -> MaterialTheme.colorScheme.primary
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            )
                            if (r.status == "working") LinearProgressIndicator(progress = { r.pct / 100f }, modifier = Modifier.fillMaxWidth())
                        }
                    }
                    Button(enabled = !busy, onClick = onDismiss, modifier = Modifier.fillMaxWidth()) {
                        Text(if (busy) t("batchImportDialog.importing") else t("common.close"))
                    }
                }
            }
        }
    }
}
