/**
 * ResQMesh ESP32 Node Firmware
 * ============================
 * Reads sensors (DHT22, MQ-2 gas sensor) and publishes to MQTT
 * via an ESP-NOW gateway bridge.
 *
 * For ESP-NOW mesh nodes (non-gateway):
 *   - Sends ESP-NOW frames to the gateway MAC address
 *
 * For the gateway ESP32:
 *   - Receives ESP-NOW frames and re-publishes to MQTT over WiFi
 *
 * MQTT Topics published:
 *   resqmesh/<NODE_ID>/sensor     – sensor readings
 *   resqmesh/<NODE_ID>/heartbeat  – keepalive every HEARTBEAT_INTERVAL_MS
 *   resqmesh/<NODE_ID>/alert      – emergency/SOS
 *   resqmesh/<NODE_ID>/topology   – neighbour list
 *
 * Dependencies (install via Arduino Library Manager):
 *   - PubSubClient  (Nick O'Leary)
 *   - ArduinoJson   (Benoit Blanchon)
 *   - DHT sensor library (Adafruit)
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

// ──────────────────────────────────────────────
// Configuration — edit these before flashing
// ──────────────────────────────────────────────

#define NODE_ID        "A"          // Unique single-char or short string ID
#define NODE_LABEL     "Node A"
#define IS_GATEWAY     true         // true = gateway (WiFi+MQTT), false = mesh node only

// WiFi (gateway only)
#define WIFI_SSID      "YOUR_SSID"
#define WIFI_PASSWORD  "YOUR_PASSWORD"

// MQTT (gateway only)
#define MQTT_BROKER    "192.168.1.100"  // IP of Mosquitto broker
#define MQTT_PORT      1883
#define MQTT_USER      ""
#define MQTT_PASS      ""

// Gateway ESP-NOW MAC — all mesh nodes send to this MAC
// Run Serial.println(WiFi.macAddress()) on the gateway to find it
static uint8_t GATEWAY_MAC[] = {0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF};

// Sensor pins
#define DHT_PIN        4
#define DHT_TYPE       DHT22
#define GAS_PIN        34   // MQ-2 analog output
#define BATTERY_PIN    35   // Voltage divider to battery

// Intervals
#define SENSOR_INTERVAL_MS    2000
#define HEARTBEAT_INTERVAL_MS 3000
#define TOPOLOGY_INTERVAL_MS  10000

// ──────────────────────────────────────────────
// Globals
// ──────────────────────────────────────────────

DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ESP-NOW payload struct (shared between gateway and mesh nodes)
typedef struct {
  char     nodeId[8];
  char     msgType[12];   // "sensor", "heartbeat", "alert", "topology"
  char     jsonPayload[256];
} EspNowFrame;

static EspNowFrame outFrame;
static EspNowFrame inFrame;

unsigned long lastSensor    = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastTopology  = 0;

// ──────────────────────────────────────────────
// MQTT helpers
// ──────────────────────────────────────────────

String topicFor(const char* msgType) {
  return String("resqmesh/") + NODE_ID + "/" + msgType;
}

void mqttReconnect() {
  while (!mqttClient.connected()) {
    Serial.print("[MQTT] Connecting...");
    String clientId = String("resqmesh-") + NODE_ID + "-" + random(0xffff);
    bool ok = strlen(MQTT_USER) > 0
      ? mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)
      : mqttClient.connect(clientId.c_str());
    if (ok) {
      Serial.println("connected");
    } else {
      Serial.printf("failed (rc=%d) — retry in 3s\n", mqttClient.state());
      delay(3000);
    }
  }
}

void publishJson(const char* msgType, JsonDocument& doc) {
  char buf[300];
  serializeJson(doc, buf);
  mqttClient.publish(topicFor(msgType).c_str(), buf);
}

// ──────────────────────────────────────────────
// Sensor reading
// ──────────────────────────────────────────────

float readBatteryPercent() {
  int raw = analogRead(BATTERY_PIN);
  // Assumes 3.3V ADC, 100k/100k voltage divider from 4.2V LiPo max
  float voltage = (raw / 4095.0) * 3.3 * 2.0;
  return constrain((voltage - 3.0) / (4.2 - 3.0) * 100.0, 0.0, 100.0);
}

float readGasLevel() {
  int raw = analogRead(GAS_PIN);
  return (raw / 4095.0) * 1000.0;  // map to 0-1000 ppm range
}

// ──────────────────────────────────────────────
// ESP-NOW — Gateway receive callback
// ──────────────────────────────────────────────

#if IS_GATEWAY
void onDataRecv(const uint8_t* mac, const uint8_t* data, int len) {
  if (len != sizeof(EspNowFrame)) return;
  memcpy(&inFrame, data, sizeof(EspNowFrame));

  Serial.printf("[ESP-NOW] Received from %02X:%02X, node=%s, type=%s\n",
    mac[4], mac[5], inFrame.nodeId, inFrame.msgType);

  // Re-publish to MQTT
  String topic = String("resqmesh/") + inFrame.nodeId + "/" + inFrame.msgType;
  mqttClient.publish(topic.c_str(), inFrame.jsonPayload);
}
#endif

// ──────────────────────────────────────────────
// ESP-NOW — Mesh node send helper
// ──────────────────────────────────────────────

#if !IS_GATEWAY
void sendViaEspNow(const char* msgType, JsonDocument& doc) {
  strncpy(outFrame.nodeId,  NODE_ID,  sizeof(outFrame.nodeId) - 1);
  strncpy(outFrame.msgType, msgType,  sizeof(outFrame.msgType) - 1);
  serializeJson(doc, outFrame.jsonPayload, sizeof(outFrame.jsonPayload));
  esp_now_send(GATEWAY_MAC, (uint8_t*)&outFrame, sizeof(outFrame));
}
#endif

// ──────────────────────────────────────────────
// Publish sensor data
// ──────────────────────────────────────────────

void publishSensor() {
  float temp  = dht.readTemperature();
  float hum   = dht.readHumidity();
  float gas   = readGasLevel();
  float bat   = readBatteryPercent();

  StaticJsonDocument<256> doc;
  doc["nodeId"]      = NODE_ID;
  doc["label"]       = NODE_LABEL;
  doc["temperature"] = isnan(temp) ? 25.0 : temp;
  doc["humidity"]    = isnan(hum)  ? 50.0 : hum;
  doc["gasLevel"]    = gas;
  doc["battery"]     = bat;
  doc["rssi"]        = WiFi.RSSI();
  doc["latency"]     = 10;   // placeholder; real value from ICMP/routing
  doc["throughput"]  = 150;  // placeholder

  #if IS_GATEWAY
    publishJson("sensor", doc);
  #else
    sendViaEspNow("sensor", doc);
  #endif

  Serial.printf("[SENSOR] temp=%.1f hum=%.1f gas=%.0f bat=%.1f\n",
    temp, hum, gas, bat);
}

// ──────────────────────────────────────────────
// Publish heartbeat
// ──────────────────────────────────────────────

void publishHeartbeat() {
  StaticJsonDocument<128> doc;
  doc["nodeId"] = NODE_ID;
  doc["ts"]     = millis();

  #if IS_GATEWAY
    publishJson("heartbeat", doc);
  #else
    sendViaEspNow("heartbeat", doc);
  #endif
}

// ──────────────────────────────────────────────
// Publish topology (neighbour list via ESP-NOW peer table)
// ──────────────────────────────────────────────

void publishTopology() {
  StaticJsonDocument<512> doc;
  doc["nodeId"] = NODE_ID;
  JsonArray neighbours = doc.createNestedArray("neighbours");

  // In a real deployment, iterate ESP-NOW peer list and measure RSSI
  // Here we add a stub neighbour for illustration:
  // JsonObject nb = neighbours.createNestedObject();
  // nb["id"]      = "B";
  // nb["rssi"]    = -65;
  // nb["latency"] = 12;

  #if IS_GATEWAY
    publishJson("topology", doc);
  #else
    sendViaEspNow("topology", doc);
  #endif
}

// ──────────────────────────────────────────────
// SOS / Alert (call from interrupt or button)
// ──────────────────────────────────────────────

void publishAlert(const char* alertType, const char* message) {
  StaticJsonDocument<200> doc;
  doc["nodeId"]    = NODE_ID;
  doc["label"]     = NODE_LABEL;
  doc["type"]      = alertType;
  doc["severity"]  = "critical";
  doc["message"]   = message;

  #if IS_GATEWAY
    publishJson("alert", doc);
  #else
    sendViaEspNow("alert", doc);
  #endif
}

// ──────────────────────────────────────────────
// Setup & Loop
// ──────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  dht.begin();

  #if IS_GATEWAY
    // ── Gateway setup ──
    WiFi.mode(WIFI_AP_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("[WiFi] Connecting");
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.printf("\n[WiFi] Connected: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi] MAC: %s\n", WiFi.macAddress().c_str());

    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setBufferSize(512);

    // Init ESP-NOW to receive from mesh nodes
    esp_now_init();
    esp_now_register_recv_cb(onDataRecv);

  #else
    // ── Mesh node setup ──
    WiFi.mode(WIFI_STA);  // Required for ESP-NOW
    esp_now_init();

    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, GATEWAY_MAC, 6);
    peerInfo.channel = 0;
    peerInfo.encrypt = false;
    esp_now_add_peer(&peerInfo);
    Serial.println("[ESP-NOW] Mesh node ready");
  #endif
}

void loop() {
  unsigned long now = millis();

  #if IS_GATEWAY
    if (!mqttClient.connected()) mqttReconnect();
    mqttClient.loop();
  #endif

  if (now - lastSensor >= SENSOR_INTERVAL_MS) {
    lastSensor = now;
    publishSensor();
  }

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = now;
    publishHeartbeat();
  }

  if (now - lastTopology >= TOPOLOGY_INTERVAL_MS) {
    lastTopology = now;
    publishTopology();
  }

  delay(10);
}
