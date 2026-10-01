package com.hearth.ui

import androidx.compose.material3.IconButton
import androidx.compose.material.icons.filled.Close
import android.text.format.DateFormat
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.hearth.data.Attachment
import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import com.hearth.health.SortDir
import com.hearth.health.SortKey
import com.hearth.health.daysBefore
import com.hearth.health.formatValue
import com.hearth.health.localDate
import com.hearth.health.whenOf
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Composable
fun KindBadge(kind: HealthKind) {
    val c = kindColor(kind)
    Surface(shape = RoundedCornerShape(6.dp), color = c.copy(alpha = 0.12f), contentColor = c) {
        Text(
            LocalStrings.current("kind.${kind.id}"),
            Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** "Today", "Yesterday", "Mon, 14 Sep", or with the year when it is not this year. */
@Composable
fun dayHeading(date: String): String {
    val t = LocalStrings.current
    val today = localDate()
    if (date == today) return t("healthTable.today")
    if (date == daysBefore(today, 1)) return t("healthTable.yesterday")
    val skeleton = if (date.take(4) == today.take(4)) "EEEMMMd" else "EEEMMMdyyyy"
    val pattern = DateFormat.getBestDateTimePattern(t.locale, skeleton)
    return LocalDate.parse(date).format(DateTimeFormatter.ofPattern(pattern, t.locale))
}

@Composable
fun DayHeader(date: String, count: Int) {
    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxWidth()) {
        Text(
            "${dayHeading(date)} · $count",
            Modifier.padding(start = 20.dp, end = 16.dp, top = 16.dp, bottom = 6.dp),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** One entry: kind, who and when; the title with the value on the trailing side; details; tags. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EntryCard(
    entry: HealthEntry,
    person: String?,
    grouped: Boolean,
    attachments: Int,
    activeTag: String,
    onTag: (String) -> Unit,
    onClick: () -> Unit,
) {
    val t = LocalStrings.current
    val value = formatValue(entry)
    OutlinedCard(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLowest),
    ) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(4.dp).fillMaxHeight().background(kindColor(entry.kind)))
            Column(Modifier.padding(start = 12.dp, end = 16.dp, top = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    KindBadge(entry.kind)
                    if (person != null) {
                        Text(person, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    }
                    Spacer(Modifier.weight(1f))
                    Text(
                        if (grouped) entry.time else whenOf(entry),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(entry.title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                    if (value.isNotEmpty()) Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                }
                val meta = entry.bodyPart.isNotEmpty() || entry.severity != null || entry.body.isNotEmpty() || attachments > 0
                if (meta) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val muted = MaterialTheme.colorScheme.onSurfaceVariant
                        val small = MaterialTheme.typography.bodySmall
                        if (entry.bodyPart.isNotEmpty()) Text(entry.bodyPart, style = small, color = muted)
                        entry.severity?.let { s ->
                            Row {
                                Text("${t("healthLog.severity")} ", style = small, color = muted)
                                Text("$s/10", style = small, fontWeight = FontWeight.Bold, color = severityColor(s))
                            }
                        }
                        if (entry.body.isNotEmpty()) Icon(HearthIcons.Notes, contentDescription = null, Modifier.size(16.dp), tint = muted)
                        if (attachments > 0) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(HearthIcons.Attach, contentDescription = t("healthTable.hasAttachments", "n" to attachments), Modifier.size(16.dp), tint = muted)
                                Text("$attachments", style = small, color = muted)
                            }
                        }
                    }
                }
                if (entry.tags.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (tag in entry.tags) FilterChip(selected = tag == activeTag, onClick = { onTag(tag) }, label = { Text(tag) })
                    }
                }
            }
        }
    }
}

private val COLUMN_WIDTHS: Map<SortKey, Dp> = mapOf(
    SortKey.DATE to 132.dp, SortKey.PERSON to 96.dp, SortKey.KIND to 132.dp, SortKey.TITLE to 200.dp,
    SortKey.VALUE to 116.dp, SortKey.BODY_PART to 104.dp, SortKey.SEVERITY to 88.dp,
)
private val TAGS_WIDTH = 160.dp

/**
 * The table view as rows of a lazy list: a sticky header row, then one row per entry, all sharing
 * one horizontal scroll so the columns stay aligned. Tapping a header sorts, a row opens it.
 */
@OptIn(ExperimentalFoundationApi::class)
fun LazyListScope.entryTable(
    entries: List<HealthEntry>,
    showPerson: Boolean,
    name: (String) -> String,
    sortKey: SortKey,
    sortDir: SortDir,
    horizontal: ScrollState,
    onSort: (SortKey) -> Unit,
    onOpen: (HealthEntry) -> Unit,
) {
    val keys = SortKey.entries.filter { showPerson || it != SortKey.PERSON }
    stickyHeader(key = "table-header") {
        val t = LocalStrings.current
        Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.horizontalScroll(horizontal).padding(horizontal = 8.dp)) {
                for (k in keys) {
                    Text(
                        t(k.labelKey) + if (k == sortKey) (if (sortDir == SortDir.ASC) " ▲" else " ▼") else "",
                        Modifier.width(COLUMN_WIDTHS.getValue(k)).clickable { onSort(k) }.padding(horizontal = 8.dp, vertical = 12.dp),
                        style = MaterialTheme.typography.labelLarge,
                        maxLines = 1,
                    )
                }
                Text(t("healthTable.colTags"), Modifier.width(TAGS_WIDTH).padding(horizontal = 8.dp, vertical = 12.dp), style = MaterialTheme.typography.labelLarge)
            }
        }
    }
    items(entries, key = { it.id }) { e ->
        Column {
            Row(Modifier.clickable { onOpen(e) }.horizontalScroll(horizontal).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                for (k in keys) {
                    Box(Modifier.width(COLUMN_WIDTHS.getValue(k)).padding(horizontal = 8.dp, vertical = 10.dp)) {
                        when (k) {
                            SortKey.DATE -> Text(whenOf(e), style = MaterialTheme.typography.bodyMedium)
                            SortKey.PERSON -> Text(name(e.personId), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            SortKey.KIND -> KindBadge(e.kind)
                            SortKey.TITLE -> Text(e.title, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            SortKey.VALUE -> Text(formatValue(e), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                            SortKey.BODY_PART -> Text(e.bodyPart, style = MaterialTheme.typography.bodyMedium)
                            SortKey.SEVERITY -> e.severity?.let { Text("$it/10", fontWeight = FontWeight.Bold, color = severityColor(it)) }
                        }
                    }
                }
                Text(
                    e.tags.joinToString(", "),
                    Modifier.width(TAGS_WIDTH).padding(horizontal = 8.dp, vertical = 10.dp),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/** Everything about one entry, its full text and documents, and Delete behind a confirmation. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun EntrySheet(
    entry: HealthEntry,
    person: String,
    attachments: List<Attachment>,
    /** Whether this phone has a document's bytes, or only its row (restored from a backup). */
    hasBytes: (Attachment) -> Boolean,
    onOpen: (Attachment) -> Unit,
    onRemove: (Attachment) -> Unit,
    onDismiss: () -> Unit,
    onDelete: () -> Unit,
) {
    val t = LocalStrings.current
    var confirm by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Attachment?>(null) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                KindBadge(entry.kind)
                Text(person, style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.weight(1f))
                Text(whenOf(entry), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(entry.title, style = MaterialTheme.typography.headlineSmall)
            formatValue(entry).takeIf { it.isNotEmpty() }?.let {
                Text(it, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.SemiBold)
            }
            val facts = buildList {
                if (entry.bodyPart.isNotEmpty()) add(t("healthLog.bodyPart") to entry.bodyPart)
                entry.severity?.let { add(t("healthLog.severity") to t("healthLog.outOfTen", "n" to it)) }
            }
            if (facts.isNotEmpty()) {
                Row(horizontalArrangement = Arrangement.spacedBy(32.dp)) {
                    for ((label, v) in facts) {
                        Column {
                            Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(v, style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
            }
            if (entry.tags.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (tag in entry.tags) {
                        Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
                            Text(tag, Modifier.padding(horizontal = 10.dp, vertical = 4.dp), style = MaterialTheme.typography.labelLarge)
                        }
                    }
                }
            }
            if (entry.body.isNotEmpty()) {
                Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                    SelectionContainer {
                        Text(entry.body, Modifier.fillMaxWidth().padding(16.dp), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            } else {
                Text(t("healthTable.noText"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (attachments.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (a in attachments) {
                        val here = hasBytes(a)
                        Row(
                            Modifier.fillMaxWidth().clickable(enabled = here) { onOpen(a) },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(HearthIcons.Attach, contentDescription = null, Modifier.size(20.dp))
                            Text(
                                a.name,
                                Modifier.weight(1f),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = if (here) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                            )
                            if (!here) Text(t("attachments.missingBytes"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            IconButton(onClick = { removing = a }) { Icon(Icons.Filled.Close, contentDescription = t("attachments.remove")) }
                        }
                    }
                }
            }
            if (entry.source.isNotEmpty()) {
                Text(
                    t("healthLog.transcribedBy", "model" to entry.source.substringBefore(':')),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider()
            OutlinedButton(
                onClick = { confirm = true },
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) {
                Icon(Icons.Filled.Delete, contentDescription = null, Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text(t("common.delete").cap())
            }
        }
    }
    removing?.let { a ->
        AlertDialog(
            onDismissRequest = { removing = null },
            text = { Text(t("attachments.confirmDelete", "name" to a.name)) },
            confirmButton = { TextButton(onClick = { removing = null; onRemove(a) }) { Text(t("attachments.remove"), color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text(t("common.cancel")) } },
        )
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            text = { Text(t("healthLog.confirmDelete", "title" to entry.title, "date" to entry.date)) },
            confirmButton = {
                TextButton(onClick = { confirm = false; onDelete() }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                    Text(t("common.delete").cap())
                }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text(t("common.cancel")) } },
        )
    }
}
