package com.hearth.ui

import android.content.Context
import androidx.compose.foundation.ExperimentalFoundationApi
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.background
import androidx.compose.ui.unit.dp
import com.hearth.data.Attachment
import com.hearth.data.HealthEntry
import com.hearth.data.HealthKind
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.health.HealthFilter
import com.hearth.health.SortDir
import com.hearth.health.SortKey
import com.hearth.health.defaultDir
import com.hearth.health.filterHealthLog
import com.hearth.health.groupByDate
import com.hearth.health.sortHealthLog
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class LogView { CARDS, TABLE }

private const val PREFS = "hearth.native"
private const val VIEW_KEY = "healthView"

/** The i18n key naming each sort key, the same labels as the web's table headers. */
val SortKey.labelKey: String
    get() = when (this) {
        SortKey.DATE -> "healthTable.colDate"
        SortKey.PERSON -> "healthPage.colPerson"
        SortKey.KIND -> "healthLog.kind"
        SortKey.TITLE -> "healthLog.titleField"
        SortKey.VALUE -> "healthLog.value"
        SortKey.BODY_PART -> "healthLog.bodyPart"
        SortKey.SEVERITY -> "healthLog.severity"
    }

/**
 * The family's health log (docs/architecture/native-apps.md, "Health log screen"): search, a
 * person row, kind chips with counts, a Filters sheet, sort and view controls, removable chips
 * for what is filtered, then the entries as cards under day headers or as a table.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun HealthScreen(repo: Repo) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    var persons by remember { mutableStateOf(emptyList<Person>()) }
    var entries by remember { mutableStateOf(emptyList<HealthEntry>()) }
    var attachments by remember { mutableStateOf(emptyMap<String, List<Attachment>>()) }
    var loaded by remember { mutableStateOf(false) }
    fun reload() = scope.launch {
        val (p, e, a) = withContext(Dispatchers.IO) { Triple(repo.listPersons(), repo.listHealthLog(), repo.attachmentsByEntry()) }
        persons = p
        entries = e
        attachments = a
        loaded = true
    }
    LaunchedEffect(Unit) { reload() }

    var filter by remember { mutableStateOf(HealthFilter()) }
    var sortKey by remember { mutableStateOf(SortKey.DATE) }
    var sortDir by remember { mutableStateOf(SortDir.DESC) }
    var view by remember { mutableStateOf(runCatching { LogView.valueOf(prefs.getString(VIEW_KEY, null)!!) }.getOrDefault(LogView.CARDS)) }
    var openEntry by remember { mutableStateOf<HealthEntry?>(null) }
    var filtersOpen by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val snackbar = remember { SnackbarHostState() }
    val restore = rememberRestore(repo, snackbar) { reload() }

    val name = { id: String -> persons.firstOrNull { it.id == id }?.displayName ?: id }
    val shown = remember(entries, filter, sortKey, sortDir, persons) { sortHealthLog(filterHealthLog(entries, filter), sortKey, sortDir, name) }
    // The web's rule: the family timeline names each entry's person; one person's log does not.
    val showPerson = filter.person.isEmpty()
    val kindCounts = remember(entries, filter.person) {
        filterHealthLog(entries, HealthFilter(person = filter.person)).groupingBy { it.kind }.eachCount()
    }
    // The person row is the scope; the sheet's badge counts what is set inside the sheet.
    val sheetCount = filter.copy(person = "").panelCount
    val set = { f: HealthFilter -> filter = f }

    val topBar = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val list = rememberLazyListState()
    val horizontal = rememberScrollState()
    val fabExpanded by remember { derivedStateOf { list.firstVisibleItemIndex == 0 } }

    Scaffold(
        modifier = Modifier.nestedScroll(topBar.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(t("healthPage.title")) },
                scrollBehavior = topBar,
                colors = TopAppBarDefaults.largeTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                ),
                actions = {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = null) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(t("native.restoreBackup")) }, onClick = { menu = false; restore() })
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (persons.isNotEmpty()) {
                ExtendedFloatingActionButton(
                    onClick = { adding = true },
                    expanded = fabExpanded,
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text(t("healthLog.addEntry")) },
                )
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (!loaded) return@Scaffold
        if (persons.isEmpty()) {
            EmptyState(Modifier.padding(padding), onRestore = restore)
            return@Scaffold
        }
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 96.dp),
        ) {
            item(key = "search") { SearchField(filter.text) { set(filter.copy(text = it)) } }
            if (persons.size > 1) {
                item(key = "people") {
                    ChipRow {
                        item {
                            FilterChip(
                                selected = filter.person.isEmpty(),
                                onClick = { set(filter.copy(person = "")) },
                                label = { Text(t("healthPage.everyone")) },
                            )
                        }
                        items(persons, key = { it.id }) { p ->
                            FilterChip(
                                selected = filter.person == p.id,
                                onClick = { set(filter.copy(person = if (filter.person == p.id) "" else p.id)) },
                                label = { Text(p.displayName) },
                            )
                        }
                    }
                }
            }
            item(key = "kinds") {
                ChipRow {
                    item {
                        FilterChip(
                            selected = filter.kind == null,
                            onClick = { set(filter.copy(kind = null)) },
                            label = { Text("${t("healthTable.allKinds")}  ${kindCounts.values.sum()}") },
                        )
                    }
                    items(HealthKind.entries.filter { (kindCounts[it] ?: 0) > 0 }) { k ->
                        FilterChip(
                            selected = filter.kind == k,
                            onClick = { set(filter.copy(kind = if (filter.kind == k) null else k)) },
                            label = { Text("${t("kind.${k.id}")}  ${kindCounts[k]}") },
                            leadingIcon = { Box(Modifier.size(8.dp).clip(CircleShape).background(kindColor(k))) },
                        )
                    }
                }
            }
            item(key = "toolbar") {
                Toolbar(
                    sheetCount = sheetCount,
                    sortKey = sortKey,
                    sortDir = sortDir,
                    showPerson = showPerson,
                    view = view,
                    onFilters = { filtersOpen = true },
                    onSort = { k -> if (k == sortKey) sortDir = if (sortDir == SortDir.ASC) SortDir.DESC else SortDir.ASC else { sortKey = k; sortDir = k.defaultDir } },
                    onDir = { sortDir = it },
                    onView = { view = it; prefs.edit().putString(VIEW_KEY, it.name).apply() },
                )
            }
            item(key = "status") {
                ActiveFilters(filter, shown.size, entries.size, onChange = set)
            }
            if (shown.isEmpty()) {
                item(key = "none") {
                    Text(
                        t("healthLog.nothingMatches").cap(),
                        Modifier.padding(horizontal = 16.dp, vertical = 32.dp).fillMaxWidth(),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            } else if (view == LogView.TABLE) {
                entryTable(shown, showPerson, name, sortKey, sortDir, horizontal, onSort = { k ->
                    if (k == sortKey) sortDir = if (sortDir == SortDir.ASC) SortDir.DESC else SortDir.ASC else { sortKey = k; sortDir = k.defaultDir }
                }, onOpen = { openEntry = it })
            } else {
                val card = @Composable { e: HealthEntry, grouped: Boolean ->
                    EntryCard(
                        entry = e,
                        person = if (showPerson) name(e.personId) else null,
                        grouped = grouped,
                        attachments = attachments[e.id]?.size ?: 0,
                        activeTag = filter.tag,
                        onTag = { tag -> set(filter.copy(tag = if (filter.tag == tag) "" else tag)) },
                        onClick = { openEntry = e },
                    )
                }
                if (sortKey == SortKey.DATE) {
                    for ((date, day) in groupByDate(shown)) {
                        stickyHeader(key = "day-$date") { DayHeader(date, day.size) }
                        items(day, key = { it.id }) { e -> Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { card(e, true) } }
                    }
                } else {
                    items(shown, key = { it.id }) { e -> Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { card(e, false) } }
                }
            }
        }
    }

    openEntry?.let { e ->
        EntrySheet(
            entry = e,
            person = name(e.personId),
            attachments = attachments[e.id].orEmpty(),
            onDismiss = { openEntry = null },
            onDelete = {
                scope.launch {
                    withContext(Dispatchers.IO) { repo.deleteHealthEntry(e.id) }
                    openEntry = null
                    reload()
                }
            },
        )
    }
    if (filtersOpen) {
        FiltersSheet(
            entries = entries,
            filter = filter,
            shown = shown.size,
            onChange = set,
            onDismiss = { filtersOpen = false },
        )
    }
    if (adding) {
        AddEntry(
            repo = repo,
            persons = persons,
            personId = filter.person.ifEmpty { if (persons.size == 1) persons[0].id else "" },
            tagSuggestions = remember(entries) { entries.flatMap { it.tags }.distinct().sorted() },
            onDismiss = { adding = false },
            onSaved = { adding = false; reload() },
        )
    }
}

@Composable
private fun SearchField(text: String, onChange: (String) -> Unit) {
    val t = LocalStrings.current
    TextField(
        value = text,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        placeholder = { Text(t("healthLog.searchText").cap()) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        trailingIcon = if (text.isEmpty()) null else ({
            IconButton(onClick = { onChange("") }) { Icon(Icons.Filled.Clear, contentDescription = t("common.clear")) }
        }),
        singleLine = true,
        shape = RoundedCornerShape(28.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
        ),
    )
}

/** A sideways-scrolling row of chips, edge to edge with the list's 16dp gutter inside it. */
@Composable
private fun ChipRow(content: androidx.compose.foundation.lazy.LazyListScope.() -> Unit) {
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Toolbar(
    sheetCount: Int,
    sortKey: SortKey,
    sortDir: SortDir,
    showPerson: Boolean,
    view: LogView,
    onFilters: () -> Unit,
    onSort: (SortKey) -> Unit,
    onDir: (SortDir) -> Unit,
    onView: (LogView) -> Unit,
) {
    val t = LocalStrings.current
    var sortMenu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FilterChip(
            selected = sheetCount > 0,
            onClick = onFilters,
            label = { Text(t("healthTable.filters")) },
            leadingIcon = { Icon(HearthIcons.FilterList, contentDescription = null, Modifier.size(FilterChipDefaults.IconSize)) },
            trailingIcon = if (sheetCount > 0) ({ Badge { Text("$sheetCount") } }) else null,
        )
        Box {
            AssistChip(
                onClick = { sortMenu = true },
                label = { Text("${t(sortKey.labelKey)} ${if (sortDir == SortDir.ASC) "↑" else "↓"}") },
                leadingIcon = { Icon(HearthIcons.Sort, contentDescription = t("healthTable.sortBy"), Modifier.size(18.dp)) },
            )
            DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                for (k in SortKey.entries) {
                    if (k == SortKey.PERSON && !showPerson) continue
                    DropdownMenuItem(
                        text = { Text(t(k.labelKey)) },
                        onClick = { sortMenu = false; onSort(k) },
                        leadingIcon = { if (k == sortKey) Icon(Icons.Filled.Check, contentDescription = null) else Spacer(Modifier.size(24.dp)) },
                    )
                }
                HorizontalDivider()
                for (d in SortDir.entries) {
                    DropdownMenuItem(
                        text = { Text(t(if (d == SortDir.ASC) "healthTable.sortAsc" else "healthTable.sortDesc")) },
                        onClick = { sortMenu = false; onDir(d) },
                        leadingIcon = { if (d == sortDir) Icon(Icons.Filled.Check, contentDescription = null) else Spacer(Modifier.size(24.dp)) },
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        SingleChoiceSegmentedButtonRow {
            LogView.entries.forEachIndexed { i, v ->
                SegmentedButton(
                    selected = view == v,
                    onClick = { onView(v) },
                    shape = SegmentedButtonDefaults.itemShape(i, LogView.entries.size),
                    icon = {},
                ) {
                    Icon(
                        if (v == LogView.CARDS) HearthIcons.ViewAgenda else HearthIcons.TableRows,
                        contentDescription = t(if (v == LogView.CARDS) "healthTable.viewCards" else "healthTable.viewTable"),
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

/** What is filtered besides the person row and the kind chips, each removable, then "n of m". */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ActiveFilters(filter: HealthFilter, shown: Int, total: Int, onChange: (HealthFilter) -> Unit) {
    val t = LocalStrings.current
    val chips = buildList {
        if (filter.bodyPart.isNotEmpty()) add(filter.bodyPart to filter.copy(bodyPart = ""))
        if (filter.tag.isNotEmpty()) add("#${filter.tag}" to filter.copy(tag = ""))
        filter.minSeverity?.let { add(t("healthTable.severityAtLeast", "n" to it) to filter.copy(minSeverity = null)) }
        if (filter.from.isNotEmpty() || filter.to.isNotEmpty())
            add("${filter.from.ifEmpty { "…" }} – ${filter.to.ifEmpty { "…" }}" to filter.copy(from = "", to = ""))
    }
    FlowRow(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        for ((label, without) in chips) {
            InputChip(
                selected = true,
                onClick = { onChange(without) },
                label = { Text(label) },
                trailingIcon = { Icon(Icons.Filled.Close, contentDescription = t("healthTable.removeFilter", "label" to label), Modifier.size(18.dp)) },
            )
        }
        Text(
            t("healthLog.shownOf", "n" to shown, "m" to total),
            Modifier.align(Alignment.CenterVertically).padding(vertical = 12.dp),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (filter.isFiltering) {
            TextButton(onClick = { onChange(HealthFilter()) }, Modifier.align(Alignment.CenterVertically)) { Text(t("common.clear").cap()) }
        }
    }
}

@Composable
private fun EmptyState(modifier: Modifier, onRestore: () -> Unit) {
    val t = LocalStrings.current
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(t("native.emptyTitle"), style = MaterialTheme.typography.titleLarge)
        Text(t("native.emptyBody"), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onRestore) { Text(t("native.restoreBackup")) }
    }
}
