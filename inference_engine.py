"""
===============================================================================
Inference Engine Module for Industrial Equipment Fault Diagnosis
===============================================================================
This module performs Forward Chaining (data-driven reasoning):
1. MATCH: Compares user symptoms against rules in the Knowledge Base.
2. AGGREGATE: Groups rules that point to the same fault.
3. UNCERTAINTY: Calculates Certainty Factors (CF) using the MYCIN formula.
4. EXPLANATION: Builds a transparent 6-step reasoning trace.
5. CONFLICT RESOLUTION: Ranks faults by Safety Priority (CRITICAL > HIGH > MEDIUM > LOW).
===============================================================================
"""

from __future__ import annotations
import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Any, Tuple


# -----------------------------------------------------------------------------
# 1. DIAGNOSIS RESULT DATA STRUCTURE
# -----------------------------------------------------------------------------

@dataclass
class DiagnosisResult:
    """
    Stores the final conclusion deduced by the Inference Engine.
    """
    cause: str
    remedy: str
    component: str
    certainty: float
    safety_priority: str
    matched_symptoms: List[str]
    matched_rules: List[str]
    reasoning_chain: List[str]
    sensor_supported: bool


# -----------------------------------------------------------------------------
# 2. INFERENCE ENGINE CLASS
# -----------------------------------------------------------------------------

class InferenceEngine:
    """
    Forward Chaining problem-solving engine.
    """

    # Priority weights for conflict resolution (safety first)
    PRIORITY_WEIGHTS = {
        "CRITICAL": 4,
        "HIGH": 3,
        "MEDIUM": 2,
        "LOW": 1
    }

    def __init__(self, kb: Any) -> None:
        self.kb = kb  # Reference to KnowledgeBase

    @staticmethod
    def _normalize(text: str) -> str:
        """Helper to lowercase and remove punctuation for robust matching."""
        if not text:
            return ""
        return re.sub(r"[^\w\s]", "", text.strip().lower())

    def diagnose(
        self,
        machine_type: str,
        selected_symptoms: List[str],
        sensor_data: Optional[Dict[str, Any]] = None
    ) -> List[DiagnosisResult]:
        """
        Main Forward Chaining method:
        Takes observed symptoms, fires matching rules, and returns sorted diagnoses.
        """
        if not machine_type or not selected_symptoms:
            return []

        # Clean working memory facts
        working_memory = [s.strip() for s in selected_symptoms if s and s.strip()]
        if not working_memory:
            return []

        # ---------------------------------------------------------------------
        # STEP 1: MATCH PHASE (Find rules matching user symptoms)
        # ---------------------------------------------------------------------
        all_rules = self.kb.get_rules(machine_type)
        matched_rules = []
        norm_wm = {self._normalize(s): s for s in working_memory}

        for rule in all_rules:
            rule_sym_norm = self._normalize(rule.symptom)
            
            # Check exact match or substring match
            if rule_sym_norm in norm_wm:
                rule._matched_symptom = norm_wm[rule_sym_norm]
                matched_rules.append(rule)
            else:
                for norm_s, orig_s in norm_wm.items():
                    if norm_s and (norm_s in rule_sym_norm or rule_sym_norm in norm_s):
                        rule._matched_symptom = orig_s
                        matched_rules.append(rule)
                        break

        if not matched_rules:
            return []

        # ---------------------------------------------------------------------
        # STEP 2: AGGREGATE PHASE (Group multiple rules by root cause)
        # ---------------------------------------------------------------------
        grouped_causes: Dict[str, List[Any]] = {}
        for rule in matched_rules:
            cause_key = rule.cause.strip().rstrip(".;,")
            # Group case-insensitively
            found = False
            for existing in grouped_causes:
                if existing.lower() == cause_key.lower():
                    grouped_causes[existing].append(rule)
                    found = True
                    break
            if not found:
                grouped_causes[cause_key] = [rule]

        # ---------------------------------------------------------------------
        # STEP 3: UNCERTAINTY & DEDUCTION (MYCIN Certainty Factors)
        # ---------------------------------------------------------------------
        results: List[DiagnosisResult] = []

        for cause, rules in grouped_causes.items():
            # Get unique symptoms and rule IDs for this cause
            syms_seen = set()
            unique_syms = []
            for r in rules:
                s = getattr(r, "_matched_symptom", r.symptom)
                if s not in syms_seen:
                    syms_seen.add(s)
                    unique_syms.append(s)

            rule_ids = list(dict.fromkeys(r.id for r in rules))
            sensor_ok = self._check_sensor_support(rules, sensor_data)

            # MYCIN combination algebra: CF_new = CF1 + CF2 * (1 - CF1)
            cf = 0.80  # Base certainty for 1 symptom
            for i in range(1, len(unique_syms)):
                cf = cf + 0.80 * (1.0 - cf)

            # Telemetry corroboration boost (+0.10, capped at 0.99)
            if sensor_ok:
                cf += 0.10
            cf = min(0.99, round(cf, 2))

            # Pick remedy, component, and safety priority
            remedy = rules[0].remedy
            component = rules[0].component
            safety_priority = max(
                (r.safety_priority.upper() for r in rules),
                key=lambda p: self.PRIORITY_WEIGHTS.get(p, 1),
                default="LOW"
            )

            # -----------------------------------------------------------------
            # STEP 4: EXPLANATION FACILITY (6-Step Audit Trail)
            # -----------------------------------------------------------------
            if len(unique_syms) == 1:
                step1 = f'Step 1: Symptom "{unique_syms[0]}" was observed by the user'
            else:
                formatted_syms = ", ".join(f'"{s}"' for s in unique_syms)
                step1 = f'Step 1: Symptoms {formatted_syms} were observed by the user'

            step2 = f'Step 2: Rule {", ".join(rule_ids)} matched — IF symptom observed THEN cause is "{cause}"'
            step3 = f'Step 3: Recommended action: "{remedy}"'
            step4 = f'Step 4: Affected component: "{component}"'

            cf_note = f"multiple symptoms ({len(unique_syms)})" if len(unique_syms) > 1 else "single symptom match"
            if sensor_ok:
                cf_note += " + 0.10 sensor corroboration boost"
            step5 = f'Step 5: Certainty calculated as {cf:.2f} ({cf_note})'
            step6 = f'Step 6: Safety priority: {safety_priority} (evaluated for {cause})'

            results.append(DiagnosisResult(
                cause=cause,
                remedy=remedy,
                component=component,
                certainty=cf,
                safety_priority=safety_priority,
                matched_symptoms=unique_syms,
                matched_rules=rule_ids,
                reasoning_chain=[step1, step2, step3, step4, step5, step6],
                sensor_supported=sensor_ok
            ))

        # ---------------------------------------------------------------------
        # STEP 5: CONFLICT RESOLUTION (Sort by: Priority Weight > Certainty > Evidence)
        # ---------------------------------------------------------------------
        results.sort(
            key=lambda r: (
                self.PRIORITY_WEIGHTS.get(r.safety_priority, 1),
                r.certainty,
                len(r.matched_symptoms)
            ),
            reverse=True
        )

        return results

    def _check_sensor_support(self, rules: List[Any], sensor_data: Optional[Dict[str, Any]]) -> bool:
        """
        Checks if physical sensor measurements confirm any of the matched rules.
        """
        if not sensor_data or not isinstance(sensor_data, dict):
            return False

        if sensor_data.get("corroborates") is True or sensor_data.get("sensor_supported") is True:
            return True

        for r in rules:
            text = f"{r.measurable_condition} {r.component} {r.cause}".lower()

            # Temperature check (> 350K or > 75°C)
            temp = sensor_data.get("temperature") or sensor_data.get("process_temp") or sensor_data.get("temp")
            if temp is not None and any(k in text for k in ("temp", "heat", "hot", "thermal")):
                if isinstance(temp, (int, float)) and (temp > 350 or (30 < temp and temp > 75)):
                    return True

            # Vibration check (> 4.5 mm/s ISO limit)
            vib = sensor_data.get("vibration") or sensor_data.get("vib")
            if vib is not None and any(k in text for k in ("vib", "noise", "bearing")):
                if isinstance(vib, (int, float)) and vib > 4.5:
                    return True

            # Torque / Overload check (> 60 Nm)
            torque = sensor_data.get("torque")
            if torque is not None and any(k in text for k in ("torque", "load", "jam", "strain")):
                if isinstance(torque, (int, float)) and torque > 60:
                    return True

            # Tool wear check (> 200 min)
            wear = sensor_data.get("tool_wear")
            if wear is not None and any(k in text for k in ("wear", "teeth", "abrasion")):
                if isinstance(wear, (int, float)) and wear > 200:
                    return True

        return False
