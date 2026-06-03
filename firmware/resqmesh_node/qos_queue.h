#pragma once
// ══════════════════════════════════════════════════════════════════════════════
// ResQMesh — QoS Transmission Queue
//
// Implements four strict-priority ring-buffer queues for outgoing ESP-NOW
// frames.  All transmit paths (origination + forwarding) enqueue frames here
// rather than calling esp_now_send() directly.  The drain loop in loop() always
// services higher-priority queues to exhaustion before advancing to lower ones.
//
//  Priority   Level       Default packet types
//  ─────────  ──────────  ──────────────────────────────────
//  QOS_HIGH   0  (3 bit)  PKT_ALERT  (SOS / emergency)
//  QOS_MEDIUM 1           PKT_SENSOR, PKT_HEARTBEAT, PKT_TOPOLOGY
//  QOS_LOW    2           PKT_DATA, PKT_DV_UPDATE
//  QOS_DEBUG  3           Future diagnostic types
//
// Capacity per queue is configurable via QOS_QUEUE_DEPTH (default 8).
// When a queue is full the incoming frame is silently dropped and the
// overflow counter for that priority level is incremented.
//
// drainOne() sends at most one frame per call and returns whether it did.
// Call it in a tight loop until it returns false (all queues empty) or
// until a time budget is exhausted.
//
// Depends on: mesh_types.h
// ══════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <esp_now.h>
#include "mesh_types.h"

#ifndef QOS_QUEUE_DEPTH
#define QOS_QUEUE_DEPTH  8   // Slots per priority ring buffer
#endif

// ── Queue slot ────────────────────────────────────────────────────────────────

struct QosSlot {
  uint8_t dstMac[6];   // ESP-NOW destination MAC
  MeshFrame frame;     // Full frame copy
  bool     used;
};

// ── QoS queue engine ──────────────────────────────────────────────────────────

class QosQueue {
public:
  // ── Init ──────────────────────────────────────────────────────────────────
  void begin() {
    for (uint8_t p = 0; p < QOS_NUM_LEVELS; p++) {
      _head[p]     = 0;
      _tail[p]     = 0;
      _count[p]    = 0;
      _dropped[p]  = 0;
      for (uint8_t i = 0; i < QOS_QUEUE_DEPTH; i++) {
        _queues[p][i].used = false;
      }
    }
    Serial.printf("[QoS] Ready  depth=%d  priorities=%d\n",
                  QOS_QUEUE_DEPTH, QOS_NUM_LEVELS);
  }

  // ── Enqueue ───────────────────────────────────────────────────────────────
  // Copies frame + dstMac into the ring buffer for the given priority level.
  // Returns true on success, false if the queue is full (frame dropped).
  // Priority is inferred from frame.pktType when pri == QOS_DEBUG is not
  // explicitly needed — callers may also override it.
  bool enqueue(const uint8_t dstMac[6], const MeshFrame& frame,
               QosPriority pri) {
    if (_count[pri] >= QOS_QUEUE_DEPTH) {
      _dropped[pri]++;
      Serial.printf("[QoS] DROP overflow pri=%d pkt=0x%02X total_dropped=%u\n",
                    pri, frame.pktType, _dropped[pri]);
      return false;
    }

    QosSlot& slot = _queues[pri][_tail[pri]];
    memcpy(slot.dstMac, dstMac, 6);
    memcpy(&slot.frame, &frame, sizeof(MeshFrame));
    slot.used = true;

    _tail[pri] = (_tail[pri] + 1) % QOS_QUEUE_DEPTH;
    _count[pri]++;
    return true;
  }

  // Convenience overload: priority inferred from frame.pktType.
  bool enqueue(const uint8_t dstMac[6], const MeshFrame& frame) {
    return enqueue(dstMac, frame, pktTypeToPriority(frame.pktType));
  }

  // ── DrainOne ──────────────────────────────────────────────────────────────
  // Dequeues and sends exactly one frame from the highest non-empty queue.
  // Returns true if a frame was sent, false if all queues are empty.
  // Call in a loop from loop() until false or a time budget expires.
  bool drainOne() {
    for (uint8_t p = 0; p < QOS_NUM_LEVELS; p++) {
      if (_count[p] == 0) continue;

      QosSlot& slot = _queues[p][_head[p]];

      esp_err_t err = esp_now_send(slot.dstMac,
                                   (const uint8_t*)&slot.frame,
                                   sizeof(MeshFrame));

      Serial.printf("[QoS] TX pri=%d pkt=0x%02X src=%s dst=%s seq=%u err=%d"
                    "  q=[%d,%d,%d,%d]\n",
                    p, slot.frame.pktType, slot.frame.srcId,
                    slot.frame.dstId,  slot.frame.seqNum, err,
                    _count[0], _count[1], _count[2], _count[3]);

      // Advance head regardless of err — a failed send is still consumed
      // to prevent head-of-line blocking on a permanently unreachable peer.
      slot.used = false;
      _head[p]  = (_head[p] + 1) % QOS_QUEUE_DEPTH;
      _count[p]--;

      return true;   // Caller decides whether to continue draining
    }
    return false;   // All queues empty
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────

  // Total pending frames across all queues.
  uint8_t pending() const {
    uint8_t n = 0;
    for (uint8_t p = 0; p < QOS_NUM_LEVELS; p++) n += _count[p];
    return n;
  }

  // Pending count for a specific priority.
  uint8_t pendingAt(QosPriority p) const { return _count[p]; }

  // Total frames dropped due to overflow since boot.
  uint32_t droppedAt(QosPriority p) const { return _dropped[p]; }

private:
  QosSlot  _queues[QOS_NUM_LEVELS][QOS_QUEUE_DEPTH];
  uint8_t  _head[QOS_NUM_LEVELS];
  uint8_t  _tail[QOS_NUM_LEVELS];
  uint8_t  _count[QOS_NUM_LEVELS];
  uint32_t _dropped[QOS_NUM_LEVELS];
};

// ── Module singleton (extern — defined in the .ino) ──────────────────────────
extern QosQueue qosQueue;
