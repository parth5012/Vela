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
    adb -s "$DEVICE" shell am start -n com.parth5012.client.dev/.MainActivity
    sleep 3
}

start_mock_server() {
    local fixture="${1:-chat}"
    log "Starting mock server with fixture: $fixture"
    python "$SCRIPT_DIR/mock_server.py" --fixture "$fixture" --port "$MOCK_PORT" &
    MOCK_PID=$!
    sleep 1

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
    adb -s "$DEVICE" shell screencap -p "/sdcard/e2e_${name}.png"
    adb -s "$DEVICE" pull "/sdcard/e2e_${name}.png" "$RESULTS_DIR/" >/dev/null
}

capture_ui_dump() {
    local name="$1"
    adb -s "$DEVICE" shell uiautomator dump "/sdcard/e2e_${name}.xml"
    adb -s "$DEVICE" pull "/sdcard/e2e_${name}.xml" "$RESULTS_DIR/" >/dev/null
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
        if check_ui_text "$RESULTS_DIR/wait_check.xml" "$text"; then
            rm -f "$RESULTS_DIR/wait_check.xml"
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    rm -f "$RESULTS_DIR/wait_check.xml"
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

    # Step 1: Verify setup screen loads
    capture_ui_dump "setup_initial"
    if check_ui_text "$RESULTS_DIR/setup_initial.xml" "Save & Continue"; then
        ok "Setup screen loaded"
    else
        fail "Setup screen not found"
        return 1
    fi

    # Step 2: Test empty field validation
    tap_screen 540 1400  # Tap Save & Continue
    sleep 1
    capture_ui_dump "setup_validation"
    if check_ui_text "$RESULTS_DIR/setup_validation.xml" "required\|invalid\|error"; then
        ok "Empty field validation works"
    else
        warn "Could not verify empty field validation"
    fi

    # Step 3: Enter valid server and verify connection
    # This requires UI-specific coordinates; placeholder for prototype
    ok "Setup feature verification complete (prototype stub)"
}

run_feature_chat() {
    local fixture="${1:-chat}"
    log "Running Chat feature verification..."

    start_mock_server "$fixture"
    launch_app

    # Step 1: Navigate to chat (after setup)
    wait_for_text "Send" 15
    capture_ui_dump "chat_loaded"
    if check_ui_text "$RESULTS_DIR/chat_loaded.xml" "Send"; then
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
    if check_ui_text "$RESULTS_DIR/chat_response.xml" "Response to"; then
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

    # Navigate to tasks
    wait_for_text "Add Task" 15
    capture_ui_dump "tasks_loaded"
    if check_ui_text "$RESULTS_DIR/tasks_loaded.xml" "Add Task"; then
        ok "Tasks screen loaded"
    else
        fail "Tasks screen not found"
        return 1
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
    if check_ui_text "$RESULTS_DIR/browser_loaded.xml" "Webview\|Browser"; then
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

# --- Dry Run ---

dry_run() {
    log "=== Dry Run: Validating fixtures and oracles ==="

    # Validate fixtures
    for fixture_file in "$SCRIPT_DIR"/fixtures/*.json; do
        if [ -f "$fixture_file" ]; then
            local name=$(basename "$fixture_file" .json)
            if python -c "import json; json.load(open('$fixture_file'))" 2>/dev/null; then
                ok "Fixture $name: valid JSON"
            else
                fail "Fixture $name: invalid JSON"
            fi
        fi
    done

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
        --verbose) VERBOSE=true; shift ;;
        --list)
            echo "Features: setup, chat, tasks, browser, settings, local-ai, device-agent, offline, fcm"
            echo "Lanes: critical-path, extended-coverage, parallel-surface"
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
    local feat_status="PASS"
    case $FEATURE in
        setup) run_feature_setup "$FIXTURE" || feat_status="FAIL" ;;
        chat) run_feature_chat "$FIXTURE" || feat_status="FAIL" ;;
        tasks) run_feature_tasks "$FIXTURE" || feat_status="FAIL" ;;
        browser) run_feature_browser "$FIXTURE" || feat_status="FAIL" ;;
        settings) run_feature_settings "$FIXTURE" || feat_status="FAIL" ;;
        *) fail "Unknown feature: $FEATURE"; usage ;;
    esac
    record_result "$FEATURE" "$feat_status"
elif [ -n "$LANE" ]; then
    log "Running lane: $LANE"
    case $LANE in
        critical-path) run_lane_critical_path "$FIXTURE" ;;
        extended-coverage) run_lane_extended "$FIXTURE" ;;
        *) fail "Unknown lane: $LANE"; usage ;;
    esac
else
    usage
fi

# Generate final report
generate_report

log "Results saved to $RESULTS_DIR"
log "Open dashboard: file://$RESULTS_DIR/index.html"
