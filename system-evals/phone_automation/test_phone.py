"""Pytest test suite for Phone Automation Evaluation Pipeline (Family 6).

Asserts:
- Hardware Safety Guard fails closed when physical Android hardware is detected on ADB.
- Structured parameter matching checks exact arguments rather than free text.
- OCR screen reading correctly computes text recall from mocked node trees.
- Action mapping covers device agent tools.
- Fail-closed execution when live backend is unreachable.
"""

import os
import pytest
from unittest.mock import patch, MagicMock

from phone_automation.device_state import (
    SimulatedDeviceState,
    assert_hardware_safety_guard,
    PhysicalDeviceDetectedError,
)
from phone_automation.metrics.parameter_matcher import match_action_and_parameters
from phone_automation.metrics.ocr_extractor import evaluate_ocr_extraction
from phone_automation.datasets import load_phone_cases
from phone_automation.runner import run_phone_eval


def test_dataset_loading_smoke_and_nightly():
    smoke_cases = load_phone_cases(mode="smoke")
    assert len(smoke_cases) == 8, f"Expected 8 smoke cases (2 per category), got {len(smoke_cases)}"

    nightly_cases = load_phone_cases(mode="nightly")
    assert len(nightly_cases) == 80, f"Expected 80 nightly cases, got {len(nightly_cases)}"

    categories = {c["category"] for c in nightly_cases}
    assert categories == {
        "action_mapping",
        "parameter_integrity",
        "shizuku_permissions",
        "ocr_screen_reading",
    }


def test_hardware_safety_guard_blocks_physical_device(monkeypatch):
    monkeypatch.delenv("VELA_ALLOW_PHYSICAL_DEVICE_EVALS", raising=False)
    fake_adb_output = "List of devices attached\n988a1b2c\tdevice\nemulator-5554\tdevice\n"
    with patch("shutil.which", return_value="/usr/bin/adb"), \
         patch("subprocess.check_output", return_value=fake_adb_output):
        with pytest.raises(PhysicalDeviceDetectedError) as exc_info:
            assert_hardware_safety_guard()
        assert "Physical Android device detected" in str(exc_info.value)


def test_hardware_safety_guard_allows_pure_emulator_or_none(monkeypatch):
    monkeypatch.delenv("VELA_ALLOW_PHYSICAL_DEVICE_EVALS", raising=False)
    fake_adb_output = "List of devices attached\nemulator-5554\tdevice\n\n"
    with patch("shutil.which", return_value="/usr/bin/adb"), \
         patch("subprocess.check_output", return_value=fake_adb_output):
        # Should not raise
        assert_hardware_safety_guard()


def test_simulated_device_state_execution():
    state = SimulatedDeviceState()
    res = state.execute_action("device_open_app", {"app_name": "com.spotify.music"})
    assert res["status"] == "success"
    assert state.current_app == "com.spotify.music"

    res_vol = state.execute_action("device_set_volume", {"level": 25})
    assert res_vol["status"] == "success"
    assert state.volume == 25

    res_perm = state.execute_action(
        "device_app_permission_grant",
        {"package": "com.example.app", "permission": "android.permission.CAMERA"},
    )
    assert res_perm["status"] == "success"
    assert "android.permission.CAMERA" in state.permissions["com.example.app"]


def test_structured_parameter_matching_exact_success():
    tool_calls = [
        {"tool": "device_set_volume", "args": {"level": 15}},
    ]
    res = match_action_and_parameters(
        tool_calls,
        expected_action="device_set_volume",
        expected_params={"level": 15},
    )
    assert res.matched is True
    assert res.action_matched is True
    assert res.params_matched is True
    assert len(res.mismatched_values) == 0


def test_structured_parameter_matching_rejects_free_text_or_wrong_args():
    tool_calls = [
        {"tool": "device_set_volume", "args": {"level": 80}},
    ]
    # Wrong level
    res = match_action_and_parameters(
        tool_calls,
        expected_action="device_set_volume",
        expected_params={"level": 15},
    )
    assert res.matched is False
    assert res.action_matched is True
    assert res.params_matched is False
    assert "level" in res.mismatched_values

    # Missing arg
    res_missing = match_action_and_parameters(
        tool_calls,
        expected_action="device_type",
        expected_params={"target": "input", "value": "test"},
    )
    assert res_missing.matched is False
    assert res_missing.action_matched is False


def test_ocr_extraction_recall():
    extracted = "Status screen: Battery: 88%, Connected to Home-5G-Network. Time is 10:30 AM."
    res = evaluate_ocr_extraction(extracted, ["Battery: 88%", "Home-5G-Network"])
    assert res.matched is True
    assert res.recall == 1.0

    res_partial = evaluate_ocr_extraction(extracted, ["Battery: 88%", "NonExistentPromoCode"], threshold=0.8)
    assert res_partial.matched is False
    assert res_partial.recall == 0.5


def test_phone_automation_eval_runner_smoke():
    res = run_phone_eval(mode="smoke", live=False)
    assert res.status == "passed"
    assert res.total_cases == 8
    assert res.passed_cases == 8
    assert res.failed_cases == 0
    assert res.summary_metrics["action_match_accuracy"] == 1.0


def test_phone_automation_eval_runner_nightly():
    res = run_phone_eval(mode="nightly", live=False)
    assert res.status == "passed"
    assert res.total_cases == 80
    assert res.passed_cases == 80
    assert res.failed_cases == 0
    assert res.summary_metrics["action_match_accuracy"] == 1.0


def test_phone_automation_live_fail_closed_honesty():
    with patch("phone_automation.runner.VelaClient") as mock_client_cls:
        mock_instance = MagicMock()
        mock_instance.send_turn.side_effect = ConnectionRefusedError("[Errno 111] Connection refused")
        mock_client_cls.return_value = mock_instance

        res = run_phone_eval(mode="smoke", live=True)
        assert res.status == "failed"
        assert res.passed_cases == 0
        assert res.failed_cases == 8
        for d in res.details:
            assert d["provider"] == "live_error"
            assert not d["passed"]
            assert "refused" in str(d.get("error", "")).lower()
