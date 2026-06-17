package com.finsight.app

import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream

/**
 * Writes a text file into the device's PUBLIC Downloads folder so it shows up
 * in the Downloads app and "Recent files" every time.
 *
 *  • Android 10+ (API 29+): uses the MediaStore Downloads collection — no
 *    storage permission required, and the file is indexed immediately.
 *  • Android 9 and below: writes straight to the public Downloads directory
 *    (relies on WRITE_EXTERNAL_STORAGE, declared with maxSdkVersion=28).
 */
@CapacitorPlugin(name = "FileExport")
class FileExportPlugin : Plugin() {

	@PluginMethod
	fun saveToDownloads(call: PluginCall) {
		val fileName = call.getString("fileName")
		val data = call.getString("data")
		val subDir = call.getString("subDir") ?: ""
		val mime = call.getString("mimeType") ?: "application/json"

		if (fileName.isNullOrBlank() || data == null) {
			call.reject("fileName and data are required.")
			return
		}

		try {
			val savedPath: String = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
				saveViaMediaStore(fileName, data, subDir, mime)
			} else {
				saveLegacy(fileName, data, subDir)
			}
			val ret = JSObject()
			ret.put("uri", savedPath)
			call.resolve(ret)
		} catch (e: Exception) {
			call.reject("Save failed: " + (e.message ?: "unknown error"))
		}
	}

	/** Android 10+ : insert into the MediaStore Downloads collection. */
	private fun saveViaMediaStore(fileName: String, data: String, subDir: String, mime: String): String {
		val relPath = if (subDir.isNotEmpty())
			Environment.DIRECTORY_DOWNLOADS + "/" + subDir
		else
			Environment.DIRECTORY_DOWNLOADS

		val values = ContentValues().apply {
			put(MediaStore.Downloads.DISPLAY_NAME, fileName)
			put(MediaStore.Downloads.MIME_TYPE, mime)
			put(MediaStore.Downloads.RELATIVE_PATH, relPath)
			put(MediaStore.Downloads.IS_PENDING, 1)
		}

		val resolver = context.contentResolver
		val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
		val itemUri = resolver.insert(collection, values)
			?: throw Exception("Could not create the file in Downloads.")

		resolver.openOutputStream(itemUri)?.use { out ->
			out.write(data.toByteArray(Charsets.UTF_8))
		} ?: throw Exception("Could not open the output stream.")

		values.clear()
		values.put(MediaStore.Downloads.IS_PENDING, 0)
		resolver.update(itemUri, values, null, null)

		return relPath + "/" + fileName
	}

	/** Android 9 and below : direct write to the public Downloads directory. */
	private fun saveLegacy(fileName: String, data: String, subDir: String): String {
		val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
		val dir = if (subDir.isNotEmpty()) File(downloads, subDir) else downloads
		if (!dir.exists()) dir.mkdirs()
		val file = File(dir, fileName)
		FileOutputStream(file).use { it.write(data.toByteArray(Charsets.UTF_8)) }
		return file.absolutePath
	}
}
