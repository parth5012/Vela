package com.vela.client.deviceagent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.util.Log

class VelaAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: VelaAccessibilityService? = null
            private set
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        // Configure capabilities: without CAN_RETRIEVE_WINDOW_CONTENT (granted via
        // serviceInfo flags), rootInActiveWindow stays null and getScreenTree() returns "".
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPES_ALL_MASK
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            flags = AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                    AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
            notificationTimeout = 100
        }
        Log.d("VelaAccessibility", "Service Connected")
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Accessibility events can be handled here if needed.
    }

    override fun onKeyEvent(event: android.view.KeyEvent?): Boolean {
        if (event?.action == android.view.KeyEvent.ACTION_DOWN) {
            val keyCode = event.keyCode
            if (keyCode == android.view.KeyEvent.KEYCODE_VOLUME_UP || keyCode == android.view.KeyEvent.KEYCODE_VOLUME_DOWN) {
                DeviceAgentModule.emitVolumeKeyEvent()
            }
        }
        return super.onKeyEvent(event)
    }

    override fun onInterrupt() {
        Log.d("VelaAccessibility", "Service Interrupted")
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        DeviceAgentModule.clearNodeMap()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        DeviceAgentModule.clearNodeMap()
        super.onDestroy()
    }
}
