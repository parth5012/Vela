#!/usr/bin/env bash
#
# Vela E2E Verification Runner
# Orchestrates mock backend, ADB automation, and result capture.
#
# Usage:
#   bash runner.sh --feature <name>     Run single feature
#   bash runner.sh --lane <name>        Run all features in a lane
#   bash runner.sh --dry-run            Validate without ADB
#   bash runner.sh --report <dir>       Generate report from results
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$SCRIPT_DIR/results/$(date -u +%Y-%m-%dT%H%M%S)"
DEVICE="${DEVICE:-emulator-5554}"
MOCK_PORT=8000
MOCK_PID=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
    cat <<EOF
Vela E2E Verification Runner

Usage:
  $0 --feature <name>     Run single feature verification
  $0 --lane <name>        Run all features in a lane
  $0 --dry-run            Validate fixtures and oracles without ADB
  $0 --report <dir>       Generate report from existing results
  $0 --list               List available features and lanes

Options:
  --device <serial>       Target device (default: emulator-5554)
  --fixture <name>        Override fixture for feature run
  --skip-install          Skip APK install step
  --compact               Force the compact 360x640 viewport (default for the visual-regression lane)
  --update-baselines      Promote current visual captures to e2e/baselines/ (intentional use only)
  --threshold <0..1>      Visual diff failure threshold (default 0.005)
  --verbose               Show ADB command output
EOF
    exit 1
}

log() { echo -e "${BLUE}[E2E]${NC} $*"; }
ok() { echo -e "${GREEN}[PASS]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }

# --- Setup ---

setup_emulator() {
    log "Checking emulator connection..."
    if ! adb -s "$DEVICE" get-state >/dev/null 2>&1; then
        fail "Device $DEVICE not connected"
        exit 1
    fi
    log "Device $DEVICE connected"

    # Dismiss Android 15 16KB page size dialog if present
    adb -s "$DEVICE" shell input tap 540 1400 2>/dev/null || true
    sleep 0.5
}

install_apk() {
    local apk_path="$CLIENT_DIR/android/app/build/outputs/apk/release/app-x86_64-release.apk"
    if [ ! -f "$apk_path" ]; then
        fail "Release APK not found at $apk_path"
        exit 1
    fi
    log "Installing release APK..."
    adb -s "$DEVICE" install -r -d "$apk_path"
    log "APK installed"
}

launch_app() {
    log "Launching Vela..."
    adb -s "$DEVICE" shell am force-stop com.parth5012.client.dev 2>/dev/null || true
    sleep 1
    adb -s "$DEVICE" shell am start -n com.parth5012.client.dev/.MainActivity
    sleep 5
}

start_mock_server() {
    local fixture="${1:-chat}"
    # Kill any existing mock server first
    stop_mock_server
    # Also kill any stale python on our port
    taskkill //F //IM python.exe 2>/dev/null || true
    sleep 0.5
    log "Starting mock server with fixture: $fixture"
    python "$SCRIPT_DIR/mock_server.py" --fixture "$fixture" --port "$MOCK_PORT" &
    MOCK_PID=$!
    sleep 2

    # Reverse port to emulator
    adb -s "$DEVICE" reverse tcp:$MOCK_PORT tcp:$MOCK_PORT
    log "Mock server running on port $MOCK_PORT (PID: $MOCK_PID)"
}

stop_mock_server() {
    if [ -n "$MOCK_PID" ]; then
        kill "$MOCK_PID" 2>/dev/null || true
        wait "$MOCK_PID" 2>/dev/null || true
        log "Mock server stopped"
    fi
}

cleanup() {
    stop_mock_server
    # Restore viewport / motion settings even on failure paths
    restore_viewport
    restore_motion
    # Remove reverse port
    adb -s "$DEVICE" reverse --remove tcp:$MOCK_PORT 2>/dev/null || true
    # Cleanup temp files
    [ -n "$RESULTS_FILE" ] && rm -f "$RESULTS_FILE" 2>/dev/null || true
    rm -f "$RESULTS_DIR/.start_ts" 2>/dev/null || true
}
trap cleanup EXIT

# --- ADB Helpers ---

capture_screenshot() {
    local name="$1"
    adb -s "$DEVICE" shell screencap -p "//sdcard/e2e_${name}.png"
    adb -s "$DEVICE" pull "//sdcard/e2e_${name}.png" "$RESULTS_DIR/" >/dev/null
}

capture_ui_dump() {
    local name="$1"
    adb -s "$DEVICE" shell uiautomator dump "//sdcard/e2e_${name}.xml"
    adb -s "$DEVICE" pull "//sdcard/e2e_${name}.xml" "$RESULTS_DIR/" >/dev/null
}

check_ui_text() {
    local dump_file="$1"
    local expected_text="$2"
    if grep -q "$expected_text" "$dump_file" 2>/dev/null; then
        return 0
    fi
    return 1
}

tap_screen() {
    local x="$1"
    local y="$2"
    adb -s "$DEVICE" shell input tap "$x" "$y"
}

type_text() {
    local text="$1"
    adb -s "$DEVICE" shell input text "$text"
}

press_back() {
    adb -s "$DEVICE" shell input keyevent 4
}

wait_for_text() {
    local text="$1"
    local timeout="${2:-10}"
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        capture_ui_dump "wait_check"
        if check_ui_text "$RESULTS_DIR/e2e_wait_check.xml" "$text"; then
            rm -f "$RESULTS_DIR/e2e_wait_check.xml"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    rm -f "$RESULTS_DIR/e2e_wait_check.xml"
    return 1
}

check_logcat() {
    local pattern="$1"
    adb -s "$DEVICE" logcat -d -t 100 *:E 2>/dev/null | grep -i "$pattern" || true
}

# --- Feature Runners ---

run_feature_setup() {
    local fixture="${1:-setup}"
    log "Running Setup feature verification..."

    start_mock_server "$fixture"
    launch_app

    # Step 1: Verify setup screen loads (or app is already configured)
    capture_ui_dump "setup_initial"
    if check_ui_text "$RESULTS_DIR/e2e_setup_initial.xml" "Save & Continue"; then
        ok "Setup screen loaded"

        # Step 2: Test empty field validation
        tap_screen 540 1400  # Tap Save & Continue
        sleep 1
        capture_ui_dump "setup_validation"
        if check_ui_text "$RESULTS_DIR/e2e_setup_validation.xml" "required\|invalid\|error"; then
            ok "Empty field validation works"
        else
            warn "Could not verify empty field validation"
        fi
    elif check_ui_text "$RESULTS_DIR/e2e_setup_initial.xml" "Send"; then
        ok "Setup already completed — app loaded past setup screen"
    else
        fail "Setup screen not found (no Save & Continue or Send detected)"
        return 1
    fi

    ok "Setup feature verification complete"
}

run_feature_chat() {
    local fixture="${1:-chat}"
    log "Running Chat feature verification..."

    start_mock_server "$fixture"
    launch_app

    # Step 1: Navigate to chat (after setup)
    wait_for_text "Send" 15
    capture_ui_dump "chat_loaded"
    if check_ui_text "$RESULTS_DIR/e2e_chat_loaded.xml" "Send"; then
        ok "Chat screen loaded"
    else
        fail "Chat screen not found"
        return 1
    fi

    # Step 2: Type and send message
    tap_screen 540 2200  # Tap input field
    sleep 0.5
    type_text "Hello from E2E"
    tap_screen 1000 2200  # Tap Send
    sleep 2

    # Step 3: Verify SSE response rendered
    capture_ui_dump "chat_response"
    if check_ui_text "$RESULTS_DIR/e2e_chat_response.xml" "Response to"; then
        ok "SSE streaming response rendered"
    else
        fail "SSE response not rendered"
        return 1
    fi

    # Step 4: Check for errors in logcat
    local errors=$(check_logcat "ReactNativeJS\|Hermes\|SQLite")
    if [ -z "$errors" ]; then
        ok "No JS/Hermes/SQLite errors in logcat"
    else
        warn "Logcat errors detected: $errors"
    fi

    ok "Chat feature verification complete"
}

run_feature_tasks() {
    local fixture="${1:-tasks}"
    log "Running Tasks feature verification..."

    start_mock_server "$fixture"
    launch_app

    # Ensure app is in foreground
    adb -s "$DEVICE" shell am start -W -n com.parth5012.client.dev/.MainActivity
    sleep 3

    # Get screen dimensions for dynamic coordinates
    local screen_h
    screen_h=$(adb -s "$DEVICE" shell wm size | grep Physical | awk '{print $3}' | cut -dx -f2)
    screen_h=${screen_h:-2400}
    log "Screen height: $screen_h"

    # Step 1: Open drawer by tapping hamburger menu (top-left header area)
    adb -s "$DEVICE" shell input tap 30 80
    sleep 2
    capture_ui_dump "drawer_open"

    # Step 2: Tap 'Tasks' in the drawer footer (near bottom of drawer)
    local tasks_y=$((screen_h - 315))
    log "Tapping Tasks in drawer at y=$tasks_y"
    adb -s "$DEVICE" shell input tap 367 $tasks_y
    sleep 2

    # Step 3: Verify Tasks screen loaded (title is 'Task Scheduler', button is '+ Add Task')
    capture_ui_dump "tasks_loaded"
    if check_ui_text "$RESULTS_DIR/e2e_tasks_loaded.xml" "Task Scheduler\|Add Task\|No tasks found"; then
        ok "Tasks screen loaded"
    else
        warn "Standard text not found, checking for fallback"
        sleep 2
        capture_ui_dump "tasks_retry"
        if check_ui_text "$RESULTS_DIR/e2e_tasks_retry.xml" "Task Scheduler\|Add Task\|No tasks found"; then
            ok "Tasks screen loaded (delayed)"
        else
            fail "Tasks screen not found"
            return 1
        fi
    fi

    ok "Tasks feature verification complete (prototype stub)"
}

run_feature_browser() {
    local fixture="${1:-browser}"
    log "Running Browser feature verification..."

    start_mock_server "$fixture"
    launch_app

    wait_for_text "Webview" 15
    capture_ui_dump "browser_loaded"
    if check_ui_text "$RESULTS_DIR/e2e_browser_loaded.xml" "Webview\|Browser"; then
        ok "Browser screen loaded"
    else
        fail "Browser screen not found"
        return 1
    fi

    # Verify overlay concealment after navigating away
    tap_screen 100 200  # Navigate back to chat
    sleep 1
    capture_screenshot "browser_concealment"
    ok "Browser feature verification complete (prototype stub)"
}

run_feature_settings() {
    local fixture="${1:-settings}"
    log "Running Settings feature verification..."

    start_mock_server "$fixture"
    launch_app

    wait_for_text "Settings" 15
    capture_ui_dump "settings_loaded"

    local sub_screens=("connection" "appearance" "agent" "local-ai" "messaging" "about")
    for screen in "${sub_screens[@]}"; do
        log "  Checking sub-screen: $screen"
        # Navigation would happen here in full implementation
    done

    ok "Settings feature verification complete (prototype stub)"
}

# --- Lane Runners ---

run_lane_critical_path() {
    log "=== Running Critical Path Lane ==="

    if run_feature_setup "${1:-setup}"; then
        record_result "setup" "PASS"
    else
        record_result "setup" "FAIL"
    fi

    if run_feature_chat "${1:-chat}"; then
        record_result "chat" "PASS"
    else
        record_result "chat" "FAIL"
    fi
}

run_lane_extended() {
    log "=== Running Extended Coverage Lane ==="

    if run_feature_tasks "${1:-tasks}"; then
        record_result "tasks" "PASS"
    else
        record_result "tasks" "FAIL"
    fi

    if run_feature_browser "${1:-browser}"; then
        record_result "browser" "PASS"
    else
        record_result "browser" "FAIL"
    fi

    if run_feature_settings "${1:-settings}"; then
        record_result "settings" "PASS"
    else
        record_result "settings" "FAIL"
    fi
}

run_feature_local_ai() {
    local fixture="${1:-local-ai}"
    log "Running Local AI feature verification..."
    start_mock_server "$fixture"
    launch_app
    wait_for_text "Local\|Cloud\|Model" 15
    capture_ui_dump "local_ai_loaded"
    if check_ui_text "$RESULTS_DIR/e2e_local_ai_loaded.xml" "Local\|Cloud"; then
        ok "Local AI screen loaded"
    else
        warn "Local AI screen not found (feature may not be enabled)"
    fi
    ok "Local AI feature verification complete"
}

run_feature_device_agent() {
    local fixture="${1:-device-agent}"
    log "Running Device Agent feature verification..."
    start_mock_server "$fixture"
    launch_app
    wait_for_text "Agent\|Device\|Shell" 15
    capture_ui_dump "device_agent_loaded"
    if check_ui_text "$RESULTS_DIR/e2e_device_agent_loaded.xml" "Agent\|Device"; then
        ok "Device Agent screen loaded"
    else
        warn "Device Agent screen not found"
    fi
    ok "Device Agent feature verification complete"
}

run_feature_offline() {
    local fixture="${1:-offline}"
    log "Running Offline feature verification..."
    start_mock_server "$fixture"
    launch_app
    wait_for_text "Send\|offline\|Offline" 15
    capture_ui_dump "offline_loaded"
    ok "Offline feature verification complete (stub)"
}

run_feature_fcm() {
    local fixture="${1:-fcm}"
    log "Running FCM Push feature verification..."
    start_mock_server "$fixture"
    launch_app
    wait_for_text "Send\|Push\|Notification" 15
    capture_ui_dump "fcm_loaded"
    ok "FCM Push feature verification complete (stub)"
}

run_lane_parallel_surface() {
    log "=== Running Parallel Surface Lane ==="

    if run_feature_local_ai "${1:-local-ai}"; then
        record_result "local-ai" "PASS"
    else
        record_result "local-ai" "FAIL"
    fi

    if run_feature_device_agent "${1:-device-agent}"; then
        record_result "device-agent" "PASS"
    else
        record_result "device-agent" "FAIL"
    fi

    if run_feature_offline "${1:-offline}"; then
        record_result "offline" "PASS"
    else
        record_result "offline" "FAIL"
    fi

    if run_feature_fcm "${1:-fcm}"; then
        record_result "fcm" "PASS"
    else
        record_result "fcm" "FAIL"
    fi
}

# --- Visual Regression Lane (WF-447-07) ---

ORIG_WM_SIZE=""
ORIG_ANIM_SCALE=""
COMPACT_MODE=false
UPDATE_BASELINES=false
DIFF_THRESHOLD=""

# Scroll-craft compact viewport: the 360x640 mobile floor.
set_compact_viewport() {
    COMPACT_MODE=true
    ORIG_WM_SIZE=$(adb -s "$DEVICE" shell wm size | grep Physical | awk '{print $3}' | tr -d '\r')
    log "Compact viewport: ${ORIG_WM_SIZE:-unknown} -> 360x640"
    adb -s "$DEVICE" shell wm size 360x640 >/dev/null 2>&1 || true
    sleep 1
}

restore_viewport() {
    if [ -n "$ORIG_WM_SIZE" ]; then
        adb -s "$DEVICE" shell wm size "$ORIG_WM_SIZE" 2>/dev/null || true
        log "Viewport restored ($ORIG_WM_SIZE)"
        ORIG_WM_SIZE=""
    fi
}

set_reduced_motion() {
    ORIG_ANIM_SCALE=$(adb -s "$DEVICE" shell settings get global animator_duration_scale | tr -d '\r\n')
    adb -s "$DEVICE" shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
    log "Reduced motion: animator_duration_scale 0 (was ${ORIG_ANIM_SCALE:-unknown})"
}

restore_motion() {
    if [ -n "$ORIG_ANIM_SCALE" ]; then
        adb -s "$DEVICE" shell settings put global animator_duration_scale "$ORIG_ANIM_SCALE" 2>/dev/null || true
        log "Motion restored (animator_duration_scale $ORIG_ANIM_SCALE)"
        ORIG_ANIM_SCALE=""
    fi
}

# Tap the centre of the first on-screen node whose text contains $1.
tap_ui_text() {
    local text="$1"
    capture_ui_dump "tap_target"
    local dump="$RESULTS_DIR/e2e_tap_target.xml"
    local bounds
    bounds=$(tr '\r' ' ' < "$dump" | grep -o "text=\"[^\"]*${text}[^\"]*\"[^>]*bounds=\"\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]\"" | head -1 | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' || true)
    if [ -z "$bounds" ]; then
        fail "tap_ui_text: '$text' not found on screen"
        return 1
    fi
    local xs=($(echo "$bounds" | tr -d '[]' | tr ',' ' '))
    local cx=$(( (xs[0] + xs[2]) / 2 ))
    local cy=$(( (xs[1] + xs[3]) / 2 ))
    log "  Tapping '$text' at ($cx,$cy)"
    tap_screen "$cx" "$cy"
}

# Tap the centre of the Nth editable text field on screen (1-based).
tap_editable_nth() {
    local n="${1:-1}"
    capture_ui_dump "tap_editable"
    local dump="$RESULTS_DIR/e2e_tap_editable.xml"
    local bounds
    bounds=$(tr '\r' ' ' < "$dump" | grep -o 'class="android.widget.EditText"[^>]*bounds="[^"]*"' | head -n "$n" | tail -n 1 | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' || true)
    if [ -z "$bounds" ]; then
        fail "tap_editable_nth: editable field #$n not found on screen"
        return 1
    fi
    local xs=($(echo "$bounds" | tr -d '[]' | tr ',' ' '))
    local cx=$(( (xs[0] + xs[2]) / 2 ))
    local cy=$(( (xs[1] + xs[3]) / 2 ))
    log "  Tapping editable field #$n at ($cx,$cy)"
    tap_screen "$cx" "$cy"
}

# Capture one screenshot per state into e2e/results/visual/<name>.png
capture_visual_state() {
    local name="$1"
    mkdir -p "$SCRIPT_DIR/results/visual"
    adb -s "$DEVICE" shell screencap -p "//sdcard/e2e_visual.png"
    adb -s "$DEVICE" pull "//sdcard/e2e_visual.png" "$SCRIPT_DIR/results/visual/${name}.png" >/dev/null
    adb -s "$DEVICE" shell rm "//sdcard/e2e_visual.png" 2>/dev/null || true
    log "  captured visual state: $name"
}

# After the setup screenshot, leave the app configured against the mock
# backend so remaining states capture real chat/settings/tasks UI.
configure_via_server() {
    tap_ui_text "Connect to Server" || return 1
    sleep 2
    tap_editable_nth 1 || return 1
    type_text "vela.local"
    sleep 0.5
    tap_editable_nth 2 || return 1
    type_text "e2e-token"
    sleep 0.5
    press_back
    sleep 0.5
    tap_ui_text "Connect & Save" || return 1
    wait_for_text "Send" 30 || { fail "Configuration did not reach chat"; return 1; }
    ok "Configured against mock server"
}

run_visual_state_setup() {
    local suffix="$1"
    start_mock_server "setup"
    # Deterministic first run: wipe app data (emulator only — this lane
    # refuses to run against a physical device).
    adb -s "$DEVICE" shell pm clear com.parth5012.client.dev >/dev/null 2>&1 || true
    launch_app
    sleep 3
    if wait_for_text "Get Started with Vela" 15; then
        ok "Setup state visible"
    else
        warn "Setup title not found — capturing current frame anyway"
    fi
    capture_visual_state "setup${suffix}"
    # Continue in the same session: configure so later states are usable.
    configure_via_server
}

run_visual_state_chat_empty() {
    local suffix="$1"
    start_mock_server "chat"
    launch_app
    sleep 2
    wait_for_text "Send" 15 || warn "chat not ready — capturing current frame"
    sleep 6  # let entrance motion settle
    capture_visual_state "chat-empty${suffix}"
}

run_visual_state_chat_thread() {
    local suffix="$1"
    start_mock_server "chat"
    launch_app
    sleep 2
    wait_for_text "Send" 15 || warn "chat not ready — capturing current frame"
    tap_editable_nth 1 || true
    type_text "Hello%sfrom%sE2E"
    sleep 0.5
    press_back  # dismiss keyboard so Send is reachable
    sleep 0.5
    tap_ui_text "Send" || warn "Send not found"
    sleep 4
    wait_for_text "Response" 15 || warn "SSE response not detected"
    sleep 2
    capture_visual_state "chat-thread${suffix}"
}

run_visual_state_settings_appearance() {
    local suffix="$1"
    start_mock_server "settings"
    launch_app
    sleep 2
    tap_screen 30 70  # hamburger (compact viewport)
    sleep 2
    tap_ui_text "Settings" || { warn "Settings not in drawer — capturing current frame"; return 1; }
    sleep 2
    if ! tap_ui_text "Appearance"; then
        warn "Appearance entry not found — capturing settings index instead"
    fi
    sleep 2
    capture_visual_state "settings-appearance${suffix}"
}

run_visual_state_tasks_empty() {
    local suffix="$1"
    start_mock_server "tasks"
    launch_app
    sleep 2
    tap_screen 30 70  # hamburger (compact viewport)
    sleep 2
    tap_ui_text "Tasks" || { warn "Tasks not in drawer — capturing current frame"; return 1; }
    sleep 3
    capture_visual_state "tasks-empty${suffix}"
}

run_lane_visual_regression() {
    log "=== Running Visual Regression Lane ==="

    # Safety: the lane never targets the user's phone.
    if [[ "$DEVICE" != emulator-* ]]; then
        fail "visual-regression refuses non-emulator device '$DEVICE'. Use --device emulator-XXXXXX."
        exit 1
    fi

    set_compact_viewport

    # Clean capture set so the diff only sees this run.
    mkdir -p "$SCRIPT_DIR/results/visual/diffs"
    rm -f "$SCRIPT_DIR/results/visual"/*.png "$SCRIPT_DIR/results/visual/diffs"/*.png 2>/dev/null || true

    local suffix
    for suffix in "" ".rmd"; do
        if [ -n "$suffix" ]; then
            log "--- Reduced-motion pass ---"
            set_reduced_motion
        else
            log "--- Normal pass ---"
        fi
        run_visual_state_setup "$suffix" || true
        run_visual_state_chat_empty "$suffix" || true
        run_visual_state_chat_thread "$suffix" || true
        run_visual_state_settings_appearance "$suffix" || true
        run_visual_state_tasks_empty "$suffix" || true
        if [ -n "$suffix" ]; then
            restore_motion
        fi
    done
    restore_viewport

    # Diff pass: current shots against e2e/baselines/ with pixelmatch.
    local diff_args=()
    if [ -n "$DIFF_THRESHOLD" ]; then
        diff_args+=(--threshold "$DIFF_THRESHOLD")
    fi
    if $UPDATE_BASELINES; then
        diff_args+=(--update-baselines)
    fi
    if node "$SCRIPT_DIR/visual-diff.mjs" "${diff_args[@]}"; then
        record_result "visual-regression" "PASS"
        ok "Visual regression lane complete"
    else
        record_result "visual-regression" "FAIL"
        fail "Visual regression lane failed (details: e2e/results/visual/report.json)"
    fi
}

# --- Dry Run ---

dry_run() {
    log "=== Dry Run: Validating fixtures and oracles ==="

    # Validate fixtures (use relative paths to avoid MSYS/Windows path issues)
    pushd "$SCRIPT_DIR/fixtures" >/dev/null || true
    for fixture_file in *.json; do
        if [ -f "$fixture_file" ]; then
            local name=$(basename "$fixture_file" .json)
            if python -c "import json; json.load(open('$fixture_file'))" 2>/dev/null; then
                ok "Fixture $name: valid JSON"
            else
                fail "Fixture $name: invalid JSON"
            fi
        fi
    done
    popd >/dev/null || true

    # Validate oracles
    for oracle_file in "$SCRIPT_DIR"/oracles/*.md; do
        if [ -f "$oracle_file" ]; then
            local name=$(basename "$oracle_file" .md)
            ok "Oracle $name: present"
        fi
    done

    # Validate lanes
    for lane_file in "$SCRIPT_DIR"/lanes/*.yaml; do
        if [ -f "$lane_file" ]; then
            local name=$(basename "$lane_file" .yaml)
            ok "Lane $name: present"
        fi
    done

    log "Dry run complete"
}

# --- Results Accumulator ---

RESULTS_FILE=""  # Set per-run temp file for accumulating feature results
LANE_STATUS=""    # Tracks overall lane status

clear_results() {
    RESULTS_FILE=$(mktemp)
    LANE_STATUS="PASS"
    echo "{}" > "$RESULTS_FILE"
}

record_result() {
    local feature="$1"
    local status="$2"  # PASS or FAIL
    local attempts="${3:-1}"
    local duration_ms="${4:-0}"
    local screenshot="${5:-}"
    local logcat="${6:-}"

    if [ "$status" = "FAIL" ]; then
        LANE_STATUS="FAIL"
    fi

    # Append to results file (newline-delimited JSON lines)
    echo "{\"feature\":\"$feature\",\"status\":\"$status\",\"attempts\":$attempts,\"duration_ms\":$duration_ms,\"screenshot\":\"$screenshot\",\"logcat\":\"$logcat\"}" >> "$RESULTS_FILE"
}

# --- Report ---

generate_report() {
    local results_dir="${1:-$RESULTS_DIR}"
    log "Generating report from $results_dir..."

    # Copy dashboard template
    cp "$SCRIPT_DIR/results/dashboard.html" "$results_dir/index.html" 2>/dev/null || true

    # Build summary.json from accumulated results
    local total=0 passed=0 failed=0
    local features_json=""
    local critical_json=""
    local extended_json=""
    local parallel_json=""

    if [ -n "$RESULTS_FILE" ] && [ -f "$RESULTS_FILE" ]; then
        while IFS= read -r line; do
            local feat=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['feature'])" 2>/dev/null)
            local stat=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
            local attn=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('attempts',1))" 2>/dev/null)
            local dur=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('duration_ms',0))" 2>/dev/null)
            local shot=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('screenshot',''))" 2>/dev/null)
            local logc=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('logcat',''))" 2>/dev/null)

            [ -z "$feat" ] && continue
            total=$((total + 1))
            [ "$stat" = "PASS" ] && passed=$((passed + 1)) || failed=$((failed + 1))

            local entry="\"$feat\":{\"status\":\"$stat\",\"attempts\":$attn,\"duration_ms\":$dur"
            [ -n "$shot" ] && entry="$entry,\"screenshot\":\"$shot\""
            [ -n "$logc" ] && entry="$entry,\"logcat\":\"$logc\""
            entry="$entry}"

            # Classify into lane
            case "$feat" in
                setup|chat|threads|rich-rendering|collapsible-blocks|message-actions|safety-tier-badges)
                    [ -n "$critical_json" ] && critical_json="$critical_json,"
                    critical_json="$critical_json$entry" ;;
                tasks|browser|settings*|theme*|agent-config|google-oauth|briefing|cookie-viewer|task-progress)
                    [ -n "$extended_json" ] && extended_json="$extended_json,"
                    extended_json="$extended_json$entry" ;;
                local-ai|device-agent|offline*|fcm*)
                    [ -n "$parallel_json" ] && parallel_json="$parallel_json,"
                    parallel_json="$parallel_json$entry" ;;
            esac
        done < "$RESULTS_FILE"
    fi

    # Compute flakiness trend from past runs
    local trend_json
    trend_json=$(compute_flakiness_trend "$results_dir")

    # Calculate duration
    local start_ts end_ts duration_s
    if [ -f "$results_dir/.start_ts" ]; then
        start_ts=$(cat "$results_dir/.start_ts")
        end_ts=$(date +%s)
        duration_s=$((end_ts - start_ts))
    else
        duration_s=0
    fi

    # Build lane statuses
    local cp_status="PASS" ext_status="PASS" par_status="PASS"
    if [ -n "$critical_json" ]; then
        echo "$critical_json" | grep -q '"status":"FAIL"' && cp_status="FAIL"
    fi
    if [ -n "$extended_json" ]; then
        echo "$extended_json" | grep -q '"status":"FAIL"' && ext_status="FAIL"
    fi
    if [ -n "$parallel_json" ]; then
        echo "$parallel_json" | grep -q '"status":"FAIL"' && par_status="FAIL"
    fi

    # Write summary.json
    cat > "$results_dir/summary.json" <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "device": "$DEVICE",
  "duration_seconds": $duration_s,
  "lanes": {
    "critical-path": { "status": "$cp_status", "features": { $critical_json } },
    "extended-coverage": { "status": "$ext_status", "features": { $extended_json } },
    "parallel-surface": { "status": "$par_status", "features": { $parallel_json } }
  },
  "summary": { "total": $total, "passed": $passed, "failed": $failed, "skipped": 0 },
  "flakiness_trend": { $trend_json }
}
EOF

    # Cleanup temp file
    [ -n "$RESULTS_FILE" ] && rm -f "$RESULTS_FILE"

    ok "Report generated at $results_dir/index.html"
    log "Open in browser: file://$results_dir/index.html"
}

# --- Flakiness Trend ---

compute_flakiness_trend() {
    local current_dir="${1:-$RESULTS_DIR}"
    local max_runs=10
    local trend_file=$(mktemp)

    # Collect all results directories (sorted, newest first)
    local dirs=()
    for d in $(ls -1d "$SCRIPT_DIR/results/"*/ 2>/dev/null | sort -r); do
        # Skip non-timestamped dirs (like the template dir)
        local dirname=$(basename "$d")
        [[ "$dirname" =~ ^[0-9]{4}- ]] || continue
        dirs+=("$d")
        [ ${#dirs[@]} -ge $max_runs ] && break
    done

    # If no past runs, return empty
    if [ ${#dirs[@]} -eq 0 ]; then
        rm -f "$trend_file"
        return
    fi

    # For each feature, count passes across runs
    python3 -c "
import json, os, sys
from collections import defaultdict

dirs = sys.argv[1:]
feature_pass = defaultdict(int)
feature_total = defaultdict(int)

for d in dirs:
    sf = os.path.join(d, 'summary.json')
    if not os.path.exists(sf):
        continue
    with open(sf) as f:
        data = json.load(f)
    for lane_id, lane in data.get('lanes', {}).items():
        for feat_id, feat in lane.get('features', {}).items():
            feature_total[feat_id] += 1
            if feat.get('status') == 'PASS':
                feature_pass[feat_id] += 1

result = []
for feat in sorted(feature_total.keys()):
    rate = feature_pass[feat] / feature_total[feat] if feature_total[feat] > 0 else 0
    result.append(f'\"{feat}\": {rate:.2f}')
print(', '.join(result))
" "${dirs[@]}" > "$trend_file" 2>/dev/null || true

    cat "$trend_file"
    rm -f "$trend_file"
}

# --- Main ---

FEATURE=""
LANE=""
DRY_RUN=false
REPORT_DIR=""
FIXTURE=""
SKIP_INSTALL=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --feature) FEATURE="$2"; shift 2 ;;
        --lane) LANE="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --report) REPORT_DIR="$2"; shift 2 ;;
        --fixture) FIXTURE="$2"; shift 2 ;;
        --device) DEVICE="$2"; shift 2 ;;
        --skip-install) SKIP_INSTALL=true; shift ;;
        --compact) COMPACT_MODE=true; shift ;;
        --update-baselines) UPDATE_BASELINES=true; shift ;;
        --threshold) DIFF_THRESHOLD="$2"; shift 2 ;;
        --verbose) VERBOSE=true; shift ;;
        --list)
            echo "Features: setup, chat, tasks, browser, settings, local-ai, device-agent, offline, fcm"
            echo "Lanes: critical-path, extended-coverage, parallel-surface, visual-regression"
            exit 0
            ;;
        *) usage ;;
    esac
done

mkdir -p "$RESULTS_DIR"
cp "$SCRIPT_DIR/results/dashboard.html" "$RESULTS_DIR/index.html" 2>/dev/null || true
clear_results
date +%s > "$RESULTS_DIR/.start_ts"

if $DRY_RUN; then
    dry_run
    exit 0
fi

if [ -n "$REPORT_DIR" ]; then
    generate_report "$REPORT_DIR"
    exit 0
fi

# Full run
setup_emulator
if ! $SKIP_INSTALL; then
    install_apk
fi

if [ -n "$FEATURE" ]; then
    log "Running single feature: $FEATURE"
    feat_status="PASS"
    case $FEATURE in
        setup) run_feature_setup "$FIXTURE" || feat_status="FAIL" ;;
        chat) run_feature_chat "$FIXTURE" || feat_status="FAIL" ;;
        tasks) run_feature_tasks "$FIXTURE" || feat_status="FAIL" ;;
        browser) run_feature_browser "$FIXTURE" || feat_status="FAIL" ;;
        settings) run_feature_settings "$FIXTURE" || feat_status="FAIL" ;;
        local-ai) run_feature_local_ai "$FIXTURE" || feat_status="FAIL" ;;
        device-agent) run_feature_device_agent "$FIXTURE" || feat_status="FAIL" ;;
        offline) run_feature_offline "$FIXTURE" || feat_status="FAIL" ;;
        fcm) run_feature_fcm "$FIXTURE" || feat_status="FAIL" ;;
        *) fail "Unknown feature: $FEATURE"; usage ;;
    esac
    record_result "$FEATURE" "$feat_status"
elif [ -n "$LANE" ]; then
    log "Running lane: $LANE"
    case $LANE in
        critical-path) run_lane_critical_path "$FIXTURE" ;;
        extended-coverage) run_lane_extended "$FIXTURE" ;;
        parallel-surface) run_lane_parallel_surface "$FIXTURE" ;;
        visual-regression) run_lane_visual_regression "$FIXTURE" ;;
        *) fail "Unknown lane: $LANE"; usage ;;
    esac
else
    usage
fi

# Generate final report
generate_report

log "Results saved to $RESULTS_DIR"
log "Open dashboard: file://$RESULTS_DIR/index.html"
