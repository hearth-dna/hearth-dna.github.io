package com.hearth.ui

import android.content.ClipData
import android.content.ClipDescription
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hearth.ask.AskData
import com.hearth.ask.PROMPTS
import com.hearth.ask.PackOptions
import com.hearth.ask.PersonRecords
import com.hearth.ask.Reason
import com.hearth.ask.buildContextPack
import com.hearth.ask.classifyQuestion
import com.hearth.ask.findingKey
import com.hearth.ask.genotypeKey
import com.hearth.ask.healthKey
import com.hearth.ask.itemLabel
import com.hearth.ask.packPeople
import com.hearth.ask.packStats
import com.hearth.ask.parseKey
import com.hearth.ask.recommend
import com.hearth.ask.resolve
import com.hearth.data.Call
import com.hearth.data.HealthKind
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.health.HealthFilter
import com.hearth.health.describeEntry
import com.hearth.health.filterHealthLog
import com.hearth.kb.Kb
import com.hearth.kb.computeFindings
import com.hearth.kb.searchKb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Year

private const val MAX_RESULTS = 60
private val RSIDS = Regex("rs\\d+")

/**
 * Ask (AskPage.tsx): the question is classified on the phone, which picks a prompt template and
 * suggests records; the user can search the health log and DNA for anything else. Only records the
 * user includes go into the pack, previewed exactly as copied. The app sends nothing: every copy
 * to the clipboard is confirmed and written to the sharing log.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun AskScreen(repo: Repo, kb: Kb) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val snackbar = remember { SnackbarHostState() }

    var persons by remember { mutableStateOf(emptyList<Person>()) }
    var question by remember { mutableStateOf("") }
    val selected = remember { mutableStateListOf<String>() }
    val findingsBy = remember { mutableStateMapOf<String, List<com.hearth.kb.Finding>>() }
    val healthBy = remember { mutableStateMapOf<String, List<com.hearth.data.HealthEntry>>() }
    val rawBy = remember { mutableStateMapOf<String, Map<String, Call>>() }
    val included = remember { mutableStateListOf<String>() }
    var realNames by remember { mutableStateOf(false) }
    var compact by remember { mutableStateOf(true) }
    var evidence by remember { mutableStateOf(true) }
    var templateId by remember { mutableStateOf(PROMPTS[0].id) }
    var templateChosen by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        persons = withContext(Dispatchers.IO) { repo.listPersons() }
        if (persons.size == 1 && selected.isEmpty()) selected.add(persons[0].id)
    }
    // Findings and the health log, once per selected person.
    LaunchedEffect(selected.toList()) {
        for (id in selected) {
            if (id in findingsBy) continue
            val (f, h) = withContext(Dispatchers.IO) {
                computeFindings(kb, repo.personCallsFor(id, kb.entries.map { it.rsid })) to repo.listHealthLog().filter { it.personId == id }
            }
            healthBy[id] = h
            findingsBy[id] = f
        }
    }

    val data = AskData(findingsBy.toMap(), healthBy.toMap(), rawBy.toMap())
    val people = persons.filter { it.id in selected }
    val intents = remember(question, selected.size) { classifyQuestion(question, kb, selected.size) }
    val suggestions = recommend(kb, question, intents, selected.filter { it in findingsBy }.map { PersonRecords(it, findingsBy.getValue(it), healthBy[it] ?: emptyList()) })
    // Follow the question's type until the user picks a template themselves.
    LaunchedEffect(intents) { if (!templateChosen) intents.firstOrNull()?.let { templateId = it.type.template } }

    val lower = question.lowercase()
    val named = persons.filter { it.displayName.length >= 2 && Regex("\\b" + Regex.escape(it.displayName.lowercase()) + "\\b").containsMatchIn(lower) }
    fun toggle(key: String) { if (key in included) included.remove(key) else included.add(key) }
    fun setPerson(id: String, on: Boolean) {
        if (on) { if (id !in selected) selected.add(id) } else {
            selected.remove(id)
            included.removeAll { parseKey(it)?.personId == id }
        }
    }

    val packed = packPeople(included, data, persons, selected)
    val template = PROMPTS.firstOrNull { it.id == templateId }
    val pack = buildContextPack(PackOptions(question, packed, realNames, Year.now().value, template, compact, evidence))
    val stats = packStats(packed, pack)

    val topBar = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(topBar.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(t("askPage.title")) },
                scrollBehavior = topBar,
                colors = TopAppBarDefaults.largeTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = 32.dp)) {
            item(key = "question") {
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(t("askPage.intro"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = question,
                        onValueChange = { question = it },
                        label = { Text(t("askPage.question")) },
                        placeholder = { Text(t("askPage.questionPlaceholder")) },
                        minLines = 3,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(t("askPage.people"), style = MaterialTheme.typography.labelLarge)
                        for (p in persons) FilterChip(selected = p.id in selected, onClick = { setPerson(p.id, p.id !in selected) }, label = { Text(p.displayName) })
                    }
                }
            }
            item(key = "suggestions") {
                Section(t("askPage.suggestHeading")) {
                    if (intents.isEmpty()) {
                        Muted(t("askPage.noIntent"))
                    } else {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            intents.forEachIndexed { i, intent ->
                                SuggestionChip(onClick = {}, label = { Text(t("askPage.type.${intent.type.id}"), fontWeight = if (i == 0) FontWeight.SemiBold else null) })
                            }
                        }
                        Muted(t("askPage.typeHint.${intents[0].type.id}") + " " + t("askPage.signals", "words" to intents[0].signals.joinToString(", ") { "“$it”" }))
                        val recommended = PROMPTS.firstOrNull { it.id == intents[0].type.template }
                        if (recommended != null && recommended.id != templateId) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(t("askPage.templateSuggested", "title" to t(recommended.titleKey)), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                                TextButton(onClick = { templateId = recommended.id; templateChosen = true }) { Text(t("askPage.useTemplate").cap()) }
                            }
                        }
                    }
                    val mentioned = named.filter { it.id !in selected }
                    if (mentioned.isNotEmpty()) {
                        Text(t("askPage.mentionedPeople"), style = MaterialTheme.typography.bodyMedium)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (p in mentioned) SuggestionChip(onClick = { setPerson(p.id, true) }, label = { Text("+ ${p.displayName}") })
                        }
                    }
                    when {
                        people.isEmpty() -> Muted(t("askPage.pickPeople"))
                        suggestions.isEmpty() -> if (intents.isNotEmpty()) Muted(t("askPage.noSuggestions"))
                        else -> {
                            val pending = suggestions.filter { it.key !in included }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(t("askPage.suggestedRecords", "n" to suggestions.size), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                                if (pending.isNotEmpty()) TextButton(onClick = { pending.forEach { toggle(it.key) } }) { Text(t("askPage.includeAll", "n" to pending.size).cap()) }
                            }
                            for (s in suggestions) {
                                val r = resolve(s.key, data) ?: continue
                                val who = if (people.size > 1) people.firstOrNull { it.id == s.personId }?.displayName?.let { "$it · " } ?: "" else ""
                                PickRow(s.key in included, who + itemLabel(r, t("askPage.undescribed")), reason(s.reason)) { toggle(s.key) }
                            }
                        }
                    }
                }
            }
            if (people.isNotEmpty()) {
                item(key = "find") {
                    FindRecords(repo, kb, people, data, included, ::toggle) { personId, calls ->
                        if (calls.isNotEmpty()) rawBy[personId] = (rawBy[personId] ?: emptyMap()) + calls.associateBy { it.rsid }
                    }
                }
            }
            item(key = "pack") {
                Section(t("askPage.includedHeading")) {
                    Muted(t("askPage.includedStats", "genotypes" to stats.genotypes, "healthEntries" to stats.healthEntries, "people" to packed.size))
                    if (packed.isEmpty()) Muted(t("askPage.nothingIncluded"))
                    for (pp in packed) {
                        Text(pp.person.displayName, style = MaterialTheme.typography.titleSmall)
                        for (key in included.toList()) {
                            val r = resolve(key, data) ?: continue
                            if (r.personId != pp.person.id) continue
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(itemLabel(r, t("askPage.undescribed")), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                                IconButton(onClick = { toggle(key) }) { Icon(Icons.Filled.Close, contentDescription = t("askPage.remove")) }
                            }
                        }
                    }
                    if (included.isNotEmpty()) TextButton(onClick = { included.clear() }) { Text(t("askPage.removeAll").cap()) }
                    HorizontalDivider()
                    Picker(t("askPage.promptTemplate"), templateId, PROMPTS.map { it.id to t(it.titleKey) }, modifier = Modifier.fillMaxWidth()) {
                        templateId = it
                        templateChosen = true
                    }
                    SwitchRow(t("askPage.compact"), compact) { compact = it }
                    SwitchRow(t("askPage.evidenceNotes"), evidence) { evidence = it }
                    SwitchRow(t("askPage.realNames"), realNames) { realNames = it }
                    if (!realNames && named.isNotEmpty()) {
                        Text(t("askPage.namesWarning", "names" to named.joinToString(", ") { it.displayName }), color = severityColor(4), style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            item(key = "preview") {
                Section(t("askPage.previewHeading", "chars" to stats.chars.grouped(), "tokens" to stats.tokens.grouped())) {
                    OutlinedCard(Modifier.fillMaxWidth()) {
                        Text(
                            pack,
                            Modifier.padding(12.dp).heightIn(max = 480.dp).horizontalScroll(rememberScrollState()),
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    Button(enabled = packed.isNotEmpty(), onClick = { confirming = true }, modifier = Modifier.fillMaxWidth()) { Text(t("askPage.copyButton")) }
                    Text(
                        rich(
                            t("askPage.openAssistant"),
                            links = mapOf("chatgpt" to "https://chatgpt.com", "claude" to "https://claude.ai", "gemini" to "https://gemini.google.com"),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }

    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(t("askPage.confirmTitle")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(rich(t("askPage.confirmBody")))
                    Text(
                        "• " + t(
                            "askPage.confirmCounts",
                            "genotypes" to stats.genotypes,
                            "healthEntries" to stats.healthEntries,
                            "people" to packed.size,
                            "peopleWord" to (if (packed.size == 1) t("askPage.person") else t("askPage.peopleWord")),
                            "naming" to (if (realNames) t("askPage.withRealNames") else t("askPage.pseudonymised")),
                        ),
                    )
                    Text("• " + t("askPage.confirmLogged"))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    // Marked sensitive so the keyboard's clipboard preview does not show health data.
                    val clip = ClipData.newPlainText("Hearth", pack).apply {
                        if (Build.VERSION.SDK_INT >= 33) description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
                    }
                    clipboard.setClip(ClipEntry(clip))
                    scope.launch {
                        withContext(Dispatchers.IO) { repo.recordCopyOut("clipboard", packed.map { it.person.id }, question, pack) }
                        snackbar.showSnackbar(t("askPage.copied", "destination" to "clipboard"))
                    }
                }) { Text(t("askPage.confirmCopy")) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(t("common.cancel")) } },
        )
    }
}

@Composable
private fun reason(r: Reason): String {
    val t = LocalStrings.current
    return when (r) {
        is Reason.Recent -> t("askPage.reason.recent", "kind" to t("kind.${r.kind.id}"))
        is Reason.Mentioned -> t("askPage.reason.mentioned", "term" to r.term)
        is Reason.MatchesQuestion -> t("askPage.reason.matchesQuestion", "term" to r.term)
        Reason.Pharmacogenomic -> t("askPage.reason.pharmacogenomic")
        Reason.Notable -> t("askPage.reason.notable")
        Reason.SharedVariant -> t("askPage.reason.sharedVariant")
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        content()
    }
}

@Composable
private fun Muted(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

/** One record with a checkbox: included or not. */
@Composable
private fun PickRow(on: Boolean, label: String, detail: String? = null, onToggle: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onToggle), verticalAlignment = Alignment.Top) {
        Checkbox(checked = on, onCheckedChange = { onToggle() })
        Column(Modifier.padding(top = 12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            if (detail != null) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SwitchRow(label: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!on) }, verticalAlignment = Alignment.CenterVertically) {
        Text(label.cap(), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked = on, onCheckedChange = onChange)
    }
}

private enum class DnaScope(val key: String?) { SEARCH(null), DRUGS("drugs"), NOTABLE("notable"), ALL("all") }

/**
 * Find any record for the selected people (AskSearch.tsx): the health log by text and kind, DNA by
 * gene, drug, condition or rsid. An rsid the knowledge base does not describe is looked up in the
 * stored genotypes directly, so any SNP from a raw file can go into the pack.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun FindRecords(
    repo: Repo,
    kb: Kb,
    people: List<Person>,
    data: AskData,
    included: List<String>,
    onToggle: (String) -> Unit,
    onRaw: (String, List<Call>) -> Unit,
) {
    val t = LocalStrings.current
    var dna by remember { mutableStateOf(false) }
    var text by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf<HealthKind?>(null) }
    var who by remember { mutableStateOf("") }
    var dnaQuery by remember { mutableStateOf("") }
    var dnaScope by remember { mutableStateOf(DnaScope.SEARCH) }
    var lookedUp by remember { mutableStateOf(emptyList<String>()) }
    val scoped = people.filter { who.isEmpty() || it.id == who }
    val prefix = { p: Person -> if (people.size > 1) "${p.displayName} · " else "" }

    // rsids typed into the DNA search that the kb does not know: looked up in the genotype table.
    val kbRsids = remember(kb) { kb.entries.map { it.rsid }.toSet() }
    val rsids = RSIDS.findAll(dnaQuery.lowercase()).map { it.value }.distinct().filter { it !in kbRsids }.toList()
    LaunchedEffect(rsids, people.map { it.id }) {
        if (rsids.isEmpty()) { lookedUp = emptyList(); return@LaunchedEffect }
        delay(300)
        for (p in people) onRaw(p.id, withContext(Dispatchers.IO) { repo.personCallsFor(p.id, rsids) })
        lookedUp = rsids
    }

    Section(t("askPage.findHeading")) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(selected = !dna, onClick = { dna = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text(t("askPage.tabHealth")) }
            SegmentedButton(selected = dna, onClick = { dna = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text(t("askPage.tabDna")) }
        }
        if (people.size > 1) {
            Picker(t("healthPage.filterPerson"), who, listOf("" to t("askPage.allSelected")) + people.map { it.id to it.displayName }, modifier = Modifier.fillMaxWidth()) { who = it }
        }
        if (!dna) {
            OutlinedTextField(text, { text = it }, placeholder = { Text(t("askPage.searchHealth")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Picker(t("healthLog.kind"), kind?.id ?: "", listOf("" to t("healthTable.allKinds")) + HealthKind.entries.map { it.id to t("kind.${it.id}") }, modifier = Modifier.fillMaxWidth()) {
                kind = HealthKind.entries.firstOrNull { k -> k.id == it }
            }
            val hits = scoped.flatMap { p -> filterHealthLog(data.healthBy[p.id] ?: emptyList(), HealthFilter(kind = kind, text = text)).map { p to it } }
            if (hits.isEmpty()) {
                Muted(t("askPage.noHealthHits"))
            } else {
                TextButton(onClick = { hits.map { (p, h) -> healthKey(p.id, h.id) }.filter { it !in included }.forEach(onToggle) }) {
                    Text(t("askPage.includeAll", "n" to hits.size).cap())
                }
                for ((p, h) in hits.take(MAX_RESULTS)) {
                    val k = healthKey(p.id, h.id)
                    PickRow(k in included, prefix(p) + describeEntry(h)) { onToggle(k) }
                }
                if (hits.size > MAX_RESULTS) Muted(t("askPage.moreResults", "n" to hits.size - MAX_RESULTS))
            }
        } else {
            OutlinedTextField(dnaQuery, { dnaQuery = it; dnaScope = DnaScope.SEARCH }, placeholder = { Text(t("askPage.searchDna")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (s in listOf(DnaScope.DRUGS, DnaScope.NOTABLE, DnaScope.ALL)) {
                    FilterChip(selected = dnaScope == s, onClick = { dnaScope = if (dnaScope == s) DnaScope.SEARCH else s }, label = { Text(t("askPage.dnaScope.${s.key}")) })
                }
            }
            val entries = when (dnaScope) {
                DnaScope.SEARCH -> {
                    // Every word is its own search ("rs429358 warfarin"), in kb order without repeats.
                    val hit = dnaQuery.split(Regex("[\\s,;]+")).filter { it.length >= 2 }.flatMap { searchKb(kb, it) }.toSet()
                    kb.entries.filter { it in hit }
                }
                DnaScope.DRUGS -> kb.entries.filter { it.topic == "pharmacogenomics" }
                else -> kb.entries
            }
            if (entries.isEmpty() && rsids.isEmpty()) Muted(if (dnaQuery.isNotBlank()) t("askPage.noDnaHits") else t("askPage.dnaHint"))
            for (e in entries) for (p in scoped) {
                val f = data.findingsBy[p.id]?.firstOrNull { it.entry.rsid == e.rsid }
                if (dnaScope == DnaScope.NOTABLE && (f?.match?.magnitude ?: 0.0) < 2) continue
                val label = prefix(p) + "${e.gene} ${e.rsid} ${f?.let { "${it.call.a1}/${it.call.a2}" } ?: ""} — ${f?.match?.label ?: e.name} [${e.evidence}]"
                if (f == null) PickRowDisabled(label, t("askPage.notGenotyped")) else {
                    val k = findingKey(p.id, e.rsid)
                    PickRow(k in included, label) { onToggle(k) }
                }
            }
            for (rsid in lookedUp) for (p in scoped) {
                val c = data.rawBy[p.id]?.get(rsid)
                if (c == null) PickRowDisabled(prefix(p) + rsid, t("askPage.notGenotyped")) else {
                    val k = genotypeKey(p.id, rsid)
                    PickRow(k in included, prefix(p) + "$rsid ${c.a1}/${c.a2} (chr${c.chromosome}:${c.position})", t("askPage.notInKb")) { onToggle(k) }
                }
            }
        }
    }
}

@Composable
private fun PickRowDisabled(label: String, why: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Checkbox(checked = false, onCheckedChange = null, enabled = false)
        Column(Modifier.padding(top = 12.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(why, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
