package com.hearth.ui

import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.hearth.data.Person
import com.hearth.data.Provider
import com.hearth.data.Relationship
import com.hearth.backup.Backups
import com.hearth.data.Repo
import com.hearth.data.Sex
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.NumberFormat

private enum class PeopleView(val labelKey: String) { CARDS("peoplePage.viewCards"), TABLE("peoplePage.viewTable"), TREE("peoplePage.viewTree") }

private const val PREFS = "hearth.native"
private const val VIEW_KEY = "peopleView"

/** "1234567" → "1,234,567" in the phone's locale, as the web's toLocaleString() does. */
fun Int.grouped(): String = NumberFormat.getIntegerInstance().format(this)

/**
 * The family (PeoplePage.tsx): everyone with sex, birth year, how many SNPs they have and who their
 * parents are, as cards or a table. A person is added or edited in a sheet; their DNA file is
 * imported from their card; several files at once make one new person each.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PeopleScreen(repo: Repo, backups: Backups, onOpen: (Person) -> Unit) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    var persons by remember { mutableStateOf(emptyList<Person>()) }
    var relationships by remember { mutableStateOf(emptyList<Relationship>()) }
    var counts by remember { mutableStateOf(emptyMap<String, Int>()) }
    var loaded by remember { mutableStateOf(false) }
    fun reload() = scope.launch {
        withContext(Dispatchers.IO) { Triple(repo.listPersons(), repo.listRelationships(), repo.genotypeCounts()) }.let {
            persons = it.first
            relationships = it.second
            counts = it.third
        }
        loaded = true
    }
    LaunchedEffect(Unit) { reload() }
    fun write(block: () -> Unit) = scope.launch {
        withContext(Dispatchers.IO) { block() }
        reload()
    }

    var view by remember { mutableStateOf(runCatching { PeopleView.valueOf(prefs.getString(VIEW_KEY, null)!!) }.getOrDefault(PeopleView.CARDS)) }
    var editing by remember { mutableStateOf<Person?>(null) }
    var adding by remember { mutableStateOf(false) }
    var importFor by remember { mutableStateOf<Person?>(null) }
    var batch by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<Person?>(null) }
    var menu by remember { mutableStateOf(false) }

    val parentsOf = { id: String -> relationships.filter { it.childId == id }.map { it.parentId } }
    val nameOf = { id: String -> persons.firstOrNull { it.id == id }?.displayName ?: "?" }
    val actions = PersonActions(
        onOpen = onOpen,
        onImport = { importFor = it },
        onEdit = { editing = it },
        onDelete = { deleting = it },
        onAddParent = { p, parent -> write { repo.setParent(parent, p.id) } },
        onRemoveParent = { p, parent -> write { repo.unsetParent(parent, p.id) } },
    )

    val topBar = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    val list = rememberLazyListState()
    val fabExpanded by remember { derivedStateOf { list.firstVisibleItemIndex == 0 } }
    Scaffold(
        modifier = Modifier.nestedScroll(topBar.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(t("peoplePage.title")) },
                scrollBehavior = topBar,
                colors = TopAppBarDefaults.largeTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                ),
                actions = {
                    SyncAction(backups)
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = null) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(t("peoplePage.importSeveral")) }, onClick = { menu = false; batch = true })
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { adding = true },
                expanded = fabExpanded,
                icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                text = { Text(t("peoplePage.addPerson")) },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        if (!loaded) return@Scaffold
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 96.dp),
        ) {
            if (persons.isEmpty()) {
                item(key = "empty") {
                    Text(
                        t("peoplePage.noOneYet", "providers" to Provider.entries.joinToString(", ") { it.label }),
                        Modifier.padding(horizontal = 16.dp, vertical = 24.dp),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                return@LazyColumn
            }
            item(key = "view") {
                SingleChoiceSegmentedButtonRow(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    PeopleView.entries.forEachIndexed { i, v ->
                        SegmentedButton(
                            selected = view == v,
                            onClick = { view = v; prefs.edit().putString(VIEW_KEY, v.name).apply() },
                            shape = SegmentedButtonDefaults.itemShape(i, PeopleView.entries.size),
                        ) { Text(t(v.labelKey)) }
                    }
                }
            }
            when (view) {
                PeopleView.CARDS -> items(persons, key = { it.id }) { p ->
                    PersonCard(p, parentsOf(p.id), persons, counts[p.id] ?: 0, nameOf, actions)
                }
                PeopleView.TABLE -> item(key = "table") { PeopleTable(persons, counts, parentsOf, nameOf, actions) }
                PeopleView.TREE -> item(key = "tree") { FamilyTree(persons, relationships, counts, onOpen) }
            }
        }
    }

    if (adding || editing != null) {
        PersonSheet(editing, onDismiss = { adding = false; editing = null }) { label, name, sex, year ->
            val e = editing
            write { if (e == null) repo.addPerson(label, name, sex, year) else repo.updatePerson(e.id, name, sex, year) }
            adding = false
            editing = null
        }
    }
    importFor?.let { p -> ImportSheet(repo, p, onDismiss = { importFor = null; reload() }) }
    if (batch) BatchImportSheet(repo, onDismiss = { batch = false; reload() })
    deleting?.let { p ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            text = { Text(t("peoplePage.confirmDelete", "name" to p.displayName)) },
            confirmButton = {
                TextButton(onClick = { deleting = null; write { repo.deletePerson(p.id) } }) {
                    Text(t("peoplePage.delete"), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(t("common.cancel")) } },
        )
    }
}

private class PersonActions(
    val onOpen: (Person) -> Unit,
    val onImport: (Person) -> Unit,
    val onEdit: (Person) -> Unit,
    val onDelete: (Person) -> Unit,
    val onAddParent: (Person, String) -> Unit,
    val onRemoveParent: (Person, String) -> Unit,
)

@Composable
private fun sexLabel(sex: String): String = LocalStrings.current(
    when (Sex.of(sex)) {
        Sex.UNKNOWN -> "peoplePage.sexUnknown"
        Sex.MALE -> "peoplePage.sexMale"
        Sex.FEMALE -> "peoplePage.sexFemale"
    },
).cap()

/** One person: facts, parents as removable chips with an "add parent" menu, and the actions. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonCard(p: Person, parents: List<String>, everyone: List<Person>, snps: Int, nameOf: (String) -> String, actions: PersonActions) {
    val t = LocalStrings.current
    var parentMenu by remember { mutableStateOf(false) }
    var cardMenu by remember { mutableStateOf(false) }
    ElevatedCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(p.displayName, style = MaterialTheme.typography.titleLarge)
                Text(p.label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                Box {
                    IconButton(onClick = { cardMenu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = null) }
                    DropdownMenu(expanded = cardMenu, onDismissRequest = { cardMenu = false }) {
                        DropdownMenuItem(text = { Text(t("peoplePage.edit").cap()) }, onClick = { cardMenu = false; actions.onEdit(p) })
                        DropdownMenuItem(text = { Text(t("peoplePage.delete"), color = MaterialTheme.colorScheme.error) }, onClick = { cardMenu = false; actions.onDelete(p) })
                    }
                }
            }
            Text(
                listOfNotNull(
                    sexLabel(p.sex),
                    p.birthYear?.let { t("peoplePage.born", "year" to it) },
                    if (snps > 0) t("peoplePage.snps", "n" to snps.grouped()) else t("peoplePage.noGenotypes"),
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(t("peoplePage.parentsHeader"), style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (pid in parents) {
                    InputChip(
                        selected = false,
                        onClick = { actions.onRemoveParent(p, pid) },
                        label = { Text(nameOf(pid)) },
                        trailingIcon = { Icon(Icons.Filled.Close, contentDescription = t("peoplePage.removeParent", "name" to nameOf(pid)), Modifier.size(18.dp)) },
                    )
                }
                val candidates = everyone.filter { it.id != p.id && it.id !in parents }
                if (candidates.isNotEmpty()) {
                    Box {
                        AssistChip(onClick = { parentMenu = true }, label = { Text(t("peoplePage.addParent")) })
                        DropdownMenu(expanded = parentMenu, onDismissRequest = { parentMenu = false }) {
                            for (c in candidates) DropdownMenuItem(text = { Text(c.displayName) }, onClick = { parentMenu = false; actions.onAddParent(p, c.id) })
                        }
                    }
                }
            }
            HorizontalDivider()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = { actions.onImport(p) }) { Text(t("peoplePage.importDna")) }
                // The report needs genotypes, as on the web.
                TextButton(onClick = { actions.onOpen(p) }, enabled = snps > 0) { Text(t("peoplePage.report")) }
            }
        }
    }
}

/** The web's table: one row per person, scrolling sideways; a row's menu has the card's actions. */
@Composable
private fun PeopleTable(persons: List<Person>, counts: Map<String, Int>, parentsOf: (String) -> List<String>, nameOf: (String) -> String, actions: PersonActions) {
    val t = LocalStrings.current
    val widths = listOf(180.dp, 96.dp, 96.dp, 180.dp, 104.dp)
    Column(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp)) {
        Row(Modifier.padding(vertical = 8.dp)) {
            listOf("peoplePage.name", "peoplePage.sex", "peoplePage.birthYear", "peoplePage.parentsHeader", "peoplePage.snpsHeader").forEachIndexed { i, k ->
                Text(t(k), Modifier.width(widths[i]).padding(horizontal = 8.dp), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            }
        }
        HorizontalDivider()
        for (p in persons) {
            var menu by remember { mutableStateOf(false) }
            Box {
                Row(Modifier.clickable { menu = true }.padding(vertical = 12.dp)) {
                    val parents = parentsOf(p.id)
                    val cells = listOf(
                        "${p.displayName} (${p.label})",
                        sexLabel(p.sex),
                        p.birthYear?.toString() ?: "–",
                        if (parents.isEmpty()) "–" else parents.joinToString(", ") { nameOf(it) },
                        counts[p.id]?.grouped() ?: "–",
                    )
                    cells.forEachIndexed { i, c -> Text(c, Modifier.width(widths[i]).padding(horizontal = 8.dp), style = MaterialTheme.typography.bodyMedium) }
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(t("peoplePage.importDna")) }, onClick = { menu = false; actions.onImport(p) })
                    DropdownMenuItem(text = { Text(t("peoplePage.report")) }, enabled = (counts[p.id] ?: 0) > 0, onClick = { menu = false; actions.onOpen(p) })
                    DropdownMenuItem(text = { Text(t("peoplePage.edit").cap()) }, onClick = { menu = false; actions.onEdit(p) })
                    DropdownMenuItem(text = { Text(t("peoplePage.delete"), color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; actions.onDelete(p) })
                }
            }
            HorizontalDivider()
        }
    }
}

/**
 * Add a person (label, display name, sex, birth year) or edit one (the label stays: backups and
 * exports name people by it).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PersonSheet(person: Person?, onDismiss: () -> Unit, onSave: (label: String, name: String, sex: Sex, year: Int?) -> Unit) {
    val t = LocalStrings.current
    var label by remember { mutableStateOf("") }
    var name by remember { mutableStateOf(person?.displayName ?: "") }
    var sex by remember { mutableStateOf(Sex.of(person?.sex ?: "unknown")) }
    var year by remember { mutableStateOf(person?.birthYear?.toString() ?: "") }
    val yearValue = year.trim().toIntOrNull()
    val valid = (person != null || label.isNotBlank()) && (person == null || name.isNotBlank()) && (year.isBlank() || yearValue != null)
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 24.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (person == null) t("peoplePage.addPerson") else person.displayName, style = MaterialTheme.typography.titleLarge)
            if (person == null) {
                OutlinedTextField(
                    value = label,
                    onValueChange = { label = it },
                    label = { Text(t("peoplePage.shortLabel")) },
                    placeholder = { Text(t("peoplePage.shortLabelPlaceholder")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                label = { Text(t("peoplePage.displayName")) },
                placeholder = { Text(t("peoplePage.displayNamePlaceholder")) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Picker(
                    t("peoplePage.sex"),
                    sex.id,
                    listOf(Sex.UNKNOWN to "peoplePage.sexUnknown", Sex.MALE to "peoplePage.sexMale", Sex.FEMALE to "peoplePage.sexFemale").map { (s, k) -> s.id to t(k).cap() },
                    modifier = Modifier.weight(1f),
                ) { sex = Sex.of(it) }
                OutlinedTextField(
                    value = year,
                    onValueChange = { year = it.filter(Char::isDigit).take(4) },
                    label = { Text(t("peoplePage.birthYear")) },
                    placeholder = { Text(t("peoplePage.birthYearPlaceholder")) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.weight(1f),
                )
            }
            Button(
                enabled = valid,
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    // The web's rules: labels are lower-case, and a blank display name is the label.
                    val l = label.trim().lowercase()
                    onSave(l, name.trim().ifEmpty { label.trim() }, sex, yearValue)
                },
            ) { Text(if (person == null) t("peoplePage.add") else t("common.save")) }
        }
    }
}
