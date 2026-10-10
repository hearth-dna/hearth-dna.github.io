package com.hearth.backup

import com.hearth.data.Blobs
import com.hearth.data.JdbcSql
import com.hearth.data.Repo
import com.hearth.genome.gunzip
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Loading what was picked, in one go (scheduler.ts `loadFiles`): a folder snapshot that arrives
 * without the genome files it keeps beside itself, and those files, in any order and form.
 */
class LoadTest {
    private fun fixture(name: String) = javaClass.classLoader!!.getResource(name)!!.readBytes()
    private fun newRepo() = Repo(JdbcSql(), Blobs(Files.createTempDirectory("blobs").toFile()))

    /** A phone's view of a folder backup of the genomes fixture: the snapshot alone, and the genome files by name. */
    private class Folder(val snapshot: NamedBytes, val genomes: List<NamedBytes>, val names: Map<String, String>)

    private fun folder(): Folder {
        val a = newRepo().also { restore(it, openContainer(fixture("genomes.hearth"))) }
        val s = buildSnapshot(a, "test", embed = false)
        val files = s.files.map { NamedBytes(it.path.substringAfterLast('/'), a.blobs.get(it.blob)!!) }
        val names = a.listPersons().associate { it.id to it.displayName }
        return Folder(NamedBytes("hearth-snapshot.hearth", serialiseContainer(s.container)), files, names)
    }

    @Test fun `a folder snapshot picked alone names who still needs a genome and keeps asking`() {
        val f = folder()
        val repo = newRepo()
        val r = loadFiles(repo, listOf(f.snapshot), null)
        assertEquals(LoadResult(1, "hearth-snapshot.hearth", 2, 0, r.exportedAt, emptyList(), emptyList(), emptyList(), emptyList()), r)
        assertEquals(f.names.values.toSet(), repo.elsewhereNames().map { it.name }.toSet())
        assertEquals(2, repo.elsewhereNames().size)
        assertTrue(repo.genotypeCounts().isEmpty())
        // Picking the genome files later, on their own, finishes the job.
        val later = loadFiles(repo, f.genomes, null)
        assertEquals(0, later.dumps)
        assertEquals(2, later.genomes)
        assertEquals(2, later.dna.size)
        assertEquals(emptyList<String>(), later.unused)
        assertEquals(2, repo.genotypeCounts().size)
        assertTrue(repo.elsewhereNames().isEmpty())
    }

    @Test fun `a snapshot and its genome files picked together load in one go, whatever the order`() {
        val f = folder()
        val repo = newRepo()
        val r = loadFiles(repo, f.genomes.reversed() + f.snapshot, null)
        assertEquals(2, r.genomes)
        assertEquals(2, r.people)
        assertEquals(f.names.values.toSet(), r.dna.map { it.second }.toSet())
        assertEquals(2, repo.genotypeCounts().size)
    }

    @Test fun `knows a genome handed over decompressed by the text inside`() {
        val f = folder()
        val repo = newRepo()
        val plain = f.genomes.map { NamedBytes(it.name.removeSuffix(".gz"), gunzip(it.bytes)) }
        val r = loadFiles(repo, plain + f.snapshot, null)
        assertEquals(2, r.genomes)
        assertEquals(emptyList<String>(), r.unused)
        // Originals are kept so this phone's own backups ship them too.
        assertTrue(repo.blobs.list().any { it.startsWith("genome-") })
    }

    @Test fun `opens a zipped backup folder, taking the snapshot and the genomes and leaving the rest`() {
        val f = folder()
        val zip = ByteArrayOutputStream().also { out ->
            ZipOutputStream(out).use { z ->
                fun add(name: String, bytes: ByteArray) { z.putNextEntry(ZipEntry(name)); z.write(bytes); z.closeEntry() }
                add("Hearth/hearth.hearth", f.snapshot.bytes)
                add("Hearth/hearth.hearth.1", f.snapshot.bytes)
                add("Hearth/README.txt", "hi".toByteArray())
                add("__MACOSX/Hearth/._hearth.hearth", f.snapshot.bytes)
                for (g in f.genomes) add("Hearth/genomes/${g.name}", g.bytes)
            }
        }.toByteArray()
        val repo = newRepo()
        val r = loadFiles(repo, listOf(NamedBytes("Hearth.zip", zip)), null)
        assertEquals(1, r.dumps)
        assertEquals(2, r.genomes)
        assertEquals("hearth.hearth", r.name)
        assertEquals(emptyList<String>(), r.unused)
    }

    @Test fun `reports files that are nobody's DNA and sealed files the passphrase did not open`() {
        val f = folder()
        val repo = newRepo()
        val r = loadFiles(repo, listOf(f.snapshot, NamedBytes("notes.txt", "hello".toByteArray())), null)
        assertEquals(emptyList<String>(), r.unused.filter { it != "notes.txt" })
        assertEquals(listOf("notes.txt"), r.unused)
        assertFalse(r.unopened.isNotEmpty())
        val sealed = Sealer("right").seal(f.genomes[0].bytes)
        val s = loadFiles(repo, listOf(NamedBytes("x.gz", sealed)), "wrong")
        assertEquals(listOf("x.gz"), s.unopened)
    }

    @Test fun `a single file that is not recognisably a backup gets the restore's own message`() {
        val repo = newRepo()
        try {
            loadFiles(repo, listOf(NamedBytes("x", "not a backup".toByteArray())), null)
            throw AssertionError("should have refused")
        } catch (e: BackupException) {
            assertEquals("native.notBackup", e.key)
        }
    }
}
