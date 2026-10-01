package com.hearth.backup

import com.hearth.attachments.addAttachment
import com.hearth.data.Blobs
import com.hearth.data.HealthKind
import com.hearth.data.JdbcSql
import com.hearth.data.NewHealthEntry
import com.hearth.data.Repo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/** A backup place in memory: what a folder the picker granted looks like to the code above it. */
class MemoryDir(override val name: String = "mem", override val single: Boolean = false, override val versioned: Boolean = false) : Dir {
    val files = LinkedHashMap<String, ByteArray>()
    val dirs = LinkedHashMap<String, MemoryDir>()
    override fun names() = files.keys.toList() + dirs.keys
    override fun read(name: String) = files[name]
    override fun readHead(name: String, bytes: Int) = files[name]?.let { it.copyOf(minOf(bytes, it.size)) }
    override fun write(name: String, bytes: ByteArray) { files[name] = bytes }
    override fun remove(name: String) { files.remove(name); dirs.remove(name) }
    override fun subdir(name: String, create: Boolean): Dir? = dirs[name] ?: if (create) MemoryDir(name).also { dirs[name] = it } else null
}

/** Mirrors frontend/src/backup/naming.test.ts and the folder cycle the scheduler runs. */
class DirTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource(name)!!.readBytes()
    private fun newRepo() = Repo(JdbcSql(), Blobs(Files.createTempDirectory("blobs").toFile()))

    @Test fun `rotation plan and newer-copy rule`() {
        assertEquals(emptyList<Pair<String, String>>(), rotationPlan(emptyList(), "b"))
        assertEquals(listOf("b" to "b.1"), rotationPlan(listOf("b"), "b"))
        assertEquals(listOf("b.2" to "b.3", "b.1" to "b.2", "b" to "b.1"), rotationPlan(listOf("b", "b.1", "b.2", "b.3"), "b"))
        val h = org.json.JSONObject().put("device", "other").put("generation", 5)
        assertTrue(hasNewer(h, "me", null))
        assertFalse(hasNewer(h, "other", null))
        assertFalse(hasNewer(h, "me", Seen("other", 5)))
        assertTrue(hasNewer(h, "me", Seen("other", 4)))
        assertTrue(hasNewer(h, "me", Seen("third", 9)))
    }

    @Test fun `a folder backup round-trips with genomes and sealed documents beside it`() {
        val a = newRepo()
        restore(a, openContainer(fixture("genomes.hearth")))
        val e = a.addHealthEntry(NewHealthEntry("p-alex", "2026-01-01", "", HealthKind.LAB, "CBC", "", "", null, emptyList(), null, null, ""))
        val pdf = "%PDF-1.7 page".toByteArray() + ByteArray(16)
        addAttachment(a, e.id, "p-alex", pdf, "cbc.pdf", 0)

        val dir = MemoryDir()
        val pass = "secret"
        repeat(2) {
            val snap = buildSnapshot(a, "test", embed = false)
            mirrorGenomes(dir, a, snap.files, pass)
            writeSnapshot(dir, serialiseContainer(snap.container, pass), "https://hearth.example")
        }
        assertEquals(setOf(SNAPSHOT, "$SNAPSHOT.1", "README.txt", GENOMES_DIR), dir.names().toSet())
        assertEquals(1, mirrorAttachments(dir, a, pass))
        assertTrue(isSealedSidecar(dir.dirs[ATTACHMENTS_DIR]!!.files.values.single()))
        assertEquals("hearth-dump", currentHeader(dir)!!.getString("format"))

        val b = newRepo()
        val r = restoreBytes(b, dir.read(SNAPSHOT)!!, pass, loadGenome = genomeLoader(dir, pass))
        assertEquals(2, r.genomes)
        // The fixture's own attachment row (a-1) has no file anywhere: one pulled, one still missing.
        assertEquals(1 to 1, pullAttachments(dir, b, pass))
        assertEquals(a.genotypeCounts(), b.genotypeCounts())
        assertEquals(listOf(Repo.attachmentBlobName(com.hearth.genome.sha256Hex(pdf))), b.blobs.list().filter { it.startsWith("att-") })
    }

    @Test fun `a single file holds only the snapshot`() {
        val dir = MemoryDir(single = true)
        writeSnapshot(dir, byteArrayOf(1), "x")
        assertEquals(setOf(SNAPSHOT), dir.names().toSet())
    }
}
