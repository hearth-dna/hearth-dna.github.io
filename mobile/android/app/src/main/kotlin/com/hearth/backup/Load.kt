package com.hearth.backup

import com.hearth.data.Repo
import com.hearth.data.str
import com.hearth.genome.decode
import com.hearth.genome.gunzip
import com.hearth.genome.gzip
import com.hearth.genome.sha256Hex
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream

/**
 * Loading what the user picked in one go (scheduler.ts `loadFiles`): backup files (a union by id,
 * see Restore.kt) and the genome files a folder snapshot keeps in its `genomes` folder, told apart
 * by content, because a phone's picker selects within one folder only. Genomes that were not among
 * them are remembered in `meta`, so a restart keeps them, until their files are picked.
 */
class NamedBytes(val name: String, val bytes: ByteArray)

/** What [loadFiles] brought in, for the message. */
data class LoadResult(
    /** Backup files among the picked ones; 0 when only genome files were picked. */
    val dumps: Int,
    val name: String,
    val people: Int,
    val genomes: Int,
    val exportedAt: String,
    /** Genome files taken, by file name, with whose DNA each was. */
    val dna: List<Pair<String, String>>,
    /** Picked files that were neither a backup nor a genome of anyone on this phone. */
    val unused: List<String>,
    /** Sealed files the passphrase did not open. */
    val unopened: List<String>,
    /** People the backups listed a genome for that none of the picked files carried. */
    val missing: List<PersonRef>,
)

private const val ELSEWHERE_KEY = "genomes-elsewhere"

private fun isZip(b: ByteArray) = b.size > 3 && b[0] == 'P'.code.toByte() && b[1] == 'K'.code.toByte() && b[2] == 3.toByte() && b[3] == 4.toByte()
private fun isGzip(b: ByteArray) = b.size > 1 && b[0] == 0x1f.toByte() && b[1] == 0x8b.toByte()

/** A file the restore recognises on sight: a dump v2, plain or sealed. */
fun isDumpFile(b: ByteArray): Boolean = runCatching { readHeaderPrefix(b) != null }.getOrDefault(false) ||
    (isZip(b) && runCatching { zipEntries(b) { it == "header.json" }.isNotEmpty() }.getOrDefault(false))

private fun zipEntries(zip: ByteArray, keep: (String) -> Boolean): List<NamedBytes> {
    val out = mutableListOf<NamedBytes>()
    ZipInputStream(ByteArrayInputStream(zip)).use { z ->
        while (true) {
            val e = z.nextEntry ?: break
            if (!e.isDirectory && keep(e.name)) out.add(NamedBytes(e.name, z.readBytes()))
        }
    }
    return out
}

/**
 * Picked files with any .zip opened up: a whole backup folder compressed into one file is one
 * selection on a phone. From a zip only the current snapshots and the genome files are taken;
 * rotated copies, conflict files, the README and macOS metadata are left inside. A dump v2 is a zip
 * too: it is a backup, not a folder of them.
 */
fun expandArchives(files: List<NamedBytes>): List<NamedBytes> = files.flatMap { f ->
    if (!isZip(f.bytes) || isDumpFile(f.bytes)) return@flatMap listOf(f)
    fun base(n: String) = n.substringAfterLast('/')
    zipEntries(f.bytes) { n ->
        !n.contains("__MACOSX/") && !base(n).startsWith("._") &&
            ((base(n).endsWith(".hearth") && !base(n).contains(".conflict-")) || base(n).endsWith(".gz"))
    }.map { NamedBytes(base(it.name), it.bytes) }
}

/** A picked file as a possible genome: its gzip bytes and both hashes a manifest may know it by. */
class PickedGenome(
    val gz: ByteArray,
    /** sha256 of [gz] (the manifest entry's `sha256`, when the copy is byte for byte). */
    val sha256: String,
    /** sha256 of the text inside (an original's `source_file` hash). */
    val textSha: String,
)

/**
 * Files the user picked by hand that may be genome files. Sealed ones are opened with the
 * passphrase. A drive or phone may hand a `.gz` over already decompressed, so plain text counts
 * too, and is known by the hash of its text. Null for a file sealed with another passphrase or
 * that is not text.
 */
fun readPickedGenomes(files: List<ByteArray>, passphrase: String?): List<PickedGenome?> {
    val open = passphrase?.takeIf { it.isNotEmpty() }?.let { Opener(it) }
    return files.map { raw ->
        val bytes = if (isSealedSidecar(raw)) {
            if (open == null) throw BackupException("native.encryptedTitle")
            runCatching { open.open(raw) }.getOrNull() ?: return@map null
        } else raw
        val gz = isGzip(bytes)
        val text = runCatching { decode(if (gz) gunzip(bytes) else bytes) }.getOrNull() ?: return@map null
        val packed = if (gz) bytes else gzip(text.toByteArray(Charsets.UTF_8))
        PickedGenome(packed, sha256Hex(packed), sha256Hex(text))
    }
}

/** Which picked file is the genome [e] waits for: the same bytes, or the same text inside. */
fun pickFor(e: Elsewhere, picked: List<PickedGenome?>): Int =
    picked.indexOfFirst { it != null && (it.sha256 == e.entry.sha256 || (e.textSha != null && it.textSha == e.textSha)) }

fun Repo.elsewhere(): List<Elsewhere> = runCatching {
    val a = JSONArray(getMeta(ELSEWHERE_KEY) ?: "[]")
    (0 until a.length()).map {
        val o = a.getJSONObject(it)
        Elsewhere(
            GenomeEntry(
                o.getString("path"), o.getString("sha256"), o.getString("person_id"), o.optString("provider", "generic"),
                o.optBoolean("original"), o.optString("source_file_id").ifEmpty { null },
            ),
            o.optString("name"),
            o.optString("text_sha").ifEmpty { null },
        )
    }
}.getOrDefault(emptyList())

private fun Repo.setElsewhere(list: List<Elsewhere>) = setMeta(
    ELSEWHERE_KEY,
    if (list.isEmpty()) null else JSONArray(list.map { x ->
        JSONObject().put("path", x.entry.path).put("sha256", x.entry.sha256).put("person_id", x.entry.personId)
            .put("provider", x.entry.provider).put("original", x.entry.original).put("source_file_id", x.entry.sourceFileId ?: "")
            .put("name", x.name).put("text_sha", x.textSha ?: "")
    }).toString(),
)

private fun Repo.hasGenotypes(personId: String) = sql.query("SELECT 1 AS x FROM genotype WHERE person_id = ? LIMIT 1", listOf(personId)).isNotEmpty()

/** People whose genome files a loaded snapshot keeps beside itself and nobody has picked yet. */
fun Repo.elsewhereNames(): List<PersonRef> = elsewhere().filter { !hasGenotypes(it.entry.personId) }.map { PersonRef(it.entry.personId, it.name) }

/**
 * Loads what the user picked, in one go. Runs the restore of every backup among the files, then
 * gives each genome a snapshot left beside itself the picked file that is it. A single file that is
 * not recognisably a backup is tried as one, so an older dump or a mistake gets the restore's own
 * message.
 */
fun loadFiles(
    repo: Repo,
    files: List<NamedBytes>,
    passphrase: String?,
    onProgress: (String, Map<String, Any>) -> Unit = { _, _ -> },
): LoadResult {
    val picked = expandArchives(files)
    var dumps = picked.filter { isDumpFile(it.bytes) }
    var rest = picked.filter { it !in dumps }
    val had = repo.elsewhere()
    if (dumps.isEmpty() && rest.size == 1 && had.isEmpty()) {
        dumps = rest
        rest = emptyList()
    }
    var name = ""
    var people = 0
    var genomes = 0
    var exportedAt = ""
    val missing = mutableListOf<PersonRef>()
    var elsewhere = had
    fun same(a: Elsewhere, b: Elsewhere) = a.entry.personId == b.entry.personId && a.entry.sha256 == b.entry.sha256
    for (d in dumps) {
        // Genomes beside a folder snapshot come back as `elsewhere`, matched below like any other.
        val r = restoreBytes(repo, d.bytes, passphrase?.ifEmpty { null }, onProgress)
        name = d.name
        people += r.persons
        genomes += r.genomes
        exportedAt = r.exportedAt
        missing += r.missing
        elsewhere = elsewhere.filter { x -> r.elsewhere.none { same(x, it) } } + r.elsewhere
    }
    val read = readPickedGenomes(rest.map { it.bytes }, passphrase)
    val used = mutableSetOf<Int>()
    val left = mutableListOf<Elsewhere>()
    val dna = mutableListOf<Pair<String, String>>()
    for (x in elsewhere) {
        val at = pickFor(x, read)
        if (at < 0) {
            left.add(x)
            continue
        }
        used.add(at)
        if (!repo.hasGenotypes(x.entry.personId)) {
            repo.sql.transaction { restoreGenome(repo, x.entry, read[at]!!.gz, onProgress, dna.size + 1, elsewhere.size) }
            genomes++
        }
        dna.add(rest[at].name to x.name)
    }
    // Nothing listed them (their snapshot was loaded before the list was kept): an original is still
    // known by its source_file row, which has its text's hash.
    val took = mutableSetOf<String>()
    for ((i, g) in read.withIndex()) {
        if (g == null || i in used) continue
        val sf = repo.sql.query(
            "SELECT s.id, s.person_id, s.provider, s.build, p.display_name, p.label FROM source_file s JOIN person p ON p.id = s.person_id WHERE s.sha256 = ? LIMIT 1",
            listOf(g.textSha),
        ).firstOrNull() ?: continue
        used.add(i)
        val personId = sf.str("person_id")
        took.add(personId)
        if (!repo.hasGenotypes(personId)) {
            val entry = GenomeEntry("", g.sha256, personId, sf.str("provider"), true, sf.str("id"))
            repo.sql.transaction { restoreGenome(repo, entry, g.gz, onProgress, dna.size + 1, read.size) }
            genomes++
        }
        dna.add(rest[i].name to sf.str("display_name").ifEmpty { sf.str("label") })
    }
    repo.setElsewhere(left.filter { it.entry.personId !in took })
    return LoadResult(
        dumps = dumps.size,
        name = name,
        people = people,
        genomes = genomes,
        exportedAt = exportedAt,
        dna = dna,
        unused = rest.filterIndexed { i, _ -> i !in used && read[i] != null }.map { it.name },
        unopened = rest.filterIndexed { i, _ -> read[i] == null }.map { it.name },
        missing = missing,
    )
}
