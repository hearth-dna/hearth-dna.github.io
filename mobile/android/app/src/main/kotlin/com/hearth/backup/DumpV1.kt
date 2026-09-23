package com.hearth.backup

import com.hearth.data.Call
import com.hearth.data.Provider
import com.hearth.data.Repo
import com.hearth.genome.decode
import com.hearth.genome.gunzip
import org.json.JSONObject
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Dump v1, the format before dump v2 (export/dump.ts): one gzipped JSON document, optionally after
 * `HRTH1` + 16-byte salt + 12-byte nonce + AES-GCM. Genotypes are a string table over a shared SNP
 * index, two characters per SNP per person. Read only: the app writes v2.
 */
private val V1_MAGIC = "HRTH1".toByteArray()

/** A v1 dump sealed with a passphrase. */
fun isSealedV1(bytes: ByteArray): Boolean = bytes.size > 5 && V1_MAGIC.indices.all { bytes[it] == V1_MAGIC[it] }

fun isV1(bytes: ByteArray): Boolean = isSealedV1(bytes) || (bytes.size > 2 && bytes[0] == 0x1f.toByte() && bytes[1] == 0x8b.toByte())

fun openV1(bytes: ByteArray, passphrase: String?): JSONObject {
    var gz = bytes
    if (isSealedV1(bytes)) {
        if (passphrase.isNullOrEmpty()) throw BackupException("native.encryptedTitle")
        val salt = bytes.copyOfRange(5, 21)
        val nonce = bytes.copyOfRange(21, 33)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(pbkdf2Sha256(passphrase, salt, 600_000), "AES"), GCMParameterSpec(128, nonce))
        gz = try {
            cipher.doFinal(bytes, 33, bytes.size - 33)
        } catch (_: AEADBadTagException) {
            throw BackupException("app.wrongPassphrase")
        }
    }
    val d = try {
        JSONObject(decode(gunzip(gz)))
    } catch (_: Exception) {
        throw BackupException("native.damaged")
    }
    if (d.optString("format") != "hearth-dump" || d.optInt("version") != 1) throw BackupException("native.notBackup")
    return d
}

/** personId → calls, from the shared SNP index (dump.ts `expandDump`); "--" is no call. */
fun expandDump(d: JSONObject): Map<String, List<Call>> {
    val idx = d.getJSONObject("snp_index")
    val rsids = idx.getJSONArray("rsids")
    val chromosomes = idx.getJSONArray("chromosomes")
    val positions = idx.getJSONArray("positions")
    val g = d.getJSONObject("genotypes")
    return g.keys().asSequence().associateWith { pid ->
        val s = g.getString(pid)
        (0 until rsids.length()).mapNotNull { i ->
            val a1 = s[i * 2].toString()
            val a2 = s[i * 2 + 1].toString()
            if (a1 == "-" && a2 == "-") null else Call(rsids.getString(i), chromosomes.getString(i), positions.getLong(i), a1, a2)
        }
    }
}

/**
 * A v1 dump merged in (restore.ts `restoreV1`): people not here yet with their genotypes, the
 * links, their health entries, the consents. People already here are left alone.
 */
fun restoreV1(repo: Repo, d: JSONObject): RestoreResult = repo.sql.transaction {
    val calls = expandDump(d)
    val existing = repo.listPersons().map { it.id }.toSet()
    val added = mutableSetOf<String>()
    val sourceFiles = d.optJSONArray("source_files")
    val persons = d.getJSONArray("persons")
    val healthBefore = repo.listHealthLog().size
    for (i in 0 until persons.length()) {
        val p = persons.getJSONObject(i)
        val id = p.getString("id")
        if (id in existing) continue
        added.add(id)
        repo.sql.exec(
            "INSERT INTO person(id,label,display_name,sex,birth_year,notes,created_at) VALUES (?,?,?,?,?,?,?)",
            listOf(id, p.optString("label"), p.optString("displayName"), p.optString("sex", "unknown"), if (p.isNull("birthYear")) null else p.optInt("birthYear"), p.optString("notes"), p.optString("createdAt")),
        )
        val sf = (0 until (sourceFiles?.length() ?: 0)).map { sourceFiles!!.getJSONObject(it) }.firstOrNull { it.optString("personId") == id }
        repo.importCalls(
            id,
            Provider.of(sf?.optString("provider") ?: "generic"),
            sf?.optString("build")?.ifEmpty { null } ?: "37",
            sf?.optString("sha256") ?: "",
            sf?.optString("originalName")?.ifEmpty { null } ?: "dump-v1",
            calls[id] ?: emptyList(),
        )
    }
    val rels = d.optJSONArray("relationships")
    for (i in 0 until (rels?.length() ?: 0)) rels!!.getJSONObject(i).let { repo.setParent(it.getString("parentId"), it.getString("childId")) }
    val journal = JSONObject()
        .put("health_log", org.json.JSONArray().apply {
            val h = d.optJSONArray("health_log")
            for (i in 0 until (h?.length() ?: 0)) h!!.getJSONObject(i).let { if (it.optString("person_id") in added) put(it) }
        })
        .put("consents", d.optJSONArray("consents") ?: org.json.JSONArray())
    // Health rows and consents go through the v2 merge, with its allowlists and defaults.
    restore(repo, Container(JSONObject().put("exported_at", d.optString("exported_at")), JSONObject(), journal))
    RestoreResult(added.size, repo.listHealthLog().size - healthBefore, added.size, 0, d.optString("exported_at"))
}
