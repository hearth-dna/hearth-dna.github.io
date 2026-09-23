package com.hearth.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hearth.data.Mendelian
import com.hearth.data.Person
import com.hearth.data.Repo
import com.hearth.data.SourceFile
import com.hearth.kb.Finding
import com.hearth.kb.FindingSortKey
import com.hearth.kb.Kb
import com.hearth.kb.computeFindings
import com.hearth.kb.plain
import com.hearth.kb.sortFindings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

/** One Mendelian comparison; [label] is null for the trio (both parents), named at render time. */
private data class MendelRow(val label: String?, val m: Mendelian)

private val FindingSortKey.labelKey
    get() = when (this) {
        FindingSortKey.GENE -> "personPage.colGene"
        FindingSortKey.RISK_COPIES -> "personPage.colGenotype"
        FindingSortKey.TOPIC -> "personPage.colMeaning"
        FindingSortKey.EVIDENCE -> "personPage.colEvidence"
        FindingSortKey.MAGNITUDE -> "personPage.colImpact"
    }

/**
 * A person's report (PersonPage.tsx): the files their genome came from, how consistent it is with
 * each parent's (and with both, for a trio), a way into their health log, and what the knowledge
 * base says about the markers they carry, sortable like the web table.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PersonScreen(repo: Repo, kb: Kb, person: Person, onBack: () -> Unit, onHealthLog: () -> Unit) {
    val t = LocalStrings.current
    BackHandler(onBack = onBack)
    var files by remember { mutableStateOf(emptyList<SourceFile>()) }
    var mendel by remember { mutableStateOf(emptyList<MendelRow>()) }
    var findings by remember { mutableStateOf<List<Finding>?>(null) }
    var entries by remember { mutableStateOf(0) }
    LaunchedEffect(person.id) {
        withContext(Dispatchers.IO) {
            files = repo.listSourceFiles().filter { it.personId == person.id }
            entries = repo.listHealthLog().count { it.personId == person.id }
            findings = computeFindings(kb, repo.personCallsFor(person.id, kb.entries.map { it.rsid }))
            val persons = repo.listPersons()
            val parents = repo.listRelationships().filter { it.childId == person.id }.map { it.parentId }
            mendel = parents.map { pid -> MendelRow(persons.firstOrNull { it.id == pid }?.displayName ?: pid, repo.mendelian(person.id, pid)) } +
                if (parents.size == 2) listOf(MendelRow(null, repo.mendelian(person.id, parents[0], parents[1]))) else emptyList()
        }
    }
    var sortKey by remember { mutableStateOf(FindingSortKey.MAGNITUDE) }
    var ascending by remember { mutableStateOf(false) }
    var sortMenu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(person.displayName) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = t("personPage.back")) }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = 24.dp)) {
            item(key = "sources") {
                Section(t("personPage.sources")) {
                    if (files.isEmpty()) Text(t("personPage.none"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    for (f in files) {
                        Text(
                            t("personPage.sourceLine", "provider" to f.provider.label, "build" to f.build, "calls" to f.rowCount.grouped(), "name" to f.originalName, "sha" to f.sha256.take(12)),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                    if (mendel.isNotEmpty()) {
                        Text(t("personPage.mendelTitle"), style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp))
                        for (r in mendel) MendelLine(r)
                    }
                }
            }
            item(key = "health") {
                ListItem(
                    headlineContent = { Text(t("healthLog.title")) },
                    supportingContent = { Text(entries.grouped()) },
                    trailingContent = { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null) },
                    modifier = Modifier.padding(horizontal = 16.dp).clickable(onClick = onHealthLog),
                )
                HorizontalDivider(Modifier.padding(horizontal = 16.dp))
            }
            item(key = "findingsHead") {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(t("personPage.findingsTitle"), style = MaterialTheme.typography.titleLarge)
                    Text(t("personPage.findingsIntro"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (!findings.isNullOrEmpty()) {
                        Box {
                            OutlinedButton(onClick = { sortMenu = true }) {
                                Icon(HearthIcons.Sort, contentDescription = null, Modifier.size(18.dp))
                                Text("  ${t(sortKey.labelKey)} ${if (ascending) "↑" else "↓"}")
                            }
                            DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                                for (k in FindingSortKey.entries) {
                                    DropdownMenuItem(
                                        text = { Text(t(k.labelKey)) },
                                        onClick = {
                                            sortMenu = false
                                            if (k == sortKey) ascending = !ascending else { sortKey = k; ascending = k.defaultAscending }
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
            val all = findings
            when {
                all == null -> item(key = "computing") { Muted(t("personPage.computing")) }
                all.isEmpty() -> item(key = "none") { Muted(t("personPage.noMarkers")) }
                else -> items(sortFindings(all, sortKey, ascending), key = { it.entry.rsid }) { FindingCard(it) }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        content()
    }
}

@Composable
private fun Muted(text: String) =
    Text(text, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)

/** "Alex: 1 / 6 shared SNPs (16.67%) inconsistent", the verdict in green below 1%, red above. */
@Composable
private fun MendelLine(r: MendelRow) {
    val t = LocalStrings.current
    val rate = r.m.rate
    val verdict = when {
        rate < 0.01 -> t("personPage.consistent")
        rate < 0.03 -> t("personPage.borderline")
        else -> t("personPage.inconsistent")
    }
    Text(
        t(
            "personPage.mendelLine",
            "label" to (r.label ?: t("personPage.bothParents")),
            "violations" to r.m.violations.grouped(),
            "compared" to r.m.compared.grouped(),
            "rate" to String.format(Locale.ROOT, "%.2f", rate * 100),
        ),
        style = MaterialTheme.typography.bodyMedium,
    )
    Text(verdict, style = MaterialTheme.typography.labelLarge, color = if (rate < 0.01) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
}

/** The web's colours for evidence grades and impact (styles.css `.badge.A/B/C`, `.mag.hi/.mid`). */
@Composable
private fun evidenceColor(e: String): Color = when (e) {
    "A" -> MaterialTheme.colorScheme.primary
    "B" -> MaterialTheme.colorScheme.tertiary
    else -> MaterialTheme.colorScheme.outline
}

@Composable
private fun FindingCard(f: Finding) {
    val t = LocalStrings.current
    val uri = LocalUriHandler.current
    val magnitude = f.match?.magnitude
    ElevatedCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(f.entry.gene, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    f.entry.rsid,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable { uri.openUri("https://www.ncbi.nlm.nih.gov/snp/${f.entry.rsid}") },
                )
                Box(Modifier.weight(1f))
                Surface(color = evidenceColor(f.entry.evidence), shape = RoundedCornerShape(6.dp)) {
                    Text(f.entry.evidence, Modifier.padding(horizontal = 8.dp, vertical = 2.dp), color = MaterialTheme.colorScheme.surface, style = MaterialTheme.typography.labelLarge)
                }
                Text(
                    magnitude?.plain() ?: "–",
                    style = MaterialTheme.typography.titleLarge,
                    color = when {
                        magnitude == null -> MaterialTheme.colorScheme.onSurfaceVariant
                        magnitude >= 3 -> MaterialTheme.colorScheme.error
                        magnitude >= 2 -> severityColor(4)
                        else -> MaterialTheme.colorScheme.onSurface
                    },
                )
            }
            if (f.entry.name.isNotEmpty()) Text(f.entry.name, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                "${f.call.a1}/${f.call.a2} · ${t("personPage.riskCopies", "n" to f.riskCopies)}",
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
            )
            Text(f.match?.label ?: t("personPage.genotypeNotDescribed"), style = MaterialTheme.typography.bodyLarge)
            Text(f.entry.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
