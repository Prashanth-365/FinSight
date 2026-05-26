package com.finsight.app

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsMessage
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

@CapacitorPlugin(
    name = "SmsReader",
    permissions = [
        Permission(
            alias = "sms",
            strings = [
                Manifest.permission.READ_SMS,
                Manifest.permission.RECEIVE_SMS
            ]
        )
    ]
)
class SmsReaderPlugin : Plugin() {

    private var receiver: BroadcastReceiver? = null

    @PluginMethod
    fun checkPermissions(call: PluginCall) {
        val ret = JSObject()
        ret.put("sms", getPermissionState("sms").toString())
        call.resolve(ret)
    }

    @PluginMethod
    fun requestPermissions(call: PluginCall) {
        requestPermissionForAlias("sms", call, "smsPermissionCallback")
    }

    @PermissionCallback
    private fun smsPermissionCallback(call: PluginCall) {
        val ret = JSObject()
        ret.put("sms", getPermissionState("sms").toString())
        call.resolve(ret)
    }

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
                    if (date < sinceTs) break  // sorted DESC by date, so we can stop
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

    /** Start listening for new incoming SMS — emits "smsReceived" events. */
    @PluginMethod
    fun startListener(call: PluginCall) {
        if (getPermissionState("sms") != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("SMS permission not granted.")
            return
        }
        if (receiver != null) {
            call.resolve()
            return
        }
        val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
        receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
                val messages: Array<SmsMessage> = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                // Concatenate multipart messages by sender
                val grouped = messages.groupBy { it.originatingAddress ?: "" }
                for ((sender, parts) in grouped) {
                    val body = parts.joinToString(separator = "") { it.messageBody ?: "" }
                    val ts = parts.firstOrNull()?.timestampMillis ?: System.currentTimeMillis()
                    val payload = JSObject()
                    payload.put("sender", sender)
                    payload.put("body", body)
                    payload.put("date", ts)
                    notifyListeners("smsReceived", payload)
                }
            }
        }
        // Android 13+ requires the export flag
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
        call.resolve()
    }

    @PluginMethod
    fun stopListener(call: PluginCall) {
        receiver?.let {
            try { context.unregisterReceiver(it) } catch (_: Exception) {}
        }
        receiver = null
        call.resolve()
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        receiver?.let {
            try { context.unregisterReceiver(it) } catch (_: Exception) {}
        }
        receiver = null
    }
}
