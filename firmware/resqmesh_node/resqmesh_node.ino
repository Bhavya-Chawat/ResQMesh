/**
 * ResQMesh ESP32 Node Firmware  v4 — Multi-Hop Forwarding
 * =============================================================
 * Adds routing table, DV updates, RSSI-based cost, route invalidation,
 * and routing-table-aware next-hop selection on top of discovery.
 *
 * Roles (set IS_GATEWAY in config.h):
 *   IS_GATEWAY false → pure mesh node  (ESP-NOW only)
 *   IS_GATEWAY true  → gateway node    (ESP-NOW receive + WiFi + MQTT)
 *
 * Dependencies (Arduino Library Manager):
 *   PubSubClient  · ArduinoJson  · DHT sensor library (Adafruit)
 *
 * Board: ESP32 Dev Module
 * Partition Scheme: Default 4MB with spiffs
 */

#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

#include "config.h"
#include "mesh_types.h"
#include "discovery.h"
#include "routing.h"
#include "forwarding.h"

// ── Module singletons ─────────────────────────────────────────────────────────
Discovery  discovery;
Routing    routing;
Forwarding forwarding;

// ── Globals ───────────────────────────────────────────────────────────────────
DHT         dht(DHT_PIN, DHT_TYPE);
WiFiClient  wifiClient;
PubSubClient mqttClient(wifiClient);

static uint8_t MY_MAC[6];   // filled in setup()

// Interval timers
static uint32_t lastSensor    = 0;
static uint32_t lastHeartbeat = 0;
static uint32_t lastTopology  = 0;

// ══════════════════════════════════════════════════════════════════════════════
// MQTT helpers  (gateway only)
// ══════════════════════════════════════════════════════════════════════════════

String topicFor(const char* msgType) {
  return String("resqmesh/") + NODE_ID + "/" + msgType;
}

void mqttReconnect() {
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Connecting...");
    String cid = String("resqmesh-") + NODE_ID + "-" + random(0xffff);
    bool ok = strlen(MQTT_USER) > 0
      ? mqttClient.connect(cid.c_str(), MQTT_USER, MQTT_PASS)
      : mqttClient.connect(cid.c_str());
    if (ok) {
      Serial.println("connected");
    } else {
      Serial.printf("failed (rc=%d) — retry in 3 s\n", mqttClient.state());
      delay(3000);
    }
  }
}

void mqttPublishJson(const char* msgType, JsonDocument& doc) {
  char buf[300];
  serializeJson(doc, buf);
  mqttClient.publish(topicFor(msgType).c_str(), buf);
}

// ══════════════════════════════════════════════════════════════════════════════
// ESP-NOW receive callback
// ══════════════════════════════════════════════════════════════════════════════

// Shared receive handler — called for both gateway and mesh node roles.
// Routes HELLO / HELLO_ACK to the discovery module; DATA/SENSOR/etc. to MQTT
// (on gateway) or future multi-hop forwarding.

void onEspNowRecv(const uint8_t* mac, const uint8_t* data, int len) {
  if (len != sizeof(MeshFrame)) {
    // Legacy frame from old firmware (single-file sketch) — handle gracefully
    if (len == sizeof(struct { char nodeId[8]; char msgType[12]; char jsonPayload[256]; })) {
      // Old EspNowFrame — only gateway handles this path
#if IS_GATEWAY
      struct OldFrame { char nodeId[8]; char msgType[12]; char jsonPayload[256]; };
      const OldFrame* old = (const OldFrame*)data;
      String topic = String("resqmesh/") + old->nodeId + "/" + old->msgType;
      mqttClient.publish(topic.c_str(), old->jsonPayload);
      Serial.printf("[GW] Legacy frame from %s/%s\n", old->nodeId, old->msgType);
#endif
    }
    return;
  }

  const MeshFrame* frame = (const MeshFrame*)data;

  // ── Discovery frames ──────────────────────────────────────────────────────
  if (frame->pktType == PKT_HELLO || frame->pktType == PKT_HELLO_ACK) {
    discovery.handleFrame(mac, frame, 0);
    return;
  }

  // ── DV routing update ─────────────────────────────────────────────────────
  if (frame->pktType == PKT_DV_UPDATE) {
    // Ignore our own broadcasts reflected back
    if (strcmp(frame->srcId, NODE_ID) == 0) return;

    // Link cost to this neighbor from the discovery table
    const NeighborEntry* nb = discovery.findByMac(mac);
    uint8_t linkCost = nb ? (uint8_t)max(1, 110 + (int)nb->rssi) : 50;

    routing.handleDvUpdate(frame->srcId, mac, linkCost, frame);
    return;
  }

  // ── Data-plane frames: dedup + TTL + forward/deliver ────────────────────────
  // forwarding.forward() handles:
  //   - duplicate suppression (seqNum dedup)
  //   - TTL decrement and drop
  //   - gateway MQTT delivery  (IS_GATEWAY)
  //   - next-hop re-send      (!IS_GATEWAY)
  if (frame->pktType == PKT_SENSOR || frame->pktType == PKT_HEARTBEAT ||
      frame->pktType == PKT_DATA   || frame->pktType == PKT_ALERT     ||
      frame->pktType == PKT_TOPOLOGY) {
    forwarding.forward(mac, frame);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Sensor reading
// ══════════════════════════════════════════════════════════════════════════════

float readBatteryPercent() {
  int raw = analogRead(BATTERY_PIN);
  float v = (raw / 4095.0f) * 3.3f * 2.0f;
  return constrain((v - 3.0f) / (4.2f - 3.0f) * 100.0f, 0.0f, 100.0f);
}

float readGasLevel() {
  return (analogRead(GAS_PIN) / 4095.0f) * 1000.0f;
}

// ══════════════════════════════════════════════════════════════════════════════
// Publish helpers
// Sensor readings are serialised into a MeshFrame.payload for mesh nodes;
// the gateway publishes directly to MQTT.
// ══════════════════════════════════════════════════════════════════════════════

// Send an originated MeshFrame toward the gateway.
// Stamps seqNum before transmitting so forwarding nodes can deduplicate.
void sendToGateway(MeshFrame& f) {
#if !IS_GATEWAY
  // Stamp sequence number (origination only — forwarded frames keep their seqNum)
  f.seqNum = forwarding.nextSeq();

  // 1. Try routing table for explicit "GW" destination
  const uint8_t* nhMac = routing.nextHopMac("GW");

  // 2. Fallback: any reachable neighbor (best RSSI)
  if (!nhMac) nhMac = routing.bestNeighborMac();

  if (!nhMac) {
    Serial.println("[Mesh] No route to gateway — frame dropped");
    return;
  }

  esp_err_t err = esp_now_send(nhMac, (const uint8_t*)&f, sizeof(f));
  const NeighborEntry* nb = discovery.findByMac(nhMac);
  Serial.printf("[Mesh] TX seq=%u ttl=%u → %s  err=%d\n",
                f.seqNum, f.ttl, nb ? nb->nodeId : "??", err);
#endif
}

// ── Sensor ────────────────────────────────────────────────────────────────────
void publishSensor() {
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();
  float gas  = readGasLevel();
  float bat  = readBatteryPercent();

  // Build JSON payload
  StaticJsonDocument<256> doc;
  doc["nodeId"]      = NODE_ID;
  doc["label"]       = NODE_LABEL;
  doc["temperature"] = isnan(temp) ? 25.0f : temp;
  doc["humidity"]    = isnan(hum)  ? 50.0f : hum;
  doc["gasLevel"]    = gas;
  doc["battery"]     = bat;
  doc["rssi"]        = (int)WiFi.RSSI();
  doc["latency"]     = 10;
  doc["throughput"]  = 150;

#if IS_GATEWAY
  mqttPublishJson("sensor", doc);
#else
  MeshFrame f;
  frameInit(&f, PKT_SENSOR, NODE_ID, "GW", MY_MAC);
  serializeJson(doc, f.payload, FRAME_PAYLOAD_LEN);
  sendToGateway(f);  // seqNum stamped inside sendToGateway
#endif

  Serial.printf("[Sensor] temp=%.1f hum=%.1f gas=%.0f bat=%.1f\n",
                temp, hum, gas, bat);
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
void publishHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["nodeId"] = NODE_ID;
  doc["ts"]     = millis();

#if IS_GATEWAY
  mqttPublishJson("heartbeat", doc);
#else
  MeshFrame f;
  frameInit(&f, PKT_HEARTBEAT, NODE_ID, "GW", MY_MAC);
  serializeJson(doc, f.payload, FRAME_PAYLOAD_LEN);
  sendToGateway(f);  // seqNum stamped inside sendToGateway
#endif
}

// ── Topology — neighbor table + routing table ─────────────────────────────────
void publishTopology() {
  StaticJsonDocument<512> doc;
  doc["nodeId"] = NODE_ID;

  // ── Neighbours (direct links from discovery) ─────────────────────────────
  JsonArray arr = doc.createNestedArray("neighbours");
  NeighborEntry neighbors[MAX_NEIGHBORS];
  uint8_t cnt = discovery.getNeighbors(neighbors, MAX_NEIGHBORS);
  for (uint8_t i = 0; i < cnt; i++) {
    JsonObject nb = arr.createNestedObject();
    nb["id"]      = neighbors[i].nodeId;
    nb["rssi"]    = neighbors[i].rssi;
    nb["latency"] = max(1, 110 + (int)neighbors[i].rssi); // = link cost
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             neighbors[i].mac[0], neighbors[i].mac[1], neighbors[i].mac[2],
             neighbors[i].mac[3], neighbors[i].mac[4], neighbors[i].mac[5]);
    nb["mac"] = macStr;
  }

  // ── Routing table (full DV table for backend graph view) ─────────────────
  JsonArray routes = doc.createNestedArray("routes");
  RouteEntry routesBuf[MAX_ROUTES];
  uint8_t rCnt = routing.getRoutes(routesBuf, MAX_ROUTES);
  for (uint8_t i = 0; i < rCnt; i++) {
    const RouteEntry& r = routesBuf[i];
    JsonObject ro = routes.createNestedObject();
    ro["dest"]     = r.dest;
    ro["nextHop"]  = r.nextHop;
    ro["cost"]     = r.cost;
    ro["hopCount"] = r.hopCount;
    ro["valid"]    = r.valid;
  }

#if IS_GATEWAY
  mqttPublishJson("topology", doc);
#else
  MeshFrame f;
  frameInit(&f, PKT_TOPOLOGY, NODE_ID, "GW", MY_MAC);
  serializeJson(doc, f.payload, FRAME_PAYLOAD_LEN);
  sendToGateway(f);  // seqNum stamped inside sendToGateway
#endif
}

// ── Alert ─────────────────────────────────────────────────────────────────────
void publishAlert(const char* alertType, const char* message) {
  StaticJsonDocument<200> doc;
  doc["nodeId"]   = NODE_ID;
  doc["label"]    = NODE_LABEL;
  doc["type"]     = alertType;
  doc["severity"] = "critical";
  doc["message"]  = message;

#if IS_GATEWAY
  mqttPublishJson("alert", doc);
#else
  MeshFrame f;
  frameInit(&f, PKT_ALERT, NODE_ID, "GW", MY_MAC);
  serializeJson(doc, f.payload, FRAME_PAYLOAD_LEN);
  sendToGateway(f);  // seqNum stamped inside sendToGateway
#endif
}

// ══════════════════════════════════════════════════════════════════════════════
// Setup
// ══════════════════════════════════════════════════════════════════════════════

void setup() {
  Serial.begin(115200);
  delay(200);
  dht.begin();

#if IS_GATEWAY
  // ── Gateway: WiFi station + AP (AP keeps a fixed channel for ESP-NOW) ──
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WiFi] Connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\n[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("[WiFi] MAC: %s  (share this with mesh nodes)\n",
                WiFi.macAddress().c_str());

  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setBufferSize(512);

#else
  // ── Mesh node: STA mode required for ESP-NOW ──
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();    // don't associate with any AP
  Serial.printf("[Mesh] Node %s  MAC: %s\n",
                NODE_ID, WiFi.macAddress().c_str());
#endif

  // Read our own MAC
  esp_read_mac(MY_MAC, ESP_MAC_WIFI_STA);

  // Init ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("[ESP-NOW] Init FAILED — halting");
    while (true) delay(1000);
  }
  esp_now_register_recv_cb(onEspNowRecv);
  Serial.println("[ESP-NOW] Initialised");

  // Start discovery
  discovery.begin(NODE_ID, MY_MAC);

  // Start routing (depends on discovery)
  routing.begin(NODE_ID, MY_MAC, discovery);

  // Start forwarding (depends on discovery + routing)
  forwarding.begin(NODE_ID, MY_MAC, discovery, routing);
}

// ══════════════════════════════════════════════════════════════════════════════
// Loop
// ══════════════════════════════════════════════════════════════════════════════

void loop() {
  uint32_t now = millis();

#if IS_GATEWAY
  if (!mqttClient.connected()) mqttReconnect();
  mqttClient.loop();
#endif

  // ── Discovery tick (HELLO broadcast + cleanup) ────────────────────────────
  discovery.tick();

  // ── Routing tick (DV broadcast + route timeout) ───────────────────────────
  routing.tick();

  // ── Sensor readings ───────────────────────────────────────────────────────
  if (now - lastSensor >= SENSOR_INTERVAL_MS) {
    lastSensor = now;
    publishSensor();
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    publishHeartbeat();
  }

  // ── Topology report (populated from live neighbor table) ──────────────────
  if (now - lastTopology >= TOPOLOGY_INTERVAL_MS) {
    lastTopology = now;
    publishTopology();
  }

  delay(10);
}
