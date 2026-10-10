package com.hearth.ui

import android.content.ClipData
import android.content.ClipDescription
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.hearth.ask.ASSISTANTS
import com.hearth.ask.Assistant
import com.hearth.ask.PackPerson
import com.hearth.ask.PackStats
import com.hearth.ask.assistantUrl
import com.hearth.data.Repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Where a context pack can go; an assistant is named by its id, which is also what the log records. */
private enum class Way { CLIPBOARD, SHARE }

private sealed interface Destination {
    data class Plain(val way: Way) : Destination
    data class Chat(val assistant: Assistant) : Destination
}

/**
 * The context pack as it will leave the phone (PackPreview.tsx): the exact text, then copy it, hand
 * it to the system share sheet, or open an assistant in the system browser with it already typed
 * in. Every copy, share or link is confirmed first and recorded in the sharing log and the chat
 * history. Hearth sends nothing itself: the text goes where the user's own action takes it.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun PackPreview(
    repo: Repo,
    pack: String,
    stats: PackStats,
    packed: List<PackPerson>,
    question: String,
    realNames: Boolean,
    snackbar: SnackbarHostState,
) {
    val t = LocalStrings.current
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    var confirming by remember { mutableStateOf<Destination?>(null) }
    val links = ASSISTANTS.map { it to assistantUrl(it, pack) }

    fun finish(destination: String, message: String) {
        scope.launch {
            withContext(Dispatchers.IO) { repo.recordCopyOut(destination, packed.map { it.person.id }, question, pack) }
            snackbar.showSnackbar(message)
        }
    }

    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            t("askPage.previewHeading", "chars" to stats.chars.grouped(), "tokens" to stats.tokens.grouped()),
            style = MaterialTheme.typography.titleLarge,
        )
        OutlinedCard(Modifier.fillMaxWidth()) {
            Text(
                pack,
                Modifier.padding(12.dp).heightIn(max = 480.dp).horizontalScroll(rememberScrollState()),
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Button(enabled = packed.isNotEmpty(), onClick = { confirming = Destination.Plain(Way.CLIPBOARD) }, modifier = Modifier.fillMaxWidth()) {
            Text(t("askPage.copyButton"))
        }
        OutlinedButton(enabled = packed.isNotEmpty(), onClick = { confirming = Destination.Plain(Way.SHARE) }, modifier = Modifier.fillMaxWidth()) {
            Text(t("askPage.shareButton"))
        }
        Text(t("askPage.openIn"), style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((a, url) in links) {
                OutlinedButton(enabled = packed.isNotEmpty() && url != null, onClick = { confirming = Destination.Chat(a) }) { Text(a.name) }
            }
        }
        if (packed.isNotEmpty() && links.any { it.second == null }) {
            Text(
                t("askPage.tooLong", "chars" to stats.chars.grouped()),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(t("askPage.trainingNotice"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    val going = confirming ?: return
    val body = when (going) {
        is Destination.Chat -> t("askPage.confirmLinkBody", "assistant" to going.assistant.name)
        is Destination.Plain -> t(if (going.way == Way.SHARE) "askPage.confirmShareBody" else "askPage.confirmBody")
    }
    AlertDialog(
        onDismissRequest = { confirming = null },
        title = { Text(t("askPage.confirmTitle")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(rich(body))
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
                confirming = null
                when (going) {
                    is Destination.Chat -> {
                        val url = assistantUrl(going.assistant, pack) ?: return@TextButton
                        // The system browser opens it; the app opens no connection of its own.
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        finish(going.assistant.id, t("askPage.opened", "assistant" to going.assistant.name))
                    }
                    is Destination.Plain -> if (going.way == Way.SHARE) {
                        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, pack)
                        context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        finish("share", t("askPage.shared"))
                    } else {
                        // Marked sensitive so the keyboard's clipboard preview does not show health data.
                        val clip = ClipData.newPlainText("Hearth", pack).apply {
                            if (Build.VERSION.SDK_INT >= 33) description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
                        }
                        clipboard.setClip(ClipEntry(clip))
                        finish("clipboard", t("askPage.copied", "destination" to "clipboard"))
                    }
                }
            }) {
                Text(
                    when (going) {
                        is Destination.Chat -> t("askPage.confirmOpen", "assistant" to going.assistant.name)
                        is Destination.Plain -> t(if (going.way == Way.SHARE) "askPage.confirmShare" else "askPage.confirmCopy")
                    },
                )
            }
        },
        dismissButton = { TextButton(onClick = { confirming = null }) { Text(t("common.cancel")) } },
    )
}
