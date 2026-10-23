"""Crash-safe CSV rewrites for the pipeline's shared data/businesses.csv."""
import csv
import os


def write_rows(path, fields, rows):
    """Write rows to path atomically: a step that crashes midway leaves the previous file intact.
    Columns are fields plus any extra keys the rows carry, in first-seen order."""
    columns = list(fields)
    for r in rows:
        for k in r:
            if k not in columns:
                columns.append(k)
    tmp = f"{path}.tmp"
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columns, restval="")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, path)
