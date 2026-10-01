package com.vela.client.deviceagent

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.graphics.Bitmap
import android.view.accessibility.AccessibilityNodeInfo
import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import rikka.shizuku.Shizuku

class DeviceAgentModule : Module() {

    companion object {
        val nodeMap = mutableMapOf<String, AccessibilityNodeInfo>()
        private const val SHIZUKU_PERMISSION_REQUEST_CODE = 4401
        // applicationId of the Shizuku manager app — NOT its Gradle namespace
        // 'moe.shizuku.manager' (manager/build.gradle: applicationId
        // "moe.shizuku.privileged.api"); PackageManager only resolves the former.
        private const val SHIZUKU_MANAGER_PACKAGE = "moe.shizuku.privileged.api"
        private const val BIND_TIMEOUT_SECONDS = 10L
        private const val PERMISSION_WAIT_SECONDS = 60L

        fun clearNodeMap() {
            for (node in nodeMap.values) {
                try {
                    node.recycle()
                } catch (e: Exception) {
                    // Ignore recycling exceptions
                }
            }
            nodeMap.clear()
        }
    }

    override fun definition() = ModuleDefinition {
        Name("DeviceAgentModule")

        AsyncFunction("getScreenTree") {
            val service = VelaAccessibilityService.instance
                ?: throw IllegalStateException("Accessibility service is not running or disabled")

            clearNodeMap()
            var nodeCounter = 0
            val sb = StringBuilder()

            fun traverse(node: AccessibilityNodeInfo?, depth: Int) {
                if (node == null) return

                val id = "@e$nodeCounter"
                nodeCounter++
                nodeMap[id] = AccessibilityNodeInfo.obtain(node)

                val rect = android.graphics.Rect()
                node.getBoundsInScreen(rect)

                val metrics = service.resources.displayMetrics
                val screenWidth = metrics.widthPixels
                val screenHeight = metrics.heightPixels

                val lPct = if (screenWidth > 0) (rect.left * 100 / screenWidth) else 0
                val tPct = if (screenHeight > 0) (rect.top * 100 / screenHeight) else 0
                val rPct = if (screenWidth > 0) (rect.right * 100 / screenWidth) else 0
                val bPct = if (screenHeight > 0) (rect.bottom * 100 / screenHeight) else 0

                val indent = "  ".repeat(depth)
                val text = node.text?.toString()?.replace("\n", " ") ?: ""
                val desc = node.contentDescription?.toString()?.replace("\n", " ") ?: ""
                val className = node.className?.toString()?.substringAfterLast('.') ?: "Node"

                val clickable = if (node.isClickable) "clickable " else ""
                val scrollable = if (node.isScrollable) "scrollable " else ""
                val focused = if (node.isFocused) "focused " else ""

                sb.append(indent)
                sb.append("[$id] $className: ")
                if (text.isNotEmpty()) sb.append("text=\"$text\" ")
                if (desc.isNotEmpty()) sb.append("desc=\"$desc\" ")
                sb.append("bounds=[$lPct,$tPct,$rPct,$bPct]px(${rect.left},${rect.top},${rect.right},${rect.bottom}) ")
                sb.append("$clickable$scrollable$focused\n")

                for (i in 0 until node.childCount) {
                    val child = node.getChild(i) ?: continue
                    traverse(child, depth + 1)
                    child.recycle()
                }
            }

            val rootNode = service.rootInActiveWindow
            if (rootNode != null) {
                traverse(rootNode, 0)
                rootNode.recycle()
            }

            sb.toString()
        }

        AsyncFunction("performAction") { action: String, target: String, value: String, ref: String ->
            val service = VelaAccessibilityService.instance
                ?: throw IllegalStateException("Accessibility service is not running or disabled")

            val node = nodeMap[target] ?: throw IllegalArgumentException("Target node not found: $target")

            when (action.lowercase()) {
                "click" -> {
                    var temp: AccessibilityNodeInfo? = node
                    var clicked = false
                    while (temp != null && !clicked) {
                        if (temp.isClickable) {
                            clicked = temp.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        }
                        temp = temp.parent
                    }
                    if (!clicked) {
                        clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                    }
                    clicked
                }
                "settext", "input", "type" -> {
                    val arguments = android.os.Bundle()
                    arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
                    node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
                }
                "scrollforward" -> {
                    node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)
                }
                "scrollbackward" -> {
                    node.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
                }
                "focus" -> {
                    node.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
                }
                else -> {
                    throw IllegalArgumentException("Unsupported action: $action")
                }
            }
        }

        AsyncFunction("getDeviceInfo") {
            val service = VelaAccessibilityService.instance
                ?: throw IllegalStateException("Accessibility service is not running or disabled")

            mapOf(
                "brand" to android.os.Build.BRAND,
                "model" to android.os.Build.MODEL,
                "sdkInt" to android.os.Build.VERSION.SDK_INT,
                "release" to android.os.Build.VERSION.RELEASE,
                "serviceRunning" to true
            )
        }

        AsyncFunction("takeScreenshot") { promise: expo.modules.kotlin.Promise ->
            val service = VelaAccessibilityService.instance
                ?: throw IllegalStateException("Accessibility service is not running or disabled")

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                val executor = java.util.concurrent.ForkJoinPool.commonPool()
                service.takeScreenshot(
                    android.view.Display.DEFAULT_DISPLAY,
                    executor,
                    object : AccessibilityService.TakeScreenshotCallback {
                        override fun onSuccess(screenshotResult: AccessibilityService.ScreenshotResult) {
                            try {
                                val hardwareBuffer = screenshotResult.hardwareBuffer
                                val colorSpace = screenshotResult.colorSpace
                                val bitmap = Bitmap.wrapHardwareBuffer(hardwareBuffer, colorSpace)
                                hardwareBuffer.close()

                                if (bitmap != null) {
                                    val softwareBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, false)
                                    val tempFile = File.createTempFile("screenshot_", ".jpg", service.cacheDir)
                                    FileOutputStream(tempFile).use { out ->
                                        softwareBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
                                    }
                                    softwareBitmap.recycle()
                                    bitmap.recycle()
                                    promise.resolve(tempFile.absolutePath)
                                } else {
                                    promise.reject("SCREENSHOT_ERROR", "Failed to wrap hardware buffer to Bitmap", null)
                                }
                            } catch (e: Exception) {
                                promise.reject("SCREENSHOT_ERROR", e.message ?: "Failed to save screenshot", e)
                            }
                        }

                        override fun onFailure(errorCode: Int) {
                            promise.reject("SCREENSHOT_ERROR", "Screenshot callback failed with error code: $errorCode", null)
                        }
                    }
                )
            } else {
                promise.reject("UNSUPPORTED_VERSION", "Screenshot requires Android R (API 30) or above", null)
            }
        }

        // --- Shizuku privileged bridge (allowlisted ops only) -------------

        AsyncFunction("getShizukuStatus") {
            val context = appContext.reactContext
            val installed = try {
                context?.packageManager?.getPackageInfo(SHIZUKU_MANAGER_PACKAGE, 0) != null
            } catch (e: Exception) {
                false
            }
            val serverRunning = shizukuAlive()
            val uid = try {
                if (serverRunning) Shizuku.getUid() else -1
            } catch (e: Throwable) {
                -1
            }
            mapOf(
                "installed" to installed,
                "serverRunning" to serverRunning,
                "permissionGranted" to shizukuGranted(),
                "uid" to uid
            )
        }

        AsyncFunction("requestShizukuPermission") {
            when {
                !shizukuAlive() -> "server_stopped"
                shizukuGranted() -> "already_granted"
                // No rationale screen in Vela: go straight to the prompt. The
                // shouldShowRequestPermissionRationale() mapping was inverted
                // (true = "denied once, can still prompt", not "permanently
                // denied") and blocked every re-request after the first deny.
                else -> {
                    val latch = CountDownLatch(1)
                    val result = AtomicReference("timeout")
                    val listener =
                        Shizuku.OnRequestPermissionResultListener { code, grantResult ->
                            if (code == SHIZUKU_PERMISSION_REQUEST_CODE) {
                                result.set(
                                    if (grantResult == PackageManager.PERMISSION_GRANTED) "granted"
                                    else "denied"
                                )
                                latch.countDown()
                            }
                        }
                    Shizuku.addRequestPermissionResultListener(listener)
                    try {
                        Shizuku.requestPermission(SHIZUKU_PERMISSION_REQUEST_CODE)
                        latch.await(PERMISSION_WAIT_SECONDS, TimeUnit.SECONDS)
                    } finally {
                        Shizuku.removeRequestPermissionResultListener(listener)
                    }
                    result.get()
                }
            }
        }

        AsyncFunction("runPrivilegedOp") { op: String, args: List<String> ->
            callShizukuOp(op, args)
        }
    }

    private fun shizukuAlive(): Boolean = try {
        Shizuku.pingBinder()
    } catch (e: Throwable) {
        false
    }

    private fun shizukuGranted(): Boolean = try {
        shizukuAlive() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    } catch (e: Throwable) {
        false
    }

    /**
     * Binds the Shizuku user service for one call and runs exactly one
     * allowlisted op. Returns "exit=<code>\n<output>" — readiness problems
     * come back as exit 125 (a confirmed non-execution), while a RemoteException
     * from execOp propagates so the executor can report it as indeterminate.
     */
    private fun callShizukuOp(op: String, args: List<String>): String {
        val context = appContext.reactContext
            ?: return "exit=125\nApp context unavailable"
        if (!shizukuAlive()) return "exit=125\nShizuku server is not running"
        if (!shizukuGranted()) return "exit=125\nShizuku permission not granted"
        val serverVersion = try {
            Shizuku.getVersion()
        } catch (e: Throwable) {
            0
        }
        if (serverVersion < 11) return "exit=125\nShizuku server too old (v11+ required)"

        val serviceArgs = Shizuku.UserServiceArgs(ComponentName(context, ShizukuOpsService::class.java))
            .daemon(false)
            .processNameSuffix("shizukuops")
            .tag("vela-shizuku-ops")
            .version(1)

        val connected = CountDownLatch(1)
        val binderRef = AtomicReference<IBinder?>(null)
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
                // Written before countDown(): visible after await() (happens-before).
                binderRef.set(service)
                connected.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName?) {
                // Per-call binding; a drop shows up as a dead binder below.
            }
        }

        try {
            Shizuku.bindUserService(serviceArgs, connection)
        } catch (e: Throwable) {
            return "exit=125\nFailed to start the Shizuku user service: ${e.message}"
        }
        try {
            if (!connected.await(BIND_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                return "exit=125\nTimed out starting the Shizuku user service"
            }
            val binder = binderRef.get()
                ?: return "exit=125\nShizuku user service connected without a binder"
            if (!binder.pingBinder()) return "exit=125\nShizuku user service binder is dead"
            val service = IShizukuOps.Stub.asInterface(binder)
            return service.execOp(op, args.toTypedArray())
        } finally {
            try {
                Shizuku.unbindUserService(serviceArgs, connection, true)
            } catch (e: Throwable) {
                // Best-effort: non-daemon services die with the app process.
            }
        }
    }
}
