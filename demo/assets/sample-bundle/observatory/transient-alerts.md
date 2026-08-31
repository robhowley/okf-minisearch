---
type: concept
title: Transient Alerts
tags:
  - transients
  - alerts
  - follow-up
status: draft
---
# Transient Alerts

## Purpose
A transient alert is a time-sensitive notice that a variable or newly appearing object may merit observation. The observatory accepts alerts from approved networks and from the on-call scientist, then records enough context to make a quick, defensible decision.

## Triage
The on-call astronomer checks the alert timestamp, coordinates, uncertainty region, brightness estimate, visibility, and scientific priority. Reject duplicates, stale positions, targets below the local horizon, and requests that conflict with a protected safety hold. If the target is observable, compare its required cadence and filters with the current schedule. The astronomer may interrupt a flexible block, but must document whose time was displaced and why.

## Response
Create an observation block with the alert identifier, ephemeris source, coordinate epoch, exposure sequence, and deadline. Use a short acquisition exposure before committing to a long series. Notify the instrument operator and record whether the target was detected, missed, or clouded out. Preserve the original alert alongside any revised coordinates; never silently edit incoming metadata. Within one day, send the requester a concise result with timestamps, limiting magnitude or measured brightness, and links to the raw data and observing log.
