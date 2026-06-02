#pragma once
// ══════════════════════════════════════════════════════════════════════════════
// ResQMesh — ESP-NOW Node Discovery
//
// Implements:
//   • HELLO broadcast  — periodic "I exist" advertisement
//   • HELLO_ACK unicast — reply sent directly back to the HELLO sender
//   • Dynamic peer registration — ESP-NOW peer added on first contact
//   • Neighbor table  — per-neighbor: ID, MAC, RSSI, last-seen timestamp
//   • Periodic cleanup — entries older than NEIGHBOR_TIMEOUT_MS are evicted
//
// Does NOT implement: routing, forwarding, QoS, topology propagation.
// ══════════════════════════════════════════════════════════════════════════════

#pragma once

#include <Arduino.h>
#include <esp_now.h>
#include <esp_wifi.h>   // esp_wifi_get_channel
#include "config.h"
#include "mesh_types.h"

// ── Neighbor table entry ──────────────────────────────────────────────────────

struct NeighborEntry {
  char    nodeId[FRAME_NODE_ID_LEN]; // Peer node ID string
  uint8_t mac[6];                    // Peer MAC address
  int8_t  rssi;                      // Last measured link RSSI (dBm)
  uint32_t lastSeen;                 // millis() of last HELLO or HELLO_ACK
  bool    active;                    // Slot in use
};

// ── Discovery module ──────────────────────────────────────────────────────────

class Discovery {
public:
  // ── Init ─────────────────────────────────────────────────────────────────
  // Call once after esp_now_init() and esp_now_register_recv_cb().
  // myId  : this node's NODE_ID string
  // myMac : this node's 6-byte MAC address
  void begin(const char* myId, const uint8_t myMac[6]) {
    _myId = myId;
    memcpy(_myMac, myMac, 6);
    memset(_table, 0, sizeof(_table));
    _lastHello   = 0;
    _lastCleanup = 0;
    Serial.printf("[Discovery] Ready — node %s\n", _myId);
  }

  // ── Tick ─────────────────────────────────────────────────────────────────
  // Call from loop(). Handles periodic HELLO broadcasts and table cleanup.
  void tick() {
    uint32_t now = millis();

    if (now - _lastHello >= HELLO_INTERVAL_MS) {
      _lastHello = now;
      _broadcastHello();
    }

    if (now - _lastCleanup >= NEIGHBOR_CLEANUP_MS) {
      _lastCleanup = now;
      _cleanupStale(now);
    }
  }

  // ── Handle incoming frame ────────────────────────────────────────────────
  // Call from the ESP-NOW receive callback for HELLO and HELLO_ACK frames.
  // mac   : sender's MAC (from ESP-NOW callback)
  // frame : parsed MeshFrame pointer
  // recvRssi : RSSI measured at *this* node when the packet arrived
  //            (read from esp_wifi_sta_get_ap_info or promiscuous sniffer;
  //             pass 0 if unavailable — the sender's self-reported rssi
  //             in frame->rssi is used as fallback)
  void handleFrame(const uint8_t mac[6], const MeshFrame* frame, int8_t recvRssi) {
    if (frame->pktType == PKT_HELLO) {
      _onHello(mac, frame, recvRssi);
    } else if (frame->pktType == PKT_HELLO_ACK) {
      _onHelloAck(mac, frame, recvRssi);
    }
  }

  // ── Neighbor table accessors ─────────────────────────────────────────────

  // Returns number of active neighbor slots.
  uint8_t count() const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < MAX_NEIGHBORS; i++) {
      if (_table[i].active) n++;
    }
    return n;
  }

  // Copy active entries into caller-supplied array (up to maxOut entries).
  // Returns number of entries written.
  uint8_t getNeighbors(NeighborEntry* out, uint8_t maxOut) const {
    uint8_t written = 0;
    for (uint8_t i = 0; i < MAX_NEIGHBORS && written < maxOut; i++) {
      if (_table[i].active) {
        out[written++] = _table[i];
      }
    }
    return written;
  }

  // Find a neighbor by nodeId string. Returns nullptr if not found.
  const NeighborEntry* find(const char* nodeId) const {
    for (uint8_t i = 0; i < MAX_NEIGHBORS; i++) {
      if (_table[i].active && strcmp(_table[i].nodeId, nodeId) == 0) {
        return &_table[i];
      }
    }
    return nullptr;
  }

  // Find a neighbor by MAC. Returns nullptr if not found.
  const NeighborEntry* findByMac(const uint8_t mac[6]) const {
    for (uint8_t i = 0; i < MAX_NEIGHBORS; i++) {
      if (_table[i].active && memcmp(_table[i].mac, mac, 6) == 0) {
        return &_table[i];
      }
    }
    return nullptr;
  }

  // True if the given MAC is registered as an ESP-NOW peer.
  bool isPeer(const uint8_t mac[6]) const {
    return esp_now_is_peer_exist(mac);
  }

private:
  const char* _myId;
  uint8_t     _myMac[6];
  NeighborEntry _table[MAX_NEIGHBORS];
  uint32_t    _lastHello;
  uint32_t    _lastCleanup;

  // ── Broadcast HELLO ───────────────────────────────────────────────────────
  // ESP-NOW broadcast address: FF:FF:FF:FF:FF:FF
  void _broadcastHello() {
    static const uint8_t BROADCAST[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};

    // Ensure broadcast peer is registered
    if (!esp_now_is_peer_exist(BROADCAST)) {
      esp_now_peer_info_t pi = {};
      memcpy(pi.peer_addr, BROADCAST, 6);
      pi.channel = ESPNOW_CHANNEL;
      pi.encrypt = false;
      esp_now_add_peer(&pi);
    }

    MeshFrame f;
    frameInit(&f, PKT_HELLO, _myId, "**", _myMac);
    f.rssi = 0;  // sender-side RSSI not applicable for broadcasts

    esp_err_t err = esp_now_send(BROADCAST, (const uint8_t*)&f, sizeof(f));
    Serial.printf("[Discovery] HELLO broadcast — neighbors: %d  err: %d\n",
                  count(), err);
  }

  // ── Handle received HELLO ─────────────────────────────────────────────────
  void _onHello(const uint8_t mac[6], const MeshFrame* frame, int8_t recvRssi) {
    // Ignore our own HELLO (can happen on some radios)
    if (strcmp(frame->srcId, _myId) == 0) return;

    int8_t linkRssi = (recvRssi != 0) ? recvRssi : frame->rssi;
    Serial.printf("[Discovery] HELLO from %s  RSSI=%d\n", frame->srcId, linkRssi);

    // Update (or insert) into neighbor table
    _upsert(frame->srcId, mac, linkRssi);

    // Register as ESP-NOW peer if not already
    _ensurePeer(mac);

    // Reply with HELLO_ACK unicast
    _sendHelloAck(mac, frame->srcId);
  }

  // ── Handle received HELLO_ACK ─────────────────────────────────────────────
  void _onHelloAck(const uint8_t mac[6], const MeshFrame* frame, int8_t recvRssi) {
    if (strcmp(frame->srcId, _myId) == 0) return;

    int8_t linkRssi = (recvRssi != 0) ? recvRssi : frame->rssi;
    Serial.printf("[Discovery] HELLO_ACK from %s  RSSI=%d\n",
                  frame->srcId, linkRssi);

    _upsert(frame->srcId, mac, linkRssi);
    _ensurePeer(mac);
  }

  // ── Send unicast HELLO_ACK ────────────────────────────────────────────────
  void _sendHelloAck(const uint8_t dstMac[6], const char* dstId) {
    MeshFrame f;
    frameInit(&f, PKT_HELLO_ACK, _myId, dstId, _myMac);
    f.rssi = 0;
    esp_now_send(dstMac, (const uint8_t*)&f, sizeof(f));
    Serial.printf("[Discovery] HELLO_ACK → %s\n", dstId);
  }

  // ── Upsert neighbor table entry ───────────────────────────────────────────
  void _upsert(const char* nodeId, const uint8_t mac[6], int8_t rssi) {
    // Search for existing entry by nodeId OR mac
    for (uint8_t i = 0; i < MAX_NEIGHBORS; i++) {
      if (_table[i].active &&
          (strcmp(_table[i].nodeId, nodeId) == 0 ||
           memcmp(_table[i].mac, mac, 6) == 0)) {
        // Update in place
        strncpy(_table[i].nodeId, nodeId, FRAME_NODE_ID_LEN - 1);
        memcpy(_table[i].mac, mac, 6);
        // Exponential moving average for RSSI: α = 0.25
        _table[i].rssi    = (int8_t)(_table[i].rssi * 0.75f + rssi * 0.25f);
        _table[i].lastSeen = millis();
        return;
      }
    }

    // Insert into first free slot
    for (uint8_t i = 0; i < MAX_NEIGHBORS; i++) {
      if (!_table[i].active) {
        memset(&_table[i], 0, sizeof(NeighborEntry));
        strncpy(_table[i].nodeId, nodeId, FRAME_NODE_ID_LEN - 1);
        memcpy(_table[i].mac, mac, 6);
        _table[i].rssi     = rssi;
        _table[i].lastSeen = millis();
        _table[i].active   = true;
        Serial.printf("[Discovery] New neighbor: %s  RSSI=%d\n", nodeId, rssi);
        return;
      }
    }

    Serial.println("[Discovery] WARNING: neighbor table full");
  }

  // ── Ensure ESP-NOW unicast peer is registered ─────────────────────────────
  void _ensurePeer(const uint8_t mac[6]) {
    if (!esp_now_is_peer_exist(mac)) {
      esp_now_peer_info_t pi = {};
      memcpy(pi.peer_addr, mac, 6);
      pi.channel = ESPNOW_CHANNEL;
      pi.encrypt = false;
      esp_err_t err = esp_now_add_peer(&pi);
      Serial.printf("[Discovery] Registered peer  err=%d\n", err);
    }
  }

  // ── Evict stale neighbors ─────────────────────────────────────────────────
  void _cleanupStale(uint32_t now) {
    for (uint8_t i = 0; i < MAX_NEIGHBORS; i++) {
      if (!_table[i].active) continue;
      if (now - _table[i].lastSeen > NEIGHBOR_TIMEOUT_MS) {
        Serial.printf("[Discovery] Evicting stale neighbor: %s\n",
                      _table[i].nodeId);

        // Remove ESP-NOW unicast peer (keep broadcast peer)
        static const uint8_t BROADCAST[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
        if (memcmp(_table[i].mac, BROADCAST, 6) != 0) {
          esp_now_del_peer(_table[i].mac);
        }

        memset(&_table[i], 0, sizeof(NeighborEntry));
        // active is now false — slot is free
      }
    }
  }
};

// ── Module singleton (extern — defined in the .ino) ──────────────────────────
extern Discovery discovery;
