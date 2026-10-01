package com.hearth.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hearth.data.HealthEntry
import com.hearth.health.HealthFilter
import com.hearth.health.daysBefore
import com.hearth.health.facets
import com.hearth.health.localDate
import java.time.LocalDate

/** Quick date ranges, in days back from today (today included). */
private val PERIODS = listOf(7L, 30L, 90L, 365L)

/**
 * The Filters sheet: body part, tag, minimum severity and a date range with quick periods. Every
 * change applies at once; the button at the bottom says how many entries that leaves.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun FiltersSheet(entries: List<HealthEntry>, filter: HealthFilter, shown: Int, onChange: (HealthFilter) -> Unit, onDismiss: () -> Unit) {
    val t = LocalStrings.current
    val (bodyParts, tags) = remember(entries) { facets(entries) }
    val today = localDate()
    val periodFrom = { days: Long -> daysBefore(today, days - 1) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(t("healthTable.filters"), style = MaterialTheme.typography.titleLarge)
            Picker(
                label = t("healthLog.filterBodyPart"),
                value = filter.bodyPart,
                options = listOf("" to t("healthLog.anyBodyPart")) + bodyParts.map { it to it },
                enabled = bodyParts.isNotEmpty(),
            ) { onChange(filter.copy(bodyPart = it)) }
            Picker(
                label = t("healthLog.filterTag"),
                value = filter.tag,
                options = listOf("" to t("healthLog.anyTag")) + tags.map { it to it },
                enabled = tags.isNotEmpty(),
            ) { onChange(filter.copy(tag = it)) }
            Picker(
                label = t("healthTable.minSeverity"),
                value = filter.minSeverity?.toString() ?: "",
                options = listOf("" to t("healthTable.anySeverity")) + (1..10).map { "$it" to t("healthTable.severityAtLeast", "n" to it) },
            ) { onChange(filter.copy(minSeverity = it.toIntOrNull())) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DateField(t("healthTable.from").cap(), filter.from, Modifier.weight(1f)) { onChange(filter.copy(from = it)) }
                DateField(t("healthTable.to").cap(), filter.to, Modifier.weight(1f)) { onChange(filter.copy(to = it)) }
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(t("healthTable.period"), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (days in PERIODS) {
                        val active = filter.from == periodFrom(days) && filter.to.isEmpty()
                        FilterChip(
                            selected = active,
                            onClick = { onChange(if (active) filter.copy(from = "", to = "") else filter.copy(from = periodFrom(days), to = "")) },
                            label = { Text(if (days == 365L) t("healthTable.periodYear") else t("healthTable.periodDays", "n" to days)) },
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(
                    onClick = { onChange(filter.copy(bodyPart = "", tag = "", minSeverity = null, from = "", to = "")) },
                    modifier = Modifier.weight(1f),
                ) { Text(t("common.clear").cap()) }
                Button(onClick = onDismiss, modifier = Modifier.weight(1f)) { Text(t("healthTable.showResults", "n" to shown)) }
            }
        }
    }
}

/** A read-only field that opens a menu of choices: Material's exposed dropdown. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Picker(label: String, value: String, options: List<Pair<String, String>>, enabled: Boolean = true, modifier: Modifier = Modifier, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { if (enabled) open = it }, modifier = modifier) {
        OutlinedTextField(
            value = options.firstOrNull { it.first == value }?.second ?: value,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(MenuAnchorType.PrimaryNotEditable, enabled),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for ((v, text) in options) DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onPick(v) })
        }
    }
}

/** A YYYY-MM-DD field filled from the Material date picker; "" is no date. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(label: String, value: String, modifier: Modifier = Modifier, clearable: Boolean = true, onPick: (String) -> Unit) {
    val t = LocalStrings.current
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedTextField(
            value = value,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { Icon(Icons.Filled.DateRange, contentDescription = null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        // A read-only text field swallows taps; this layer takes them and opens the picker.
        Box(Modifier.matchParentSize().clickable { open = true })
    }
    if (open) {
        val state = rememberDatePickerState(
            initialSelectedDateMillis = value.takeIf { it.isNotEmpty() }?.let { LocalDate.parse(it).toEpochDay() * 86_400_000L },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    open = false
                    onPick(state.selectedDateMillis?.let { LocalDate.ofEpochDay(it / 86_400_000L).toString() } ?: "")
                }) { Text(t("native.ok")) }
            },
            dismissButton = {
                if (clearable) TextButton(onClick = { open = false; onPick("") }) { Text(t("common.clear").cap()) }
                else TextButton(onClick = { open = false }) { Text(t("common.cancel")) }
            },
        ) { DatePicker(state = state) }
    }
}
