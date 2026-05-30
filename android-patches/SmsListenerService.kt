package com.finsight.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Telephony
import android.telephony.SmsMessage
import androidx.core.app.NotificationCompat

/**
 * A low-priority foreground service that keeps the SMS BroadcastReceiver alive
 * even when the app is killed from RAM. Posts a per-SMS notification with a
 * deep link to convert the SMS straight from the lock screen.
 */
class SmsListenerService : Service() {
    private var receiver: BroadcastReceiver? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels(this)
        startForeground(NOTIF_ONGOING_ID, buildOngoingNotification())

        receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
                val messages: Array<SmsMessage> = Telephony.Sms.Intents.getMessagesFromIntent(intent)
                val grouped = messages.groupBy { it.originatingAddress ?: "" }
                for ((sender, parts) in grouped) {
                    val body = parts.joinToString(separator = "") { it.messageBody ?: "" }
                    val ts = parts.firstOrNull()?.timestampMillis ?: System.currentTimeMillis()
                    if (looksLikeTransactionSms(body)) {
                        postTxnNotification(applicationContext, sender, body, ts)
                    }
                }
            }
        }
        val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(receiver, filter)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY  // restart if killed
    }

    override fun onDestroy() {
        super.onDestroy()
        try { receiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        receiver = null
    }

    private fun buildOngoingNotification(): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ONGOING_ID)
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("FinSight is watching bank SMS")
            .setContentText("Tap to open the app")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .setShowWhen(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(pi)
            .build()
    }

    companion object {
        const val CHANNEL_ONGOING_ID = "fs.listener.ongoing"
        const val CHANNEL_ALERTS_ID = "fs.alerts"
        const val NOTIF_ONGOING_ID = 1001

        fun createChannels(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CHANNEL_ONGOING_ID) == null) {
                nm.createNotificationChannel(NotificationChannel(
                    CHANNEL_ONGOING_ID,
                    "Listener status",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    description = "Persistent low-priority icon while FinSight is watching for bank SMS"
                    setShowBadge(false)
                })
            }
            if (nm.getNotificationChannel(CHANNEL_ALERTS_ID) == null) {
                nm.createNotificationChannel(NotificationChannel(
                    CHANNEL_ALERTS_ID,
                    "Transaction alerts",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "One notification per detected bank/UPI SMS"
                })
            }
        }

        /** Decide whether an SMS body is likely a transaction. Kept simple here;
         *  the JS-side parser will run again when the user opens it.            */
        fun looksLikeTransactionSms(body: String): Boolean {
            val b = body.lowercase()
            val hasAmount = Regex("(rs\\.?|inr|₹)\\s*[0-9,]+", RegexOption.IGNORE_CASE).containsMatchIn(body)
            if (!hasAmount) return false
            val verbs = Regex("\\b(debited|credited|spent|paid|received|transferred|withdrawn|deposit|purchase|refund|sent|charged)\\b", RegexOption.IGNORE_CASE)
            if (!verbs.containsMatchIn(body)) return false
            val spam = Regex("(congratulations|pre-?approved|voucher|coupon|t&c|claim|hurry|offer|lifetime free|reward points|sign up|verify now|won |lucky|eligibility|eligible to)", RegexOption.IGNORE_CASE)
            if (spam.containsMatchIn(body)) return false
            return true
        }

        fun postTxnNotification(ctx: Context, sender: String, body: String, ts: Long) {
            val nm = ctx.getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            // Deep-link to the app with the raw SMS payload; JS reads this and
            // inserts the row + opens the converter.
            val deepLink = Uri.parse(
                "com.finsight.app://sms-incoming" +
                    "?sender=" + Uri.encode(sender) +
                    "&body=" + Uri.encode(body) +
                    "&ts=" + ts
            )
            val intent = Intent(Intent.ACTION_VIEW, deepLink).apply {
                setPackage(ctx.packageName)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            val notifId = (ts and 0x7FFFFFFF).toInt()
            val pi = PendingIntent.getActivity(
                ctx, notifId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val short = if (body.length > 120) body.substring(0, 117) + "…" else body
            val notif = NotificationCompat.Builder(ctx, CHANNEL_ALERTS_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle("Bank SMS — tap to log")
                .setContentText(short)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
            nm.notify(notifId, notif)
        }
    }
}
