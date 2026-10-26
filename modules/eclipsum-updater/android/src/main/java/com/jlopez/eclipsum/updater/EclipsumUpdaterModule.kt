package com.jlopez.eclipsum.updater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.provider.Settings
import androidx.core.net.toUri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Actualización dentro de la app: descarga el APK, comprueba su sha256 y lo instala con PackageInstaller.
 * Android solo instala encima si la firma coincide, pero la release va firmada con el debug.keystore
 * público de RN: la confianza real está en la URL y el sha256 que publica Remote Config.
 */
class EclipsumUpdaterModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw CodedException("ERR_NO_CONTEXT", "Sin contexto de Android", null)

  override fun definition() = ModuleDefinition {
    Name("EclipsumUpdater")
    Events("onProgress", "onStatus")

    OnCreate { instance = WeakReference(this@EclipsumUpdaterModule) }
    OnDestroy { if (instance?.get() === this@EclipsumUpdaterModule) instance = null }

    Function("canInstall") {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.O || ctx.packageManager.canRequestPackageInstalls()
    }

    // «Instalar apps desconocidas» de esta app: Android lo pide una sola vez
    Function("openInstallSettings") {
      appContext.throwingActivity.startActivity(
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:${ctx.packageName}".toUri()),
      )
    }

    // Resuelve al entregar el APK a Android; el resultado final llega por onStatus (o la app se reinicia)
    AsyncFunction("install") Coroutine { url: String, sha256: String ->
      try {
        withContext(Dispatchers.IO) {
          val apk = download(url, sha256.lowercase())
          commit(apk)
          apk.delete() // la sesión ya tiene su copia
        }
      } catch (e: CancellationException) {
        throw e
      } catch (e: IOException) {
        throw CodedException("ERR_DOWNLOAD", e.message, e)
      } catch (e: Exception) {
        throw CodedException("ERR_PREPARE", e.javaClass.simpleName, e)
      }
    }
  }

  /** Resultado de la sesión de PackageInstaller (lo reenvía [UpdateReceiver]). */
  internal fun onInstallStatus(status: Int, message: String?) {
    if (status == PackageInstaller.STATUS_SUCCESS) return // la app se sustituye
    val error = when (status) {
      // Cancelada en el diálogo o rechazada por el verificador del sistema (p. ej. Play Protect)
      PackageInstaller.STATUS_FAILURE_ABORTED -> "aborted"
      PackageInstaller.STATUS_FAILURE_CONFLICT, PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> "conflict"
      else -> "failed"
    }
    sendEvent("onStatus", mapOf("error" to error, "detail" to (message ?: "$status")))
  }

  private fun download(url: String, sha256: String): File {
    val dir = File(ctx.cacheDir, "updates").apply { deleteRecursively(); mkdirs() }
    val file = File(dir, "eclipsum.apk")
    val md = MessageDigest.getInstance("SHA-256")
    val conn = URL(url).openConnection() as HttpURLConnection
    conn.connectTimeout = 15_000
    conn.readTimeout = 30_000
    try {
      if (conn.responseCode !in 200..299) throw IOException("HTTP ${conn.responseCode}")
      val total = conn.contentLengthLong
      conn.inputStream.use { input ->
        file.outputStream().use { out ->
          val buf = ByteArray(64 * 1024)
          var done = 0L
          var sent = -1
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            md.update(buf, 0, n)
            done += n
            // Un evento por punto porcentual: por bloque serían cientos de cruces al hilo de JS
            val percent = if (total > 0) (done * 100 / total).toInt().coerceAtMost(100) else -1
            if (percent != sent) {
              sent = percent
              sendEvent("onProgress", mapOf("percent" to percent))
            }
          }
        }
      }
    } finally {
      conn.disconnect()
    }
    if (md.digest().joinToString("") { "%02x".format(it) } != sha256) {
      file.delete()
      throw IOException("sha256 distinto")
    }
    return file
  }

  private fun commit(apk: File) {
    val installer = ctx.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
      setAppPackageName(ctx.packageName)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }
    val id = installer.createSession(params)
    try {
      installer.openSession(id).use { session ->
        apk.inputStream().use { input ->
          session.openWrite("eclipsum.apk", 0, apk.length()).use { out ->
            input.copyTo(out)
            session.fsync(out)
          }
        }
        val intent = Intent(ctx, UpdateReceiver::class.java)
        // Mutable: el instalador añade al intent el estado y, si hace falta, la pantalla de confirmación
        val pending = PendingIntent.getBroadcast(ctx, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
        session.commit(pending.intentSender)
      }
    } catch (e: Exception) {
      // Si no, cada reintento con poco espacio deja otra sesión a medias ocupando lo que ya escribió
      installer.abandonSession(id)
      throw e
    }
  }

  internal companion object {
    @Volatile
    var instance: WeakReference<EclipsumUpdaterModule>? = null
  }
}
