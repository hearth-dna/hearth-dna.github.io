package com.hearth.data

import java.io.File

/**
 * The files kept next to the database (the web's OPFS file cache, `db.filePut` and friends):
 * gzipped genome originals and attached documents, by name. Names come from content hashes built
 * in code (`genome-<sha>.gz`), never from anything a user typed or a file carried.
 */
class Blobs(private val dir: File) {
    fun put(name: String, bytes: ByteArray) {
        dir.mkdirs()
        // Written beside and renamed, so a crash never leaves half a file under the real name.
        val tmp = File(dir, "$name.part")
        tmp.writeBytes(bytes)
        if (!tmp.renameTo(File(dir, name))) error("cannot store $name")
    }

    fun get(name: String): ByteArray? = File(dir, name).takeIf { it.isFile }?.readBytes()

    fun delete(name: String) {
        File(dir, name).delete()
    }

    fun list(): List<String> = dir.list()?.filterNot { it.endsWith(".part") }?.sorted() ?: emptyList()
}
