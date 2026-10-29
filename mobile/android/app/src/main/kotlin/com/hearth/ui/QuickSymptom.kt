package com.hearth.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hearth.data.ConsentKind
import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import com.hearth.data.NewHealthEntry
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.health.findPreset
import com.hearth.health.localDate
import com.hearth.health.presetOf
import com.hearth.health.presetOrder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalTime

/** Picker values that are not a preset id: nothing chosen yet, and "something else…". */
private const val NONE = ""
private const val CUSTOM = "*"

/**
 * One line for how someone feels right now (QuickSymptom.tsx) — a runny nose, a cough, red eyes —
 * or for a treatment or checkup they had: teeth cleaning, an eye exam. Pick from both lists (the
 * ones this person already records come first; the pick decides symptom or procedure) or type
 * another and say which it is, optionally rate a symptom and add a note, save. Date and time are
 * now. The symptom's structured details and anything else (another date, the side of the body)
 * belong in the full form.
 */
@Composable
fun QuickSymptom(repo: Repo, persons: List<Person>, initialPerson: String, entries: List<HealthEntry>, onSaved: () -> Unit) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    var personId by remember(initialPerson) { mutableStateOf(initialPerson) }
    val order = remember(entries, personId) {
        presetOrder(listOf(HealthKind.SYMPTOM, HealthKind.PROCEDURE), entries.filter { personId.isEmpty() || it.personId == personId })
    }
    var choice by remember { mutableStateOf(NONE) }
    var typed by remember { mutableStateOf("") }
    // What typed text is saved as; a preset brings its own kind.
    var custom by remember { mutableStateOf(HealthKind.SYMPTOM) }
    var severity by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var asking by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf<String?>(null) }

    // A typed name that is a known one, or one of its synonyms, is saved as that preset.
    val preset = if (choice == CUSTOM) order.firstOrNull { presetOf(it.kind, typed) == it } else findPreset(choice)
    val kind = preset?.kind ?: custom
    val finalTitle = preset?.title ?: if (choice == CUSTOM) typed.trim() else ""
    val shownName = preset?.let { t("preset.${it.id}") } ?: finalTitle
    val valid = personId.isNotEmpty() && finalTitle.isNotEmpty()

    fun save() = scope.launch {
        if (!valid) return@launch
        if (!withContext(Dispatchers.IO) { repo.hasConsent(ConsentKind.IMPORT_DOCUMENT, personId) }) {
            asking = true
            return@launch
        }
        withContext(Dispatchers.IO) {
            repo.addHealthEntry(
                NewHealthEntry(
                    personId, localDate(), LocalTime.now().let { "%02d:%02d".format(it.hour, it.minute) }, kind,
                    finalTitle, note.trim(), preset?.bodyPart ?: "", severity.toIntOrNull()?.takeIf { kind == HealthKind.SYMPTOM }, preset?.tags ?: emptyList(), null, null, "",
                ),
            )
        }
        saved = shownName
        choice = NONE
        typed = ""
        severity = ""
        note = ""
        onSaved()
    }

    OutlinedCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(t("quickSymptom.label"), style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (persons.size > 1) {
                    Picker(t("healthPage.colPerson"), personId, listOf("" to t("healthForm.pickPerson")) + persons.map { it.id to it.displayName }, modifier = Modifier.weight(1f)) { personId = it }
                }
                Picker(t("quickSymptom.symptom"), choice, listOf(NONE to "—") + order.map { it.id to t("preset.${it.id}") } + (CUSTOM to t("quick.custom")), modifier = Modifier.weight(1f)) {
                    choice = it
                    typed = ""
                }
            }
            if (choice == CUSTOM) {
                OutlinedTextField(typed, { typed = it }, placeholder = { Text(t("quickSymptom.placeholder")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                if (preset == null) {
                    val kinds = listOf(HealthKind.SYMPTOM, HealthKind.PROCEDURE)
                    Picker(t("healthLog.kind"), custom.id, kinds.map { it.id to t("kind.${it.id}") }, modifier = Modifier.fillMaxWidth()) { id -> custom = kinds.first { it.id == id } }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (kind == HealthKind.SYMPTOM) {
                    Picker(t("healthLog.severity"), severity, listOf("" to "—") + (1..10).map { it.toString() to t("healthLog.outOfTen", "n" to it) }, modifier = Modifier.weight(1f)) { severity = it }
                } else {
                    Spacer(Modifier.weight(1f))
                }
                Button(enabled = valid, onClick = { save() }) { Text(t("quick.save")) }
            }
            OutlinedTextField(note, { note = it }, placeholder = { Text(t("quick.note")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            saved?.let { Text(t("quick.saved", "what" to it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
        }
    }

    if (asking) {
        val ticked = rememberTicks(ConsentKind.IMPORT_DOCUMENT)
        AlertDialog(
            onDismissRequest = { asking = false },
            title = { Text(t(ConsentKind.IMPORT_DOCUMENT.titleKey)) },
            text = { ConsentChecks(ConsentKind.IMPORT_DOCUMENT, ticked) },
            confirmButton = {
                TextButton(enabled = ticked.all { it }, onClick = {
                    asking = false
                    scope.launch {
                        withContext(Dispatchers.IO) { repo.grantConsent(ConsentKind.IMPORT_DOCUMENT, personId) }
                        save()
                    }
                }) { Text(t("consentForm.confirm")) }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text(t("common.cancel")) } },
        )
    }
}
