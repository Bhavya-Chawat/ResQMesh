import paho.mqtt.client as mqtt
import time

def on_message(client, userdata, message):
    print(f"Received message on {message.topic}: {message.payload.decode('utf-8')}")

client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2)
client.on_message = on_message

try:
    print("Connecting to MQTT broker at localhost...")
    client.connect("localhost", 1883, 60)
    client.subscribe("#")
    client.loop_start()
    print("Listening for 10 seconds. Please wait...")
    time.sleep(10)
    client.loop_stop()
except Exception as e:
    print(f"Error: {e}")
