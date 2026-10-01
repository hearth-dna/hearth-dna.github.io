package com.hearth.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.hearth.data.FamilyCall
import com.hearth.data.Person
import com.hearth.data.Relationship
import com.hearth.data.Repo
import com.hearth.data.Sex
import com.hearth.family.Origin
import com.hearth.family.ParentCall
import com.hearth.family.alleleOrigins
import com.hearth.family.layoutPedigree
import com.hearth.kb.Kb
import com.hearth.kb.KbEntry
import com.hearth.kb.searchKb
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val RSID = Regex("^rs\\d+$", RegexOption.IGNORE_CASE)

/**
 * Family lookup (FamilyPage.tsx): find a marker by rsid, gene, drug or condition, then see every
 * person's genotype at it and, when parents are set, who inherited which allele from whom.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FamilyScreen(repo: Repo, kb: Kb) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    var q by rememberSaveable { mutableStateOf("") }
    var looked by rememberSaveable { mutableStateOf<String?>(null) }
    var rows by remember { mutableStateOf<List<FamilyCall>?>(null) }
    var persons by remember { mutableStateOf(emptyList<Person>()) }
    var relationships by remember { mutableStateOf(emptyList<Relationship>()) }
    fun lookup(rsid: String) = scope.launch {
        q = rsid
        looked = rsid
        rows = withContext(Dispatchers.IO) { repo.familyAt(rsid) }
    }
    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) { repo.listPersons() to repo.listRelationships() }.let { (p, r) -> persons = p; relationships = r }
        looked?.let { lookup(it) }
    }
    val isRsid = RSID.matches(q.trim())
    val hits = if (isRsid) emptyList() else searchKb(kb, q).take(12)
    val entry = looked?.let { l -> kb.entries.firstOrNull { it.rsid == l } }

    val topBar = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(topBar.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(t("familyPage.title")) },
                scrollBehavior = topBar,
                colors = TopAppBarDefaults.largeTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                    scrolledContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = padding.calculateTopPadding(), bottom = 24.dp)) {
            item(key = "search") {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = q,
                        onValueChange = { q = it },
                        placeholder = { Text(t("familyPage.searchPlaceholder")) },
                        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { if (isRsid) lookup(q.trim()) }),
                        modifier = Modifier.weight(1f),
                    )
                    Button(enabled = isRsid, onClick = { lookup(q.trim()) }) { Text(t("familyPage.lookUp")) }
                }
            }
            items(hits, key = { "hit-${it.rsid}" }) { e ->
                ListItem(
                    headlineContent = { Text("${e.gene} — ${e.name}") },
                    overlineContent = { Text(e.rsid) },
                    supportingContent = { Text(e.summary, maxLines = 2) },
                    modifier = Modifier.clickable { lookup(e.rsid) },
                )
            }
            val found = rows
            if (found != null && looked != null) {
                item(key = "head") {
                    Column(Modifier.padding(16.dp)) {
                        Text(looked!!, style = MaterialTheme.typography.headlineSmall)
                        if (entry != null) Text("${entry.gene} — ${entry.name}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (found.isNotEmpty() && relationships.isNotEmpty()) {
                    item(key = "tree") {
                        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(t("familyPage.whoInherited"), style = MaterialTheme.typography.titleMedium)
                            InheritanceTree(persons, relationships, found, entry)
                        }
                    }
                }
                if (found.isEmpty()) {
                    item(key = "none") { Text(t("familyPage.notGenotyped"), Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                } else {
                    item(key = "tableHead") {
                        GenotypeRow(t("familyPage.person"), t("familyPage.chr"), t("familyPage.position"), t("familyPage.genotype"), header = true)
                        HorizontalDivider(Modifier.padding(horizontal = 16.dp))
                    }
                    items(persons, key = { "row-${it.id}" }) { p ->
                        val r = found.firstOrNull { it.personId == p.id }?.call
                        GenotypeRow(p.displayName, r?.chromosome ?: "–", r?.position?.toString() ?: "–", if (r != null) "${r.a1}/${r.a2}" else t("familyPage.notOnChip"), muted = r == null)
                    }
                }
            }
        }
    }
}

@Composable
private fun GenotypeRow(person: String, chr: String, position: String, genotype: String, header: Boolean = false, muted: Boolean = false) {
    val style = if (header) MaterialTheme.typography.labelLarge else MaterialTheme.typography.bodyMedium
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Text(person, Modifier.weight(1f), style = style)
        Text(chr, Modifier.width(44.dp), style = style)
        Text(position, Modifier.width(96.dp), style = style)
        Text(genotype, Modifier.width(88.dp), style = style, color = if (muted) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
    }
}

/** A box in either tree: the pedigree convention is a square for men, a pill for women. */
@Composable
private fun PedigreeBox(sex: String, border: BorderStroke, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val corner = when (Sex.of(sex)) {
        Sex.MALE -> 4.dp
        Sex.FEMALE -> NODE_H / 2
        Sex.UNKNOWN -> 8.dp
    }
    Surface(
        shape = RoundedCornerShape(corner),
        border = border,
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxSize().let { if (onClick != null) it.clickable(onClick = onClick) else it },
    ) {
        Box(contentAlignment = Alignment.Center) { content() }
    }
}

/**
 * The pedigree for one rsid (InheritanceTree.tsx): each person's genotype, and on every line the
 * allele that parent passed on. Risk alleles are red, ambiguous lines dashed, impossible ones red.
 */
@Composable
private fun InheritanceTree(persons: List<Person>, relationships: List<Relationship>, calls: List<FamilyCall>, entry: KbEntry?) {
    val t = LocalStrings.current
    val danger = MaterialTheme.colorScheme.error
    val warn = severityColor(4)
    val nodes = layoutPedigree(persons, relationships)
    val callOf = calls.associate { it.personId to it.call }
    val risk = entry?.riskAllele
    val edges = pedigreeEdges(nodes).map { e ->
        val child = callOf[e.to.person.id]
        val origins = if (child != null) alleleOrigins(child, e.to.parents.map { ParentCall(it, callOf[it]) }) else emptyList()
        val mine = origins.filter { it.from == e.from.person.id }.map { it.allele }
        val impossible = origins.firstOrNull()?.from == Origin.IMPOSSIBLE
        e.copy(
            color = if (impossible) danger else null,
            width = if (mine.isNotEmpty()) 2.dp else 1.2.dp,
            dashed = origins.isNotEmpty() && !impossible && mine.isEmpty(),
            label = mine.joinToString("").ifEmpty { null },
            labelColor = if (risk != null && risk in mine) danger else null,
        )
    }
    Pedigree(nodes, edges) { n ->
        val c = callOf[n.person.id]
        val copies = if (c != null && risk != null) listOf(c.a1, c.a2).count { it == risk } else 0
        val outline = when (copies) {
            2 -> danger
            1 -> warn
            else -> MaterialTheme.colorScheme.outlineVariant
        }
        PedigreeBox(n.person.sex, BorderStroke(if (copies > 0) 2.dp else 1.dp, outline)) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(n.person.displayName, fontWeight = FontWeight.SemiBold, maxLines = 1)
                if (c == null) {
                    Text(t("inheritanceTree.notTyped"), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                } else {
                    Text(
                        buildAnnotatedString {
                            for (a in listOf(c.a1, c.a2)) {
                                if (a == risk) withStyle(SpanStyle(color = danger, fontWeight = FontWeight.Bold)) { append(a) } else append(a)
                            }
                        },
                        fontSize = 16.sp,
                    )
                }
            }
        }
    }
    Text(
        rich(
            t("inheritanceTree.legend") + (risk?.let { " " + t("inheritanceTree.riskLegend", "allele" to it) } ?: ""),
            mapOf("r" to SpanStyle(color = danger, fontWeight = FontWeight.Bold)),
        ),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Everyone as a pedigree (FamilyTree.tsx); a person with genotypes opens their report. */
@Composable
fun FamilyTree(persons: List<Person>, relationships: List<Relationship>, counts: Map<String, Int>, onOpen: (Person) -> Unit) {
    val t = LocalStrings.current
    val nodes = layoutPedigree(persons, relationships)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Pedigree(nodes, pedigreeEdges(nodes), Modifier.padding(horizontal = 8.dp)) { n ->
            val p = n.person
            val snps = counts[p.id] ?: 0
            val border = if (snps > 0) BorderStroke(1.5.dp, MaterialTheme.colorScheme.primary) else BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
            PedigreeBox(p.sex, border, onClick = if (snps > 0) ({ onOpen(p) }) else null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(p.displayName, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    Text(
                        listOfNotNull(
                            p.birthYear?.let { t("peoplePage.born", "year" to it) },
                            if (snps > 0) t("peoplePage.snps", "n" to snps.grouped()) else t("peoplePage.noGenotypes"),
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        maxLines = 2,
                    )
                }
            }
        }
        if (persons.size > 1 && relationships.isEmpty()) {
            Text(t("peoplePage.treeHint"), Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
