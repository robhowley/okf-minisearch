---
type: concept
title: Data Handoff
tags:
  - data
  - provenance
  - handoff
status: stable
---
# Data Handoff

## Purpose
A data handoff transfers an observing night from the control room to the person reducing or archiving it. The handoff should let another operator identify what happened without relying on memory or private messages.

## Package contents
Place raw files in a read-only night directory named with the observing date and run identifier. Include the final schedule, night log, target list, calibration frames, instrument configuration, weather summary, and any alert messages. Generate a file manifest with relative paths, byte sizes, checksums, and acquisition timestamps. Separate successful, partial, and failed sequences, but retain failed files when they explain a gap or instrument problem.

## Review and receipt
The observer reviews filenames, target coordinates, filters, exposure times, and detector temperature before announcing the package. Add a README that states known defects, missing calibrations, clock concerns, and the software version used at acquisition. The recipient verifies the checksum and confirms receipt in the handoff record. Corrections are made by adding a dated note or replacement file; do not rewrite raw data in place. Keep the original package and its receipt together in the archive.
