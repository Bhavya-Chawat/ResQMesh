#pragma once
// ══════════════════════════════════════════════════════════════════════════════
// ResQMesh — ESP-NOW Frame Definitions
//
// Single header shared by all firmware modules.
// Defines the on-air frame layout for every packet type exchanged over ESP-NOW.
// ══════════════════════════════════════════════════════════════════════════════

#include <stdint.h>
#include <string.h>

#define FRAME_NODE_ID_LEN   8    // nodeId string including null terminator
#define FRAME_PAYLOAD_LEN   196  // JSON payload (reduced by 4 to fit ttl+seqNum)
#define FRAME_DEFAULT_TTL     7  // Max hops before a data frame is dropped

// ── Packet type codes ─────────────────────────────────────────────────────────
// Kept as uint8_t (1 byte) to minimise frame size.
typedef enum : uint8_t {
  PKT_HELLO       = 0x01,   // Discovery broadcast
  PKT_HELLO_ACK   = 0x02,   // Unicast reply to HELLO
  PKT_DV_UPDATE   = 0x03,   // Distance Vector routing table broadcast
  PKT_DATA        = 0x10,   // Generic application payload
  PKT_HEARTBEAT   = 0x11,   // Keepalive
  PKT_SENSOR      = 0x12,   // Sensor reading
  PKT_ALERT       = 0x13,   // SOS / emergency
  PKT_TOPOLOGY    = 0x14,   // Neighbor list report
} PktType;

// ── QoS priority levels ───────────────────────────────────────────────────────────────
// Numeric values are indices into the four-queue array — do not change them.
typedef enum : uint8_t {
  QOS_HIGH   = 0,  // PKT_ALERT — emergency / SOS
  QOS_MEDIUM = 1,  // PKT_SENSOR, PKT_HEARTBEAT, PKT_TOPOLOGY
  QOS_LOW    = 2,  // PKT_DATA, PKT_DV_UPDATE
  QOS_DEBUG  = 3,  // Any future diagnostic packet type
} QosPriority;

#define QOS_NUM_LEVELS 4

// Map a packet type to its default QoS priority.
inline QosPriority pktTypeToPriority(uint8_t pktType) {
  switch ((PktType)pktType) {
    case PKT_ALERT:     return QOS_HIGH;
    case PKT_SENSOR:
    case PKT_HEARTBEAT:
    case PKT_TOPOLOGY:  return QOS_MEDIUM;
    case PKT_DATA:
    case PKT_DV_UPDATE: return QOS_LOW;
    default:            return QOS_DEBUG;
  }
}

// ── Distance Vector update entry (packed into MeshFrame.payload) ──────────────
// Each DV_UPDATE frame carries an array of DVEntry records.
// Cost metric: link cost = max(1, 110 + RSSI)  (maps -110..-30 dBm → 0..80)
//              route cost = sum of link costs along the path

#define DV_INFINITY      255   // Unreachable sentinel (fits in uint8_t)
#define DV_MAX_ENTRIES    17   // Max entries per DV_UPDATE frame
                               // (17 × 11 bytes = 187 bytes ≤ FRAME_PAYLOAD_LEN)

typedef struct __attribute__((packed)) {
  char    dest[FRAME_NODE_ID_LEN];  // Destination node ID
  uint8_t cost;                     // Route cost (metric), DV_INFINITY = unreachable
  uint8_t hopCount;                 // Number of hops to destination
  uint8_t seqNum;                   // Destination's own sequence number (anti-loop)
} DVEntry;  // 11 bytes

static_assert(sizeof(DVEntry) * DV_MAX_ENTRIES <= FRAME_PAYLOAD_LEN,
              "DVEntry array overflows payload");

// ── Wire frame ────────────────────────────────────────────────────────────────
// Every ESP-NOW transmission is exactly one MeshFrame.
// Maximum ESP-NOW payload is 250 bytes — this struct must stay ≤ 250 bytes.

typedef struct __attribute__((packed)) {
  uint8_t  pktType;                    // PktType enum
  char     srcId[FRAME_NODE_ID_LEN];   // Originating node ID (null-terminated)
  char     dstId[FRAME_NODE_ID_LEN];   // Destination node ID; "**" = broadcast
  uint8_t  srcMac[6];                  // Originating node MAC
  int8_t   rssi;                       // Sender-side RSSI (HELLO/HELLO_ACK only)
  uint8_t  ttl;                        // Hops remaining; drop frame when 0
  uint16_t seqNum;                     // Per-source sequence number (dedup)
  char     payload[FRAME_PAYLOAD_LEN]; // JSON string
} MeshFrame;

// Compile-time guard: frame must fit in one ESP-NOW packet
static_assert(sizeof(MeshFrame) <= 250, "MeshFrame exceeds ESP-NOW 250-byte limit");

// ── Helper: fill a frame header ───────────────────────────────────────────────
// Sets default TTL and seqNum=0. Caller must set frame->seqNum after calling
// when a specific sequence number is needed.
inline void frameInit(MeshFrame* f, PktType type,
                      const char* srcId, const char* dstId,
                      const uint8_t srcMac[6]) {
  memset(f, 0, sizeof(MeshFrame));
  f->pktType = (uint8_t)type;
  strncpy(f->srcId, srcId, FRAME_NODE_ID_LEN - 1);
  strncpy(f->dstId, dstId, FRAME_NODE_ID_LEN - 1);
  memcpy(f->srcMac, srcMac, 6);
  f->rssi   = 0;
  f->ttl    = FRAME_DEFAULT_TTL;
  f->seqNum = 0;  // caller sets a real seqNum for data frames
}
