package com.vela.client.deviceagent

import android.accessibilityservice.AccessibilityService
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
        Log.d("VelaAccessibility", "Service Connected")
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Accessibility events can be handled here if needed.
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
