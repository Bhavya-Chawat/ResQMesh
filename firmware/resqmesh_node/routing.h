#pragma once
// ══════════════════════════════════════════════════════════════════════════════
// ResQMesh — Distance Vector Routing
//
// Implements:
//   • Routing table — per-destination: next-hop MAC, cost, hopCount, seqNum
//   • Link cost     — derived from RSSI: cost = max(1, 110 + RSSI)
//   • DV update TX  — periodic broadcast via QoS queue
//   • DV update RX  — Bellman-Ford relaxation on received neighbor tables
//   • Sequence-number deduplication — stale or looped updates are dropped
//   • Route invalidation — triggered by neighbor timeout OR route age timeout
//   • Poison reverse — invalid routes advertised with cost=DV_INFINITY
//   • Reconvergence  — immediate DV broadcast after any invalidation
//
// Depends on: discovery.h, qos_queue.h, mesh_types.h, config.h
// ══════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <esp_now.h>
#include "config.h"
#include "mesh_types.h"
#include "discovery.h"
#include "qos_queue.h"   // DV broadcasts enqueued at QOS_LOW

// ── Routing table entry ───────────────────────────────────────────────────────

#define MAX_ROUTES  20   // Maximum destinations tracked

struct RouteEntry {
  char    dest[FRAME_NODE_ID_LEN];  // Destination node ID
  char    nextHop[FRAME_NODE_ID_LEN]; // Next-hop node ID (direct neighbor)
  uint8_t nextHopMac[6];            // Next-hop MAC (for esp_now_send)
  uint8_t cost;                     // Total route cost (metric)
  uint8_t hopCount;                 // Hops to destination
  uint8_t seqNum;                   // Last seen sequence number from dest
  uint32_t lastRefreshed;           // millis() of last successful relaxation
  bool    active;                   // Slot in use
  bool    valid;                    // false = route invalidated (cost == DV_INFINITY)
};

// ── Routing engine ────────────────────────────────────────────────────────────

class Routing {
public:
  // ── Init ─────────────────────────────────────────────────────────────────
  // myId      : this node's NODE_ID
  // myMac     : this node's 6-byte MAC
  // disc      : reference to the active Discovery instance
  void begin(const char* myId, const uint8_t myMac[6], Discovery& disc) {
    _myId = myId;
    memcpy(_myMac, myMac, 6);
    _disc = &disc;
    memset(_table, 0, sizeof(_table));
    _mySeq       = 0;
    _lastDvTx    = 0;
    _lastTimeout = 0;
    _dirty       = false;

    // Add a route to ourselves — cost 0, hop 0
    _upsertRoute(_myId, _myId, _myMac, 0, 0, _mySeq);

    Serial.printf("[Routing] Ready — node %s\n", _myId);
  }

  // ── Tick ─────────────────────────────────────────────────────────────────
  // Call from loop(). Handles:
  //   • Periodic DV broadcast
  //   • Stale route invalidation
  void tick() {
    uint32_t now = millis();

    // Sync direct-neighbor link costs before deciding whether to broadcast
    _refreshNeighborRoutes();

    if (now - _lastTimeout >= ROUTE_TIMEOUT_MS / 4) {
      _lastTimeout = now;
      _checkTimeouts(now);
    }

    if (now - _lastDvTx >= DV_UPDATE_INTERVAL_MS || _dirty) {
      _lastDvTx = now;
      _dirty    = false;
      broadcastDV();
    }
  }

  // ── Neighbor-loss hook ────────────────────────────────────────────────────
  // Called by Discovery when a neighbor entry is evicted (timeout or manual).
  // Immediately invalidates every route that uses nodeId as next-hop,
  // applies poison-reverse on the next DV broadcast, and requests an
  // immediate DV update so reconvergence propagates without waiting for
  // DV_UPDATE_INTERVAL_MS.
  void onNeighborLost(const char* nodeId) {
    Serial.printf("[Routing] Neighbor lost: %s — invalidating routes\n", nodeId);

    bool anyInvalidated = false;

    for (uint8_t i = 0; i < MAX_ROUTES; i++) {
      if (!_table[i].active) continue;
      if (strcmp(_table[i].dest, _myId) == 0) continue;  // never invalidate self
      if (!_table[i].valid) continue;                      // already invalid

      if (strcmp(_table[i].nextHop, nodeId) == 0) {
        // Poison: cost = DV_INFINITY, keep entry so we can advertise the poison
        _table[i].cost     = DV_INFINITY;
        _table[i].valid    = false;
        // Increment dest's seqNum so neighbours accept our poison over old routes
        _table[i].seqNum   = (uint8_t)(_table[i].seqNum + 1);
        _table[i].lastRefreshed = millis();
        anyInvalidated = true;
        Serial.printf("[Routing] Poisoned route: %s (was via %s)\n",
                      _table[i].dest, nodeId);
      }
    }

    if (anyInvalidated) {
      _dirty = true;   // triggers immediate broadcastDV() in next tick()
    }
  }

  // ── Handle incoming DV_UPDATE frame ──────────────────────────────────────
  // Call from the ESP-NOW receive callback.
  // neighborId  : srcId of the sending node
  // neighborMac : sender's MAC
  // neighborCost: our link cost to this neighbor (from discovery RSSI)
  void handleDvUpdate(const char* neighborId,
                      const uint8_t neighborMac[6],
                      uint8_t neighborLinkCost,
                      const MeshFrame* frame) {

    // Parse DVEntry array packed into frame->payload
    uint8_t entryCount = frame->payload[0]; // first byte = count
    if (entryCount == 0 || entryCount > DV_MAX_ENTRIES) return;

    const DVEntry* entries = (const DVEntry*)(frame->payload + 1);

    bool changed = false;

    for (uint8_t i = 0; i < entryCount; i++) {
      const DVEntry& e = entries[i];

      // Skip our own entry in the neighbor's table (split horizon)
      if (strcmp(e.dest, _myId) == 0) continue;

      // Clamp to avoid uint8_t overflow
      uint16_t newCost16 = (uint16_t)e.cost + (uint16_t)neighborLinkCost;
      uint8_t  newCost   = (newCost16 >= DV_INFINITY) ? DV_INFINITY
                                                      : (uint8_t)newCost16;
      uint8_t  newHops   = (e.hopCount >= 254)        ? 254
                                                      : e.hopCount + 1;

      RouteEntry* existing = _findRoute(e.dest);

      if (!existing) {
        // New destination — insert if reachable
        if (newCost < DV_INFINITY) {
          _upsertRoute(e.dest, neighborId, neighborMac,
                       newCost, newHops, e.seqNum);
          changed = true;
          Serial.printf("[Routing] New route: %s via %s cost=%d hops=%d\n",
                        e.dest, neighborId, newCost, newHops);
        }
        continue;
      }

      // ── Sequence number check ─────────────────────────────────────────
      // Accept if: seqNum is newer, OR cost is better with same seqNum,
      // OR it's a route invalidation (cost == DV_INFINITY) from the
      // current next-hop.
      bool seqNewer  = _seqNewer(e.seqNum, existing->seqNum);
      bool samePath  = strcmp(existing->nextHop, neighborId) == 0;
      bool betterCost = newCost < existing->cost;
      bool isPoison  = (newCost == DV_INFINITY);

      if (seqNewer) {
        // Newer sequence from anywhere — always accept
        bool updated = _upsertRoute(e.dest, neighborId, neighborMac,
                                    newCost, newHops, e.seqNum);
        changed = changed || updated;

      } else if (!seqNewer && samePath && isPoison) {
        // Poison from current next-hop — invalidate
        existing->cost      = DV_INFINITY;
        existing->valid     = false;
        existing->seqNum    = e.seqNum;
        existing->lastRefreshed = millis();
        changed = true;
        Serial.printf("[Routing] Route invalidated: %s (poison from %s)\n",
                      e.dest, neighborId);

      } else if (!seqNewer && !existing->valid && newCost < DV_INFINITY) {
        // Previously invalid route — restore if reachable
        bool updated = _upsertRoute(e.dest, neighborId, neighborMac,
                                    newCost, newHops, e.seqNum);
        changed = changed || updated;

      } else if (!seqNewer && betterCost && !isPoison) {
        // Same or older seq but better metric — accept
        bool updated = _upsertRoute(e.dest, neighborId, neighborMac,
                                    newCost, newHops, e.seqNum);
        changed = changed || updated;
      }
    }

    if (changed) _dirty = true;
  }

  // ── Broadcast this node's DV table to all neighbors ──────────────────────
  // Enqueues a PKT_DV_UPDATE frame at QOS_LOW through the QoS queue.
  // The drain loop in loop() calls esp_now_send() in priority order.
  void broadcastDV() {
    static const uint8_t BROADCAST[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};

    _mySeq++;  // Increment own sequence number each advertisement

    // Refresh our self-route
    RouteEntry* self = _findRoute(_myId);
    if (self) {
      self->seqNum        = _mySeq;
      self->lastRefreshed = millis();
    }

    // Build frame
    MeshFrame frame;
    frameInit(&frame, PKT_DV_UPDATE, _myId, "**", _myMac);

    uint8_t count = 0;
    DVEntry* entries = (DVEntry*)(frame.payload + 1);

    for (uint8_t i = 0; i < MAX_ROUTES && count < DV_MAX_ENTRIES; i++) {
      if (!_table[i].active) continue;

      DVEntry& e = entries[count++];
      strncpy(e.dest, _table[i].dest, FRAME_NODE_ID_LEN - 1);
      e.dest[FRAME_NODE_ID_LEN - 1] = '\0';
      // Advertise DV_INFINITY for poisoned routes so neighbours reconverge
      e.cost     = _table[i].valid ? _table[i].cost : DV_INFINITY;
      e.hopCount = _table[i].hopCount;
      e.seqNum   = (_table[i].valid && strcmp(_table[i].dest, _myId) == 0)
                     ? _mySeq : _table[i].seqNum;
    }

    frame.payload[0] = count;

    // Ensure broadcast peer is registered
    if (!esp_now_is_peer_exist(BROADCAST)) {
      esp_now_peer_info_t pi = {};
      memcpy(pi.peer_addr, BROADCAST, 6);
      pi.channel = ESPNOW_CHANNEL;
      pi.encrypt = false;
      esp_now_add_peer(&pi);
    }

    esp_err_t err = esp_now_send(BROADCAST, (const uint8_t*)&frame, sizeof(frame));
    Serial.printf("[Routing] DV broadcast  routes=%d seq=%d err=%d\n",
                  count, _mySeq, err);
  }

  // ── Route lookup ──────────────────────────────────────────────────────────
  // Returns the best valid RouteEntry for destId, or nullptr if unreachable.
  const RouteEntry* lookup(const char* destId) const {
    for (uint8_t i = 0; i < MAX_ROUTES; i++) {
      if (_table[i].active && _table[i].valid &&
          strcmp(_table[i].dest, destId) == 0) {
        return &_table[i];
      }
    }
    return nullptr;
  }

  // Returns next-hop MAC for destId, or nullptr if unreachable.
  const uint8_t* nextHopMac(const char* destId) const {
    const RouteEntry* r = lookup(destId);
    return r ? r->nextHopMac : nullptr;
  }

  // Best-RSSI neighbor — fallback when destination unknown (toward gateway)
  const uint8_t* bestNeighborMac() const {
    NeighborEntry neighbors[MAX_NEIGHBORS];
    uint8_t cnt = _disc->getNeighbors(
      const_cast<NeighborEntry*>(neighbors), MAX_NEIGHBORS);
    if (cnt == 0) return nullptr;

    uint8_t best = 0;
    for (uint8_t i = 1; i < cnt; i++) {
      if (neighbors[i].rssi > neighbors[best].rssi) best = i;
    }
    // Return MAC from the internal table via find()
    const NeighborEntry* nb = _disc->find(neighbors[best].nodeId);
    return nb ? nb->mac : nullptr;
  }

  // ── Table dump (for topology publish) ────────────────────────────────────
  uint8_t getRoutes(RouteEntry* out, uint8_t maxOut) const {
    uint8_t written = 0;
    for (uint8_t i = 0; i < MAX_ROUTES && written < maxOut; i++) {
      if (_table[i].active) out[written++] = _table[i];
    }
    return written;
  }

  uint8_t activeCount() const {
    uint8_t n = 0;
    for (uint8_t i = 0; i < MAX_ROUTES; i++) {
      if (_table[i].active && _table[i].valid) n++;
    }
    return n;
  }

private:
  const char* _myId;
  uint8_t     _myMac[6];
  Discovery*  _disc;
  RouteEntry  _table[MAX_ROUTES];
  uint8_t     _mySeq;
  uint32_t    _lastDvTx;
  uint32_t    _lastTimeout;
  bool        _dirty;

  // ── Link cost from RSSI ───────────────────────────────────────────────────
  // Maps RSSI dBm to a cost metric 1..80.
  // -30 dBm (excellent) → cost 1
  // -90 dBm (poor)      → cost 61 (capped at DV_INFINITY - 1 = 254)
  static uint8_t _rssiToCost(int8_t rssi) {
    int c = 110 + (int)rssi;   // -110→0, -30→80
    return (uint8_t)constrain(c, 1, (int)(DV_INFINITY - 1));
  }

  // ── Sequence number comparison (handles 8-bit wraparound) ────────────────
  // Returns true if a is strictly newer than b.
  static bool _seqNewer(uint8_t a, uint8_t b) {
    // Standard DSDV / RIP-style: 127-window wraparound check
    int8_t diff = (int8_t)(a - b);
    return diff > 0;
  }

  // ── Find route entry by destination ID ───────────────────────────────────
  RouteEntry* _findRoute(const char* dest) {
    for (uint8_t i = 0; i < MAX_ROUTES; i++) {
      if (_table[i].active && strcmp(_table[i].dest, dest) == 0) {
        return &_table[i];
      }
    }
    return nullptr;
  }

  // ── Upsert a route entry — returns true if table changed ─────────────────
  bool _upsertRoute(const char* dest, const char* nextHop,
                    const uint8_t nextHopMac[6],
                    uint8_t cost, uint8_t hopCount, uint8_t seqNum) {

    RouteEntry* e = _findRoute(dest);

    if (e) {
      bool changed = (e->cost != cost || strcmp(e->nextHop, nextHop) != 0 ||
                      !e->valid);
      strncpy(e->nextHop, nextHop, FRAME_NODE_ID_LEN - 1);
      memcpy(e->nextHopMac, nextHopMac, 6);
      e->cost         = cost;
      e->hopCount     = hopCount;
      e->seqNum       = seqNum;
      e->lastRefreshed = millis();
      e->valid        = (cost < DV_INFINITY);
      return changed;
    }

    // Insert into free slot
    for (uint8_t i = 0; i < MAX_ROUTES; i++) {
      if (!_table[i].active) {
        memset(&_table[i], 0, sizeof(RouteEntry));
        strncpy(_table[i].dest,    dest,    FRAME_NODE_ID_LEN - 1);
        strncpy(_table[i].nextHop, nextHop, FRAME_NODE_ID_LEN - 1);
        memcpy(_table[i].nextHopMac, nextHopMac, 6);
        _table[i].cost         = cost;
        _table[i].hopCount     = hopCount;
        _table[i].seqNum       = seqNum;
        _table[i].lastRefreshed = millis();
        _table[i].active       = true;
        _table[i].valid        = (cost < DV_INFINITY);
        return true;
      }
    }

    Serial.println("[Routing] WARNING: routing table full");
    return false;
  }

  // ── Sync direct-neighbor costs from discovery table ───────────────────────
  // Called before each DV broadcast so link-cost changes propagate immediately.
  void _refreshNeighborRoutes() {
    NeighborEntry neighbors[MAX_NEIGHBORS];
    uint8_t cnt = _disc->getNeighbors(neighbors, MAX_NEIGHBORS);

    for (uint8_t i = 0; i < cnt; i++) {
      uint8_t cost = _rssiToCost(neighbors[i].rssi);
      _upsertRoute(neighbors[i].nodeId,
                   neighbors[i].nodeId,
                   neighbors[i].mac,
                   cost, 1,
                   _findSeqFor(neighbors[i].nodeId));
    }
  }

  // Get last known seqNum for a destination (0 if unknown)
  uint8_t _findSeqFor(const char* dest) {
    RouteEntry* e = _findRoute(dest);
    return e ? e->seqNum : 0;
  }

  // ── Invalidate stale routes (age-based, runs on timer) ───────────────────
  // Also invalidates routes whose next-hop is no longer in the neighbor table
  // (catches the case where discovery evicted the neighbor between ticks).
  void _checkTimeouts(uint32_t now) {
    bool anyInvalidated = false;

    for (uint8_t i = 0; i < MAX_ROUTES; i++) {
      if (!_table[i].active) continue;
      if (strcmp(_table[i].dest, _myId) == 0) continue;
      if (!_table[i].valid) continue;

      // ── Case A: age timeout ───────────────────────────────────────────
      bool aged = (now - _table[i].lastRefreshed > ROUTE_TIMEOUT_MS);

      // ── Case B: next-hop no longer a live neighbor ────────────────────
      bool nhGone = (_disc->find(_table[i].nextHop) == nullptr);

      if (aged || nhGone) {
        _table[i].cost     = DV_INFINITY;
        _table[i].valid    = false;
        _table[i].seqNum   = (uint8_t)(_table[i].seqNum + 1);
        _table[i].lastRefreshed = now;
        anyInvalidated = true;
        Serial.printf("[Routing] Route invalidated: %s via %s (%s)\n",
                      _table[i].dest, _table[i].nextHop,
                      aged ? "age" : "nh_gone");
      }
    }

    if (anyInvalidated) _dirty = true;
  }
};

// ── Module singleton (extern — defined in the .ino) ──────────────────────────
extern Routing routing;
