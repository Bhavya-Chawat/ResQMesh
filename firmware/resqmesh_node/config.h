#pragma once

// ══════════════════════════════════════════════════════════════════════════════
// ResQMesh — Node Configuration
// Edit ONLY this file before flashing each node.
// ══════════════════════════════════════════════════════════════════════════════

// ── Node identity ─────────────────────────────────────────────────────────────
#define NODE_ID     "A"        // Unique ID: single char or short string (≤7 chars)
#define NODE_LABEL  "Node A"   // Human-readable display name

// ── Role ─────────────────────────────────────────────────────────────────────
// true  = Gateway: runs WiFi + MQTT + ESP-NOW receive
// false = Mesh node: runs ESP-NOW only (no WiFi credentials needed)
#define IS_GATEWAY  true

// ── WiFi / MQTT (gateway only — ignored on mesh nodes) ───────────────────────
#define WIFI_SSID      "Madhur"
#define WIFI_PASSWORD  "qwertyuiop"
#define MQTT_BROKER    "172.20.10.9"
#define MQTT_PORT      1883
#define MQTT_USER      ""
#define MQTT_PASS      ""

// ── ESP-NOW channel ───────────────────────────────────────────────────────────
// Must match on all nodes in the mesh. Gateway uses WIFI_AP_STA so its channel
// is locked by the AP; mesh nodes will hop to this channel automatically.
#define ESPNOW_CHANNEL  1

// ── Sensor pins ───────────────────────────────────────────────────────────────
#define DHT_PIN       4
#define DHT_TYPE      DHT22
#define GAS_PIN       34    // MQ-2 analog output
#define BATTERY_PIN   35    // Voltage divider to LiPo

// ── Timing (milliseconds) ────────────────────────────────────────────────────
#define HELLO_INTERVAL_MS       5000   // Broadcast HELLO every 5 s
#define NEIGHBOR_TIMEOUT_MS    15000   // Remove neighbor if silent for 15 s
#define NEIGHBOR_CLEANUP_MS     5000   // Run cleanup check every 5 s
#define DV_UPDATE_INTERVAL_MS   6000   // Broadcast DV table every 6 s
#define ROUTE_TIMEOUT_MS       20000   // Invalidate route if no DV update for 20 s
#define SENSOR_INTERVAL_MS      2000
#define HEARTBEAT_INTERVAL_MS   2000
#define TOPOLOGY_INTERVAL_MS   10000

// ── Discovery limits ─────────────────────────────────────────────────────────
#define MAX_NEIGHBORS  10   // Maximum entries in the neighbor table

// ── QoS limits ───────────────────────────────────────────────────────────────
#define QOS_QUEUE_DEPTH       8   // Slots per priority ring buffer
#define QOS_DRAIN_BUDGET_MS   8   // Max ms spent draining queues per loop() call
