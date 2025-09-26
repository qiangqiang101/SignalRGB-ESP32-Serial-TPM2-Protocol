import Serial from "@SignalRGB/serial";
export function Name() { return "Silicon Labs CP210x"; }
export function VendorId() { return 0x10C4; }
export function ProductId() { return 0xEA60; }
export function Publisher() { return "I'm Not MentaL"; }
export function Size() { return [1, 1]; }
export function DeviceType() { return "lightingcontroller"; }
export function Type() { return "serial"; }
export function ImageUrl() { return "https://assets.signalrgb.com/devices/default/misc/usb-drive-render.png"; }
export function SubdeviceController() { return true; }
export function Validate(endpoint) { return endpoint.interface === 0; }
/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
RGBconfig:readonly
*/
export function ControllableParameters() {
	return [
		{ "property": "shutdownColor", "group": "lighting", "label": "Shutdown Color", description: "This color is applied to the device when the System, or SignalRGB is shutting down", "min": "0", "max": "360", "type": "color", "default": "#000000" },
		{ "property": "LightingMode", "group": "lighting", "label": "Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", "type": "combobox", "values": ["Canvas", "Forced"], "default": "Canvas" },
		{ "property": "forcedColor", "group": "lighting", "label": "Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", "min": "0", "max": "360", "type": "color", "default": "#009bde" },
		{ "property": "RGBconfig", "group": "lighting", "label": "ARGB Configuration", description: "Sets the RGB color order for the ARGB Headers. If you are experiencing issues, try switching to each one of these options until you find one which works", "type": "combobox", "values": ["RGB", "RBG", "BGR", "BRG", "GBR", "GRB"], "default": "GRB" },
	];
}

export function Initialize() {
	const deviceInfo = Serial.getDeviceInfo();
	console.log(deviceInfo);

	device.setName(deviceInfo.driverDesc);

	Serial.disconnect();
	Serial.connect({ baudRate: 115200, dataBits: 8, stopBits: 'One', parity: 'None' });

	if (!Serial.isConnected()) {
		console.log('ESP32 failed to connect');
		return false;
	}

	SetupChannels();

	console.log('ESP32 Initialized');
}

function SetupChannels() {
	device.SetLedLimit(MaxLeds);
	device.addChannel('Channel 1', MaxLeds);
}

export function Render() {
	if (Serial.isConnected()) SendChannel();
}

function SendChannel(shutdown = false) {
	let componentChannel = device.channel('Channel 1');
	let channelLedCount = componentChannel.ledCount > MaxLeds ? MaxLeds : componentChannel.ledCount;

	let RGBData = [];

	if (shutdown) {
		RGBData = device.createColorArray(shutdownColor, channelLedCount, 'Inline', RGBconfig);
	} else if (LightingMode === 'Forced') {
		RGBData = device.createColorArray(forcedColor, channelLedCount, 'Inline', RGBconfig);
	} else if (componentChannel.shouldPulseColors()) {
		channelLedCount = MaxLeds
		let pulseColor = device.getChannelPulseColor('Channel 1', channelLedCount);
		RGBData = device.createColorArray(pulseColor, channelLedCount, 'Inline', RGBconfig);
	} else {
		RGBData = device.channel('Channel 1').getColors('Inline', RGBconfig);
	}

	const totalLEDs = Math.floor(RGBData.length / 3);
	const numPackets = Math.ceil(totalLEDs / MaxLedsPerPacket);

	for (let currPacket = 0; currPacket < numPackets; currPacket++) {
		const startLED = currPacket * MaxLedsPerPacket;
		const endLED = Math.min(startLED + MaxLedsPerPacket, totalLEDs);

		const startByte = startLED * 3;
		const endByte = endLED * 3;

		const packetData = RGBData.slice(startByte, endByte);
		const packet = BuildTPM2Packet(packetData);

		Serial.write(Array.from(packet));
		device.pause(1);
	}
}

function BuildTPM2Packet(colors) {
	// Normalize flat array to RGB objects if needed
	if (typeof colors[0] === 'number') {
		if (colors.length % 3 !== 0) {
			throw new Error("Flat color array length must be divisible by 3");
		}
		colors = colors.reduce((acc, val, idx) => {
			if (idx % 3 === 0) {
				acc.push({ g: val, r: colors[idx + 1], b: colors[idx + 2] });
			}
			return acc;
		}, []);
	}

	const payloadSize = colors.length * 3;
	const packetSize = payloadSize + 6; // 1 channel + 1 start + 1 type + 2 length + 1 end
	const packet = new Uint8Array(packetSize);

	packet[0] = 0x00;                // Channel byte
	packet[1] = 0xC9;                   // Start byte
	packet[2] = 0xDA;                   // Packet type (Data)
	packet[3] = (payloadSize >> 8) & 0xFF; // MSB
	packet[4] = payloadSize & 0xFF;        // LSB

	for (let i = 0; i < colors.length; i++) {
		const offset = 5 + i * 3;
		packet[offset] = colors[i].r;
		packet[offset + 1] = colors[i].g;
		packet[offset + 2] = colors[i].b;
	}

	packet[packetSize - 1] = 0x36; // End byte
	return packet;
}

export function Shutdown(SystemSuspending) {
	SendChannel(true);
	if (Serial.isConnected()) Serial.disconnect();
}

const MaxLeds = 80; // Could go higher a bit, but mine freezes with 85
const MaxLedsPerPacket = 300;