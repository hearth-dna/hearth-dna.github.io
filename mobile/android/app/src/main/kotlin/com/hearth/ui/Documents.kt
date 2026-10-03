package com.hearth.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hearth.Egress
import com.hearth.Secrets
import com.hearth.attachments.ACCEPT
import com.hearth.attachments.sniffMime
import com.hearth.data.Attachment
import com.hearth.data.ConsentKind
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.documents.DOCUMENT_HINTS
import com.hearth.documents.HealthDraft
import com.hearth.documents.documentPrompt
import com.hearth.documents.documentSchema
import com.hearth.documents.draftFromJson
import com.hearth.genome.sha256Hex
import com.hearth.health.localDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant

/** Where the user's Gemini key is kept: the Keystore-backed [Secrets], never the database or a backup. */
const val GEMINI_KEY = "gemini_api_key"
const val GEMINI_MODEL = "gemini_model"

/** Gemini's inline limit is 20 MB a request; this leaves room for base64 (ReadDocumentDialog.tsx). */
private const val MAX_SEND_BYTES = 15L * 1024 * 1024

/** A file the user picked, read into memory with the name the provider shows. */
class Picked(val name: String, val bytes: ByteArray, val mime: String)

fun Context.readPicked(uri: Uri): Picked {
    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)
    // The bytes decide the type; the provider's guess only fills in for what we do not sniff.
    return Picked(displayName(uri), bytes, sniffMime(bytes) ?: contentResolver.getType(uri) ?: "")
}

/**
 * An attached document shown inside the app: an image as it is, a PDF page by page through the
 * platform renderer. The bytes are never handed to another app, so nothing else sees the file.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachmentViewer(a: Attachment, bytes: ByteArray, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val pages by produceState<List<Bitmap>?>(null, a.id) {
        value = withContext(Dispatchers.IO) { render(context, a, bytes) }
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(a.name, maxLines = 1) },
                    navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, contentDescription = LocalStrings.current("common.close")) } },
                )
            },
            containerColor = Color.Black,
        ) { padding ->
            val list = pages
            if (list == null) {
                Column(Modifier.fillMaxSize().padding(padding), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                }
                return@Scaffold
            }
            LazyColumn(Modifier.fillMaxSize().padding(padding), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(list) { page ->
                    Image(page.asImageBitmap(), contentDescription = a.name, contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth().background(Color.White))
                }
            }
        }
    }
}

private fun render(context: Context, a: Attachment, bytes: ByteArray): List<Bitmap> {
    if (a.mime != "application/pdf") return listOfNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size))
    // PdfRenderer reads from a file descriptor: a private temporary copy, deleted straight after.
    val tmp = File.createTempFile("view", ".pdf", context.cacheDir)
    try {
        tmp.writeBytes(bytes)
        ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { pdf ->
                val width = context.resources.displayMetrics.widthPixels
                return (0 until pdf.pageCount).map { i ->
                    pdf.openPage(i).use { page ->
                        val bmp = Bitmap.createBitmap(width, width * page.height / page.width, Bitmap.Config.ARGB_8888)
                        bmp.eraseColor(android.graphics.Color.WHITE)
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        bmp
                    }
                }
            }
        }
    } finally {
        tmp.delete()
    }
}

private sealed interface ReadStage {
    data object Pick : ReadStage
    data object Consent : ReadStage
    data object Confirm : ReadStage
    data object Sending : ReadStage
    data class Failed(val message: String) : ReadStage
}

/**
 * Reading a photo, scan or PDF with the user's own Gemini key (ReadDocumentDialog.tsx): the key
 * the first time (with the steps to get one), the provider consent once, then the pages and what
 * they are, a confirmation that names the provider and lists the files, and the send. The reply
 * becomes a draft for the add form; the send is recorded in the sharing log, metadata only.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReadDocumentSheet(repo: Repo, persons: List<Person>, initialPerson: String, onDismiss: () -> Unit, onDraft: (Person, HealthDraft, String, List<Picked>) -> Unit) {
    val t = LocalStrings.current
    var personId by remember { mutableStateOf(initialPerson.ifEmpty { persons.first().id }) }
    val person = persons.firstOrNull { it.id == personId } ?: persons.first()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val secrets = remember { Secrets(context) }
    var key by remember { mutableStateOf<String?>(null) }
    var keyLoaded by remember { mutableStateOf(false) }
    var newKey by remember { mutableStateOf("") }
    var consented by remember { mutableStateOf(false) }
    var files by remember { mutableStateOf(emptyList<Picked>()) }
    var hint by remember { mutableStateOf("auto") }
    var keep by remember { mutableStateOf(true) }
    var stage by remember { mutableStateOf<ReadStage>(ReadStage.Pick) }
    val model = remember { secrets.get(GEMINI_MODEL)?.ifEmpty { null } ?: Egress.GEMINI_DEFAULT_MODEL }
    val consentTicks = rememberTicks(ConsentKind.READ_DOCUMENT_BYOK)
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            key = secrets.get(GEMINI_KEY)
            consented = repo.hasConsent(ConsentKind.READ_DOCUMENT_BYOK)
        }
        keyLoaded = true
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        scope.launch { files = withContext(Dispatchers.IO) { uris.map { context.readPicked(it) } } }
    }
    val total = files.sumOf { it.bytes.size.toLong() }
    val tooBig = total > MAX_SEND_BYTES

    fun send() = scope.launch {
        val k = key ?: return@launch
        stage = ReadStage.Sending
        stage = try {
            val (draft, source) = withContext(Dispatchers.IO) {
                val hashes = files.map { sha256Hex(it.bytes) }
                val (text, used) = Egress.readDocumentWithGemini(
                    k, model, files.map { Egress.DocumentPart(it.mime, it.bytes) }, documentPrompt(hint), documentSchema(), Instant.now().toString(),
                )
                val meta = JSONObject()
                    .put("person", person.label)
                    .put("files", JSONArray(files.mapIndexed { i, f -> JSONObject().put("name", f.name).put("type", f.mime).put("bytes", f.bytes.size).put("sha256", hashes[i]) }))
                    .put("hint", hint)
                    .put("model", model)
                repo.logSharing("document", "gemini:$used", meta.toString(2))
                draftFromJson(text, localDate()) to "gemini:$used:${hashes.joinToString("+")}"
            }
            onDraft(person, draft, source, if (keep) files else emptyList())
            return@launch
        } catch (e: Exception) {
            ReadStage.Failed(e.message ?: e.javaClass.simpleName)
        }
    }

    val busy = stage == ReadStage.Sending
    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true, confirmValueChange = { !busy }),
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(bottom = 24.dp).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(t("readDocumentDialog.title", "name" to person.displayName), style = MaterialTheme.typography.titleLarge)
            when {
                !keyLoaded -> Unit
                key == null -> {
                    Text(t("native.keyNotice"), style = MaterialTheme.typography.bodyMedium)
                    GeminiKeySteps()
                    OutlinedTextField(
                        value = newKey,
                        onValueChange = { newKey = it },
                        label = { Text(t("readDocumentDialog.apiKey")) },
                        placeholder = { Text("AIza…") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Button(enabled = newKey.isNotBlank(), modifier = Modifier.fillMaxWidth(), onClick = {
                        val v = newKey.trim()
                        scope.launch {
                            withContext(Dispatchers.IO) { secrets.set(GEMINI_KEY, v) }
                            key = v
                            newKey = ""
                        }
                    }) { Text(t("common.save")) }
                }
                stage == ReadStage.Consent -> {
                    Text(t(ConsentKind.READ_DOCUMENT_BYOK.titleKey), style = MaterialTheme.typography.titleMedium)
                    ConsentChecks(ConsentKind.READ_DOCUMENT_BYOK, consentTicks)
                    Button(enabled = consentTicks.all { it }, modifier = Modifier.fillMaxWidth(), onClick = {
                        scope.launch {
                            withContext(Dispatchers.IO) { repo.grantConsent(ConsentKind.READ_DOCUMENT_BYOK) }
                            consented = true
                            stage = ReadStage.Confirm
                        }
                    }) { Text(t("consentForm.confirm")) }
                }
                stage == ReadStage.Confirm || stage == ReadStage.Sending -> {
                    Text(rich(t("readDocumentDialog.confirmIntro", "model" to model)), style = MaterialTheme.typography.bodyMedium)
                    for (f in files) Text("• " + t("readDocumentDialog.fileLine", "name" to f.name, "kb" to (f.bytes.size / 1024)), style = MaterialTheme.typography.bodyMedium)
                    Row(Modifier.fillMaxWidth().clickable { keep = !keep }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = keep, onCheckedChange = { keep = it })
                        Text(t("readDocumentDialog.keepOriginals"), style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(t("readDocumentDialog.keepOriginalsHint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(enabled = !busy, onClick = { send() }, modifier = Modifier.fillMaxWidth()) {
                        Text(if (busy) t("readDocumentDialog.sending") else t("readDocumentDialog.send"))
                    }
                    OutlinedButton(enabled = !busy, onClick = { stage = ReadStage.Pick }, modifier = Modifier.fillMaxWidth()) { Text(t("readDocumentDialog.back")) }
                }
                else -> {
                    if (persons.size > 1) {
                        Picker(t("healthPage.colPerson"), personId, persons.map { it.id to it.displayName }, modifier = Modifier.fillMaxWidth()) { personId = it }
                    }
                    Text(t("readDocumentDialog.pickIntro"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = { picker.launch(ACCEPT) }, modifier = Modifier.fillMaxWidth()) { Text(t("native.chooseFiles")) }
                    for (f in files) Text("• " + t("readDocumentDialog.fileLine", "name" to f.name, "kb" to (f.bytes.size / 1024)), style = MaterialTheme.typography.bodyMedium)
                    Picker(t("readDocumentDialog.whatIsIt"), hint, DOCUMENT_HINTS.map { it to t("readDocumentDialog.hint.$it") }, modifier = Modifier.fillMaxWidth()) { hint = it }
                    if (tooBig) {
                        Text(
                            t("readDocumentDialog.tooBig", "mb" to String.format(java.util.Locale.ROOT, "%.1f", total / 1024.0 / 1024.0), "max" to MAX_SEND_BYTES / 1024 / 1024),
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                    (stage as? ReadStage.Failed)?.let { Text(t("readDocumentDialog.failed", "message" to it.message), color = MaterialTheme.colorScheme.error) }
                    Button(
                        enabled = files.isNotEmpty() && !tooBig,
                        onClick = { stage = if (consented) ReadStage.Confirm else ReadStage.Consent },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(t("readDocumentDialog.continue")) }
                }
            }
        }
    }
}

/** How to get a Gemini key, in plain steps (GeminiKeySteps.tsx); the link opens in the browser. */
@Composable
fun GeminiKeySteps() {
    val t = LocalStrings.current
    Surface(color = MaterialTheme.colorScheme.surfaceContainer, shape = MaterialTheme.shapes.medium) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(t("geminiKeySteps.summary"), style = MaterialTheme.typography.titleSmall)
            (1..4).forEach { i ->
                Text(
                    rich("$i. " + t("geminiKeySteps.step$i"), links = mapOf("a" to "https://aistudio.google.com/apikey")),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Text(t("native.keyWarning"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
