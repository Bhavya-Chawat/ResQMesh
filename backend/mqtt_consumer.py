"""
mqtt_consumer.py
----------------
Standalone helper that can be imported by app.py or run independently
for testing MQTT connectivity without the Flask server.

Usage (standalone test):
    python mqtt_consumer.py

It will print every incoming message to stdout.
"""

import json
import logging
import os
import time

import paho.mqtt.client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

TOPICS = [
    "resqmesh/+/sensor",
    "resqmesh/+/heartbeat",
    "resqmesh/+/alert",
    "resqmesh/+/topology",
]


class MQTTConsumer:
    """
    Thin wrapper around paho-mqtt that handles:
      - Auto-reconnect
      - Topic subscription on connect
      - Message dispatching to registered handlers
    """

    def __init__(self, broker: str, port: int, username: str = "", password: str = ""):
        self.broker   = broker
        self.port     = port
        self._handlers: dict[str, list] = {}   # msg_type → [callable]

        self._client = mqtt.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id=f"resqmesh-consumer-{int(time.time())}",
            protocol=mqtt.MQTTv5,
        )
        if username:
            self._client.username_pw_set(username, password)

        self._client.on_connect    = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message    = self._on_message

    # ── Public API ───────────────────────────────

    def on(self, msg_type: str):
        """Decorator: @consumer.on('sensor') def handle(node_id, payload): ..."""
        def decorator(fn):
            self._handlers.setdefault(msg_type, []).append(fn)
            return fn
        return decorator

    def connect(self, keepalive: int = 60):
        self._client.connect(self.broker, self.port, keepalive)

    def loop_start(self):
        self._client.loop_start()

    def loop_stop(self):
        self._client.loop_stop()

    def loop_forever(self):
        self._client.loop_forever()

    def is_connected(self) -> bool:
        return self._client.is_connected()

    # ── Internal callbacks ────────────────────────

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        if reason_code == 0:
            log.info("MQTTConsumer connected to %s:%d", self.broker, self.port)
            for topic in TOPICS:
                client.subscribe(topic)
                log.info("Subscribed: %s", topic)
        else:
            log.error("MQTTConsumer failed to connect: %s", reason_code)

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties):
        log.warning("MQTTConsumer disconnected (%s)", reason_code)

    def _on_message(self, client, userdata, msg):
        parts = msg.topic.split("/")
        if len(parts) < 3 or parts[0] != "resqmesh":
            return

        node_id  = parts[1]
        msg_type = parts[2]

        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = {}

        for handler in self._handlers.get(msg_type, []):
            try:
                handler(node_id, payload)
            except Exception as exc:
                log.error("Handler error for %s/%s: %s", node_id, msg_type, exc)


# ──────────────────────────────────────────────
# Standalone test mode
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    broker = os.getenv("MQTT_BROKER", "localhost")
    port   = int(os.getenv("MQTT_PORT", 1883))

    consumer = MQTTConsumer(broker, port)

    @consumer.on("sensor")
    def on_sensor(node_id, payload):
        print(f"[SENSOR] {node_id}: {payload}")

    @consumer.on("heartbeat")
    def on_heartbeat(node_id, payload):
        print(f"[HB] {node_id}: {payload}")

    @consumer.on("alert")
    def on_alert(node_id, payload):
        print(f"[ALERT] {node_id}: {payload}")

    @consumer.on("topology")
    def on_topology(node_id, payload):
        print(f"[TOPO] {node_id}: {payload}")

    consumer.connect()
    print(f"Listening on {broker}:{port} — Ctrl+C to stop")
    try:
        consumer.loop_forever()
    except KeyboardInterrupt:
        consumer.loop_stop()
        sys.exit(0)
