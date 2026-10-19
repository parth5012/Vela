"""Simulated Android Device State Machine for Phone Automation Evaluations.

Adversarial Hardening Rules:
- Hardware Safety Guard: Under no circumstances should eval tests issue commands
  to a physical Android device. All phone evals must execute against a simulated
  device state machine or fail closed if adb devices returns an unauthorized
  physical device serial.
- No physical side effects or real adb subprocess calls permitted during evaluations.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Any, Optional


class PhysicalDeviceDetectedError(RuntimeError):
    """Raised when physical Android device hardware is detected during evals."""
    pass


def assert_hardware_safety_guard() -> None:
    """Enforces that no unauthorized physical device can receive commands.
    
    If adb is installed and physical devices are connected, raises PhysicalDeviceDetectedError
    unless explicit simulation override is active. Under eval execution, physical ADB is prohibited.
    """
    if os.getenv("VELA_ALLOW_PHYSICAL_DEVICE_EVALS", "0") == "1":
        return

    adb_bin = shutil.which("adb")
    if adb_bin:
        try:
            out = subprocess.check_output([adb_bin, "devices"], timeout=1.0, text=True, stderr=subprocess.DEVNULL)
            lines = [line.strip() for line in out.strip().splitlines()[1:] if line.strip()]
            physical_devices = [l for l in lines if not l.startswith("emulator-") and "\tdevice" in l]
            if physical_devices:
                raise PhysicalDeviceDetectedError(
                    f"Physical Android device detected on ADB: {physical_devices}. "
                    "Evaluation halted to prevent accidental execution on physical hardware."
                )
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            pass


@dataclass
class SimulatedDeviceState:
    """Simulated in-memory device state for evaluating phone automation actions."""

    current_app: str = "com.android.launcher3"
    volume: int = 50
    screen_hierarchy: list[dict[str, Any]] = field(default_factory=list)
    permissions: dict[str, set[str]] = field(default_factory=dict)
    settings: dict[str, dict[str, str]] = field(default_factory=lambda: {
        "system": {"font_scale": "1.0", "screen_off_timeout": "30000"},
        "secure": {"enabled_accessibility_services": "", "mock_location": "0"},
        "global": {"airplane_mode_on": "0", "auto_time": "1"},
    })
    shizuku_ready: bool = True
    installed_apps: set[str] = field(default_factory=lambda: {
        "com.android.launcher3",
        "com.google.android.youtube",
        "com.spotify.music",
        "com.android.settings",
        "com.google.android.apps.messaging",
        "com.google.android.dialer",
        "com.android.chrome",
    })
    running_apps: set[str] = field(default_factory=lambda: {
        "com.android.launcher3",
        "com.android.settings",
    })
    history: list[dict[str, Any]] = field(default_factory=list)

    def execute_action(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Execute a tool invocation deterministically against simulated state machine."""
        assert_hardware_safety_guard()
        self.history.append({"tool": tool_name, "args": args})

        if tool_name == "device_open_app":
            app = args.get("app_name", "")
            self.current_app = app
            self.running_apps.add(app)
            return {"status": "success", "result": f"App {app} opened"}

        elif tool_name == "device_tap":
            target = args.get("target", "")
            return {"status": "success", "result": f"Tapped {target}"}

        elif tool_name == "device_type":
            target = args.get("target", "")
            val = args.get("value", "")
            return {"status": "success", "result": f"Typed '{val}' into {target}"}

        elif tool_name == "device_scroll":
            direction = args.get("direction", "down")
            return {"status": "success", "result": f"Scrolled {direction}"}

        elif tool_name == "device_swipe":
            direction = args.get("direction", "up")
            return {"status": "success", "result": f"Swiped {direction}"}

        elif tool_name == "device_press_key":
            key = args.get("key_name", "")
            if key == "HOME":
                self.current_app = "com.android.launcher3"
            return {"status": "success", "result": f"Key {key} pressed"}

        elif tool_name == "device_set_volume":
            lvl = int(args.get("level", 50))
            lvl = max(0, min(100, lvl))
            self.volume = lvl
            return {"status": "success", "result": f"Volume set to {lvl}"}

        elif tool_name == "device_screen_read":
            return {"status": "success", "result": json.dumps({"current_app": self.current_app, "nodes": self.screen_hierarchy})}

        elif tool_name == "device_screenshot":
            return {"status": "success", "result": "data:image/png;base64,mock_screenshot_data"}

        elif tool_name == "device_info":
            return {
                "status": "success",
                "result": {
                    "battery": 88,
                    "model": "Simulated Pixel 9 Pro",
                    "os_version": "Android 15 (Vanilla Ice Cream)",
                    "screen_width": 1080,
                    "screen_height": 2400,
                    "current_app": self.current_app,
                    "volume": self.volume,
                },
            }

        elif tool_name == "device_app_permission_grant":
            if not self.shizuku_ready:
                return {"status": "error", "result": "Shizuku server not running or permission denied"}
            pkg = args.get("package", "")
            perm = args.get("permission", "")
            if pkg not in self.permissions:
                self.permissions[pkg] = set()
            self.permissions[pkg].add(perm)
            return {"status": "success", "result": f"Granted {perm} to {pkg}"}

        elif tool_name == "device_app_permission_revoke":
            if not self.shizuku_ready:
                return {"status": "error", "result": "Shizuku server not running or permission denied"}
            pkg = args.get("package", "")
            perm = args.get("permission", "")
            if pkg in self.permissions:
                self.permissions[pkg].discard(perm)
            return {"status": "success", "result": f"Revoked {perm} from {pkg}"}

        elif tool_name == "device_setting_put":
            if not self.shizuku_ready:
                return {"status": "error", "result": "Shizuku server not running or permission denied"}
            ns = args.get("namespace", "system")
            key = args.get("key", "")
            val = str(args.get("value", ""))
            if ns not in self.settings:
                self.settings[ns] = {}
            self.settings[ns][key] = val
            return {"status": "success", "result": f"Set {ns}/{key} = {val}"}

        elif tool_name == "device_app_force_stop":
            if not self.shizuku_ready:
                return {"status": "error", "result": "Shizuku server not running or permission denied"}
            pkg = args.get("package", "")
            self.running_apps.discard(pkg)
            if self.current_app == pkg:
                self.current_app = "com.android.launcher3"
            return {"status": "success", "result": f"Force stopped {pkg}"}

        elif tool_name == "device_app_set_state":
            if not self.shizuku_ready:
                return {"status": "error", "result": "Shizuku server not running or permission denied"}
            pkg = args.get("package", "")
            state = args.get("state", "enabled")
            return {"status": "success", "result": f"Set {pkg} to {state}"}

        elif tool_name == "device_app_clear_data":
            if not self.shizuku_ready:
                return {"status": "error", "result": "Shizuku server not running or permission denied"}
            pkg = args.get("package", "")
            return {"status": "success", "result": f"Cleared data for {pkg}"}

        elif tool_name == "device_app_install":
            if not self.shizuku_ready:
                return {"status": "error", "result": "Shizuku server not running or permission denied"}
            apk = args.get("apk_path", "")
            pkg_name = apk.split("/")[-1].replace(".apk", "")
            self.installed_apps.add(pkg_name)
            return {"status": "success", "result": f"Installed {apk}"}

        elif tool_name == "device_app_uninstall":
            if not self.shizuku_ready:
                return {"status": "error", "result": "Shizuku server not running or permission denied"}
            pkg = args.get("package", "")
            self.installed_apps.discard(pkg)
            self.running_apps.discard(pkg)
            return {"status": "success", "result": f"Uninstalled {pkg}"}

        else:
            return {"status": "error", "result": f"Unknown device tool: {tool_name}"}
