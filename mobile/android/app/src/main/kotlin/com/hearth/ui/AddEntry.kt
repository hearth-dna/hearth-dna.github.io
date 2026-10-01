package com.hearth.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.ui.platform.LocalContext
import com.hearth.attachments.ACCEPT
import com.hearth.attachments.AttachmentException
import com.hearth.attachments.MAX_FILE_BYTES
import com.hearth.attachments.MAX_PER_ENTRY
import com.hearth.attachments.Rejection
import com.hearth.attachments.addAttachment
import com.hearth.documents.HealthDraft
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimeInput
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.hearth.data.ConsentKind
import com.hearth.data.HealthKind
import com.hearth.data.NewHealthEntry
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.health.BODY_PARTS
import com.hearth.health.HealthPreset
import com.hearth.health.localDate
import com.hearth.health.parseTags
import com.hearth.health.presetsFor
import java.time.LocalTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Kinds whose entries usually happen at a time of day; the others start without one. */
private val TIMED = setOf(HealthKind.SYMPTOM, HealthKind.MEASUREMENT, HealthKind.MEDICATION)

/** Which optional fields each kind shows, as HealthEntryForm's FIELDS. */
private fun HealthKind.hasValue() = this == HealthKind.MEASUREMENT
private fun HealthKind.hasBodyPart() = this in setOf(HealthKind.SYMPTOM, HealthKind.MEASUREMENT, HealthKind.IMAGING, HealthKind.DIAGNOSIS, HealthKind.OTHER)
private fun HealthKind.hasSeverity() = this == HealthKind.SYMPTOM || this == HealthKind.OTHER

private fun nowTime() = LocalTime.now().let { "%02d:%02d".format(it.hour, it.minute) }

private fun numeric(s: String) = s.trim().replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() }

/**
 * Adding an entry, as the web's HealthEntryForm: first what it is, then only the fields that make
 * sense for that kind, with its presets as one-tap starting points. A person's first entry asks
 * for the document consent (design §13.1) before anything is written.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AddEntry(
    repo: Repo,
    persons: List<Person>,
    personId: String,
    tagSuggestions: List<String>,
    onDismiss: () -> Unit,
    /** A document the model read, for review; [source] names the model and the files. */
    draft: HealthDraft? = null,
    source: String = "",
    /** Files to keep with the entry, picked here or passed on from the document reader. */
    initialFiles: List<Picked> = emptyList(),
    /** Called with a message per file that could not be kept (the entry itself is saved). */
    onSaved: (List<String>) -> Unit,
) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var kind by remember { mutableStateOf(draft?.kind) }
    var person by remember { mutableStateOf(personId) }
    var preset by remember { mutableStateOf<HealthPreset?>(null) }
    var title by remember { mutableStateOf(draft?.title ?: "") }
    var date by remember { mutableStateOf(draft?.date ?: localDate()) }
    val files = remember { mutableStateListOf(*initialFiles.toTypedArray()) }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        scope.launch { files.addAll(withContext(Dispatchers.IO) { uris.map { context.readPicked(it) } }) }
    }
    var time by remember { mutableStateOf("") }
    var value by remember { mutableStateOf("") }
    var value2 by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("") }
    var bodyPart by remember { mutableStateOf("") }
    var severity by remember { mutableStateOf(0) }
    var tags by remember { mutableStateOf("") }
    var body by remember { mutableStateOf(draft?.body ?: "") }
    var asking by remember { mutableStateOf(false) }

    val k = kind
    val pair = if (k == HealthKind.MEASUREMENT) preset?.pair else null
    val valid = person.isNotEmpty() && k != null && title.isNotBlank() &&
        (!k.hasValue() || (numeric(value) != null && (pair == null || numeric(value2) != null)))

    fun save() = scope.launch {
        if (k == null || !valid) return@launch
        val consented = withContext(Dispatchers.IO) { repo.hasConsent(ConsentKind.IMPORT_DOCUMENT, person) }
        if (!consented) {
            asking = true
            return@launch
        }
        val failures = withContext(Dispatchers.IO) {
            val entry = repo.addHealthEntry(
                NewHealthEntry(
                    personId = person,
                    date = date,
                    time = time,
                    kind = k,
                    title = title.trim(),
                    body = body,
                    bodyPart = if (k.hasBodyPart()) bodyPart.trim() else "",
                    severity = if (k.hasSeverity() && severity > 0) severity else null,
                    tags = parseTags(tags),
                    value = if (k.hasValue()) numeric(value) else null,
                    value2 = if (pair != null) numeric(value2) else null,
                    unit = if (k.hasValue()) unit.trim() else "",
                    source = source,
                ),
            )
            // The entry is saved first; a file that cannot be kept is reported, not lost silently.
            files.mapIndexedNotNull { i, f ->
                try {
                    addAttachment(repo, entry.id, person, f.bytes, f.name, i)
                    null
                } catch (e: AttachmentException) {
                    when (e.reason) {
                        Rejection.TYPE -> t("attachments.badType", "name" to f.name)
                        Rejection.SIZE -> t("attachments.tooBig", "name" to f.name, "max" to MAX_FILE_BYTES / 1024 / 1024)
                        Rejection.COUNT -> t("attachments.tooMany", "max" to MAX_PER_ENTRY)
                        Rejection.SPACE -> t("attachments.noSpace")
                    }
                } catch (e: Exception) {
                    t("attachments.saveFailed", "name" to f.name)
                }
            }
        }
        onSaved(failures)
    }

    fun pick(p: HealthPreset?) {
        preset = p
        if (p == null) return
        title = p.title
        if (p.bodyPart.isNotEmpty()) bodyPart = p.bodyPart
        if (p.tags.isNotEmpty()) tags = p.tags.joinToString(", ")
        unit = p.unit
        value = ""
        value2 = ""
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(if (k == null) t("healthForm.whatToAdd") else t("healthForm.newEntry", "kind" to t("kind.${k.id}"))) },
                    navigationIcon = { IconButton(onClick = onDismiss) { Icon(Icons.Filled.Close, contentDescription = t("common.cancel")) } },
                    actions = { if (k != null) TextButton(onClick = { save() }, enabled = valid) { Text(t("common.save")) } },
                )
            },
        ) { padding ->
            if (k == null) {
                KindPicker(Modifier.padding(padding)) { picked ->
                    kind = picked
                    time = if (picked in TIMED) nowTime() else ""
                }
                return@Scaffold
            }
            Column(
                Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                if (persons.size > 1) {
                    Picker(
                        label = t("healthPage.colPerson"),
                        value = person,
                        options = listOf("" to t("healthForm.pickPerson")) + persons.map { it.id to it.displayName },
                    ) { person = it }
                }
                val presets = presetsFor(k)
                if (presets.isNotEmpty()) {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(horizontal = 0.dp)) {
                        items(presets, key = { it.id }) { p ->
                            FilterChip(selected = preset == p, onClick = { pick(if (preset == p) null else p) }, label = { Text(t("preset.${p.id}")) })
                        }
                    }
                }
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it; if (preset?.title != it) preset = null },
                    label = { Text(t("healthForm.title.${k.id}")) },
                    placeholder = { Text(t("healthForm.titlePlaceholder.${k.id}")) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    DateField(t("healthLog.date"), date, Modifier.weight(1f), clearable = false) { if (it.isNotEmpty()) date = it }
                    TimeField(t("healthForm.time"), time, Modifier.weight(1f)) { time = it }
                    TextButton(onClick = { date = localDate(); time = nowTime() }) { Text(t("healthForm.now")) }
                }
                if (k.hasValue()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        NumberField(
                            if (pair != null) t("healthLog.valueOf", "label" to t("preset.pair.${pair.first}")) else t("healthLog.value"),
                            value, Modifier.weight(1f),
                        ) { value = it }
                        if (pair != null) {
                            NumberField(t("healthLog.valueOf", "label" to t("preset.pair.${pair.second}")), value2, Modifier.weight(1f)) { value2 = it }
                        }
                        OutlinedTextField(
                            value = unit,
                            onValueChange = { unit = it },
                            label = { Text(t("healthLog.unit")) },
                            placeholder = { Text(t("healthLog.unitPlaceholder")) },
                            singleLine = true,
                            readOnly = preset != null,
                            modifier = Modifier.weight(0.8f),
                        )
                    }
                }
                if (k.hasBodyPart()) BodyPartField(bodyPart) { bodyPart = it }
                if (k.hasSeverity()) {
                    Column {
                        Row {
                            Text(t("healthLog.severity"), style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                            Text(
                                if (severity == 0) t("healthLog.notRated") else t("healthLog.outOfTen", "n" to severity),
                                style = MaterialTheme.typography.labelLarge,
                                color = if (severity == 0) MaterialTheme.colorScheme.onSurfaceVariant else severityColor(severity),
                            )
                        }
                        Slider(value = severity.toFloat(), onValueChange = { severity = it.toInt() }, valueRange = 0f..10f, steps = 9)
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = tags,
                        onValueChange = { tags = it },
                        label = { Text(t("healthLog.tags")) },
                        placeholder = { Text(t("healthLog.tagsPlaceholder")) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    val have = parseTags(tags)
                    val offer = tagSuggestions.filter { it !in have }
                    if (offer.isNotEmpty()) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (tag in offer.take(12)) SuggestionChip(onClick = { tags = (have + tag).joinToString(", ") }, label = { Text(tag) })
                        }
                    }
                }
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text(t("healthForm.details.${k.id}")) },
                    placeholder = { Text(t("healthForm.bodyPlaceholder.${k.id}")) },
                    minLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    OutlinedButton(onClick = { filePicker.launch(ACCEPT) }) {
                        Icon(HearthIcons.Attach, contentDescription = null, Modifier.size(18.dp))
                        Text("  " + t("attachments.add"))
                    }
                    Text(t("attachments.addHint"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    for (f in files.toList()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(f.name, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                            IconButton(onClick = { files.remove(f) }) { Icon(Icons.Filled.Close, contentDescription = t("attachments.remove")) }
                        }
                    }
                }
                if (source.isNotEmpty()) {
                    Text(t("healthLog.transcribedBy", "model" to source.substringBefore(':')), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { kind = null; preset = null }) { Text(t("healthForm.changeType").cap()) }
                Spacer(Modifier.size(24.dp))
            }
        }
    }

    if (asking) {
        var ticked by remember { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text(t("consent.import_document.title")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.clickable { ticked = !ticked }, verticalAlignment = Alignment.Top) {
                        Checkbox(checked = ticked, onCheckedChange = { ticked = it })
                        Text(t("consent.import_document.statement1"), Modifier.padding(top = 12.dp))
                    }
                    Text(
                        t("consentForm.recorded", "version" to ConsentKind.IMPORT_DOCUMENT.version),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            confirmButton = {
                TextButton(enabled = ticked, onClick = {
                    asking = false
                    scope.launch {
                        withContext(Dispatchers.IO) { repo.grantConsent(ConsentKind.IMPORT_DOCUMENT, person) }
                        save()
                    }
                }) { Text(t("consentForm.confirm")) }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text(t("common.cancel")) } },
        )
    }
}

/** The kinds as cards with a one-line hint each: "what do you want to add?". */
@Composable
private fun KindPicker(modifier: Modifier, onPick: (HealthKind) -> Unit) {
    val t = LocalStrings.current
    Column(modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (k in HealthKind.entries) {
            OutlinedCard(onClick = { onPick(k) }, modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Box(Modifier.size(12.dp).clip(CircleShape).background(kindColor(k)))
                    Column {
                        Text(t("kind.${k.id}"), style = MaterialTheme.typography.titleMedium)
                        Text(t("healthForm.hint.${k.id}"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
private fun NumberField(label: String, value: String, modifier: Modifier, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        singleLine = true,
        isError = value.isNotEmpty() && numeric(value) == null,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
        modifier = modifier,
    )
}

/** An HH:MM field filled from Material's time input; "" is no time. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TimeField(label: String, value: String, modifier: Modifier, onPick: (String) -> Unit) {
    val t = LocalStrings.current
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedTextField(value = value, onValueChange = {}, readOnly = true, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Box(Modifier.matchParentSize().clickable { open = true })
    }
    if (open) {
        val (h, m) = value.split(':').mapNotNull { it.toIntOrNull() }.takeIf { it.size == 2 } ?: LocalTime.now().let { listOf(it.hour, it.minute) }
        val state = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = true)
        AlertDialog(
            onDismissRequest = { open = false },
            text = { TimeInput(state = state) },
            confirmButton = { TextButton(onClick = { open = false; onPick("%02d:%02d".format(state.hour, state.minute)) }) { Text(t("native.ok")) } },
            dismissButton = { TextButton(onClick = { open = false; onPick("") }) { Text(t("common.clear").cap()) } },
        )
    }
}

/** Free text with the web's suggestions (its datalist): the list narrows as the user types. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BodyPartField(value: String, onChange: (String) -> Unit) {
    val t = LocalStrings.current
    var open by remember { mutableStateOf(false) }
    val matches = BODY_PARTS.filter { it.contains(value.trim(), ignoreCase = true) && it != value.trim().lowercase() }
    ExposedDropdownMenuBox(expanded = open && matches.isNotEmpty(), onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = value,
            onValueChange = { onChange(it); open = true },
            label = { Text(t("healthLog.bodyPart")) },
            placeholder = { Text(t("healthLog.bodyPartPlaceholder")) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryEditable),
        )
        ExposedDropdownMenu(expanded = open && matches.isNotEmpty(), onDismissRequest = { open = false }) {
            for (b in matches) DropdownMenuItem(text = { Text(b) }, onClick = { onChange(b); open = false })
        }
    }
}
