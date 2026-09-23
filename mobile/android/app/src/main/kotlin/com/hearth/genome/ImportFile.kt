package com.hearth.genome

import com.hearth.data.Provider
import com.hearth.data.Repo

/** Where an import is: an i18n key from `importFile.json`, its placeholders, and 0–100. */
data class ImportProgress(val key: String, val params: Map<String, Any> = emptyMap(), val pct: Float = 0f)

data class ImportSummary(val calls: Int, val provider: Provider, val build: String, val skipped: Int)

/** Thrown when a file parses to nothing Hearth can store; the message key is `importFile.noRows`. */
class NoCallsException : Exception("importFile.noRows")

/**
 * Unpack → parse → store one raw-data file for one person (importFile.ts `importGenomeFile`), shared
 * by the single and the batch import. Runs for seconds on a real genome: call it off the main thread.
 */
fun importGenomeFile(
    repo: Repo,
    personId: String,
    bytes: ByteArray,
    fileName: String,
    forced: Provider? = null,
    onProgress: (ImportProgress) -> Unit = {},
): ImportSummary {
    onProgress(ImportProgress("importFile.unpacking"))
    val (text, innerName) = fileToText(bytes, fileName)
    val sha256 = sha256Hex(text)
    val detected = forced ?: detectProvider(text)
    onProgress(ImportProgress("importFile.parsingFile", mapOf("name" to innerName, "provider" to detected.label)))
    val r = parseRawText(text, forced) { d, n -> onProgress(ImportProgress("importFile.parsing", pct = d * 50f / n)) }
    if (r.calls.isEmpty()) throw NoCallsException()
    onProgress(ImportProgress("importFile.storing", mapOf("n" to r.calls.size), 50f))
    repo.importCalls(personId, r.provider, r.build, sha256, fileName, r.calls) { n ->
        onProgress(ImportProgress("importFile.storingProgress", mapOf("n" to n, "total" to r.calls.size), 50 + n * 50f / r.calls.size))
    }
    // The original text is kept, gzipped, so backups ship it instead of re-serialising every row.
    repo.blobs.put(Repo.genomeBlobName(sha256), gzip(text.toByteArray(Charsets.UTF_8)))
    repo.pruneBlobs()
    return ImportSummary(r.calls.size, r.provider, r.build, r.skipped)
}

/** "AncestryDNA (1).txt" → label "ancestrydna-1", display name "AncestryDNA (1)". */
fun personFromFileName(name: String): Pair<String, String> {
    val stem = name.replace(Regex("\\.(zip|gz|txt|csv|tsv|vcf)$", RegexOption.IGNORE_CASE), "")
        .replace(Regex("\\.(txt|csv|tsv|vcf)$", RegexOption.IGNORE_CASE), "")
    val label = stem.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
    return label.ifEmpty { "genome" } to stem.ifEmpty { name }
}
