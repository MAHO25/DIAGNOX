"""
===============================================================================
Knowledge Base Module for Industrial Equipment Fault Diagnosis
===============================================================================
This module stores domain knowledge using two AI representations:
1. Frames (Minsky, 1974): Represents machines and their parts/symptoms.
2. Production Rules (IF-THEN): Maps symptoms to root causes and remedies.
===============================================================================
"""

from __future__ import annotations
import csv
import os
import re
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Dict, List, Optional, Any, Union


# -----------------------------------------------------------------------------
# 1. DATA STRUCTURES (Rule and Frame)
# -----------------------------------------------------------------------------

@dataclass
class Rule:
    """
    Represents an IF-THEN diagnostic rule:
    IF symptom is observed THEN deduce cause, remedy, and affected component.
    """
    id: str
    machine_type: str
    symptom: str
    cause: str
    remedy: str
    component: str
    measurable_condition: str = ""
    source: str = ""
    base_certainty: float = 0.8
    safety_priority: str = "low"

    @property
    def rule_id(self) -> str:
        """Alias for id."""
        return self.id

    def to_dict(self) -> Dict[str, Any]:
        """Convert Rule object to dictionary for JSON serialization."""
        return asdict(self)


@dataclass
class Frame:
    """
    Represents a machine entity (Minsky's Frame Theory).
    Slots: name, components, observable symptoms, and associated rules.
    """
    machine_type: str
    full_name: str
    components: List[str] = field(default_factory=list)
    symptoms: List[str] = field(default_factory=list)
    rules: List[Rule] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "machine_type": self.machine_type,
            "full_name": self.full_name,
            "components": list(self.components),
            "symptoms": list(self.symptoms),
            "rule_count": len(self.rules),
            "rules": [r.to_dict() for r in self.rules],
        }


# -----------------------------------------------------------------------------
# 2. HELPER: DETECT SAFETY PRIORITY
# -----------------------------------------------------------------------------

def detect_safety_priority(cause: str, remedy: str) -> str:
    """
    Assigns safety urgency ('critical', 'high', 'medium', 'low')
    based on keywords in the cause and remedy.
    """
    text = f"{cause} {remedy}".lower()

    # Critical: immediate hazard, fire, shock, explosion
    critical_words = ["fire", "explosion", "shock", "danger", "short-circuit", "ground-fault"]
    if any(re.search(rf"\b{w}\b", text) for w in critical_words):
        return "critical"

    # High: emergency shutdown, severe damage, replace part, trip
    high_words = ["stop", "shut down", "shutdown", "damage", "replace", "burnt", "trip", "trips"]
    if any(re.search(rf"\b{w}\b", text) for w in high_words):
        return "high"

    # Medium: maintenance check, inspect, monitor, adjust
    medium_words = ["inspect", "check", "monitor", "adjust", "clean"]
    if any(re.search(rf"\b{w}\b", text) for w in medium_words):
        return "medium"

    # Low: minor/informational
    return "low"


# -----------------------------------------------------------------------------
# 3. KNOWLEDGE BASE CLASS
# -----------------------------------------------------------------------------

class KnowledgeBase:
    """
    Central repository that loads CSV datasets and stores machine frames & rules.
    """

    MACHINE_NAMES = {
        "motor": "Three-phase induction motor",
        "pump": "Centrifugal pump",
        "gearbox": "Industrial gearbox (gear reducer)",
        "compressor": "Industrial air compressor",
    }

    def __init__(self) -> None:
        # Dictionary holding frames: machine_type -> Frame object
        self.frames: Dict[str, Frame] = {}

    def load_machine(self, machine_type: str, csv_path: Union[str, Path]) -> Frame:
        """
        Reads one CSV file, extracts symptoms/causes/remedies, and builds a Frame.
        """
        path = Path(csv_path)
        if not path.is_file():
            raise FileNotFoundError(f"Dataset CSV not found: {path}")

        m_type = machine_type.strip().lower()
        full_name = self.MACHINE_NAMES.get(m_type, m_type.title())
        id_prefix = m_type.upper()

        rules: List[Rule] = []
        unique_symptoms: List[str] = []
        unique_components: List[str] = []

        # Read CSV file (supports UTF-8 with BOM or standard UTF-8)
        with open(path, mode="r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            
            # Map column headers flexibly
            field_map = {}
            for col in reader.fieldnames or []:
                norm = col.strip().lower()
                if "symptom" in norm: field_map["symptom"] = col
                elif "cause" in norm or "fault" in norm: field_map["cause"] = col
                elif "remedy" in norm or "action" in norm: field_map["remedy"] = col
                elif "component" in norm or "part" in norm: field_map["component"] = col
                elif "condition" in norm or "measurable" in norm: field_map["measurable"] = col
                elif "source" in norm or "reference" in norm: field_map["source"] = col

            rule_idx = 1
            for row in reader:
                symptom = row.get(field_map.get("symptom", ""), "").strip()
                cause = row.get(field_map.get("cause", ""), "").strip()
                remedy = row.get(field_map.get("remedy", ""), "").strip()
                component = row.get(field_map.get("component", ""), "General").strip() or "General"
                condition = row.get(field_map.get("measurable", ""), "").strip()
                source = row.get(field_map.get("source", ""), "").strip()

                if not symptom or not cause:
                    continue  # Skip incomplete rows

                priority = detect_safety_priority(cause, remedy)
                rule_id = f"{id_prefix}_R{rule_idx:03d}"
                rule_idx += 1

                rule = Rule(
                    id=rule_id,
                    machine_type=m_type,
                    symptom=symptom,
                    cause=cause,
                    remedy=remedy,
                    component=component,
                    measurable_condition=condition,
                    source=source,
                    base_certainty=0.8,
                    safety_priority=priority
                )
                rules.append(rule)

                if symptom not in unique_symptoms:
                    unique_symptoms.append(symptom)
                if component and component not in unique_components:
                    unique_components.append(component)

        frame = Frame(
            machine_type=m_type,
            full_name=full_name,
            components=unique_components,
            symptoms=unique_symptoms,
            rules=rules
        )
        self.frames[m_type] = frame
        return frame

    def load_all_machines(self, dataset_dir: Union[str, Path, None] = None) -> Dict[str, Frame]:
        """
        Loads all 4 standard equipment CSVs from the DataSet folder.
        """
        if dataset_dir is None:
            dataset_dir = Path(__file__).resolve().parent / "DataSet"
        else:
            dataset_dir = Path(dataset_dir)

        file_mapping = {
            "motor": "motor_faults.csv",
            "pump": "pump_faults.csv",
            "gearbox": "gearbox_faults.csv",
            "compressor": "compressor_faults.csv",
        }

        for m_type, filename in file_mapping.items():
            csv_file = dataset_dir / filename
            if csv_file.is_file():
                self.load_machine(m_type, csv_file)

        return self.frames

    # Query helper methods
    def get_frame(self, machine_type: str) -> Optional[Frame]:
        """Get the Frame object for a specific machine type."""
        return self.frames.get(machine_type.strip().lower())

    def get_rules(self, machine_type: str) -> List[Rule]:
        """Return all rules for a machine type."""
        frame = self.get_frame(machine_type)
        return list(frame.rules) if frame else []

    def get_symptoms(self, machine_type: str) -> List[str]:
        """Return list of symptoms for a machine type."""
        frame = self.get_frame(machine_type)
        return list(frame.symptoms) if frame else []

    def get_components(self, machine_type: str) -> List[str]:
        """Return list of components for a machine type."""
        frame = self.get_frame(machine_type)
        return list(frame.components) if frame else []

    def get_machine_types(self) -> List[str]:
        """Return list of loaded machine keys (e.g. ['motor', 'pump', ...])."""
        return list(self.frames.keys())

    def to_dict(self) -> Dict[str, Any]:
        """Exports KB summary statistics."""
        return {
            "machine_types": self.get_machine_types(),
            "frames": {m: f.to_dict() for m, f in self.frames.items()},
            "stats": {
                "total_machines": len(self.frames),
                "total_rules": sum(len(f.rules) for f in self.frames.values()),
                "total_symptoms": sum(len(f.symptoms) for f in self.frames.values()),
                "total_components": sum(len(f.components) for f in self.frames.values()),
            }
        }
