package com.hearth.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hearth.data.ConsentKind
import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import com.hearth.data.NewHealthEntry
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.health.findPreset
import com.hearth.health.formatValue
import com.hearth.health.localDate
import com.hearth.health.measurementOrder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalTime

private const val CUSTOM = ""

private fun number(s: String) = s.trim().replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() }

/**
 * One line for the numbers people record over and over (QuickMeasurement.tsx): pick the parameter,
 * type the number, save. Date and time are now, the unit comes from the preset, and the parameters
 * this person already records come first. Anything more belongs in the full form.
 */
@Composable
fun QuickMeasurement(repo: Repo, persons: List<Person>, initialPerson: String, entries: List<HealthEntry>, onSaved: () -> Unit) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    var personId by remember(initialPerson) { mutableStateOf(initialPerson) }
    val order = remember(entries, personId) { measurementOrder(entries.filter { personId.isEmpty() || it.personId == personId }) }
    var presetId by remember { mutableStateOf(order.firstOrNull()?.id ?: CUSTOM) }
    var title by remember { mutableStateOf("") }
    var unit by remember { mutableStateOf("") }
    var value by remember { mutableStateOf("") }
    var value2 by remember { mutableStateOf("") }
    var asking by remember { mutableStateOf(false) }
    var saved by remember { mutableStateOf<String?>(null) }

    val preset = findPreset(presetId)
    val pair = preset?.pair
    val finalTitle = preset?.title ?: title.trim()
    val finalUnit = preset?.unit ?: unit.trim()
    val valid = personId.isNotEmpty() && finalTitle.isNotEmpty() && number(value) != null && (pair == null || number(value2) != null)

    fun save() = scope.launch {
        if (!valid) return@launch
        if (!withContext(Dispatchers.IO) { repo.hasConsent(ConsentKind.IMPORT_DOCUMENT, personId) }) {
            asking = true
            return@launch
        }
        val v = number(value)
        val v2 = if (pair != null) number(value2) else null
        withContext(Dispatchers.IO) {
            repo.addHealthEntry(
                NewHealthEntry(
                    personId, localDate(), LocalTime.now().let { "%02d:%02d".format(it.hour, it.minute) }, HealthKind.MEASUREMENT,
                    finalTitle, "", preset?.bodyPart ?: "", null, preset?.tags ?: emptyList(), v, v2, finalUnit,
                ),
            )
        }
        saved = "$finalTitle ${formatValue(v, v2, finalUnit)}"
        value = ""
        value2 = ""
        onSaved()
    }

    OutlinedCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(t("quick.label"), style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (persons.size > 1) {
                    Picker(t("healthPage.colPerson"), personId, listOf("" to t("healthForm.pickPerson")) + persons.map { it.id to it.displayName }, modifier = Modifier.weight(1f)) { personId = it }
                }
                Picker(t("quick.parameter"), presetId, order.map { it.id to t("preset.${it.id}") } + (CUSTOM to t("quick.custom")), modifier = Modifier.weight(1f)) {
                    presetId = it
                    value = ""
                    value2 = ""
                }
            }
            if (preset == null) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(title, { title = it }, placeholder = { Text(t("quick.customPlaceholder")) }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(unit, { unit = it }, placeholder = { Text(t("healthLog.unitPlaceholder")) }, singleLine = true, modifier = Modifier.weight(0.6f))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                val keyboard = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done)
                OutlinedTextField(
                    value, { value = it },
                    placeholder = { Text(if (pair != null) t("preset.pair.${pair.first}") else t("healthLog.value")) },
                    singleLine = true, keyboardOptions = keyboard, keyboardActions = KeyboardActions(onDone = { save() }), modifier = Modifier.weight(1f),
                )
                if (pair != null) {
                    OutlinedTextField(
                        value2, { value2 = it },
                        placeholder = { Text(t("preset.pair.${pair.second}")) },
                        singleLine = true, keyboardOptions = keyboard, keyboardActions = KeyboardActions(onDone = { save() }), modifier = Modifier.weight(1f),
                    )
                }
                if (preset != null) Text(preset.unit, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(enabled = valid, onClick = { save() }) { Text(t("quick.save")) }
            }
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
