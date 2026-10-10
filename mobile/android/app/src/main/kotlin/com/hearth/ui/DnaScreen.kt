package com.hearth.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.hearth.ask.PROMPTS
import com.hearth.ask.PackOptions
import com.hearth.ask.buildContextPack
import com.hearth.ask.packStats
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.kb.Finding
import com.hearth.kb.Kb
import com.hearth.kb.NOTABLE
import com.hearth.kb.ViewerFilter
import com.hearth.kb.computeFindings
import com.hearth.kb.viewerPackPeople
import com.hearth.kb.viewerQuestion
import com.hearth.kb.viewerRows
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Year

private val EXPLAIN = PROMPTS.firstOrNull { it.id == "explain" }

/** The DNA tab's choices, held above the screen so that opening the family lookup and coming back keeps them. */
class DnaFilters {
    var who by mutableStateOf("")
    var areas by mutableStateOf(listOf<String>())
    var query by mutableStateOf("")
    var notable by mutableStateOf(false)
    var question by mutableStateOf("")
    var realNames by mutableStateOf(false)

    /** Ticked markers (rsids); when any of them is shown, only those go into the pack. */
    var picked by mutableStateOf(listOf<String>())
}

/**
 * The DNA tab (DnaPage.tsx): every marker the knowledge base describes, most clinically useful
 * first, with each person's genotype beside it. Filter by person, area of medicine, text and
 * notability; what is shown, or only the markers ticked, becomes a context pack to copy, share or
 * open in an assistant, previewed exactly as it leaves. A marker opens in the family lookup.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DnaScreen(repo: Repo, kb: Kb, f: DnaFilters, onLookup: (String) -> Unit) {
    val t = LocalStrings.current
    val uri = LocalUriHandler.current
    val snackbar = remember { SnackbarHostState() }
    var persons by remember { mutableStateOf(emptyList<Person>()) }
    var counts by remember { mutableStateOf(emptyMap<String, Int>()) }
    var findingsBy by remember { mutableStateOf(emptyMap<String, List<Finding>>()) }
    var who by f::who
    var areas by f::areas
    var query by f::query
    var notable by f::notable
    var question by f::question
    var realNames by f::realNames
    var picked by f::picked

    LaunchedEffect(Unit) {
        val (p, c) = withContext(Dispatchers.IO) { repo.listPersons() to repo.genotypeCounts() }
        persons = p
        counts = c
        val rsids = kb.entries.map { it.rsid }
        findingsBy = withContext(Dispatchers.IO) { p.filter { (c[it.id] ?: 0) > 0 }.associate { it.id to computeFindings(kb, repo.personCallsFor(it.id, rsids)) } }
    }

    val withDna = persons.filter { (counts[it.id] ?: 0) > 0 }
    val shown = withDna.filter { who.isEmpty() || it.id == who }
    val rows = remember(kb, findingsBy, shown, areas, query, notable) {
        viewerRows(kb, findingsBy, shown.map { it.id }, ViewerFilter(areas, query, notable))
    }
    val pickedRows = rows.filter { it.entry.rsid in picked }
    val packed = viewerPackPeople(pickedRows.ifEmpty { rows }, shown)
    val asked = question.trim().ifEmpty { viewerQuestion(kb, areas) }
    val pack = buildContextPack(PackOptions(asked, packed, realNames, Year.now().value, EXPLAIN, compact = true))
    val stats = packStats(packed, pack)
    val lang = t.language

    val topBar = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(topBar.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(t("dnaPage.title")) },
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
            item(key = "intro") {
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(t("dnaPage.intro"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (withDna.isEmpty()) {
                        Text(t("dnaPage.noDna"), style = MaterialTheme.typography.bodyMedium)
                    } else {
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(selected = who.isEmpty(), onClick = { who = "" }, label = { Text(t("dnaPage.everyone")) })
                            for (p in withDna) FilterChip(selected = who == p.id, onClick = { who = p.id }, label = { Text(p.displayName) })
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = areas.isEmpty(), onClick = { areas = emptyList() }, label = { Text(t("dnaPage.allAreas")) })
                        for (a in kb.areas) {
                            FilterChip(
                                selected = a.id in areas,
                                onClick = { areas = if (a.id in areas) areas - a.id else areas + a.id },
                                label = { Text(a.name(lang)) },
                            )
                        }
                    }
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        placeholder = { Text(t("dnaPage.search")) },
                        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Search),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (shown.isNotEmpty()) {
                        Row(Modifier.fillMaxWidth().clickable { notable = !notable }, verticalAlignment = Alignment.CenterVertically) {
                            Text(t("dnaPage.notable"), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            Switch(checked = notable, onCheckedChange = { notable = it })
                        }
                    }
                    Text(t("dnaPage.count", "n" to rows.size), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (pickedRows.isNotEmpty()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(t("dnaPage.picked", "n" to pickedRows.size), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            TextButton(onClick = { picked = emptyList() }) { Text(t("dnaPage.clearPicked").cap()) }
                        }
                    }
                }
            }
            if (rows.isEmpty()) {
                item(key = "none") { Text(t("dnaPage.noRows"), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            items(rows, key = { it.entry.rsid }) { row ->
                val e = row.entry
                ElevatedCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
                    Column(Modifier.padding(start = 4.dp, end = 16.dp, top = 4.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (shown.isNotEmpty()) {
                                Checkbox(checked = e.rsid in picked, onCheckedChange = { picked = if (e.rsid in picked) picked - e.rsid else picked + e.rsid })
                            } else {
                                Spacer(Modifier.width(12.dp))
                            }
                            Text(e.gene, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(
                                "  " + e.rsid,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.clickable { uri.openUri("https://www.ncbi.nlm.nih.gov/snp/${e.rsid}") },
                            )
                            Spacer(Modifier.weight(1f))
                            Surface(color = evidenceColor(e.evidence), shape = RoundedCornerShape(6.dp)) {
                                Text(e.evidence, Modifier.padding(horizontal = 8.dp, vertical = 2.dp), color = MaterialTheme.colorScheme.surface, style = MaterialTheme.typography.labelLarge)
                            }
                        }
                        Column(Modifier.padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            if (e.name.isNotEmpty()) Text(e.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                for (id in e.areas) {
                                    val label = kb.areas.firstOrNull { it.id == id }?.name(lang) ?: id
                                    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(6.dp)) {
                                        Text(label, Modifier.padding(horizontal = 8.dp, vertical = 2.dp), style = MaterialTheme.typography.labelSmall)
                                    }
                                }
                            }
                            Text(e.summary, style = MaterialTheme.typography.bodyMedium)
                            for (p in shown) {
                                val f = row.findings[p.id]
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    if (shown.size > 1) Text(p.displayName, Modifier.weight(0.4f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Column(Modifier.weight(if (shown.size > 1) 0.6f else 1f)) {
                                        if (f != null) {
                                            val m = f.match?.magnitude ?: 0.0
                                            Text(
                                                "${f.call.a1}/${f.call.a2}",
                                                fontWeight = FontWeight.SemiBold,
                                                color = when {
                                                    m >= 3 -> MaterialTheme.colorScheme.error
                                                    m >= NOTABLE -> severityColor(4)
                                                    else -> MaterialTheme.colorScheme.onSurface
                                                },
                                            )
                                            Text(
                                                f.match?.label ?: t("dnaPage.undescribed"),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = if (f.match == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                                            )
                                        } else {
                                            Text(t("dnaPage.notGenotyped"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                    }
                                }
                            }
                            if (e.generatedBy.startsWith("llm")) {
                                Text(t("dnaPage.draft"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            TextButton(onClick = { onLookup(e.rsid) }, contentPadding = PaddingValues(0.dp)) { Text(t("app.navFamily")) }
                        }
                    }
                }
            }
            item(key = "legend") {
                Text(t("dnaPage.evidenceLegend"), Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (shown.isNotEmpty()) {
                item(key = "send") {
                    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(t("dnaPage.sendHeading"), style = MaterialTheme.typography.titleLarge)
                        Text(t("dnaPage.sendIntro"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        OutlinedTextField(
                            value = question,
                            onValueChange = { question = it },
                            label = { Text(t("dnaPage.question")) },
                            placeholder = { Text(viewerQuestion(kb, areas)) },
                            minLines = 3,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Row(Modifier.fillMaxWidth().clickable { realNames = !realNames }, verticalAlignment = Alignment.CenterVertically) {
                            Text(t("askPage.realNames").cap(), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            Switch(checked = realNames, onCheckedChange = { realNames = it })
                        }
                    }
                }
                item(key = "preview") { PackPreview(repo, pack, stats, packed, asked, realNames, snackbar) }
            }
        }
    }
}
