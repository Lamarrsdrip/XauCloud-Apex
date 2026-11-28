#!/usr/bin/env python3
"""Import the authorized, source-hashed XauCloud exports as reference lessons."""
import argparse
import csv
import hashlib
import json
import math
import sqlite3
from collections import Counter
from pathlib import Path
from statistics import median

EXAM_BOUNDARY_TERMINAL = "2026.11.26"
FIELDS = {
    "demo-tradebrain-20260820": (
        "event", "time", "dir", "setup", "grade", "regime", "session", "outcome", "outcomeLabel",
        "buildHash", "eaVersion", "dataStatus", "tradeRole", "originalOneRDistance", "effectiveSLDistance",
        "executionAnomalyQuarantine", "netProfitIncludingFees", "closeDealFee", "maeGoldPrice",
        "mfeGoldPrice", "maePips", "mfePips", "secondsToMAE", "secondsNegativeTotal", "spreadPoints",
        "slippagePoints", "requestedSL", "exitReason", "entryTimingQuality", "expectedMAERisk",
    ),
    "demo-executed-trade-memory-20250401": (
        "event", "time", "dir", "setup", "grade", "regime", "session", "outcome", "eaVersion",
        "tradeRole", "entryTimingQuality", "secondsNegative", "worstFloating", "exitReason",
    ),
    "demo-blocked-trade-memory-20260820": (
        "event", "time", "dir", "setup", "grade", "reasonKey", "checkpointMin", "favATR",
        "advATR", "regime", "atr",
    ),
    "demo-timing-proof-20260820": (
        "sourcePath", "firstSeenTime", "requiredDelaySeconds", "recoveryWaitSeconds",
        "timingEngineWaitSeconds", "revalidationResult", "bypassUsed", "bypassReason",
        "finalExecutionTime", "executionOwner", "eaVersion",
    ),
}
M10_COLUMNS = (
    "event symbol evidenceId barOpenTime barCloseTime capturedAt evaluatedShift freshnessState dataState "
    "complete trendDirection trendStrength trendState buyPressure sellPressure buyPressureSlope "
    "sellPressureSlope continuationScore exhaustionScore exhaustionPct exhaustedDirection structureState "
    "bullishBos bearishBos bullishReclaim bearishReclaim bullishDisplacement bearishDisplacement "
    "pullbackState locationState buyRoomPips sellRoomPips volatilityState newsState buyCaseScore "
    "sellCaseScore preferredDirection m10DecisionType exactReason"
).split()


def read_source(file, label):
    if label == "m10-v6.28.6":
        with file.open(encoding="utf-8-sig", newline="") as handle:
            rows = csv.reader(handle, delimiter="\t")
            header = next(rows)
            if len(header) != 2 or header[0] != "XAUAI_M10_HISTORY_V1":
                raise ValueError("Unexpected M10 export schema")
            records = [dict(zip(M10_COLUMNS, row)) for row in rows if len(row) == len(M10_COLUMNS)]
            if len(records) != int(header[1]):
                raise ValueError("Incomplete M10 export")
            for row in records:
                # Native M10 evidence retains its own non-account identity and does not supply an outcome.
                yield row.get("capturedAt"), row
        return

    with file.open(encoding="utf-16", newline="") as handle:
        rows = csv.DictReader(handle)
        field = "firstSeenTime" if "firstSeenTime" in FIELDS[label] else "time"
        if field not in rows.fieldnames:
            raise ValueError("Missing terminal timestamp")
        for row in rows:
            timestamps = [row.get(field), row.get("finalExecutionTime")] if field == "firstSeenTime" else [row.get(field)]
            if any(value and value >= EXAM_BOUNDARY_TERMINAL for value in timestamps):
                continue
            timestamp = row.get(field)
            if not timestamp or not timestamp.startswith("2026."):
                continue
            yield timestamp, {key: row[key] for key in FIELDS[label] if row.get(key)}


def values_for(rows, key):
    values = []
    for row in rows:
        if key not in row:
            continue
        value = float(row[key])
        if math.isfinite(value):
            values.append(value)
    return {"n": len(values), "median": median(values) if values else None}


def lesson_summary(lessons):
    summary = {}
    for receipt, reference in lessons:
        rows = [row for _, row in reference]
        entry = {
            "sha256": receipt["sha256"], "count": len(rows),
            "events": dict(Counter(row.get("event", "TIMING") for row in rows)),
            "fromTerminal": min((ts for ts, _ in reference), default=None),
            "throughTerminal": max((ts for ts, _ in reference), default=None),
        }
        if receipt["label"] == "demo-tradebrain-20260820":
            closes = [row for row in rows if row.get("event") == "CLOSE"]
            usable = [row for row in closes if row.get("executionAnomalyQuarantine") == "N"
                      and row.get("dataStatus") == "ENTRY_DATA_PRESENT"]
            entry |= {
                "closeLabels": dict(Counter(row.get("outcomeLabel", "UNLABELED") for row in closes)),
                "statEligibleCloses": len(usable),
                "quarantinedCloses": sum(row.get("executionAnomalyQuarantine") == "Y" for row in closes),
                "normalWinnerMaeUsdPerOz": values_for([r for r in usable if r.get("outcomeLabel") == "NORMAL_STRATEGY_WIN"], "maeGoldPrice"),
                "normalLoserMfeUsdPerOz": values_for([r for r in usable if r.get("outcomeLabel") == "NORMAL_STRATEGY_LOSS"], "mfeGoldPrice"),
            }
        if receipt["label"] == "demo-timing-proof-20260820":
            entry["timingEngineWaitSeconds"] = values_for(rows, "timingEngineWaitSeconds")
        summary[receipt["label"]] = entry
    return {
        "provenance": "ORIGINAL_XAUCLOUD_DEMO_REFERENCE",
        "sourceClock": "TERMINAL_TIME",
        "excludesTerminalDateFrom": EXAM_BOUNDARY_TERMINAL,
        "authority": "REFERENCE_ONLY",
        "sources": summary,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("database", type=Path)
    args = parser.parse_args()
    manifests = json.loads((args.directory / "vps-export-manifest.json").read_bytes())
    lessons = []
    for receipt in manifests:
        label = receipt["label"]
        if label not in FIELDS and label != "m10-v6.28.6":
            raise ValueError("Unexpected export name")
        file = args.directory / (label + ".csv")
        raw = file.read_bytes()
        if len(raw) != receipt["bytes"] or hashlib.sha256(raw).hexdigest() != receipt["sha256"]:
            raise ValueError("Source checksum mismatch")
        lessons.append((receipt, list(read_source(file, label))))
    if {receipt["label"] for receipt, _ in lessons} != set(FIELDS) | {"m10-v6.28.6"}:
        raise ValueError("Incomplete authorized export inventory")

    with sqlite3.connect(args.database, timeout=300) as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS classroom_reference_sources(
                sha256 TEXT PRIMARY KEY, source TEXT NOT NULL, metadata TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS classroom_reference_lessons(
                sha256 TEXT NOT NULL REFERENCES classroom_reference_sources(sha256),
                row_number INTEGER NOT NULL, terminal_time TEXT NOT NULL, lesson TEXT NOT NULL,
                PRIMARY KEY(sha256, row_number)
            );
        """)
        for receipt, records in lessons:
            source = receipt["sha256"]
            safe_receipt = {key: receipt[key] for key in ("label", "sha256", "bytes", "lastWriteUtc")}
            db.execute("INSERT OR IGNORE INTO classroom_reference_sources VALUES(?,?,?)",
                       (source, receipt["label"], json.dumps(safe_receipt)))
            db.executemany("INSERT OR IGNORE INTO classroom_reference_lessons VALUES(?,?,?,?)",
                           ((source, i, timestamp, json.dumps(row)) for i, (timestamp, row) in enumerate(records)))
    print(json.dumps(lesson_summary(lessons), indent=2))


if __name__ == "__main__":
    main()
