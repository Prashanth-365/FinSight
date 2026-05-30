package com.finsight.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission

@CapacitorPlugin(
    name = "SmsReader",
    permissions = [
        Permission(
            alias = "sms",
            strings = [
                Manifest.permission.READ_SMS,
                Manifest.permission.RECEIVE_SMS
            ]
        ),
        Permission(
            alias = "notifications",
            strings = [
                "android.permission.POST_NOTIFICATIONS"
            ]
        )
    ]
)
class SmsReaderPlugin : Plugin() {

    /**
     * Read the existing SMS inbox. Options:
     *   senderFilter: array of strings (substring match on sender id, case-insensitive)
     *   bodyFilter:   array of strings (substring match on body, case-insensitive)
     *   sinceTs:      epoch millis, only messages after this date
     *   limit:        max rows (default 2000)
     */
    @PluginMethod
    fun readInbox(call: PluginCall) {
        if (getPermissionState("sms") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("SMS read permission not granted.")
            return
        }
        val senderFilter = call.getArray("senderFilter")?.toList<String>().orEmpty()
            .map { it.lowercase() }
        val bodyFilter = call.getArray("bodyFilter")?.toList<String>().orEmpty()
            .map { it.lowercase() }
        val sinceTs = call.getLong("sinceTs") ?: 0L
        val limit = call.getInt("limit") ?: 2000

        val uri: Uri = Telephony.Sms.Inbox.CONTENT_URI
        val projection = arrayOf(
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE
        )
        val sort = Telephony.Sms.DATE + " DESC"

        val results = JSArray()
        try {
            context.contentResolver.query(uri, projection, null, null, sort).use { cursor ->
                if (cursor == null) {
                    val ret = JSObject()
                    ret.put("messages", results)
                    call.resolve(ret)
                    return
                }
                val idIdx = cursor.getColumnIndexOrThrow(Telephony.Sms._ID)
                val addrIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
                val bodyIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
                val dateIdx = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)

                var count = 0
                while (cursor.moveToNext() && count < limit) {
                    val date = cursor.getLong(dateIdx)
                    if (date < sinceTs) break
                    val addr = cursor.getString(addrIdx) ?: ""
                    val body = cursor.getString(bodyIdx) ?: ""
                    val addrLower = addr.lowercase()
                    val bodyLower = body.lowercase()
                    if (senderFilter.isNotEmpty() && senderFilter.none { addrLower.contains(it) }) continue
                    if (bodyFilter.isNotEmpty() && bodyFilter.none { bodyLower.contains(it) }) continue
                    val msg = JSObject()
                    msg.put("id", cursor.getLong(idIdx))
                    msg.put("sender", addr)
                    msg.put("body", body)
                    msg.put("date", date)
                    results.put(msg)
                    count++
                }
            }
            val ret = JSObject()
            ret.put("messages", results)
            ret.put("count", results.length())
            call.resolve(ret)
        } catch (e: Exception) {
            call.reject("Failed to read SMS inbox: ${e.message}", e)
        }
    }

    /**
     * Start a foreground service that listens for incoming SMS and posts a
     * notification for each likely transactional one. Power-efficient because
     * Android only wakes us when an SMS arrives.
     */
    @PluginMethod
    fun startListener(call: PluginCall) {
        if (getPermissionState("sms") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("SMS permission not granted.")
            return
        }
        val ctx = context
        val intent = Intent(ctx, SmsListenerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(intent)
        } else {
            ctx.startService(intent)
        }
        call.resolve()
    }

    @PluginMethod
    fun stopListener(call: PluginCall) {
        val ctx = context
        ctx.stopService(Intent(ctx, SmsListenerService::class.java))
        call.resolve()
    }
}
