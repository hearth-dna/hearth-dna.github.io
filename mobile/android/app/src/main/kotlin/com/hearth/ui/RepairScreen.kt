package com.hearth.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hearth.backup.rebuildGenomesFromCache
import com.hearth.data.Db
import com.hearth.data.Repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class Step { ASK, WORKING, DONE, FAILED }

/**
 * In place of the app when the database file is damaged (RepairScreen.tsx): what happened, and a
 * repair that keeps whatever can still be read, rebuilds genotypes from the genome files kept on
 * the phone, and then opens the app again. Anything still missing comes back from a backup.
 */
@Composable
fun RepairScreen(db: Db, repo: Repo, error: String, onDone: () -> Unit) {
    val t = LocalStrings.current
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(Step.ASK) }
    var progress by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf("") }

    fun repair() = scope.launch {
        step = Step.WORKING
        message = try {
            val (rows, lost) = withContext(Dispatchers.IO) { db.repair() }
            val genomes = withContext(Dispatchers.IO) {
                rebuildGenomesFromCache(repo) { key, params -> progress = t(key, *params.map { (k, v) -> k to v }.toTypedArray()) }
            }
            step = Step.DONE
            listOf(
                t("repair.done", "people" to (rows["person"] ?: 0), "entries" to (rows["health_log"] ?: 0), "genomes" to genomes),
                if (lost.isNotEmpty()) t("repair.lost", "tables" to lost.joinToString(", ")) else "",
            ).filter { it.isNotEmpty() }.joinToString(" ")
        } catch (e: Exception) {
            step = Step.FAILED
            t("repair.failed", "error" to (e.message ?: e.javaClass.simpleName))
        }
    }

    Scaffold { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(t("native.repairTitle"), style = MaterialTheme.typography.headlineMedium)
            Text(t("repair.intro"), style = MaterialTheme.typography.bodyLarge)
            Text(error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            when (step) {
                Step.ASK -> Button(onClick = { repair() }, modifier = Modifier.fillMaxWidth()) { Text(t("repair.button")) }
                Step.WORKING -> {
                    Text(progress ?: t("repair.working"))
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                Step.DONE, Step.FAILED -> {
                    Text(message, color = if (step == Step.DONE) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error)
                    Button(onClick = onDone, modifier = Modifier.fillMaxWidth()) { Text(t("repair.reload")) }
                }
            }
        }
    }
}
