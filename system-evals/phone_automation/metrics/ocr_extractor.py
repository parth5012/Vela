"""OCR and Accessibility Node Hierarchy Text Extraction Evaluator.

Evaluates text extraction, element grounding, and semantic reading
from mocked accessibility node trees and OCR screen layouts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class OCRExtractionResult:
    matched: bool
    recall: float
    precision: float
    f1: float
    missing_targets: list[str] = field(default_factory=list)
    extraneous_targets: list[str] = field(default_factory=list)
    reason: str = ""


def evaluate_ocr_extraction(
    extracted_text: str,
    expected_texts: list[str],
    threshold: float = 0.8,
) -> OCRExtractionResult:
    """Evaluate whether the agent accurately extracted target text elements from the screen."""
    if not expected_texts:
        return OCRExtractionResult(
            matched=True,
            recall=1.0,
            precision=1.0,
            f1=1.0,
            reason="No expected texts required",
        )

    norm_extracted = extracted_text.lower()
    found = []
    missing = []

    for exp in expected_texts:
        if exp.lower() in norm_extracted:
            found.append(exp)
        else:
            missing.append(exp)

    recall = len(found) / len(expected_texts) if expected_texts else 1.0
    matched = recall >= threshold

    return OCRExtractionResult(
        matched=matched,
        recall=round(recall, 2),
        precision=1.0,  # Precision relative to targeted goals
        f1=round(recall, 2),
        missing_targets=missing,
        extraneous_targets=[],
        reason=f"Found {len(found)}/{len(expected_texts)} target texts (recall: {round(recall, 2)})",
    )
