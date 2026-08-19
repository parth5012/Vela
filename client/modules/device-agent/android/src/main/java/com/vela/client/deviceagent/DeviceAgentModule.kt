package com.vela.client.deviceagent

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.graphics.Bitmap
import android.view.accessibility.AccessibilityNodeInfo
import android.accessibilityservice.AccessibilityService
import java.io.File
import java.io.FileOutputStream

class DeviceAgentModule : Module() {

    companion object {
        val nodeMap = mutableMapOf<String, AccessibilityNodeInfo>()

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
    }
}
