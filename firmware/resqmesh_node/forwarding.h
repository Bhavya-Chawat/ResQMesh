#pragma once
// ══════════════════════════════════════════════════════════════════════════════
// ResQMesh — Multi-Hop Packet Forwarding
//
// Implements:
//   • Per-source sequence number deduplication
//       – Duplicate frames (same srcId + seqNum) are silently dropped
//       – Window of DEDUP_CACHE_SIZE recent (srcId, seqNum) pairs kept
//   • TTL decrement
//       – Every forwarding hop decrements frame.ttl by 1
//       – Frame is dropped (not forwarded) when ttl reaches 0
//   • Next-hop forwarding
//       – Uses routing.nextHopMac(frame.dstId) for unicast destinations
//       – Broadcast-destined frames ("**", "GW") are also deduplicated
//       – Gateway re-delivers to MQTT; intermediate nodes re-send to next hop
//
// Depends on: routing.h, discovery.h, mesh_types.h, qos_queue.h, config.h
// ══════════════════════════════════════════════════════════════════════════════

#include "qos_queue.h"

// ── Deduplication cache ───────────────────────────────────────────────────────

// Size of the rolling (srcId, seqNum) seen-set.
// At one frame per 2 s per node, 32 slots cover ~64 s of traffic for one node,
// or ~5 s across 6 simultaneous senders — sufficient for mesh convergence time.
#ifndef DEDUP_CACHE_SIZE
#define DEDUP_CACHE_SIZE  32
#endif

struct DedupEntry {
  char     srcId[FRAME_NODE_ID_LEN];
  uint16_t seqNum;
  bool     valid;
};

// ── Forwarding engine ─────────────────────────────────────────────────────────

class Forwarding {
public:
  // ── Init ─────────────────────────────────────────────────────────────────
  // myId   : this node's NODE_ID
  // myMac  : this node's 6-byte MAC
  // disc   : active Discovery instance
  // rout   : active Routing instance
  void begin(const char* myId, const uint8_t myMac[6],
             Discovery& disc, Routing& rout) {
    _myId  = myId;
    memcpy(_myMac, myMac, 6);
    _disc  = &disc;
    _rout  = &rout;
    memset(_cache, 0, sizeof(_cache));
    _cacheIdx   = 0;
    _txSeqNum   = 0;
    Serial.printf("[Fwd] Ready — node %s  dedup_cache=%d\n",
                  _myId, DEDUP_CACHE_SIZE);
  }

  // ── Next outgoing sequence number ────────────────────────────────────────
  // Call once per data frame this node originates before calling frameInit.
  uint16_t nextSeq() { return ++_txSeqNum; }

  // ── Forward an incoming data frame ───────────────────────────────────────
  // Called from the ESP-NOW recv callback for data-plane frames
  // (PKT_DATA, PKT_SENSOR, PKT_HEARTBEAT, PKT_ALERT, PKT_TOPOLOGY).
  //
  // Returns:
  //   true  — frame was delivered locally (gateway → MQTT) or forwarded
  //   false — frame was dropped (duplicate or TTL expired)
  //
  // On the gateway node this publishes to MQTT.
  // On mesh nodes this re-sends toward the next hop.
  bool forward(const uint8_t* recvMac, const MeshFrame* frame) {
    extern bool isIsolatedManually;
    if (isIsolatedManually) {
      bool forUs = (strcmp(frame->dstId, _myId) == 0);
      if (forUs && frame->pktType == PKT_DATA) {
        if (!_isSeen(frame->srcId, frame->seqNum)) {
          _markSeen(frame->srcId, frame->seqNum);
          _handleLocalControl(frame);
        }
      }
      return false;
    }


    // ── Step 1: Deduplication ────────────────────────────────────────────
    if (_isSeen(frame->srcId, frame->seqNum)) {
      Serial.printf("[Fwd] DROP duplicate: src=%s seq=%u\n",
                    frame->srcId, frame->seqNum);
      return false;
    }
    _markSeen(frame->srcId, frame->seqNum);

    // ── Step 2: TTL check ────────────────────────────────────────────────
    if (frame->ttl == 0) {
      Serial.printf("[Fwd] DROP TTL=0: src=%s seq=%u type=0x%02X\n",
                    frame->srcId, frame->seqNum, frame->pktType);
      return false;
    }

    // ── Step 3: Are we the final destination? ────────────────────────────
    bool forUs = (strcmp(frame->dstId, _myId) == 0 ||
                  strcmp(frame->dstId, "**")  == 0);

#if IS_GATEWAY
    // Gateway is the sink for "GW" and "**" destinations
    if (forUs || strcmp(frame->dstId, "GW") == 0) {
      _deliverToMqtt(frame);
      return true;
    }
#else
    if (forUs) {
      // Mesh node is the named destination — consume locally.
      // (Application callbacks can be registered here in a future layer.)
      Serial.printf("[Fwd] DELIVER local: src=%s seq=%u\n",
                    frame->srcId, frame->seqNum);
      if (frame->pktType == PKT_DATA) {
        _handleLocalControl(frame);
      }
      return true;
    }
#endif

    // ── Step 4: Forward to next hop ──────────────────────────────────────
    // Build a mutable copy with decremented TTL.
    MeshFrame fwd;
    memcpy(&fwd, frame, sizeof(MeshFrame));
    fwd.ttl--;   // TTL decrement happens at every forwarding node

    const uint8_t* nhMac = nullptr;

    if (strcmp(fwd.dstId, "GW") == 0 || strcmp(fwd.dstId, "**") == 0) {
      // Toward gateway: use routing table, fall back to best neighbor
      nhMac = _rout->nextHopMac("GW");
      if (!nhMac) nhMac = _rout->bestNeighborMac();
    } else {
      // Named destination: routing table lookup
      nhMac = _rout->nextHopMac(fwd.dstId);
    }

    if (!nhMac) {
      Serial.printf("[Fwd] DROP no_route: src=%s dst=%s seq=%u\n",
                    fwd.srcId, fwd.dstId, fwd.seqNum);
      return false;
    }

    // Avoid sending back to the node we received from (simple loop guard)
    if (memcmp(nhMac, recvMac, 6) == 0) {
      Serial.printf("[Fwd] DROP loop_guard: src=%s dst=%s seq=%u\n",
                    fwd.srcId, fwd.dstId, fwd.seqNum);
      return false;
    }

    // Enqueue through QoS layer — priority inferred from frame.pktType.
    // drainOne() in loop() will call esp_now_send() in priority order.
    bool ok = qosQueue.enqueue(nhMac, fwd);

    const NeighborEntry* nb = _disc->findByMac(nhMac);
    Serial.printf("[Fwd] ENQUEUE src=%s dst=%s seq=%u ttl=%u → %s  ok=%d\n",
                  fwd.srcId, fwd.dstId, fwd.seqNum, fwd.ttl,
                  nb ? nb->nodeId : "??", ok);
    return ok;
  }

private:
  const char* _myId;
  uint8_t     _myMac[6];
  Discovery*  _disc;
  Routing*    _rout;
  DedupEntry  _cache[DEDUP_CACHE_SIZE];
  uint8_t     _cacheIdx;   // circular-buffer write pointer
  uint16_t    _txSeqNum;   // monotonically increasing tx sequence number

  // ── Dedup: check ────────────────────────────────────────────────────────
  bool _isSeen(const char* srcId, uint16_t seq) const {
    for (uint8_t i = 0; i < DEDUP_CACHE_SIZE; i++) {
      if (_cache[i].valid &&
          _cache[i].seqNum == seq &&
          strcmp(_cache[i].srcId, srcId) == 0) {
        return true;
      }
    }
    return false;
  }

  // ── Dedup: record ────────────────────────────────────────────────────────
  void _markSeen(const char* srcId, uint16_t seq) {
    DedupEntry& e = _cache[_cacheIdx];
    strncpy(e.srcId, srcId, FRAME_NODE_ID_LEN - 1);
    e.srcId[FRAME_NODE_ID_LEN - 1] = '\0';
    e.seqNum = seq;
    e.valid  = true;
    _cacheIdx = (_cacheIdx + 1) % DEDUP_CACHE_SIZE;
  }

  // ── Gateway: deliver frame payload to MQTT ───────────────────────────────
#if IS_GATEWAY
  void _deliverToMqtt(const MeshFrame* frame) {
    const char* mtype = nullptr;
    switch ((PktType)frame->pktType) {
      case PKT_SENSOR:    mtype = "sensor";    break;
      case PKT_HEARTBEAT: mtype = "heartbeat"; break;
      case PKT_DATA:      mtype = "data";      break;
      case PKT_ALERT:     mtype = "alert";     break;
      case PKT_TOPOLOGY:  mtype = "topology";  break;
      default: break;
    }
    if (!mtype) return;

    // Topic uses the original source node ID — preserves backend contract
    extern PubSubClient mqttClient;
    String topic = String("resqmesh/") + frame->srcId + "/" + mtype;
    mqttClient.publish(topic.c_str(), frame->payload);
    Serial.printf("[Fwd] MQTT: %s  ttl_remaining=%u hops_taken=%u\n",
                  topic.c_str(), frame->ttl,
                  (uint8_t)(FRAME_DEFAULT_TTL - frame->ttl));
  }
#endif

  void _handleLocalControl(const MeshFrame* frame) {
    StaticJsonDocument<128> doc;
    DeserializationError error = deserializeJson(doc, frame->payload);
    if (!error) {
      const char* status = doc["status"];
      if (status) {
        extern bool isIsolatedManually;
        if (strcmp(status, "failed") == 0) {
          isIsolatedManually = true;
          digitalWrite(LED_RED_PIN, HIGH);
          Serial.println("[Control] Manually isolated — Red LED glows");
        } else if (strcmp(status, "active") == 0) {
          isIsolatedManually = false;
          digitalWrite(LED_RED_PIN, LOW);
          Serial.println("[Control] Manually recovered — Red LED off");
        }
      }
    } else {
      Serial.printf("[Control] Failed to parse control payload: %s\n", error.c_str());
    }
  }
};

// ── Module singleton (extern — defined in the .ino) ──────────────────────────
extern Forwarding forwarding;
