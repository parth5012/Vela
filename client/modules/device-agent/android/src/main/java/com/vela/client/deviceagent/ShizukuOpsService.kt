package com.vela.client.deviceagent

import android.content.Context
import android.os.RemoteException
import androidx.annotation.Keep
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Runs inside the Shizuku user service process as shell (uid 2000) or root
 * (uid 0). This class is the trust boundary of the whole integration: every
 * op is matched against a fixed allowlist and every argument is pattern-
 * validated before any binary runs. Commands are executed directly with
 * absolute paths and argument arrays — never through a shell — so no argument
 * can inject additional syntax.
 *
 * Result contract (consumed by client/utils/deviceActionExecutor.ts):
 *   "exit=<code>\n<output>" always — 126 rejected, 127 not started, 124
 *   timeout here, plus 125 not-ready from DeviceAgentModule — so a
 *   pre-dispatch rejection is a plain result, never an exception that could
 *   be reported as "indeterminate".
 */
class ShizukuOpsService : IShizukuOps.Stub {

    constructor() : super()

    /** Shizuku v13 prefers the Context constructor; keep it from R8. */
    @Keep
    @Suppress("unused")
    constructor(context: Context) : super()

    override fun destroy() {
        // Shizuku never kills user service processes itself; the documented
        // teardown is cleanup + exit (Shizuku-API README, "Stop the User Service").
        System.exit(0)
    }

    @Throws(RemoteException::class)
    override fun execOp(op: String, args: Array<String>): String {
        val command = try {
            buildCommand(op, args)
        } catch (e: SecurityException) {
            return "exit=$REJECTED_EXIT\n${e.message}"
        }
        return try {
            runCommand(command)
        } catch (e: Exception) {
            "exit=$NOT_STARTED_EXIT\nFailed to start ${command.firstOrNull()}: ${e.message}"
        }
    }

    companion object {
        private const val REJECTED_EXIT = 126
        private const val NOT_STARTED_EXIT = 127
        private const val TIMEOUT_EXIT = 124

        private const val MAX_OUTPUT_BYTES = 128 * 1024
        private const val COMMAND_TIMEOUT_SECONDS = 15L

        private val PACKAGE_ID = Regex("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)+")
        private val NAME = Regex("[A-Za-z0-9_.]+")
        private val SETTING_NAMESPACES = setOf("system", "secure", "global")
        private const val MAX_SETTING_VALUE_LENGTH = 4096

        private const val PM = "/system/bin/pm"
        private const val AM = "/system/bin/am"
        private const val SETTINGS = "/system/bin/settings"

        internal fun buildCommand(op: String, args: Array<String>): List<String> {
            fun pkg(index: Int): String =
                args.getOrNull(index)?.takeIf { PACKAGE_ID.matches(it) }
                    ?: throw SecurityException("invalid package name argument")

            fun perm(index: Int): String =
                args.getOrNull(index)?.takeIf { NAME.matches(it) }
                    ?: throw SecurityException("invalid permission name argument")

            return when (op) {
                "pm_grant" -> listOf(PM, "grant", pkg(0), perm(1))
                "pm_revoke" -> listOf(PM, "revoke", pkg(0), perm(1))

                "settings_put" -> {
                    val ns = args.getOrNull(0)?.takeIf { it in SETTING_NAMESPACES }
                        ?: throw SecurityException("namespace must be one of system|secure|global")
                    val key = args.getOrNull(1)?.takeIf { NAME.matches(it) }
                        ?: throw SecurityException("invalid settings key")
                    val value = args.getOrNull(2)
                        ?: throw SecurityException("missing settings value")
                    if (value.length > MAX_SETTING_VALUE_LENGTH) {
                        throw SecurityException("settings value too long")
                    }
                    listOf(SETTINGS, "put", ns, key, value)
                }

                "force_stop" -> listOf(AM, "force-stop", pkg(0))

                "set_enabled" -> {
                    val target = pkg(0)
                    when (args.getOrNull(1)) {
                        "enabled" -> listOf(PM, "enable", target)
                        "disabled" -> listOf(PM, "disable", target)
                        else -> throw SecurityException("state must be enabled or disabled")
                    }
                }

                "clear_data" -> listOf(PM, "clear", pkg(0))

                "install" -> {
                    val path = args.getOrNull(0)
                        ?.takeIf { it.startsWith("/") && it.endsWith(".apk") }
                        ?: throw SecurityException("apk path must be an absolute .apk path")
                    listOf(PM, "install", "-r", path)
                }

                "uninstall" -> listOf(PM, "uninstall", pkg(0))

                else -> throw SecurityException("op not on allowlist: $op")
            }
        }

        private fun runCommand(command: List<String>): String {
            val process = ProcessBuilder(command).redirectErrorStream(true).start()
            val buffer = ByteArrayOutputStream()
            val collector = thread(name = "shizuku-ops-out") {
                val chunk = ByteArray(8192)
                var truncated = false
                process.inputStream.use { input ->
                    while (true) {
                        val n = input.read(chunk)
                        if (n <= 0) break
                        val remaining = MAX_OUTPUT_BYTES - buffer.size()
                        if (n >= remaining) {
                            buffer.write(chunk, 0, remaining)
                            truncated = true
                            break
                        }
                        buffer.write(chunk, 0, n)
                    }
                }
                if (truncated) buffer.write("\n[output truncated]".toByteArray())
            }

            if (!process.waitFor(COMMAND_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly()
                collector.join(2000)
                return "exit=$TIMEOUT_EXIT\nCommand timed out after ${COMMAND_TIMEOUT_SECONDS}s: ${command.first()}"
            }
            collector.join(2000)
            return "exit=${process.exitValue()}\n${buffer.toString("UTF-8")}"
        }
    }
}
